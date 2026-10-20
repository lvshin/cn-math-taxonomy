package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/registration")
class InternalRegistrationController {
    private final LearningService service;

    InternalRegistrationController(LearningService service) {
        this.service = service;
    }

    @PostMapping("/reserve")
    Map<String, Object> reserve(@RequestBody JsonNode request) {
        return service.reserve(request);
    }

    @PostMapping("/bind")
    Map<String, Object> bind(@RequestBody JsonNode request) {
        return service.bind(request);
    }
}
