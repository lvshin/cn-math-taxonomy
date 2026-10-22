package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;

/** Validates stored question identity without regrading an old answer. No answer text leaves this class. */
final class PracticeProfile {
    private static final List<String> QUESTION_FIELDS = List.of("id", "topicId", "difficulty", "type", "prompt", "answer", "choices", "explanation",
            "templateId", "templateVersion", "params", "familyKey", "generated", "origin", "review_status", "figure");
    private static final List<String> SEMANTIC_FIELDS = List.of("topicId", "type", "prompt", "answer", "choices", "explanation");
    private static final Set<String> RESULTS = Set.of("correct", "wrong", "skip");
    private final ObjectMapper mapper;
    private final Map<String, JsonNode> fixed = new HashMap<>();
    private final Map<String, String> templates = new HashMap<>();
    private final String dataVersion;

    PracticeProfile(ObjectMapper mapper) {
        this(mapper, resource(mapper, "meta.json"), resource(mapper, "questions.json"), resource(mapper, "practice_templates.json"));
    }

    PracticeProfile(ObjectMapper mapper, JsonNode meta, JsonNode questions, JsonNode manifest) {
        this.mapper = mapper;
        this.dataVersion = meta.path("data_version").asText();
        for (JsonNode question : questions) {
            fixed.put(question.path("id").asText(), question);
        }
        if (manifest.path("schema").asInt() == 1 && manifest.path("templates").isArray()) {
            for (JsonNode template : manifest.path("templates")) {
                templates.put(template.path("id").asText() + "@" + template.path("version").asText(), template.path("topicId").asText());
            }
        }
    }

    private static JsonNode resource(ObjectMapper mapper, String name) {
        var resource = new ClassPathResource("static/data/" + name);
        if (!resource.exists() && "practice_templates.json".equals(name)) {
            return mapper.createObjectNode();
        }
        try (var input = resource.getInputStream()) {
            return mapper.readTree(input);
        } catch (IOException exception) {
            throw new IllegalStateException("Practice catalog is not installed: " + name, exception);
        }
    }

    /** Schema 1 remains readable; schema 2 is a bounded, frozen ordered practice plan. */
    void validateSnapshot(JsonNode snapshot, JsonNode content) {
        validateSnapshot(snapshot, content, null);
    }

    void validateSnapshot(JsonNode snapshot, JsonNode content, JsonNode original) {
        if (snapshot.has("schema") && !Set.of(1, 2).contains(snapshot.path("schema").asInt())) {
            throw ApiException.invalid("未知练习快照版本");
        }
        if (snapshot.path("schema").asInt(1) != 2) return;
        JsonNode plan = snapshot.path("plan");
        JsonNode answers = snapshot.path("answers");
        JsonNode questions = content.path("questions");
        if (!Set.of("practice", "review").contains(snapshot.path("mode").asText())
                || !text(snapshot.path("seed"), 200) || !text(snapshot.path("dataVersion"), 100)
                || !snapshot.path("targets").isArray() || snapshot.path("targets").isEmpty() || snapshot.path("targets").size() > 500
                || !Set.of(5, 10, 20).contains(snapshot.path("limit").asInt())
                || !plan.isArray() || plan.isEmpty() || plan.size() > snapshot.path("limit").asInt()
                || !answers.isArray() || answers.size() > plan.size()
                || !questions.isArray() || !questions.equals(plan)
                || !snapshot.path("selection").isObject() || !text(snapshot.path("selection").path("strategyVersion"), 100)
                || !text(snapshot.path("selection").path("catalogVersion"), 100)
                || !validInstant(snapshot.path("startedAt")) || !validInstant(snapshot.path("selection").path("asOf")) || !snapshot.path("selection").path("weights").isObject()) {
            throw ApiException.invalid("随机练习快照格式不正确");
        }
        boolean frozen = original != null && original.path("schema").asInt() == 2;
        if (frozen) {
            for (String field : List.of("schema", "mode", "seed", "dataVersion", "targets", "limit", "plan", "selection", "startedAt")) {
                if (!snapshot.path(field).equals(original.path(field))) throw ApiException.invalid("已开始的随机练习题序与选题策略不能改变");
            }
            if (answers.size() < original.path("answers").size()) throw ApiException.invalid("已保存作答不能删除");
            for (int i = 0; i < original.path("answers").size(); i++) {
                if (!answers.get(i).equals(original.path("answers").get(i))) throw ApiException.invalid("已保存作答不能改写");
            }
        }
        Set<String> targets = new HashSet<>();
        for (JsonNode target : snapshot.path("targets")) {
            if (!text(target, 100)) throw ApiException.invalid("随机练习知识点格式不正确");
            targets.add(target.asText());
        }
        Set<String> ids = new HashSet<>();
        Set<String> identities = new HashSet<>();
        for (JsonNode question : plan) {
            if ((!frozen && compatibleQuestion(question) == null) || !ids.add(question.path("id").asText())
                    || !identities.add(question.path("type").asText() + "|" + java.text.Normalizer.normalize(question.path("prompt").asText().replaceAll("\\s+", ""), java.text.Normalizer.Form.NFKC))
                    || !targets.contains(question.path("topicId").asText())) {
                throw ApiException.invalid("随机练习题目不兼容或重复");
            }
        }
        for (int i = 0; i < answers.size(); i++) {
            JsonNode answer = answers.get(i);
            JsonNode question = plan.get(i);
            if (!answer.path("qid").asText().equals(question.path("id").asText())
                    || !answer.path("id").asText().equals(question.path("topicId").asText())
                    || !RESULTS.contains(answer.path("result").asText())
                    || !Set.of("auto", "manual").contains(answer.path("gradeSource").asText())
                    || !validInstant(answer.path("answeredAt"))
                    || !familyKey(question).equals(answer.path("familyKey").asText())) {
                throw ApiException.invalid("随机练习作答必须对应冻结题序及直接判分结果");
            }
        }
    }

