package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class LearningController {
    private final LearningService learning;
    private final LearningRecords records;

    LearningController(LearningService learning, LearningRecords records) {
        this.learning = learning;
        this.records = records;
    }

    @GetMapping("/capabilities")
    ResponseEntity<Map<String, Object>> capabilities(HttpServletRequest request) {
        Map<String, Object> capabilities = new LinkedHashMap<>(Map.of("cloud", true, "adaptivePractice", true, "apiVersion", 1,
                "loginUrl", "oauth2/authorization/learning", "preschool", true,
                "preschoolLoginUrl", "oauth2/authorization/learning?module=preschool"));
        if (SessionRestoration.hasMarker(request)) {
            capabilities.put("sessionRestoreUrl", "oauth2/authorization/learning?restore=1");
            capabilities.put("preschoolSessionRestoreUrl", "oauth2/authorization/learning?restore=1&module=preschool");
        }
        return ResponseEntity.ok().header("Cache-Control", "no-store").header("Vary", "Cookie").body(capabilities);
    }

    @GetMapping("/csrf")
    Map<String, String> csrf(CsrfToken token) {
        return Map.of("token", token.getToken(), "headerName", token.getHeaderName(), "parameterName", token.getParameterName());
    }

    @GetMapping("/me")
    Map<String, Object> me(@AuthenticationPrincipal OidcUser user) {
        return learning.me(user);
    }

    @GetMapping("/families")
    List<Map<String, Object>> families(@AuthenticationPrincipal OidcUser user) {
        return learning.families(user);
    }

    @PostMapping("/families")
    Map<String, Object> createFamily(@AuthenticationPrincipal OidcUser user, @RequestBody JsonNode request) {
        return learning.createFamily(user, request);
    }

    @GetMapping("/families/{family}/children")
    List<Map<String, Object>> children(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family) {
        return learning.children(user, family);
    }

    @PostMapping("/families/{family}/children")
    Map<String, Object> createChild(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @RequestBody JsonNode request) {
        return learning.createChild(user, family, request);
    }

    @PatchMapping("/families/{family}/children/{child}")
    Map<String, Object> updateChild(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return learning.updateChild(user, family, child, request);
    }

    @GetMapping("/families/{family}/members")
    List<Map<String, Object>> members(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family) {
        return learning.members(user, family);
    }

    @PatchMapping("/families/{family}/members/{member}")
    Map<String, Object> updateMember(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID member, @RequestBody JsonNode request) {
        return learning.updateMember(user, family, member, request);
    }

    @GetMapping("/families/{family}/invitations")
    List<Map<String, Object>> invitations(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family) {
        return learning.invitations(user, family);
    }

    @PostMapping("/families/{family}/invitations")
    Map<String, Object> invite(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @RequestBody JsonNode request) {
        return learning.invite(user, family, request);
    }

    @PostMapping("/families/{family}/invitations/{id}/revoke")
    Map<String, Object> revoke(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID id) {
        return learning.revoke(user, family, id);
    }

    @PostMapping("/operator/invitations")
    Map<String, Object> operatorInvite(@AuthenticationPrincipal OidcUser user, @RequestBody JsonNode request) {
        return learning.invite(user, null, request);
    }

    @PostMapping("/families/{family}/leave")
    Map<String, Object> leave(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family) {
        return learning.leave(user, family);
    }

    @GetMapping("/operator/invitations")
    List<Map<String, Object>> operatorInvitations(@AuthenticationPrincipal OidcUser user) {
        return learning.operatorInvitations(user);
    }

    @PostMapping("/operator/invitations/{id}/revoke")
    Map<String, Object> revokeOperator(@AuthenticationPrincipal OidcUser user, @PathVariable UUID id) {
        return learning.revokeOperatorInvitation(user, id);
    }

    @PostMapping("/invitations/preview")
    Map<String, Object> preview(@RequestBody JsonNode request) {
        return learning.preview(request);
    }

    @PostMapping("/invitations/accept")
    Map<String, Object> accept(@AuthenticationPrincipal OidcUser user, @RequestBody JsonNode request) {
        return learning.accept(user, request);
    }

    @PostMapping("/invitations/registration-grant")
    Map<String, Object> grant(@RequestBody JsonNode request) {
        return learning.registrationGrant(request);
    }

    @GetMapping("/activities")
    JsonNode activities() {
        return records.activities();
    }

    @GetMapping("/preschool/activities")
    JsonNode preschoolActivities() {
        return records.preschoolActivities();
    }

    @GetMapping("/families/{family}/children/{child}/preschool/observations")
    List<Map<String, Object>> preschoolObservations(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child) {
        return records.preschoolObservations(user, family, child);
    }

    @PostMapping("/families/{family}/children/{child}/preschool/observations")
    Map<String, Object> observePreschool(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return records.observePreschool(user, family, child, request);
    }

    @GetMapping("/families/{family}/children/{child}/preschool/history")
    Map<String, Object> preschoolHistory(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child,
            @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "50") int limit) {
        return records.preschoolHistory(user, family, child, cursor, limit);
    }

    @GetMapping("/families/{family}/children/{child}/observations")
    List<Map<String, Object>> observations(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child) {
        return records.observations(user, family, child);
    }

    @PostMapping("/families/{family}/children/{child}/observations")
    Map<String, Object> observe(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return records.observe(user, family, child, request);
    }

    @GetMapping("/families/{family}/children/{child}/sessions")
    List<Map<String, Object>> sessions(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child) {
        return records.sessions(user, family, child);
    }

    @GetMapping("/families/{family}/children/{child}/practice-profile")
    ResponseEntity<Map<String, Object>> practiceProfile(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(records.practiceProfile(user, family, child));
    }

    @GetMapping("/families/{family}/children/{child}/sessions/{id}")
    Map<String, Object> session(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @PathVariable UUID id) {
        return records.session(user, family, child, id);
    }

    @PostMapping("/families/{family}/children/{child}/sessions")
    Map<String, Object> createSession(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return records.createSession(user, family, child, request);
    }

    @PutMapping("/families/{family}/children/{child}/sessions/{id}")
    Map<String, Object> updateSession(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @PathVariable UUID id, @RequestBody JsonNode request) {
        return records.updateSession(user, family, child, id, request);
    }

    @GetMapping("/families/{family}/children/{child}/history")
    Map<String, Object> history(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child,
            @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "50") int limit) {
        return records.history(user, family, child, cursor, limit);
    }

    @PostMapping("/families/{family}/children/{child}/imports/preview")
    Map<String, Object> previewImport(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return records.previewImport(user, family, child, request);
    }

    @PostMapping("/families/{family}/children/{child}/imports")
    Map<String, Object> importRecord(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family, @PathVariable UUID child, @RequestBody JsonNode request) {
        return records.importRecord(user, family, child, request);
    }

    @GetMapping("/families/{family}/export")
    Map<String, Object> export(@AuthenticationPrincipal OidcUser user, @PathVariable UUID family) {
        return records.export(user, family);
    }
}
