package org.cnmathtaxonomy.learning;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
    private final DatabaseSafety safety;

    HealthController(DatabaseSafety safety) {
        this.safety = safety;
    }

    @GetMapping("/healthz")
    Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @GetMapping("/readyz")
    ResponseEntity<Map<String, String>> ready() {
        try {
            safety.verify();
            return ResponseEntity.ok(Map.of("status", "ready"));
        } catch (RuntimeException exception) {
            return ResponseEntity.status(503).body(Map.of("status", "unavailable"));
        }
    }
}
