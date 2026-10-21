package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class LearningRecords {
    private static final String SESSION_COLUMNS = "id,family_id,child_id,author_id,data_version,content_snapshot,snapshot,finished,version,occurred_at,updated_at";
    private static final String OBSERVATION_COLUMNS = "id,author_id,activity_id,activity_version,activity_snapshot,outcome,note,occurred_at,correction_of";
    private final LearningService learning;
    private final LearningStore store;
    private final ObjectMapper mapper;
    private final PracticeProfile practice;

    LearningRecords(LearningService learning, LearningStore store, ObjectMapper mapper) {
        this.learning = learning;
        this.store = store;
        this.mapper = mapper;
        this.practice = new PracticeProfile(mapper);
    }

    public JsonNode activities() {
        try (var stream = new ClassPathResource("static/data/activities.json").getInputStream()) {
            JsonNode content = mapper.readTree(stream);
            return content.isArray() ? content : content.path("activities");
        } catch (IOException exception) {
            throw new IllegalStateException("Activity catalog is not installed", exception);
        }
    }

    private LearningService.Actor scope(OidcUser principal, UUID family, UUID child, boolean write) {
        var actor = learning.actor(principal);
        learning.family(actor, family, write, false);
        learning.child(family, child, write);
        return actor;
    }

    public List<Map<String, Object>> observations(OidcUser principal, UUID family, UUID child) {
        scope(principal, family, child, false);
        return store.list("SELECT " + OBSERVATION_COLUMNS + " FROM learning.observations WHERE family_id=? AND child_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1000", family, child);
    }

    public Map<String, Object> observe(OidcUser principal, UUID family, UUID child, JsonNode request) {
        var actor = scope(principal, family, child, true);
        UUID id = LearningService.uuid(request, "id");
        String activity = LearningService.text(request, "activityId", 100, true);
        String activityVersion = LearningService.text(request, "activityVersion", 100, true);
        String outcome = LearningService.text(request, "outcome", 20, true);
        if (!LearningService.OUTCOMES.contains(outcome)) {
            throw ApiException.invalid("未知观察结果");
        }
        String note = LearningService.text(request, "note", 2000, false);
        Instant occurred = occurredAt(request);
        UUID correction = request.hasNonNull("correctionOf") ? LearningService.uuid(request, "correctionOf") : null;
        JsonNode activitySnapshot = null;
        if (correction != null) {
            var original = store.one("SELECT author_id,activity_id,activity_version,activity_snapshot FROM learning.observations WHERE family_id=? AND child_id=? AND id=?", family, child, correction);
            if (!original.get("authorId").equals(actor.id()) && !"OWNER".equals(store.one("SELECT role FROM learning.members WHERE family_id=? AND user_id=?", family, actor.id()).get("role"))) {
                throw ApiException.forbidden();
            }
            if (!activity.equals(original.get("activityId")) || !activityVersion.equals(original.get("activityVersion")) || correction.equals(id)) {
                throw ApiException.invalid("更正必须关联同一活动的既有观察");
            }
            activitySnapshot = (JsonNode) original.get("activitySnapshot");
        } else {
            for (JsonNode card : activities()) {
                if (activity.equals(card.path("id").asText()) && activityVersion.equals(card.path("version").asText())) {
                    activitySnapshot = card;
                }
            }
            if (activitySnapshot == null) {
                throw ApiException.invalid("活动或版本不存在");
            }
        }
        var normalized = mapper.createObjectNode().put("activityId", activity).put("activityVersion", activityVersion)
                .put("outcome", outcome).put("note", note).put("occurredAt", occurred.toString()).put("correctionOf", correction == null ? null : correction.toString());
        String fingerprint = fingerprint(normalized);
        store.update("INSERT INTO learning.observations(id,family_id,child_id,author_id,activity_id,activity_version,activity_snapshot,outcome,note,occurred_at,correction_of,fingerprint) VALUES(?,?,?,?,?,?,?::jsonb,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", id, family, child, actor.id(), activity, activityVersion, activitySnapshot.toString(), outcome, note, LearningService.timestamp(occurred), correction, fingerprint);
        var stored = store.one("SELECT " + OBSERVATION_COLUMNS + ",fingerprint FROM learning.observations WHERE family_id=? AND child_id=? AND id=?", family, child, id);
        if (!actor.id().equals(stored.get("authorId")) || !fingerprint.equals(stored.remove("fingerprint"))) {
            throw ApiException.conflict("IDEMPOTENCY_CONFLICT");
        }
        return stored;
    }

    public List<Map<String, Object>> sessions(OidcUser principal, UUID family, UUID child) {
        scope(principal, family, child, false);
        return store.list("SELECT " + SESSION_COLUMNS + " FROM learning.sessions WHERE family_id=? AND child_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1000", family, child);
    }

    public Map<String, Object> practiceProfile(OidcUser principal, UUID family, UUID child) {
        scope(principal, family, child, false);
        var profile = practice.accumulator(Instant.now());
        // This query intentionally has no history-list LIMIT and reads each session's latest persisted snapshot once.
        store.forEachRow("SELECT id,snapshot,content_snapshot,occurred_at,updated_at FROM learning.sessions WHERE family_id=? AND child_id=?",
                row -> profile.add(row.get("id").toString(), (JsonNode) row.get("snapshot"), (JsonNode) row.get("contentSnapshot"),
                        (Instant) row.get("occurredAt"), (Instant) row.get("updatedAt")), family, child);
        return profile.result();
    }

    public Map<String, Object> session(OidcUser principal, UUID family, UUID child, UUID id) {
        scope(principal, family, child, false);
        return storedSession(family, child, id);
    }

    private Map<String, Object> storedSession(UUID family, UUID child, UUID id) {
        return store.one("SELECT " + SESSION_COLUMNS + " FROM learning.sessions WHERE family_id=? AND child_id=? AND id=?", family, child, id);
    }

    public Map<String, Object> createSession(OidcUser principal, UUID family, UUID child, JsonNode request) {
        var actor = scope(principal, family, child, true);
        UUID id = LearningService.uuid(request, "id");
        String version = LearningService.text(request, "dataVersion", 100, true);
        JsonNode snapshot = object(request, "snapshot");
        JsonNode content = object(request, "contentSnapshot");
        checkDataVersion(snapshot, content, version);
        String fingerprint = fingerprint(request);
        var existing = store.optional("SELECT " + SESSION_COLUMNS + ",initial_fingerprint FROM learning.sessions WHERE family_id=? AND child_id=? AND id=?", family, child, id);
        if (existing != null) {
            if (!actor.id().equals(existing.get("authorId")) || !fingerprint.equals(existing.remove("initialFingerprint"))) {
                throw ApiException.conflict("IDEMPOTENCY_CONFLICT");
            }
            return existing;
        }
        practice.validateSnapshot(snapshot, content);
        store.update("INSERT INTO learning.sessions(id,family_id,child_id,author_id,data_version,content_snapshot,snapshot,initial_fingerprint) VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?) ON CONFLICT(id) DO NOTHING", id, family, child, actor.id(), version, content.toString(), snapshot.toString(), fingerprint);
        var stored = store.one("SELECT " + SESSION_COLUMNS + ",initial_fingerprint FROM learning.sessions WHERE family_id=? AND child_id=? AND id=?", family, child, id);
        if (!actor.id().equals(stored.get("authorId")) || !fingerprint.equals(stored.remove("initialFingerprint"))) {
            throw ApiException.conflict("IDEMPOTENCY_CONFLICT");
        }
        return stored;
    }

    public Map<String, Object> updateSession(OidcUser principal, UUID family, UUID child, UUID id, JsonNode request) {
        var actor = scope(principal, family, child, true);
        var old = storedSession(family, child, id);
        String role = store.one("SELECT role FROM learning.members WHERE family_id=? AND user_id=?", family, actor.id()).get("role").toString();
        if (!actor.id().equals(old.get("authorId")) && !"OWNER".equals(role)) {
            throw ApiException.forbidden();
        }
        JsonNode snapshot = object(request, "snapshot");
        JsonNode content = object(request, "contentSnapshot");
        checkDataVersion(snapshot, content, old.get("dataVersion").toString());
        if (snapshot.path("schema").asInt(1) != ((JsonNode) old.get("snapshot")).path("schema").asInt(1)) {
            throw ApiException.invalid("练习快照类型不能改变");
        }
        boolean finished = LearningService.bool(request, "finished");
        long version = LearningService.version(request);
        if (Boolean.TRUE.equals(old.get("finished"))) {
            if (finished && snapshot.equals(old.get("snapshot")) && content.equals(old.get("contentSnapshot"))) {
                return old;
            }
            throw ApiException.conflict("SESSION_FINISHED");
        }
        if (version != ((Number) old.get("version")).longValue()) {
            if (snapshot.equals(old.get("snapshot")) && content.equals(old.get("contentSnapshot")) && finished == Boolean.TRUE.equals(old.get("finished"))) {
                return old;
            }
            throw ApiException.conflict("VERSION_CONFLICT");
        }
        practice.validateSnapshot(snapshot, content, (JsonNode) old.get("snapshot"));
        int changed = store.update("UPDATE learning.sessions SET snapshot=?::jsonb,content_snapshot=?::jsonb,finished=?,version=version+1,updated_at=now() WHERE family_id=? AND child_id=? AND id=? AND version=?", snapshot.toString(), content.toString(), finished, family, child, id, version);
        if (changed == 0) {
            // A retry of the exact completed save is safe; a competing edit remains visible as a conflict.
            var latest = storedSession(family, child, id);
            if (snapshot.equals(latest.get("snapshot")) && content.equals(latest.get("contentSnapshot")) && finished == Boolean.TRUE.equals(latest.get("finished"))) {
                return latest;
            }
            throw ApiException.conflict("VERSION_CONFLICT");
        }
        return storedSession(family, child, id);
    }

    public Map<String, Object> history(OidcUser principal, UUID family, UUID child, String cursor, int limit) {
        scope(principal, family, child, false);
        if (limit < 1 || limit > 100) {
            throw ApiException.invalid("每页记录数应为1至100");
        }
        String cursorCondition = "";
        List<Object> args = new ArrayList<>(List.of(family, child, family, child, family, child));
        if (cursor != null && !cursor.isBlank()) {
            try {
                JsonNode parsed = mapper.readTree(Base64.getUrlDecoder().decode(cursor));
                Instant time = Instant.parse(parsed.path("time").asText());
                UUID id = UUID.fromString(parsed.path("id").asText());
                String kind = parsed.path("kind").asText();
                if (!List.of("OBSERVATION", "SESSION", "IMPORT").contains(kind)) {
                    throw new IllegalArgumentException();
                }
                cursorCondition = " WHERE (h.occurred_at,h.id,h.kind) < (?,?,?)";
                args.add(LearningService.timestamp(time));
                args.add(id);
                args.add(kind);
            } catch (IOException | IllegalArgumentException exception) {
                throw ApiException.invalid("历史游标无效");
            }
        }
        args.add(limit + 1);
        String query = """
                WITH h AS (
                  SELECT id,'OBSERVATION'::text kind,occurred_at,author_id,activity_id,activity_version,activity_snapshot,outcome,note,correction_of,
                    null::text data_version,null::uuid session_id,null::boolean finished,null::jsonb snapshot,null::jsonb content_snapshot,null::jsonb record FROM learning.observations WHERE family_id=? AND child_id=?
                  UNION ALL
                  SELECT id,'SESSION',occurred_at,author_id,null,null,null,null,null,null,data_version,id,finished,snapshot,content_snapshot,null FROM learning.sessions WHERE family_id=? AND child_id=?
                  UNION ALL
                  SELECT id,'IMPORT',occurred_at,author_id,null,null,null,null,null,null,record->>'dataVersion',null,null,null,null,record FROM learning.imports WHERE family_id=? AND child_id=?
                ) SELECT h.id,h.kind,h.occurred_at,h.author_id,u.name author_name,h.activity_id,h.activity_version,h.activity_snapshot,h.outcome,h.note,h.correction_of,h.data_version,h.session_id,h.finished,h.snapshot,h.content_snapshot,h.record
                  FROM h JOIN learning.users u ON u.id=h.author_id
                """ + cursorCondition + " ORDER BY h.occurred_at DESC,h.id DESC,h.kind DESC LIMIT ?";
        var rows = store.list(query, args.toArray());
        boolean more = rows.size() > limit;
        if (more) {
            rows.removeLast();
        }
        String next = null;
        if (more && !rows.isEmpty()) {
            var last = rows.getLast();
            var node = mapper.createObjectNode().put("time", LearningService.instant(last.get("occurredAt")).toString())
                    .put("id", last.get("id").toString()).put("kind", last.get("kind").toString());
            next = Base64.getUrlEncoder().withoutPadding().encodeToString(node.toString().getBytes(StandardCharsets.UTF_8));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", rows);
        result.put("nextCursor", next);
        result.put("evidencePolicy", "仅直接作答与家长观察作为长期证据；推断跳过不计为掌握");
        return result;
    }

    public Map<String, Object> previewImport(OidcUser principal, UUID family, UUID child, JsonNode request) {
        scope(principal, family, child, true);
        JsonNode record = validImport(request);
        return Map.of("valid", true, "dataVersion", record.path("dataVersion").textValue(), "answers", record.path("answers").size(),
                "targets", record.path("targets"), "regraded", false, "warning", "保留旧版内容，不按当前题库重新判分；请确认不是试运行记录");
    }

    public Map<String, Object> importRecord(OidcUser principal, UUID family, UUID child, JsonNode request) {
        var actor = scope(principal, family, child, true);
        UUID id = LearningService.uuid(request, "id");
        JsonNode record = validImport(request);
        String fingerprint = fingerprint(record);
        var duplicate = store.optional("SELECT id,author_id FROM learning.imports WHERE family_id=? AND child_id=? AND fingerprint=?", family, child, fingerprint);
        if (duplicate != null) {
            return Map.of("id", duplicate.get("id"), "imported", true, "duplicate", true, "regraded", false);
        }
        store.update("INSERT INTO learning.imports(id,family_id,child_id,author_id,record,fingerprint) VALUES(?,?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING", id, family, child, actor.id(), record.toString(), fingerprint);
        var imported = store.optional("SELECT id,fingerprint FROM learning.imports WHERE family_id=? AND child_id=? AND (id=? OR fingerprint=?)", family, child, id, fingerprint);
        if (imported == null || !fingerprint.equals(imported.get("fingerprint"))) {
            throw ApiException.conflict("IDEMPOTENCY_CONFLICT");
        }
        return Map.of("id", imported.get("id"), "imported", true, "duplicate", !id.equals(imported.get("id")), "regraded", false);
    }

    public Map<String, Object> export(OidcUser principal, UUID family) {
        learning.family(learning.actor(principal), family, false, true);
        return Map.of("schema", 1, "exportedAt", Instant.now(), "family", store.one("SELECT id,name FROM learning.families WHERE id=?", family),
                "children", store.list("SELECT id,nickname,stage,archived,version FROM learning.children WHERE family_id=? ORDER BY id", family),
                "members", store.list("SELECT m.user_id,u.name,m.role,m.active,m.version FROM learning.members m JOIN learning.users u ON u.id=m.user_id WHERE family_id=? ORDER BY m.user_id", family),
                "observations", store.list("SELECT child_id," + OBSERVATION_COLUMNS + " FROM learning.observations WHERE family_id=? ORDER BY occurred_at,id", family),
                "sessions", store.list("SELECT " + SESSION_COLUMNS + " FROM learning.sessions WHERE family_id=? ORDER BY occurred_at,id", family),
                "imports", store.list("SELECT id,child_id,author_id,record,occurred_at FROM learning.imports WHERE family_id=? ORDER BY occurred_at,id", family));
    }

    private JsonNode validImport(JsonNode request) {
        JsonNode record = object(request, "record");
        if (record.path("schema").asInt() != 1 || !record.path("dataVersion").isTextual() || record.path("dataVersion").asText().isBlank()
                || !record.path("targets").isArray() || record.path("targets").isEmpty() || record.path("targets").size() > 500
                || !record.path("answers").isArray() || record.path("answers").size() > 80 || !record.path("options").isObject()) {
            throw ApiException.invalid("不是可识别的旧版练习导出");
        }
        if (record.path("test").asBoolean() || record.path("testRecord").asBoolean() || record.path("synthetic").asBoolean()) {
            throw ApiException.invalid("试运行记录不能作为学习历史导入");
        }
        for (JsonNode answer : record.path("answers")) {
            if (!answer.path("id").isTextual() || !answer.path("qid").isTextual() || !List.of("correct", "wrong", "skip").contains(answer.path("result").asText())) {
                throw ApiException.invalid("旧版作答记录格式不正确");
            }
        }
        return record;
    }

    private JsonNode object(JsonNode request, String field) {
        JsonNode value = request == null ? null : request.get(field);
        if (value == null || !value.isObject() || value.toString().getBytes(StandardCharsets.UTF_8).length > 500_000) {
            throw ApiException.invalid("字段需要不超过500KB的JSON对象：" + field);
        }
        return value;
    }

    private void checkDataVersion(JsonNode snapshot, JsonNode content, String dataVersion) {
        if ((snapshot.has("dataVersion") && !dataVersion.equals(snapshot.path("dataVersion").asText()))
                || (content.has("dataVersion") && !dataVersion.equals(content.path("dataVersion").asText()))) {
            throw ApiException.invalid("快照版本必须与本次练习的数据版本一致");
        }
    }

    private Instant occurredAt(JsonNode request) {
        try {
            Instant value = Instant.parse(LearningService.text(request, "occurredAt", 60, true));
            if (value.isAfter(Instant.now().plusSeconds(86400))) {
                throw ApiException.invalid("观察时间不能晚于明天");
            }
            return value;
        } catch (java.time.format.DateTimeParseException exception) {
            throw ApiException.invalid("观察时间格式不正确");
        }
    }

    private String fingerprint(JsonNode json) {
        return LearningService.hash(canonical(json).toString());
    }

    private JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            ObjectNode sorted = mapper.createObjectNode();
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            names.sort(String::compareTo);
            for (String name : names) {
                sorted.set(name, canonical(node.get(name)));
            }
            return sorted;
        }
        if (node.isArray()) {
            ArrayNode array = mapper.createArrayNode();
            node.forEach(value -> array.add(canonical(value)));
            return array;
        }
        return node;
    }
}
