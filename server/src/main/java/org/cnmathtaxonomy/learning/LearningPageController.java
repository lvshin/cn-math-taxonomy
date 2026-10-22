package org.cnmathtaxonomy.learning;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
class LearningPageController {
    @GetMapping("/kindergarten/")
    String kindergarten() {
        return "forward:/kindergarten/index.html";
    }
}