    private boolean text(JsonNode node, int maximum) {
        return node.isTextual() && !node.asText().isBlank() && node.asText().length() <= maximum;
    }

    private boolean validInstant(JsonNode node) {
        try {
            return text(node, 60) && Instant.parse(node.asText()) != null;
        } catch (java.time.format.DateTimeParseException exception) {
            return false;
        }
    }

    private static boolean markedSynthetic(JsonNode node) {
        return node.path("test").asBoolean() || node.path("testRecord").asBoolean() || node.path("synthetic").asBoolean()
                || node.path("imported").asBoolean();
    }

    private String familyKey(JsonNode question) {
        return question.hasNonNull("templateId")
                ? "template:" + question.path("templateId").asText() + "@" + question.path("templateVersion").asText()
                : "fixed:" + question.path("id").asText();
    }

    private JsonNode compatibleQuestion(JsonNode question) {
        if (!question.isObject() || !text(question.path("id"), 300) || !text(question.path("topicId"), 100)
                || !text(question.path("prompt"), 10000) || !question.hasNonNull("answer")
                || !text(question.path("explanation"), 10000)) return null;
        String family = familyKey(question);
        if (question.hasNonNull("familyKey") && !family.equals(question.path("familyKey").asText())) return null;
        if (question.hasNonNull("templateId")) {
            String template = question.path("templateId").asText() + "@" + question.path("templateVersion").asText();
            if (!question.path("topicId").asText().equals(templates.get(template)) || !question.path("params").isObject()
                    || !Set.of("numeric", "choice", "text").contains(question.path("type").asText())) return null;
        } else {
            JsonNode current = fixed.get(question.path("id").asText());
            if (current == null || SEMANTIC_FIELDS.stream().anyMatch(field -> !current.path(field).equals(question.path(field)))) return null;
        }
        ObjectNode sanitized = mapper.createObjectNode();
        for (String field : QUESTION_FIELDS) {
            if (question.has(field)) sanitized.set(field, question.get(field));
        }
        sanitized.put("familyKey", family);
        return sanitized;
    }

    Accumulator accumulator(Instant asOf) {
        return new Accumulator(asOf, UUID.randomUUID().toString());
    }

    final class Accumulator {
        private final Instant asOf;
        private final String salt;
        private final Map<String, List<Attempt>> attempts = new LinkedHashMap<>();
        private final Set<String> topics = new LinkedHashSet<>();
        private final Map<String, JsonNode> review = new HashMap<>();
        private final java.util.TreeMap<String, String> reviewPriorities = new java.util.TreeMap<>();

        Accumulator(Instant asOf, String salt) {
            this.asOf = asOf;
            this.salt = salt;
        }

