package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

@Service
@Transactional
public class LearningService {
    static final Set<String> ROLES = Set.of("OWNER", "EDITOR", "VIEWER");
    static final Set<String> OUTCOMES = Set.of("INDEPENDENT", "PROMPTED", "TOGETHER", "NOT_TRIED", "PAUSED");
    private static final String SESSION_COLUMNS = "id,family_id,child_id,author_id,data_version,content_snapshot,snapshot,finished,version,occurred_at,updated_at";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final LearningStore store;
    private final LearningProperties properties;
    private final ObjectMapper mapper;

    LearningService(LearningStore store, LearningProperties properties, ObjectMapper mapper) {
        this.store = store;
        this.properties = properties;
        this.mapper = mapper;
    }

    record Actor(UUID id, String name, boolean operator, boolean registrationPending) {
    }

    Actor actor(OidcUser principal) {
        if (principal == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "请先登录");
        }
        boolean pending = reconcileRegistration(principal);
        Actor identity = identity(principal.getIssuer().toString(), principal.getSubject(), principal.getFullName() != null ? principal.getFullName() : principal.getPreferredUsername());
        return new Actor(identity.id(), identity.name(), identity.operator(), pending);
    }

    private boolean reconcileRegistration(OidcUser principal) {
        Object claim = principal.getIdToken().getClaims().get("learning_registration_receipt");
        if (claim == null) {
            return false;
        }
        if (!(claim instanceof String receipt) || receipt.length() > 4096 || !receipt.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) {
            throw ApiException.forbidden();
        }
        try {
            String[] segments = receipt.split("\\.", -1);
            JsonNode payload = mapper.readTree(Base64.getUrlDecoder().decode(segments[0]));
            if (payload.path("v").asInt() != 1 || !properties.oidcClientId().equals(payload.path("clientId").asText())
                    || !principal.getIssuer().toString().equals(payload.path("issuer").asText())
                    || !principal.getSubject().equals(payload.path("subject").asText())) {
                throw ApiException.forbidden();
            }
            // A verified OIDC identity already bound in our own ledger stays usable across key rotation.
            UUID reservation = uuid(payload, "reservationId");
            store.context("reservation", reservation);
            var existing = store.optional("SELECT client_id,auth_session_id,bound_issuer,bound_subject FROM learning.registration_grants WHERE reservation_id=?", reservation);
            if (existing != null && properties.oidcClientId().equals(existing.get("clientId"))
                    && principal.getIssuer().toString().equals(existing.get("boundIssuer")) && principal.getSubject().equals(existing.get("boundSubject"))) {
                return false;
            }
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(properties.registrationKey().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] signature = mac.doFinal(segments[0].getBytes(StandardCharsets.US_ASCII));
            if (!MessageDigest.isEqual(signature, Base64.getUrlDecoder().decode(segments[1]))) {
                throw ApiException.forbidden();
            }
            try {
                bindRegistration(payload, true);
                return false;
            } catch (ApiException exception) {
                if (Set.of("INVITATION_INVALID", "NOT_FOUND", "REGISTRATION_ALREADY_BOUND").contains(exception.code())) {
                    return true;
                }
                throw exception;
            }
        } catch (java.security.GeneralSecurityException | java.io.IOException | IllegalArgumentException exception) {
            throw ApiException.forbidden();
        }
    }

    Actor identity(String issuer, String subject, String name) {
        if (!properties.oidcIssuer().equals(issuer) || subject == null || subject.isBlank()) {
            throw ApiException.forbidden();
        }
        store.context("issuer", issuer);
        store.context("subject", subject);
        String displayName = name == null || name.isBlank() ? "家庭成员" : name.substring(0, Math.min(name.length(), 120));
        var user = store.one("INSERT INTO learning.users(id,issuer,subject,name) VALUES(?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET name=EXCLUDED.name RETURNING id,name,enabled", UUID.randomUUID(), issuer, subject, displayName);
        if (!Boolean.TRUE.equals(user.get("enabled"))) {
            throw ApiException.forbidden();
        }
        UUID id = (UUID) user.get("id");
        boolean operator = issuer.equals(properties.operatorIssuer()) && subject.equals(properties.operatorSubject())
                && properties.operatorSubject() != null && !properties.operatorSubject().isBlank();
        store.context("actor", id);
        store.context("operator", operator);
        return new Actor(id, displayName, operator, false);
    }

    public Map<String, Object> me(OidcUser principal) {
        Actor actor = actor(principal);
        return Map.of("id", actor.id(), "name", actor.name(), "enabled", true, "operator", actor.operator(), "registrationPending", actor.registrationPending());
    }

    String family(Actor actor, UUID familyId, boolean write, boolean owner) {
        // Resolve membership before selecting a tenant context; it is read afresh on every request.
        var member = store.optional("SELECT role,active FROM learning.members WHERE family_id=? AND user_id=?", familyId, actor.id());
        if (member == null || !Boolean.TRUE.equals(member.get("active"))) {
            throw ApiException.missing();
        }
        String role = (String) member.get("role");
        if ((owner && !"OWNER".equals(role)) || (write && "VIEWER".equals(role))) {
            throw ApiException.forbidden();
        }
        contextFamily(familyId, role);
        return role;
    }

    private void contextFamily(UUID id, String role) {
        store.context("family", id);
        store.context("role", role);
    }

    Map<String, Object> child(UUID familyId, UUID childId, boolean writable) {
        var child = store.one("SELECT id,nickname,stage,archived,version FROM learning.children WHERE family_id=? AND id=?", familyId, childId);
        if (writable && Boolean.TRUE.equals(child.get("archived"))) {
            throw ApiException.conflict("CHILD_ARCHIVED");
        }
        return child;
    }

    public List<Map<String, Object>> families(OidcUser principal) {
        Actor actor = actor(principal);
        var memberships = store.list("SELECT family_id,role FROM learning.members WHERE user_id=? AND active ORDER BY joined_at,family_id", actor.id());
        List<Map<String, Object>> result = new ArrayList<>();
        for (var membership : memberships) {
            UUID id = (UUID) membership.get("familyId");
            contextFamily(id, membership.get("role").toString());
            var value = store.one("SELECT id,name FROM learning.families WHERE id=?", id);
            value.put("role", membership.get("role"));
            result.add(value);
        }
        return result;
    }

    public Map<String, Object> createFamily(OidcUser principal, JsonNode request) {
        Actor actor = actor(principal);
        requireNoFamily(actor);
        boolean allowed = Boolean.TRUE.equals(store.one("SELECT create_allowed FROM learning.users WHERE id=?", actor.id()).get("createAllowed"));
        if (!actor.operator() && !allowed) {
            throw new ApiException(HttpStatus.FORBIDDEN, "INVITATION_REQUIRED", "请先接受开户邀请");
        }
        UUID id = UUID.randomUUID();
        String name = text(request, "name", 100, true);
        contextFamily(id, "OWNER");
        store.update("INSERT INTO learning.families(id,name,created_by) VALUES(?,?,?)", id, name, actor.id());
        writeMembership("INSERT INTO learning.members(family_id,user_id,role) VALUES(?,?,'OWNER')", id, actor.id());
        store.audit(id, actor.id(), "FAMILY_CREATED", id);
        return Map.of("id", id, "name", name, "role", "OWNER");
    }

    private void requireNoFamily(Actor actor) {
        // identity() has already locked this user's row through its upsert for the transaction.
        // The fresh read is visible under RLS and serializes create/join across tabs and devices.
        if (hasFamily(actor)) {
            throw alreadyJoined();
        }
    }

    private boolean hasFamily(Actor actor) {
        return store.optional("SELECT family_id FROM learning.members WHERE user_id=? AND active", actor.id()) != null;
    }

    private int writeMembership(String sql, Object... arguments) {
        try {
            return store.update(sql, arguments);
        } catch (DuplicateKeyException exception) {
            // The unique active-membership index also covers a former member reactivated by
            // an administrator who cannot read the member's other family under RLS.
            throw alreadyJoined();
        }
    }

    private ApiException alreadyJoined() {
        return new ApiException(HttpStatus.CONFLICT, "FAMILY_ALREADY_JOINED", "该账号已加入家庭，不能同时加入多个家庭");
    }

    public List<Map<String, Object>> children(OidcUser principal, UUID familyId) {
        family(actor(principal), familyId, false, false);
        return store.list("SELECT id,nickname,stage,archived,version FROM learning.children WHERE family_id=? ORDER BY created_at,id", familyId);
    }

    public Map<String, Object> createChild(OidcUser principal, UUID familyId, JsonNode request) {
        Actor actor = actor(principal);
        family(actor, familyId, false, true);
        UUID id = UUID.randomUUID();
        store.update("INSERT INTO learning.children(id,family_id,nickname,stage) VALUES(?,?,?,?)", id, familyId, text(request, "nickname", 80, true), text(request, "stage", 80, false));
        store.audit(familyId, actor.id(), "CHILD_CREATED", id);
        return child(familyId, id, false);
    }

    public Map<String, Object> updateChild(OidcUser principal, UUID familyId, UUID childId, JsonNode request) {
        Actor actor = actor(principal);
        family(actor, familyId, false, true);
        var old = child(familyId, childId, false);
        long version = version(request);
        String nickname = request.has("nickname") ? text(request, "nickname", 80, true) : old.get("nickname").toString();
        String stage = request.has("stage") ? text(request, "stage", 80, false) : (String) old.get("stage");
        boolean archived = request.has("archived") ? bool(request, "archived") : Boolean.TRUE.equals(old.get("archived"));
        if (store.update("UPDATE learning.children SET nickname=?,stage=?,archived=?,version=version+1 WHERE family_id=? AND id=? AND version=?", nickname, stage, archived, familyId, childId, version) == 0) {
            throw ApiException.conflict("VERSION_CONFLICT");
        }
        store.audit(familyId, actor.id(), "CHILD_UPDATED", childId);
        return child(familyId, childId, false);
    }

    public List<Map<String, Object>> members(OidcUser principal, UUID familyId) {
        family(actor(principal), familyId, false, false);
        return store.list("SELECT m.user_id,u.name,m.role,m.active,m.version FROM learning.members m JOIN learning.users u ON u.id=m.user_id WHERE m.family_id=? ORDER BY m.joined_at,m.user_id", familyId);
    }

    public Map<String, Object> updateMember(OidcUser principal, UUID familyId, UUID userId, JsonNode request) {
        Actor actor = actor(principal);
        family(actor, familyId, false, true);
        // All owner-changing operations serialize on this stable family row, preventing write skew.
        store.one("SELECT id FROM learning.families WHERE id=? FOR UPDATE", familyId);
        family(actor, familyId, false, true);
        var member = store.one("SELECT role,active,version FROM learning.members WHERE family_id=? AND user_id=?", familyId, userId);
        String role = role(request);
        boolean active = bool(request, "active");
        if ("OWNER".equals(member.get("role")) && Boolean.TRUE.equals(member.get("active")) && (!active || !"OWNER".equals(role))) {
            int owners = store.jdbc.queryForObject("SELECT count(*) FROM learning.members WHERE family_id=? AND active AND role='OWNER'", Integer.class, familyId);
            if (owners <= 1) {
                throw ApiException.conflict("LAST_OWNER");
            }
        }
        if (writeMembership("UPDATE learning.members SET role=?,active=?,version=version+1 WHERE family_id=? AND user_id=? AND version=?", role, active, familyId, userId, version(request)) == 0) {
            throw ApiException.conflict("VERSION_CONFLICT");
        }
        store.audit(familyId, actor.id(), "MEMBERSHIP_UPDATED", userId);
        return store.one("SELECT user_id,role,active,version FROM learning.members WHERE family_id=? AND user_id=?", familyId, userId);
    }

    public List<Map<String, Object>> invitations(OidcUser principal, UUID familyId) {
        family(actor(principal), familyId, false, true);
        return store.list("SELECT id,role,expires_at,revoked,accepted_at,accepted_by,created_at FROM learning.invitations WHERE family_id=? ORDER BY created_at DESC", familyId);
    }

    public Map<String, Object> leave(OidcUser principal, UUID familyId) {
        Actor actor = actor(principal);
        family(actor, familyId, false, false);
        store.one("SELECT id FROM learning.families WHERE id=? FOR UPDATE", familyId);
        String role = family(actor, familyId, false, false);
        if ("OWNER".equals(role)) {
            int owners = store.jdbc.queryForObject("SELECT count(*) FROM learning.members WHERE family_id=? AND active AND role='OWNER'", Integer.class, familyId);
            if (owners <= 1) {
                throw ApiException.conflict("LAST_OWNER");
            }
        }
        // This narrowly scoped self-service transition is allowed even for a read-only member.
        contextFamily(familyId, "OWNER");
        store.update("UPDATE learning.members SET active=false,version=version+1 WHERE family_id=? AND user_id=? AND active", familyId, actor.id());
        store.audit(familyId, actor.id(), "MEMBERSHIP_LEFT", actor.id());
        return Map.of("left", true);
    }

    public List<Map<String, Object>> operatorInvitations(OidcUser principal) {
        Actor actor = actor(principal);
        if (!actor.operator()) {
            throw ApiException.forbidden();
        }
        return store.list("SELECT id,role,expires_at,revoked,accepted_at,accepted_by,created_at FROM learning.invitations WHERE family_id IS NULL ORDER BY created_at DESC");
    }

    public Map<String, Object> revokeOperatorInvitation(OidcUser principal, UUID id) {
        Actor actor = actor(principal);
        if (!actor.operator()) {
            throw ApiException.forbidden();
        }
        var invitation = store.one("SELECT id,accepted_at FROM learning.invitations WHERE family_id IS NULL AND id=? FOR UPDATE", id);
        if (invitation.get("acceptedAt") != null) {
            throw ApiException.conflict("INVITATION_USED");
        }
        store.update("UPDATE learning.invitations SET revoked=true WHERE id=?", id);
        store.audit(null, actor.id(), "INVITATION_REVOKED", id);
        return Map.of("id", id, "revoked", true);
    }

    public Map<String, Object> invite(OidcUser principal, UUID familyId, JsonNode request) {
        Actor actor = actor(principal);
        if (familyId == null) {
            if (!actor.operator()) {
                throw ApiException.forbidden();
            }
        } else {
            family(actor, familyId, false, true);
        }
        String role = familyId == null ? "OWNER" : role(request);
        String token = token();
        String hash = hash(token);
        UUID id = UUID.randomUUID();
        Instant expires = Instant.now().plusSeconds(7 * 86400);
        store.context("invite_hash", hash);
        store.update("INSERT INTO learning.invitations(id,family_id,role,token_hash,created_by,expires_at) VALUES(?,?,?,?,?,?)", id, familyId, role, hash, actor.id(), timestamp(expires));
        store.audit(familyId, actor.id(), "INVITATION_CREATED", id);
        return Map.of("id", id, "token", token, "expiresAt", expires);
    }

    public Map<String, Object> revoke(OidcUser principal, UUID familyId, UUID id) {
        Actor actor = actor(principal);
        family(actor, familyId, false, true);
        var invitation = store.one("SELECT id,accepted_at FROM learning.invitations WHERE family_id=? AND id=? FOR UPDATE", familyId, id);
        if (invitation.get("acceptedAt") != null) {
            throw ApiException.conflict("INVITATION_USED");
        }
        store.update("UPDATE learning.invitations SET revoked=true WHERE id=?", id);
        store.audit(familyId, actor.id(), "INVITATION_REVOKED", id);
        return Map.of("id", id, "revoked", true);
    }

    private Map<String, Object> validInvite(String token, boolean lock) {
        store.context("invite_hash", hash(token));
        var invitation = store.optional("SELECT id,family_id,role,expires_at,revoked,accepted_by FROM learning.invitations WHERE token_hash=?" + (lock ? " FOR UPDATE" : ""), hash(token));
        if (invitation == null || Boolean.TRUE.equals(invitation.get("revoked")) || !instant(invitation.get("expiresAt")).isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.GONE, "INVITATION_INVALID", "邀请无效、已撤销或已过期");
        }
        store.context("invitation_id", invitation.get("id"));
        return invitation;
    }

    public Map<String, Object> preview(JsonNode request) {
        var invitation = validInvite(text(request, "token", 200, true), false);
        if (invitation.get("acceptedBy") != null) {
            throw ApiException.conflict("INVITATION_USED");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", invitation.get("id"));
        result.put("familyId", invitation.get("familyId"));
        result.put("role", invitation.get("role"));
        result.put("expiresAt", invitation.get("expiresAt"));
        result.put("kind", invitation.get("familyId") == null ? "ONBOARDING" : "FAMILY");
        if (invitation.get("familyId") != null) {
            contextFamily((UUID) invitation.get("familyId"), "VIEWER");
            result.put("familyName", store.one("SELECT name FROM learning.families WHERE id=?", invitation.get("familyId")).get("name"));
        }
        return result;
    }

    public Map<String, Object> accept(OidcUser principal, JsonNode request) {
        Actor actor = actor(principal);
        var invitation = validInvite(text(request, "token", 200, true), true);
        if (invitation.get("acceptedBy") != null) {
            if (actor.id().equals(invitation.get("acceptedBy"))) {
                return acceptance(invitation, actor);
            }
            throw ApiException.conflict("INVITATION_USED");
        }
        var reservation = store.optional("SELECT bound_issuer,bound_subject FROM learning.registration_grants WHERE invitation_id=? AND reservation_id IS NOT NULL AND (bound_subject IS NOT NULL OR NOT retired) ORDER BY (bound_subject IS NOT NULL) DESC,created_at,id LIMIT 1", invitation.get("id"));
        if (reservation != null && (!principal.getIssuer().toString().equals(reservation.get("boundIssuer")) || !principal.getSubject().equals(reservation.get("boundSubject")))) {
            throw ApiException.conflict("INVITATION_BOUND_TO_OTHER_IDENTITY");
        }
        requireNoFamily(actor);
        UUID familyId = (UUID) invitation.get("familyId");
        if (familyId == null) {
            store.update("UPDATE learning.users SET create_allowed=true WHERE id=?", actor.id());
        } else {
            contextFamily(familyId, "OWNER");
            var existing = store.optional("SELECT active FROM learning.members WHERE family_id=? AND user_id=?", familyId, actor.id());
            if (existing == null) {
                writeMembership("INSERT INTO learning.members(family_id,user_id,role) VALUES(?,?,?)", familyId, actor.id(), invitation.get("role"));
            } else if (!Boolean.TRUE.equals(existing.get("active"))) {
                writeMembership("UPDATE learning.members SET active=true,role=?,version=version+1 WHERE family_id=? AND user_id=?", invitation.get("role"), familyId, actor.id());
            }
            store.audit(familyId, actor.id(), "INVITATION_ACCEPTED", (UUID) invitation.get("id"));
        }
        store.update("UPDATE learning.invitations SET accepted_by=?,accepted_at=now() WHERE id=?", actor.id(), invitation.get("id"));
        return acceptance(invitation, actor);
    }

    private Map<String, Object> acceptance(Map<String, Object> invitation, Actor actor) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("accepted", true);
        value.put("familyId", invitation.get("familyId"));
        value.put("canCreateFamily", invitation.get("familyId") == null && !hasFamily(actor));
        return value;
    }

    public Map<String, Object> registrationGrant(JsonNode request) {
        var invitation = validInvite(text(request, "token", 200, true), true);
        if (invitation.get("acceptedBy") != null) {
            throw ApiException.conflict("INVITATION_USED");
        }
        // An abandoned, unbound expired registration must not permanently consume an invitation.
        store.update("UPDATE learning.registration_grants SET retired=true WHERE invitation_id=? AND expires_at<now() AND bound_subject IS NULL AND NOT retired", invitation.get("id"));
        if (store.optional("SELECT id FROM learning.registration_grants WHERE invitation_id=? AND reservation_id IS NOT NULL AND (NOT retired OR bound_subject IS NOT NULL)", invitation.get("id")) != null) {
            throw ApiException.conflict("REGISTRATION_ALREADY_RESERVED");
        }
        String grant = token();
        store.context("grant_hash", hash(grant));
        store.update("INSERT INTO learning.registration_grants(id,invitation_id,grant_hash,expires_at) VALUES(?,?,?,?)", UUID.randomUUID(), invitation.get("id"), hash(grant), timestamp(Instant.now().plusSeconds(600)));
        String registrationUrl = "/edu/math/oauth2/authorization/learning?invite_grant=" + grant;
        return Map.of("grant", grant, "registrationUrl", registrationUrl);
    }

    public Map<String, Object> reserve(JsonNode request) {
        String grant = text(request, "grant", 200, true);
        String clientId = text(request, "clientId", 200, true);
        String authSessionId = text(request, "authSessionId", 300, true);
        String username = text(request, "username", 200, true);
        if (!properties.oidcClientId().equals(clientId)) {
            throw ApiException.forbidden();
        }
        store.context("grant_hash", hash(grant));
        var value = store.optional("SELECT id,invitation_id,expires_at,reservation_id,client_id,auth_session_id,username FROM learning.registration_grants WHERE grant_hash=?", hash(grant));
        if (value == null || !instant(value.get("expiresAt")).isAfter(Instant.now())) {
            throw ApiException.conflict("REGISTRATION_GRANT_EXPIRED");
        }
        store.context("invitation_id", value.get("invitationId"));
        checkRegistrationInvite(value.get("invitationId"));
        value = store.one("SELECT id,invitation_id,expires_at,reservation_id,client_id,auth_session_id,username FROM learning.registration_grants WHERE grant_hash=? FOR UPDATE", hash(grant));
        if (!instant(value.get("expiresAt")).isAfter(Instant.now())) {
            throw ApiException.conflict("REGISTRATION_GRANT_EXPIRED");
        }
        if (value.get("reservationId") != null) {
            if (!clientId.equals(value.get("clientId")) || !authSessionId.equals(value.get("authSessionId")) || !username.equals(value.get("username"))) {
                throw ApiException.conflict("REGISTRATION_ALREADY_RESERVED");
            }
            return Map.of("reservationId", value.get("reservationId"));
        }
        // Serialize different grants for one invitation before reserving either of them.
        var reserved = store.optional("SELECT reservation_id FROM learning.registration_grants WHERE invitation_id=? AND reservation_id IS NOT NULL AND (NOT retired OR bound_subject IS NOT NULL)", value.get("invitationId"));
        if (reserved != null) {
            throw ApiException.conflict("REGISTRATION_ALREADY_RESERVED");
        }
        UUID id = UUID.randomUUID();
        store.context("reservation", id);
        store.update("UPDATE learning.registration_grants SET reservation_id=?,client_id=?,auth_session_id=?,username=? WHERE id=?", id, clientId, authSessionId, username, value.get("id"));
        return Map.of("reservationId", id);
    }

    private void checkRegistrationInvite(Object invitationId) {
        var invitation = store.one("SELECT expires_at,revoked,accepted_by FROM learning.invitations WHERE id=? FOR UPDATE", invitationId);
        if (Boolean.TRUE.equals(invitation.get("revoked")) || invitation.get("acceptedBy") != null || !instant(invitation.get("expiresAt")).isAfter(Instant.now())) {
            throw ApiException.conflict("INVITATION_INVALID");
        }
    }

    public Map<String, Object> bind(JsonNode request) {
        return bindRegistration(request, false);
    }

    private Map<String, Object> bindRegistration(JsonNode request, boolean signedReceipt) {
        UUID reservation = uuid(request, "reservationId");
        store.context("reservation", reservation);
        var grant = store.one("SELECT invitation_id,client_id,auth_session_id,expires_at,bound_issuer,bound_subject FROM learning.registration_grants WHERE reservation_id=?", reservation);
        String client = text(request, "clientId", 200, true);
        String authSession = text(request, "authSessionId", 300, true);
        String issuer = text(request, "issuer", 1000, true);
        String subject = text(request, "subject", 300, true);
        if (!properties.oidcClientId().equals(client) || !client.equals(grant.get("clientId")) || !authSession.equals(grant.get("authSessionId")) || !properties.oidcIssuer().equals(issuer)) {
            throw ApiException.forbidden();
        }
        if (signedReceipt && grant.get("boundSubject") != null) {
            if (!issuer.equals(grant.get("boundIssuer")) || !subject.equals(grant.get("boundSubject"))) {
                throw ApiException.conflict("REGISTRATION_ALREADY_BOUND");
            }
            return Map.of("bound", true);
        }
        store.context("invitation_id", grant.get("invitationId"));
        if (signedReceipt) {
            var bound = store.optional("SELECT bound_issuer,bound_subject FROM learning.registration_grants WHERE invitation_id=? AND bound_subject IS NOT NULL", grant.get("invitationId"));
            if (bound != null) {
                if (issuer.equals(bound.get("boundIssuer")) && subject.equals(bound.get("boundSubject"))) {
                    return Map.of("bound", true);
                }
                throw ApiException.conflict("REGISTRATION_ALREADY_BOUND");
            }
        }
        checkRegistrationInvite(grant.get("invitationId"));
        grant = store.one("SELECT invitation_id,client_id,auth_session_id,expires_at,bound_issuer,bound_subject FROM learning.registration_grants WHERE reservation_id=? FOR UPDATE", reservation);
        var otherBound = store.optional("SELECT bound_issuer,bound_subject FROM learning.registration_grants WHERE invitation_id=? AND bound_subject IS NOT NULL AND reservation_id<>?", grant.get("invitationId"), reservation);
        if (otherBound != null) {
            if (issuer.equals(otherBound.get("boundIssuer")) && subject.equals(otherBound.get("boundSubject"))) {
                return Map.of("bound", true);
            }
            throw ApiException.conflict("REGISTRATION_ALREADY_BOUND");
        }
        if (!signedReceipt && !instant(grant.get("expiresAt")).isAfter(Instant.now())) {
            throw ApiException.conflict("REGISTRATION_GRANT_EXPIRED");
        }
        if (grant.get("boundSubject") != null) {
            if (!issuer.equals(grant.get("boundIssuer")) || !subject.equals(grant.get("boundSubject"))) {
                throw ApiException.conflict("REGISTRATION_ALREADY_BOUND");
            }
            return Map.of("bound", true);
        }
        store.update("UPDATE learning.registration_grants SET bound_issuer=?,bound_subject=? WHERE reservation_id=?", issuer, subject, reservation);
        return Map.of("bound", true);
    }

    static String text(JsonNode request, String field, int maximum, boolean required) {
        JsonNode value = request == null ? null : request.get(field);
        if (value == null || value.isNull()) {
            if (required) {
                throw ApiException.invalid("缺少字段：" + field);
            }
            return null;
        }
        if (!value.isTextual() || value.textValue().length() > maximum || (required && value.textValue().isBlank())) {
            throw ApiException.invalid("字段格式不正确：" + field);
        }
        return value.textValue().strip();
    }

    static UUID uuid(JsonNode request, String field) {
        try {
            return UUID.fromString(text(request, field, 36, true));
        } catch (IllegalArgumentException exception) {
            throw ApiException.invalid("标识格式不正确：" + field);
        }
    }

    static long version(JsonNode request) {
        if (request == null || !request.path("version").isIntegralNumber() || request.path("version").longValue() < 0) {
            throw ApiException.invalid("缺少有效版本号");
        }
        return request.path("version").longValue();
    }

    static boolean bool(JsonNode request, String field) {
        if (request == null || !request.path(field).isBoolean()) {
            throw ApiException.invalid("字段格式不正确：" + field);
        }
        return request.path(field).booleanValue();
    }

    static String role(JsonNode request) {
        String role = text(request, "role", 10, true);
        if (!ROLES.contains(role)) {
            throw ApiException.invalid("未知家庭角色");
        }
        return role;
    }

    static String token() {
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    static String hash(String input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    static OffsetDateTime timestamp(Instant instant) {
        return instant.atOffset(java.time.ZoneOffset.UTC);
    }

    static Instant instant(Object value) {
        if (value instanceof Instant time) {
            return time;
        }
        if (value instanceof OffsetDateTime time) {
            return time.toInstant();
        }
        return Instant.parse(value.toString());
    }
}
