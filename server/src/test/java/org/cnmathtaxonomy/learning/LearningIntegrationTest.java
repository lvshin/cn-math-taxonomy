package org.cnmathtaxonomy.learning;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

/** Runs against an explicitly supplied disposable PostgreSQL 18 database, never an embedded substitute. */
@EnabledIfEnvironmentVariable(named = "LEARNING_TEST_JDBC_URL", matches = ".+")
class LearningIntegrationTest {
    static final String ISSUER = "https://identity.example.invalid/realms/test";
    static AnnotationConfigApplicationContext context;
    static HikariDataSource migration;
    static LearningService learning;
    static LearningRecords records;
    static LearningStore store;
    static ObjectMapper mapper;
    static TransactionTemplate transaction;

    @Configuration
    @EnableTransactionManagement
    static class Config {
        // Match Boot's repository exception-translation proxy instead of testing a raw DAO instance.
        @Bean
        static org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor repositoryProxies() {
            var processor = new org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor();
            processor.setProxyTargetClass(true);
            return processor;
        }
        @Bean(destroyMethod = "close")
        DataSource dataSource() {
            return source("learning_app", "LEARNING_TEST_APP_PASSWORD");
        }
        @Bean
        JdbcTemplate jdbc(DataSource dataSource) {
            return new JdbcTemplate(dataSource);
        }
        @Bean
        PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }
        @Bean
        ObjectMapper mapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
        @Bean
        LearningProperties properties() {
            return new LearningProperties(LearningService.token(), ISSUER, "learning-test", ISSUER, "operator");
        }
        @Bean
        LearningStore store(JdbcTemplate jdbc, ObjectMapper mapper) {
            return new LearningStore(jdbc, mapper);
        }
        @Bean
        LearningService service(LearningStore store, LearningProperties properties, ObjectMapper mapper) {
            return new LearningService(store, properties, mapper);
        }
        @Bean
        LearningRecords records(LearningService service, LearningStore store, ObjectMapper mapper) {
            return new LearningRecords(service, store, mapper);
        }
    }

    @Configuration
    @org.springframework.web.servlet.config.annotation.EnableWebMvc
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    @org.springframework.context.annotation.Import({SecurityConfiguration.class, LearningController.class, ApiErrors.class})
    static class WebConfig {
        @Bean
        org.springframework.security.oauth2.client.registration.ClientRegistrationRepository clients() {
            return new org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository(
                    org.springframework.security.oauth2.client.registration.ClientRegistration.withRegistrationId("learning")
                            .clientId("learning-test").clientSecret("synthetic-test-client-secret").scope("openid", "profile")
                            .authorizationGrantType(org.springframework.security.oauth2.core.AuthorizationGrantType.AUTHORIZATION_CODE)
                            .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                            .authorizationUri(ISSUER + "/protocol/openid-connect/auth")
                            .tokenUri(ISSUER + "/protocol/openid-connect/token")
                            .jwkSetUri(ISSUER + "/protocol/openid-connect/certs")
                            .providerConfigurationMetadata(Map.of("end_session_endpoint", ISSUER + "/protocol/openid-connect/logout"))
                            .issuerUri(ISSUER).userNameAttributeName("sub").build());
        }
    }

    static HikariDataSource source(String user, String passwordVariable) {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(System.getenv("LEARNING_TEST_JDBC_URL"));
        config.setUsername(user);
        config.setPassword(System.getenv().getOrDefault(passwordVariable, ""));
        config.setMaximumPoolSize(8);
        return new HikariDataSource(config);
    }

    @BeforeAll
    static void start() {
        migration = source("learning_migrator", "LEARNING_TEST_MIGRATION_PASSWORD");
        Flyway.configure().dataSource(migration).locations("classpath:db/migration").load().migrate();
        context = new AnnotationConfigApplicationContext(Config.class);
        learning = context.getBean(LearningService.class);
        records = context.getBean(LearningRecords.class);
        store = context.getBean(LearningStore.class);
        assertTrue(org.springframework.aop.support.AopUtils.isCglibProxy(store), "Tests must exercise the production repository proxy");
        mapper = context.getBean(ObjectMapper.class);
        transaction = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    }

    @AfterAll
    static void stop() {
        if (context != null) {
            context.close();
        }
        if (migration != null) {
            migration.close();
        }
    }

    @BeforeEach
    void clear() {
        new JdbcTemplate(migration).execute("TRUNCATE learning.users CASCADE");
    }

    static OidcUser user(String subject) {
        return user(subject, null);
    }

    static OidcUser user(String subject, String receipt) {
        var token = OidcIdToken.withTokenValue("synthetic-test-token").issuer(ISSUER).subject(subject)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(3600)).claim("preferred_username", subject);
        if (receipt != null) {
            token.claim("learning_registration_receipt", receipt);
        }
        return new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")), token.build());
    }

    static ObjectNode json(Object... fields) {
        ObjectNode node = mapper.createObjectNode();
        for (int i = 0; i < fields.length; i += 2) {
            node.set(fields[i].toString(), mapper.valueToTree(fields[i + 1]));
        }
        return node;
    }

    static UUID family(String name, OidcUser owner) {
        if (!"operator".equals(owner.getSubject())) {
            String token = learning.invite(user("operator"), null, json()).get("token").toString();
            learning.accept(owner, json("token", token));
        }
        return (UUID) learning.createFamily(owner, json("name", name)).get("id");
    }

    static UUID child(OidcUser owner, UUID family, String name) {
        return (UUID) learning.createChild(owner, family, json("nickname", name, "stage", "家庭活动")).get("id");
    }

    static void join(OidcUser owner, UUID family, OidcUser member, String role) {
        String token = learning.invite(owner, family, json("role", role)).get("token").toString();
        learning.accept(member, json("token", token));
    }

    @Test
    void databaseGuardAndRowIsolationAreReal() {
        new DatabaseSafety(context.getBean(JdbcTemplate.class)).verify();
        OidcUser alice = user("operator");
        UUID family = family("合成家庭甲", alice);
        UUID child = child(alice, family, "甲一");
        transaction.executeWithoutResult(status -> {
            var actor = learning.actor(alice);
            assertEquals(0, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM learning.children", Integer.class));
            learning.family(actor, family, false, false);
            assertEquals(1, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM learning.children", Integer.class));
        });
        transaction.executeWithoutResult(status -> assertEquals(0, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM learning.children", Integer.class)));
        assertEquals(10, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='learning' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity", Integer.class));
    }

    @Test
    void twoFamiliesTwoChildrenCannotCrossReadWriteOrExport() {
        OidcUser alice = user("operator");
        OidcUser bob = user("bob");
        UUID fa = family("合成家庭甲", alice);
        UUID a1 = child(alice, fa, "甲一");
        child(alice, fa, "甲二");
        UUID fb = family("合成家庭乙", bob);
        UUID b1 = child(bob, fb, "乙一");
        child(bob, fb, "乙二");
        assertEquals(2, learning.children(alice, fa).size());
        assertEquals(2, learning.children(bob, fb).size());
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> learning.children(alice, fb)).code());
        assertThrows(ApiException.class, () -> records.history(alice, fa, b1, null, 50));
        assertThrows(ApiException.class, () -> records.export(alice, fb));
        assertThrows(ApiException.class, () -> records.createSession(alice, fa, b1, sessionRequest()));
        transaction.executeWithoutResult(status -> {
            var actor = learning.actor(alice);
            learning.family(actor, fa, true, false);
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> store.update("INSERT INTO learning.sessions(id,family_id,child_id,author_id,data_version,content_snapshot,snapshot,initial_fingerprint) VALUES(?,?,?,?,?,'{}','{}',?)", UUID.randomUUID(), fa, b1, actor.id(), "synthetic", "synthetic"));
            status.setRollbackOnly();
        });
        OidcUser viewer = user("family-b-viewer");
        join(bob, fb, viewer, "VIEWER");
        assertEquals(1, learning.families(viewer).size());
        assertEquals(2, learning.children(viewer, fb).size());
        assertThrows(ApiException.class, () -> child(viewer, fb, "禁止创建"));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> learning.children(viewer, fa)).code());
    }

    @Test
    void creatingOrJoiningBlocksAnotherFamilyWithoutConsumingInvitations() {
        OidcUser owner = user("operator");
        OidcUser otherOwner = user("other-owner");
        UUID first = family("合成家庭甲", owner);
        UUID second = family("合成家庭乙", otherOwner);
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.createFamily(owner, json("name", "不应创建"))).code());
        String invite = learning.invite(otherOwner, second, json("role", "EDITOR")).get("token").toString();
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.accept(owner, json("token", invite))).code());
        assertEquals(second, learning.preview(json("token", invite)).get("familyId"));
        assertEquals(first, learning.families(owner).getFirst().get("id"));
        assertEquals(true, learning.accept(user("new-member"), json("token", invite)).get("accepted"));

        String onboarding = learning.invite(owner, null, json()).get("token").toString();
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.accept(owner, json("token", onboarding))).code());
        assertEquals("ONBOARDING", learning.preview(json("token", onboarding)).get("kind"));
        OidcUser creator = user("invited-creator");
        assertEquals(true, learning.accept(creator, json("token", onboarding)).get("canCreateFamily"));
        learning.createFamily(creator, json("name", "合成家庭丙"));
        assertEquals(false, learning.accept(creator, json("token", onboarding)).get("canCreateFamily"));
    }

    @Test
    void leavingAllowsAnotherFamilyAndAcceptedRetryDoesNotRestoreOldAccess() {
        OidcUser owner = user("operator");
        OidcUser otherOwner = user("other-owner");
        OidcUser member = user("moving-member");
        UUID first = family("合成家庭甲", owner);
        UUID second = family("合成家庭乙", otherOwner);
        UUID child = child(owner, first, "合成孩子");
        String original = learning.invite(owner, first, json("role", "EDITOR")).get("token").toString();
        learning.accept(member, json("token", original));
        records.createSession(member, first, child, sessionRequest());
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.createFamily(member, json("name", "不应创建"))).code());
        String next = learning.invite(otherOwner, second, json("role", "VIEWER")).get("token").toString();
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.accept(member, json("token", next))).code());
        assertEquals(true, learning.accept(member, json("token", original)).get("accepted"));
        learning.leave(member, first);
        assertEquals(true, learning.accept(member, json("token", next)).get("accepted"));
        // Retrying a previously successful request reports its result without reinstating membership.
        assertEquals(first, learning.accept(member, json("token", original)).get("familyId"));
        assertEquals(1, learning.families(member).size());
        assertEquals(second, learning.families(member).getFirst().get("id"));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> learning.children(member, first)).code());
        assertEquals(1, records.sessions(owner, first, child).size());
        assertEquals(learning.me(member).get("id"), records.sessions(owner, first, child).getFirst().get("authorId"));
    }

    @Test
    void reactivatingAFormerMemberCannotBypassTheFamilyLimitUnderRls() {
        OidcUser owner = user("operator");
        OidcUser otherOwner = user("other-owner");
        OidcUser member = user("former-member");
        UUID first = family("合成家庭甲", owner);
        UUID second = family("合成家庭乙", otherOwner);
        join(owner, first, member, "EDITOR");
        UUID memberId = (UUID) learning.me(member).get("id");
        learning.leave(member, first);
        join(otherOwner, second, member, "VIEWER");
        assertEquals("FAMILY_ALREADY_JOINED", assertThrows(ApiException.class,
                () -> learning.updateMember(owner, first, memberId, json("role", "EDITOR", "active", true, "version", 1))).code());
        assertEquals(second, learning.families(member).getFirst().get("id"));
        assertEquals(false, learning.members(owner, first).stream().filter(value -> memberId.equals(value.get("userId"))).findFirst().orElseThrow().get("active"));
        learning.leave(member, second);
        assertEquals(true, learning.updateMember(owner, first, memberId,
                json("role", "EDITOR", "active", true, "version", 1)).get("active"));
        assertEquals(first, learning.families(member).getFirst().get("id"));
    }

    @Test
    void concurrentCreatesAndJoinsForOneIdentityHaveExactlyOneWinner() throws Exception {
        OidcUser operator = user("operator");
        OidcUser otherOwner = user("other-owner");
        UUID first = family("合成家庭甲", operator);
        UUID second = family("合成家庭乙", otherOwner);
        OidcUser creator = user("concurrent-creator");
        String onboarding = learning.invite(operator, null, json()).get("token").toString();
        learning.accept(creator, json("token", onboarding));
        assertOneFamilyWinner(creator,
                () -> learning.createFamily(creator, json("name", "并发甲")),
                () -> learning.createFamily(creator, json("name", "并发乙")));

        OidcUser mixed = user("concurrent-create-join");
        String mixedOnboarding = learning.invite(operator, null, json()).get("token").toString();
        learning.accept(mixed, json("token", mixedOnboarding));
        String mixedInvite = learning.invite(operator, first, json("role", "EDITOR")).get("token").toString();
        assertOneFamilyWinner(mixed,
                () -> learning.createFamily(mixed, json("name", "并发创建")),
                () -> learning.accept(mixed, json("token", mixedInvite)));

        OidcUser joiner = user("concurrent-joiner");
        String inviteA = learning.invite(operator, first, json("role", "EDITOR")).get("token").toString();
        String inviteB = learning.invite(otherOwner, second, json("role", "VIEWER")).get("token").toString();
        assertOneFamilyWinner(joiner,
                () -> learning.accept(joiner, json("token", inviteA)),
                () -> learning.accept(joiner, json("token", inviteB)));
        UUID joined = (UUID) learning.families(joiner).getFirst().get("id");
        String unused = joined.equals(first) ? inviteB : inviteA;
        assertNotNull(learning.preview(json("token", unused)).get("familyId"));
    }

    @Test
    void uniqueIndexMigrationRejectsLegacyMultipleFamiliesTransactionally() throws Exception {
        OidcUser owner = user("operator");
        OidcUser otherOwner = user("other-owner");
        OidcUser member = user("legacy-member");
        UUID first = family("合成家庭甲", owner);
        UUID second = family("合成家庭乙", otherOwner);
        join(owner, first, member, "EDITOR");
        UUID memberId = (UUID) learning.me(member).get("id");
        String migrationSql = new org.springframework.core.io.ClassPathResource("db/migration/V7__one_active_family_per_user.sql")
                .getContentAsString(StandardCharsets.UTF_8);
        var migrationTransaction = new TransactionTemplate(new DataSourceTransactionManager(migration));
        JdbcTemplate jdbc = new JdbcTemplate(migration);
        migrationTransaction.executeWithoutResult(status -> {
            jdbc.execute("DROP INDEX learning.members_one_active_family");
            jdbc.queryForObject("SELECT set_config('learning.family',?,true)", String.class, second.toString());
            jdbc.queryForObject("SELECT set_config('learning.role','OWNER',true)", String.class);
            // Simulate the previously supported state without weakening FORCE RLS.
            jdbc.update("INSERT INTO learning.members(family_id,user_id,role) VALUES(?,?,'VIEWER')", second, memberId);
            assertThrows(org.springframework.dao.DuplicateKeyException.class, () -> jdbc.execute(migrationSql));
            status.setRollbackOnly();
        });
        // Failed DDL rolls the whole migration back; it never chooses or deletes a membership.
        new DatabaseSafety(context.getBean(JdbcTemplate.class)).verify();
        assertEquals(1, learning.families(member).size());
        assertEquals(first, learning.families(member).getFirst().get("id"));
    }

    static void assertOneFamilyWinner(OidcUser user, Callable<?> first, Callable<?> second) throws Exception {
        var ready = new java.util.concurrent.CountDownLatch(2);
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var operations = List.of(first, second).stream().map(operation -> executor.submit(() -> {
                ready.countDown();
                assertTrue(start.await(5, java.util.concurrent.TimeUnit.SECONDS));
                try {
                    operation.call();
                    return "OK";
                } catch (ApiException exception) {
                    return exception.code();
                }
            })).toList();
            assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS));
            start.countDown();
            var outcomes = List.of(operations.get(0).get(5, java.util.concurrent.TimeUnit.SECONDS),
                    operations.get(1).get(5, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter("OK"::equals).count());
            assertEquals(1, outcomes.stream().filter("FAMILY_ALREADY_JOINED"::equals).count());
        }
        assertEquals(1, learning.families(user).size());
    }

    static ObjectNode sessionRequest() {
        return json("id", UUID.randomUUID(), "dataVersion", "synthetic-old-v1", "snapshot", Map.of("answers", List.of(), "targets", List.of("synthetic-topic")), "contentSnapshot", Map.of("questions", List.of()));
    }

    @Test
    void sessionsPreserveContentAndRejectCompetingChanges() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        ObjectNode request = sessionRequest();
        UUID id = UUID.fromString(request.path("id").asText());
        var created = records.createSession(owner, family, child, request);
        assertEquals(0L, created.get("version"));
        assertEquals(id, records.createSession(owner, family, child, request).get("id"));
        ObjectNode competing = request.deepCopy().put("dataVersion", "different");
        assertEquals("IDEMPOTENCY_CONFLICT", assertThrows(ApiException.class, () -> records.createSession(owner, family, child, competing)).code());
        ObjectNode update = json("version", 0, "finished", false, "snapshot", Map.of("answers", List.of(Map.of("id", "synthetic-topic", "qid", "synthetic-question", "result", "correct"))), "contentSnapshot", Map.of("questions", List.of(Map.of("prompt", "original"))));
        assertEquals(1L, records.updateSession(owner, family, child, id, update).get("version"));
        assertEquals(1L, records.updateSession(owner, family, child, id, update).get("version"));
        ObjectNode different = update.deepCopy();
        different.set("snapshot", json("answers", List.of(Map.of("result", "wrong"))));
        assertEquals("VERSION_CONFLICT", assertThrows(ApiException.class, () -> records.updateSession(owner, family, child, id, different)).code());
        var history = records.history(owner, family, child, null, 50);
        var item = ((List<Map<String, Object>>) history.get("items")).getFirst();
        assertEquals("synthetic-old-v1", item.get("dataVersion"));
        assertEquals("operator", item.get("authorName"));
        assertNotNull(item.get("authorId"));
        assertEquals("original", ((JsonNode) item.get("contentSnapshot")).path("questions").get(0).path("prompt").asText());
    }

    static JsonNode currentPracticeQuestion() {
        try (var stream = new org.springframework.core.io.ClassPathResource("static/data/questions.json").getInputStream()) {
            return mapper.readTree(stream).get(0);
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        }
    }

    static ObjectNode practiceRequest(JsonNode question, String result) {
        return json("id", UUID.randomUUID(), "dataVersion", "compatible-legacy-version",
                "snapshot", Map.of("schema", 1, "answers", List.of(Map.of("id", question.path("topicId").asText(), "qid", question.path("id").asText(), "result", result, "text", "private-original-answer"))),
                "contentSnapshot", Map.of("questions", List.of(question)));
    }

    static Map<String, Object> practiceFamily(Map<String, Object> profile, String key) {
        return (Map<String, Object>) ((Map<?, ?>) profile.get("families")).get(key);
    }

    @Test
    void practiceProfileIsChildScopedReadableByViewerAndRevokedImmediately() {
        OidcUser owner = user("operator"), otherOwner = user("profile-other-owner"), viewer = user("profile-viewer");
        UUID family = family("合成练习家庭甲", owner), first = child(owner, family, "甲一"), second = child(owner, family, "甲二");
        UUID otherFamily = family("合成练习家庭乙", otherOwner), otherChild = child(otherOwner, otherFamily, "乙一");
        JsonNode question = currentPracticeQuestion();
        records.createSession(owner, family, first, practiceRequest(question, "correct"));
        records.createSession(owner, family, second, practiceRequest(question, "wrong"));
        join(owner, family, viewer, "VIEWER");
        String key = "fixed:" + question.path("id").asText();
        assertEquals(1, practiceFamily(records.practiceProfile(viewer, family, first), key).get("correct"));
        assertEquals(0, practiceFamily(records.practiceProfile(viewer, family, second), key).get("correct"));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> records.practiceProfile(owner, otherFamily, otherChild)).code());
        assertThrows(ApiException.class, () -> records.practiceProfile(owner, family, otherChild));
        assertThrows(ApiException.class, () -> records.createSession(viewer, family, first, practiceRequest(question, "correct")));
        UUID viewerId = (UUID) learning.me(viewer).get("id");
        learning.updateMember(owner, family, viewerId, json("role", "VIEWER", "active", false, "version", 0));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> records.practiceProfile(viewer, family, first)).code());
    }

    @Test
    void practiceProfileReadsBeyondThousandSessionsAndCountsLatestSnapshotOnly() {
        OidcUser owner = user("operator");
        UUID family = family("合成练习家庭", owner), child = child(owner, family, "合成孩子");
        JsonNode question = currentPracticeQuestion();
        ObjectNode initial = practiceRequest(question, "wrong");
        UUID session = UUID.fromString(initial.path("id").asText());
        records.createSession(owner, family, child, initial);
        records.createSession(owner, family, child, initial);
        ObjectNode updated = practiceRequest(question, "correct");
        ObjectNode save = json("version", 0, "finished", false, "snapshot", updated.path("snapshot"), "contentSnapshot", updated.path("contentSnapshot"));
        records.updateSession(owner, family, child, session, save);
        records.updateSession(owner, family, child, session, save);
        transaction.executeWithoutResult(status -> {
            var actor = learning.actor(owner);
            learning.family(actor, family, true, false);
            store.update("INSERT INTO learning.sessions(id,family_id,child_id,author_id,data_version,content_snapshot,snapshot,initial_fingerprint) "
                    + "SELECT gen_random_uuid(),?,?,?,'compatible-legacy-version',?::jsonb,?::jsonb,'synthetic-direct-history' FROM generate_series(1,1001)",
                    family, child, actor.id(), initial.path("contentSnapshot").toString(), initial.path("snapshot").toString());
        });
        assertEquals(1000, records.sessions(owner, family, child).size());
        var profile = records.practiceProfile(owner, family, child);
        var stats = practiceFamily(profile, "fixed:" + question.path("id").asText());
        assertEquals(1, stats.get("correct"));
        assertEquals(1001, stats.get("wrong"));
        assertEquals(1, ((List<?>) profile.get("reviewQuestions")).size());
        assertFalse(mapper.valueToTree(profile).toString().contains("private-original-answer"));
        assertEquals(List.of(question.path("topicId").asText()), profile.get("topicIds"));
    }

    @Test
    void practiceProfileExcludesImportsObservationInferredAndChangedQuestionSemantics() {
        OidcUser owner = user("operator");
        UUID family = family("合成练习家庭", owner), child = child(owner, family, "合成孩子");
        JsonNode question = currentPracticeQuestion();
        ObjectNode record = json("schema", 1, "dataVersion", "legacy", "targets", List.of(question.path("topicId").asText()), "options", Map.of(),
                "answers", List.of(Map.of("id", question.path("topicId").asText(), "qid", question.path("id").asText(), "result", "correct")));
        records.importRecord(owner, family, child, json("id", UUID.randomUUID(), "record", record));
        var activity = records.activities().get(0);
        records.observe(owner, family, child, json("id", UUID.randomUUID(), "activityId", activity.path("id").asText(), "activityVersion", activity.path("version").asText(),
                "outcome", "INDEPENDENT", "note", "合成观察", "occurredAt", Instant.now().toString()));
        ObjectNode inferred = practiceRequest(question, "correct");
        ((ObjectNode) inferred.path("snapshot").path("answers").get(0)).put("gradeSource", "inferred");
        records.createSession(owner, family, child, inferred);
        ObjectNode changedQuestion = question.deepCopy();
        changedQuestion.put("prompt", "旧版含义已改变");
        records.createSession(owner, family, child, practiceRequest(changedQuestion, "correct"));
        var empty = records.practiceProfile(owner, family, child);
        assertTrue(((Map<?, ?>) empty.get("families")).isEmpty());
        assertTrue(((List<?>) empty.get("topicIds")).isEmpty());
        records.createSession(owner, family, child, practiceRequest(question, "skip"));
        assertEquals(1, practiceFamily(records.practiceProfile(owner, family, child), "fixed:" + question.path("id").asText()).get("skip"));
    }

    @Test
    void schemaTwoSessionsFreezePlanAndAppendDirectAnswersWithSafeRetries() {
        OidcUser owner = user("operator");
        UUID family = family("合成练习家庭", owner), child = child(owner, family, "合成孩子");
        JsonNode question = currentPracticeQuestion();
        ObjectNode snapshot = json("schema", 2, "mode", "practice", "seed", "synthetic-seed", "startedAt", Instant.now().toString(), "dataVersion", "legacy-compatible", "targets", List.of(question.path("topicId").asText()),
                "limit", 5, "plan", List.of(question), "answers", List.of(), "selection", Map.of("strategyVersion", "1", "catalogVersion", "1", "asOf", Instant.now().toString(), "weights", Map.of()));
        ObjectNode content = json("questions", List.of(question));
        UUID id = UUID.randomUUID();
        ObjectNode request = json("id", id, "dataVersion", "legacy-compatible", "snapshot", snapshot, "contentSnapshot", content);
        var created = records.createSession(owner, family, child, request);
        assertEquals(0L, created.get("version"));
        ObjectNode answered = snapshot.deepCopy();
        answered.set("answers", mapper.valueToTree(List.of(Map.of("id", question.path("topicId").asText(), "qid", question.path("id").asText(), "result", "correct", "answeredAt", Instant.now().toString(),
                "gradeSource", "auto", "familyKey", "fixed:" + question.path("id").asText()))));
        ObjectNode update = json("version", 0, "finished", false, "snapshot", answered, "contentSnapshot", content);
        assertEquals(1L, records.updateSession(owner, family, child, id, update).get("version"));
        assertEquals(1L, records.updateSession(owner, family, child, id, update).get("version"));
        assertEquals(1, practiceFamily(records.practiceProfile(owner, family, child), "fixed:" + question.path("id").asText()).get("correct"));
        ObjectNode competingAnswer = update.deepCopy();
        ((ObjectNode) competingAnswer.path("snapshot").path("answers").get(0)).put("result", "wrong");
        assertEquals("VERSION_CONFLICT", assertThrows(ApiException.class, () -> records.updateSession(owner, family, child, id, competingAnswer)).code());
        ObjectNode mutated = update.deepCopy().put("version", 1);
        ((ObjectNode) mutated.path("snapshot")).put("seed", "changed");
        assertThrows(ApiException.class, () -> records.updateSession(owner, family, child, id, mutated));
        ObjectNode deleteAnswer = update.deepCopy().put("version", 1);
        ((ObjectNode) deleteAnswer.path("snapshot")).set("answers", mapper.createArrayNode());
        assertThrows(ApiException.class, () -> records.updateSession(owner, family, child, id, deleteAnswer));
        ObjectNode mismatched = request.deepCopy();
        mismatched.put("id", UUID.randomUUID().toString());
        ((ObjectNode) mismatched.path("contentSnapshot")).set("questions", mapper.createArrayNode());
        assertThrows(ApiException.class, () -> records.createSession(owner, family, child, mismatched));
    }

    @Test
    void sessionSnapshotBoundaryCountsUtf8Bytes() {
        OidcUser owner = user("operator");
        UUID family = family("合成练习家庭", owner), child = child(owner, family, "合成孩子");
        ObjectNode request = sessionRequest();
        ((ObjectNode) request.path("snapshot")).put("oversized", "汉".repeat(170_000));
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> records.createSession(owner, family, child, request)).code());
        ObjectNode content = sessionRequest();
        ((ObjectNode) content.path("contentSnapshot")).put("oversized", "汉".repeat(170_000));
        assertThrows(ApiException.class, () -> records.createSession(owner, family, child, content));
        assertTrue(records.sessions(owner, family, child).isEmpty());
    }

    @Test
    void practiceProfileHttpUsesProxiedRepositoryWithRealPostgres() throws Exception {
        assertTrue(org.springframework.aop.support.AopUtils.isCglibProxy(store));
        OidcUser owner = user("operator"), viewer = user("proxied-profile-viewer"), otherOwner = user("proxied-other-owner");
        UUID family = family("合成代理家庭甲", owner), child = child(owner, family, "甲一");
        UUID otherFamily = family("合成代理家庭乙", otherOwner), otherChild = child(otherOwner, otherFamily, "乙一");
        join(owner, family, viewer, "VIEWER");
        try (var web = new org.springframework.web.context.support.AnnotationConfigWebApplicationContext()) {
            web.setParent(context);
            web.setServletContext(new org.springframework.mock.web.MockServletContext());
            web.register(WebConfig.class);
            web.refresh();
            var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(web)
                    .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity()).build();
            String path = "/api/v1/families/" + family + "/children/" + child + "/practice-profile";
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
            // The empty child exercises the streamed-query path too; this failed on the production proxy before the fix.
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(owner)))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.topicIds").isEmpty());
            JsonNode question = currentPracticeQuestion();
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path.replace("practice-profile", "sessions"))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(owner))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf())
                            .contentType("application/json").content(practiceRequest(question, "correct").toString()))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
            String statistics = "$.families['fixed:" + question.path("id").asText() + "'].correct";
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(viewer)))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("Cache-Control", "no-store"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(statistics).value(1));
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path.replace("practice-profile", "sessions"))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(viewer))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf())
                            .contentType("application/json").content(practiceRequest(question, "correct").toString()))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden());
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path.replace(child.toString(), otherChild.toString()))
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(owner)))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/families/" + otherFamily + "/children/" + otherChild + "/practice-profile")
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(owner)))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
            UUID viewerId = (UUID) learning.me(viewer).get("id");
            learning.updateMember(owner, family, viewerId, json("role", "VIEWER", "active", false, "version", 0));
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)
                            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin().oidcUser(viewer)))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
        }
    }

    @Test
    void memberRemovalTakesEffectAndLastOwnerIsProtected() {
        OidcUser owner = user("operator");
        OidcUser editor = user("editor");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        UUID ownerId = (UUID) learning.me(owner).get("id");
        assertEquals("LAST_OWNER", assertThrows(ApiException.class, () -> learning.updateMember(owner, family, ownerId, json("role", "EDITOR", "active", true, "version", 0))).code());
        join(owner, family, editor, "EDITOR");
        UUID editorId = (UUID) learning.me(editor).get("id");
        assertEquals(0, records.sessions(editor, family, child).size());
        assertThrows(ApiException.class, () -> learning.updateMember(editor, family, ownerId, json("role", "VIEWER", "active", true, "version", 0)));
        learning.updateMember(owner, family, editorId, json("role", "EDITOR", "active", false, "version", 0));
        assertEquals("NOT_FOUND", assertThrows(ApiException.class, () -> records.sessions(editor, family, child)).code());
        assertEquals(2, learning.members(owner, family).size());
    }

    @Test
    void invitationAndRegistrationAreSingleUseBoundAndRecoverable() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        var invitation = learning.invite(owner, family, json("role", "EDITOR"));
        String token = invitation.get("token").toString();
        assertEquals("合成家庭", learning.preview(json("token", token)).get("familyName"));
        var grant = learning.registrationGrant(json("token", token));
        assertTrue(grant.get("registrationUrl").toString().startsWith("/edu/math/oauth2/authorization/learning?invite_grant="));
        ObjectNode reserve = json("grant", grant.get("grant"), "clientId", "learning-test", "authSessionId", "synthetic-auth", "username", "newmember");
        UUID reservation = (UUID) learning.reserve(reserve).get("reservationId");
        assertEquals(reservation, learning.reserve(reserve).get("reservationId"));
        assertThrows(ApiException.class, () -> learning.reserve(reserve.deepCopy().put("username", "different")));
        assertThrows(ApiException.class, () -> learning.accept(user("newmember"), json("token", token)));
        ObjectNode bind = json("reservationId", reservation, "clientId", "learning-test", "authSessionId", "synthetic-auth", "issuer", ISSUER, "subject", "newmember");
        assertEquals(true, learning.bind(bind).get("bound"));
        assertEquals(true, learning.bind(bind).get("bound"));
        assertThrows(ApiException.class, () -> learning.bind(bind.deepCopy().put("subject", "different")));
        assertEquals(true, learning.accept(user("newmember"), json("token", token)).get("accepted"));
        assertEquals(true, learning.accept(user("newmember"), json("token", token)).get("accepted"));
        assertThrows(ApiException.class, () -> learning.accept(user("other"), json("token", token)));
        assertFalse(learning.families(user("newmember")).isEmpty());
        assertFalse(learning.invitations(owner, family).getFirst().containsKey("token"));
    }

    @Test
    void concurrentAcceptanceAndOwnerDemotionHaveOneWinner() throws Exception {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        String token = learning.invite(owner, family, json("role", "OWNER")).get("token").toString();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Callable<Boolean> a = () -> acceptSafely(user("a"), token);
            Callable<Boolean> b = () -> acceptSafely(user("b"), token);
            var outcomes = executor.invokeAll(List.of(a, b));
            assertEquals(1, outcomes.stream().filter(result -> {
                try {
                    return result.get();
                } catch (Exception exception) {
                    throw new RuntimeException(exception);
                }
            }).count());
        }
        OidcUser second = learning.families(user("a")).isEmpty() ? user("b") : user("a");
        UUID ownerId = (UUID) learning.me(owner).get("id");
        UUID secondId = (UUID) learning.me(second).get("id");
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var results = executor.invokeAll(List.<Callable<Boolean>>of(
                    () -> demoteSafely(owner, family, ownerId), () -> demoteSafely(second, family, secondId)));
            assertNotEquals(results.get(0).get(), results.get(1).get());
        }
        assertEquals(1, learning.members(owner, family).stream().filter(member -> "OWNER".equals(member.get("role")) && Boolean.TRUE.equals(member.get("active"))).count());
    }

    static boolean acceptSafely(OidcUser user, String token) {
        try {
            learning.accept(user, json("token", token));
            return true;
        } catch (ApiException exception) {
            return false;
        }
    }

    static boolean demoteSafely(OidcUser user, UUID family, UUID id) {
        try {
            learning.updateMember(user, family, id, json("role", "EDITOR", "active", true, "version", 0));
            return true;
        } catch (ApiException exception) {
            return false;
        }
    }

    @Test
    void importPreviewAndIdempotencyPreserveOldVersion() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        ObjectNode record = json("schema", 1, "dataVersion", "old-unavailable-version", "targets", List.of("old-topic"), "answers", List.of(Map.of("id", "old-topic", "qid", "old-question", "result", "correct")), "options", Map.of("seed", "old", "limit", 16, "mode", "target"));
        ObjectNode request = json("id", UUID.randomUUID(), "record", record);
        assertEquals(false, records.previewImport(owner, family, child, request).get("regraded"));
        UUID imported = (UUID) records.importRecord(owner, family, child, request).get("id");
        assertEquals(imported, records.importRecord(owner, family, child, request.deepCopy().put("id", UUID.randomUUID().toString())).get("id"));
        assertEquals(1, ((List<?>) records.history(owner, family, child, null, 50).get("items")).size());
        request.set("record", record.deepCopy().put("testRecord", true));
        assertThrows(ApiException.class, () -> records.previewImport(owner, family, child, request));
    }

    @Test
    void observationsCorrectionsPaginationAndArchiveStayDistinct() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        JsonNode card = records.activities().get(0);
        UUID original = UUID.randomUUID();
        ObjectNode observation = json("id", original, "activityId", card.path("id").asText(), "activityVersion", card.path("version").asText(), "outcome", "PAUSED", "note", "合成观察", "occurredAt", Instant.now().minusSeconds(20).toString());
        assertEquals("PAUSED", records.observe(owner, family, child, observation).get("outcome"));
        assertEquals(original, records.observe(owner, family, child, observation).get("id"));
        assertThrows(ApiException.class, () -> records.observe(owner, family, child, observation.deepCopy().put("outcome", "INDEPENDENT")));
        ObjectNode correction = observation.deepCopy().put("id", UUID.randomUUID().toString()).put("correctionOf", original.toString()).put("outcome", "TOGETHER").put("occurredAt", Instant.now().toString());
        records.observe(owner, family, child, correction);
        var page1 = records.history(owner, family, child, null, 1);
        assertNotNull(page1.get("nextCursor"));
        var page2 = records.history(owner, family, child, page1.get("nextCursor").toString(), 1);
        assertEquals(1, ((List<?>) page2.get("items")).size());
        assertNull(page2.get("nextCursor"));
        assertEquals(2, records.observations(owner, family, child).size());
        learning.updateChild(owner, family, child, json("archived", true, "version", 0));
        assertEquals("CHILD_ARCHIVED", assertThrows(ApiException.class, () -> records.createSession(owner, family, child, sessionRequest())).code());
        assertEquals(2, records.observations(owner, family, child).size());
    }

    @Test
    void expiredUnboundRegistrationCanRestartAndRevokedGrantsFail() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        var invitation = learning.invite(owner, family, json("role", "EDITOR"));
        String token = invitation.get("token").toString();
        var first = learning.registrationGrant(json("token", token));
        ObjectNode request = json("grant", first.get("grant"), "clientId", "learning-test", "authSessionId", "abandoned-session", "username", "synthetic");
        UUID abandoned = (UUID) learning.reserve(request).get("reservationId");
        transaction.executeWithoutResult(status -> {
            store.context("reservation", abandoned);
            store.update("UPDATE learning.registration_grants SET expires_at=now()-interval '1 minute' WHERE reservation_id=?", abandoned);
        });
        assertEquals("REGISTRATION_GRANT_EXPIRED", assertThrows(ApiException.class, () -> learning.reserve(request)).code());
        var fresh = learning.registrationGrant(json("token", token));
        assertNotEquals(first.get("grant"), fresh.get("grant"));
        UUID reserved = (UUID) learning.reserve(request.deepCopy().put("grant", fresh.get("grant").toString()).put("authSessionId", "new-session")).get("reservationId");
        assertNotEquals(abandoned, reserved);
        learning.revoke(owner, family, (UUID) invitation.get("id"));
        assertThrows(ApiException.class, () -> learning.bind(json("reservationId", reserved, "clientId", "learning-test", "authSessionId", "new-session", "issuer", ISSUER, "subject", "synthetic")));
        assertThrows(ApiException.class, () -> learning.accept(user("synthetic"), json("token", token)));
    }

    @Test
    void selfLeaveAndOperatorInvitationsEnforceSeparatePowers() {
        OidcUser owner = user("operator");
        OidcUser viewer = user("viewer");
        UUID family = family("合成家庭", owner);
        assertEquals("LAST_OWNER", assertThrows(ApiException.class, () -> learning.leave(owner, family)).code());
        join(owner, family, viewer, "VIEWER");
        transaction.executeWithoutResult(status -> {
            var actor = learning.actor(viewer);
            learning.family(actor, family, false, false);
            var failure = assertThrows(org.springframework.dao.DataAccessException.class, () -> store.update("UPDATE learning.families SET name='forbidden' WHERE id=?", family));
            assertTrue(failure.getMostSpecificCause().getMessage().contains("row-level security"));
            status.setRollbackOnly();
        });
        assertEquals(true, learning.leave(viewer, family).get("left"));
        assertTrue(learning.families(viewer).isEmpty());
        assertThrows(ApiException.class, () -> learning.children(viewer, family));
        var invitation = learning.invite(owner, null, json());
        assertFalse(learning.operatorInvitations(owner).isEmpty());
        assertThrows(ApiException.class, () -> learning.operatorInvitations(viewer));
        learning.revokeOperatorInvitation(owner, (UUID) invitation.get("id"));
        assertThrows(ApiException.class, () -> learning.preview(json("token", invitation.get("token"))));
    }

    @Test
    void activityContentSurvivesUpgradeAndOldVersionCorrection() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        JsonNode originalCard = records.activities().get(0).deepCopy();
        UUID original = UUID.randomUUID();
        ObjectNode request = json("id", original, "activityId", originalCard.path("id").asText(), "activityVersion", originalCard.path("version").asText(), "outcome", "PROMPTED", "occurredAt", Instant.now().toString());
        assertEquals(originalCard, records.observe(owner, family, child, request).get("activitySnapshot"));
        LearningRecords upgraded = new LearningRecords(learning, store, mapper) {
            @Override
            public JsonNode activities() {
                return mapper.createArrayNode().add(((ObjectNode) originalCard.deepCopy()).put("version", "future-v2").put("title", "Changed title"));
            }
        };
        transaction.executeWithoutResult(status -> {
            var correction = request.deepCopy().put("id", UUID.randomUUID().toString()).put("correctionOf", original.toString()).put("outcome", "TOGETHER");
            assertEquals(originalCard, upgraded.observe(owner, family, child, correction).get("activitySnapshot"));
        });
        var history = (List<Map<String, Object>>) records.history(owner, family, child, null, 50).get("items");
        assertEquals(2, history.size());
        assertTrue(history.stream().allMatch(item -> originalCard.equals(item.get("activitySnapshot"))));
        var exported = (List<Map<String, Object>>) records.export(owner, family).get("observations");
        assertTrue(exported.stream().allMatch(item -> originalCard.equals(item.get("activitySnapshot"))));
    }

    static String receipt(UUID reservation, String session, String subject) throws Exception {
        JsonNode payload = json("v", 1, "reservationId", reservation, "clientId", "learning-test", "authSessionId", session, "issuer", ISSUER, "subject", subject);
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(context.getBean(LearningProperties.class).registrationKey().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return encoded + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(encoded.getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    void signedRegistrationReceiptResumesAfterExpiredGrantWithoutLosingLedger() throws Exception {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        String token = learning.invite(owner, family, json("role", "EDITOR")).get("token").toString();
        var grant = learning.registrationGrant(json("token", token));
        UUID reservation = (UUID) learning.reserve(json("grant", grant.get("grant"), "clientId", "learning-test", "authSessionId", "committed-session", "username", "committed-user")).get("reservationId");
        String signed = receipt(reservation, "committed-session", "committed-user");
        OidcUser committed = user("committed-user", signed);
        assertThrows(ApiException.class, () -> learning.me(user("different-user", signed)));
        assertThrows(ApiException.class, () -> learning.me(user("committed-user", signed.substring(0, signed.indexOf('.') + 1) + LearningService.token())));
        transaction.executeWithoutResult(status -> {
            store.context("reservation", reservation);
            store.update("UPDATE learning.registration_grants SET expires_at=now()-interval '1 minute' WHERE reservation_id=?", reservation);
        });
        // The browser starts over after expiration, but the committed provider identity still holds its old receipt.
        learning.registrationGrant(json("token", token));
        assertEquals(false, learning.me(committed).get("registrationPending"));
        assertTrue(learning.families(committed).isEmpty());
        assertEquals(true, learning.accept(committed, json("token", token)).get("accepted"));
        assertEquals(false, learning.me(committed).get("registrationPending"));
        assertEquals(1, learning.families(committed).size());
        // A changed HMAC is irrelevant once this exact verified OIDC identity is durably bound.
        String oldKeyReceipt = signed.substring(0, signed.indexOf('.') + 1) + LearningService.token();
        assertEquals(false, learning.me(user("committed-user", oldKeyReceipt)).get("registrationPending"));
    }

    @Test
    void revokedPendingReceiptDoesNotLockIdentityOutOfANewInvitation() throws Exception {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        var firstInvite = learning.invite(owner, family, json("role", "EDITOR"));
        var grant = learning.registrationGrant(json("token", firstInvite.get("token")));
        UUID reservation = (UUID) learning.reserve(json("grant", grant.get("grant"), "clientId", "learning-test", "authSessionId", "revoked-session", "username", "pending-user")).get("reservationId");
        OidcUser pending = user("pending-user", receipt(reservation, "revoked-session", "pending-user"));
        learning.revoke(owner, family, (UUID) firstInvite.get("id"));
        assertEquals(true, learning.me(pending).get("registrationPending"));
        assertTrue(learning.families(pending).isEmpty());
        String newInvite = learning.invite(owner, family, json("role", "VIEWER")).get("token").toString();
        assertEquals(true, learning.accept(pending, json("token", newInvite)).get("accepted"));
        assertEquals(1, learning.families(pending).size());
    }

    @Test
    void snapshotVersionCannotBeRewrittenOnExistingSession() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        UUID child = child(owner, family, "合成孩子");
        ObjectNode request = sessionRequest();
        var created = records.createSession(owner, family, child, request);
        ObjectNode update = json("version", 0, "finished", false, "snapshot", Map.of("dataVersion", "wrong-version"), "contentSnapshot", Map.of());
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> records.updateSession(owner, family, child, (UUID) created.get("id"), update)).code());
    }

    @Test
    void retiredUnboundReservationAllowsChoosingAnExistingAccount() {
        OidcUser owner = user("operator");
        UUID family = family("合成家庭", owner);
        String token = learning.invite(owner, family, json("role", "VIEWER")).get("token").toString();
        var grant = learning.registrationGrant(json("token", token));
        UUID reservation = (UUID) learning.reserve(json("grant", grant.get("grant"), "clientId", "learning-test", "authSessionId", "abandoned", "username", "never-created")).get("reservationId");
        transaction.executeWithoutResult(status -> {
            store.context("reservation", reservation);
            store.update("UPDATE learning.registration_grants SET expires_at=now()-interval '1 minute' WHERE reservation_id=?", reservation);
        });
        learning.registrationGrant(json("token", token));
        assertEquals(true, learning.accept(user("existing-account"), json("token", token)).get("accepted"));
        assertEquals(1, learning.families(user("existing-account")).size());
    }

    @Test
    void queuedPromotionDemotionAndLeaveRecheckRoleAfterLock() throws Exception {
        OidcUser a = user("operator");
        OidcUser b = user("queued-editor");
        UUID family = family("合成家庭", a);
        join(a, family, b, "EDITOR");
        UUID aId = (UUID) learning.me(a).get("id");
        UUID bId = (UUID) learning.me(b).get("id");
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = transaction.execute(status -> {
                store.context("actor", aId);
                store.context("family", family);
                store.context("role", "OWNER");
                store.one("SELECT id FROM learning.families WHERE id=? FOR UPDATE", family);
                store.update("UPDATE learning.members SET role='OWNER',version=version+1 WHERE family_id=? AND user_id=?", family, bId);
                var demoteA = executor.submit(() -> demoteSafely(a, family, aId));
                awaitBlocked(1);
                var leaveB = executor.submit(() -> {
                    try {
                        learning.leave(b, family);
                        return "LEFT";
                    } catch (ApiException exception) {
                        return exception.code();
                    }
                });
                awaitBlocked(2);
                return List.of(demoteA, leaveB);
            });
            assertEquals(true, futures.get(0).get(5, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("LAST_OWNER", futures.get(1).get(5, java.util.concurrent.TimeUnit.SECONDS));
        }
        assertEquals(1, learning.members(a, family).stream().filter(member -> "OWNER".equals(member.get("role")) && Boolean.TRUE.equals(member.get("active"))).count());
    }

    static void awaitBlocked(int minimum) {
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(3);
        while (System.nanoTime() < deadline) {
            Integer count = context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='learning_app' AND cardinality(pg_blocking_pids(pid))>0", Integer.class);
            if (count != null && count >= minimum) {
                return;
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError(exception);
            }
        }
        throw new AssertionError("Expected PostgreSQL lock waiters did not reach the barrier");
    }
}