        void add(String sessionId, JsonNode snapshot, JsonNode content, Instant occurred, Instant updated) {
            if (markedSynthetic(snapshot) || markedSynthetic(content) || !snapshot.path("answers").isArray()
                    || !content.path("questions").isArray()) return;
            int schema = snapshot.path("schema").asInt(1);
            if (schema != 1 && schema != 2) return;
            Map<String, JsonNode> byId = new HashMap<>();
            Set<String> duplicates = new HashSet<>();
            for (JsonNode question : content.path("questions")) {
                String qid = question.path("id").asText();
                if (byId.put(qid, question) != null) duplicates.add(qid);
            }
            Map<String, Attempt> logical = new LinkedHashMap<>();
            int index = 0;
            for (JsonNode answer : snapshot.path("answers")) {
                int answerIndex = index++;
                String qid = answer.path("qid").asText();
                JsonNode rawQuestion = byId.get(qid);
                if (duplicates.contains(qid) || rawQuestion == null || markedSynthetic(answer)
                        || !RESULTS.contains(answer.path("result").asText()) || answer.path("inferred").asBoolean()
                        || "inferred".equals(answer.path("src").asText())
                        || (answer.has("gradeSource") && !Set.of("auto", "manual").contains(answer.path("gradeSource").asText()))
                        || (schema == 2 && (!answer.has("gradeSource") || !validInstant(answer.path("answeredAt"))))) continue;
                JsonNode question = compatibleQuestion(rawQuestion);
                if (question == null || !answer.path("id").asText().equals(question.path("topicId").asText())) continue;
                if (schema == 2 && (!snapshot.path("plan").isArray() || answerIndex >= snapshot.path("plan").size()
                        || !rawQuestion.equals(snapshot.path("plan").get(answerIndex))
                        || !familyKey(question).equals(answer.path("familyKey").asText()))) continue;
                String family = familyKey(question);
                Instant time = validInstant(answer.path("answeredAt")) ? Instant.parse(answer.path("answeredAt").asText()) : occurred;
                Instant upper = updated.isBefore(asOf) ? updated : asOf;
                if (time.isBefore(occurred)) time = occurred;
                if (time.isAfter(upper)) time = upper;
                logical.put(question.path("topicId").asText() + "\u0000" + qid,
                        new Attempt(family, question.path("topicId").asText(), answer.path("result").asText(), time, sessionId, answerIndex));
                sample(question);
            }
            for (Attempt attempt : logical.values()) {
                topics.add(attempt.topic());
                attempts.computeIfAbsent(attempt.family(), ignored -> new ArrayList<>()).add(attempt);
            }
        }

        /** Random-priority bottom-k sampling over distinct questions, independent of history order and repetitions. */
        private void sample(JsonNode question) {
            String identity = question.path("id").asText();
            if (review.containsKey(identity)) return;
            String priority = priority(identity);
            if (review.size() == 40) {
                if (priority.compareTo(reviewPriorities.lastKey()) >= 0) return;
                review.remove(reviewPriorities.pollLastEntry().getValue());
            }
            review.put(identity, question);
            reviewPriorities.put(priority, identity);
        }

        private String priority(String identity) {
            try {
                return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((salt + "\u0000" + identity).getBytes(StandardCharsets.UTF_8))) + ":" + identity;
            } catch (NoSuchAlgorithmException exception) {
                throw new IllegalStateException(exception);
            }
        }

        Map<String, Object> result() {
            Map<String, Object> families = new LinkedHashMap<>();
            attempts.forEach((family, events) -> {
                events.sort(Comparator.comparing(Attempt::at).thenComparing(Attempt::session).thenComparingInt(Attempt::index));
                int correct = 0, wrong = 0, skip = 0, streak = 0;
                for (Attempt attempt : events) {
                    switch (attempt.result()) {
                        case "correct" -> { correct++; streak++; }
                        case "wrong" -> { wrong++; streak = 0; }
                        case "skip" -> { skip++; streak = 0; }
                        default -> throw new IllegalStateException();
                    }
                }
                Attempt last = events.getLast();
                families.put(family, Map.of("topicId", last.topic(), "correct", correct, "wrong", wrong, "skip", skip,
                        "streak", streak, "lastResult", last.result(), "lastAt", last.at().toString()));
            });
            List<JsonNode> questions = reviewPriorities.values().stream().map(review::get).toList();
            return Map.of("schema", 1, "dataVersion", dataVersion, "asOf", asOf.toString(), "topicIds", topics.stream().sorted().toList(),
                    "families", families, "reviewQuestions", questions);
        }
    }

    private record Attempt(String family, String topic, String result, Instant at, String session, int index) {}
}
