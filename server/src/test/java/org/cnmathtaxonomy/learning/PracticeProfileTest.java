package org.cnmathtaxonomy.learning;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PracticeProfileTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final Instant at = Instant.parse("2026-01-10T12:00:00Z");
    private final JsonNode fixed = mapper.valueToTree(Map.of("id", "q1", "topicId", "topic1", "type", "numeric", "prompt", "3+4=?", "answer", "7", "explanation", "3+4=7"));

    private PracticeProfile catalog() {
        return new PracticeProfile(mapper, mapper.valueToTree(Map.of("data_version", "v1")), mapper.valueToTree(List.of(fixed)),
                mapper.valueToTree(Map.of("schema", 1, "templates", List.of(Map.of("id", "add", "version", "1", "topicId", "topic1")))));
    }

    private ObjectNode generated(int number) {
        ObjectNode q = fixed.deepCopy();
        q.put("id", "generated-" + number).put("templateId", "add").put("templateVersion", "1").put("familyKey", "template:add@1");
        q.set("params", mapper.valueToTree(Map.of("a", number)));
        return q;
    }

    private ObjectNode snapshot(JsonNode question, String result, Instant answeredAt) {
        ObjectNode answer = mapper.createObjectNode().put("id", question.path("topicId").asText()).put("qid", question.path("id").asText()).put("result", result);
        if (answeredAt != null) answer.put("answeredAt", answeredAt.toString()).put("gradeSource", "auto");
        ObjectNode snapshot = mapper.createObjectNode().put("schema", 1);
        snapshot.set("answers", mapper.valueToTree(List.of(answer)));
        return snapshot;
    }

    private ObjectNode content(JsonNode q) {
        return mapper.createObjectNode().set("questions", mapper.valueToTree(List.of(q)));
    }

    private Map<String, Object> family(Map<String, Object> profile, String key) {
        return (Map<String, Object>) ((Map<?, ?>) profile.get("families")).get(key);
    }

    @Test
    void logicalAnswersAreDeduplicatedAndOrderedByTrustedTimeWithoutReturningText() {
        var accumulator = catalog().accumulator(at.plusSeconds(100));
        ObjectNode first = snapshot(fixed, "correct", at.plusSeconds(5));
        ((ObjectNode) first.path("answers").get(0)).put("text", "private-answer");
        ((ArrayNode) first.path("answers")).add(first.path("answers").get(0).deepCopy());
        accumulator.add("s1", first, content(fixed), at, at.plusSeconds(10));
        accumulator.add("s3", snapshot(fixed, "correct", at.plusSeconds(30)), content(fixed), at.plusSeconds(20), at.plusSeconds(40));
        accumulator.add("s2", snapshot(fixed, "wrong", at.plusSeconds(15)), content(fixed), at.plusSeconds(10), at.plusSeconds(20));
        var result = accumulator.result();
        var family = family(result, "fixed:q1");
        assertEquals(2, family.get("correct"));
        assertEquals(1, family.get("wrong"));
        assertEquals(1, family.get("streak"));
        assertEquals(at.plusSeconds(30).toString(), family.get("lastAt"));
        assertFalse(mapper.valueToTree(result).toString().contains("private-answer"));
        assertEquals(List.of("topic1"), result.get("topicIds"));
    }

    @Test
    void wrongAndSkipResetStreakAndFutureAnswerTimesAreClamped() {
        var accumulator = catalog().accumulator(at.plusSeconds(60));
        accumulator.add("s1", snapshot(fixed, "correct", at.minusSeconds(500)), content(fixed), at, at.plusSeconds(10));
        accumulator.add("s2", snapshot(fixed, "skip", at.plusSeconds(10000)), content(fixed), at.plusSeconds(20), at.plusSeconds(30));
        var family = family(accumulator.result(), "fixed:q1");
        assertEquals(0, family.get("streak"));
        assertEquals(1, family.get("skip"));
        assertEquals(at.plusSeconds(30).toString(), family.get("lastAt"));
    }

    @Test
    void excludesInferredImportedTestsAndChangedOrUnknownFixedQuestions() {
        var accumulator = catalog().accumulator(at.plusSeconds(60));
        ObjectNode inferred = snapshot(fixed, "correct", null);
        ((ObjectNode) inferred.path("answers").get(0)).put("gradeSource", "inferred");
        accumulator.add("s1", inferred, content(fixed), at, at);
        accumulator.add("s2", snapshot(fixed, "correct", null).put("imported", true), content(fixed), at, at);
        accumulator.add("s3", snapshot(fixed, "correct", null).put("testRecord", true), content(fixed), at, at);
        ObjectNode changed = fixed.deepCopy();
        changed.put("answer", "8");
        accumulator.add("s4", snapshot(changed, "correct", null), content(changed), at, at);
        changed.put("id", "unknown");
        accumulator.add("s5", snapshot(changed, "correct", null), content(changed), at, at);
        assertTrue(((Map<?, ?>) accumulator.result().get("families")).isEmpty());
        assertEquals(List.of(), accumulator.result().get("topicIds"));
    }

    @Test
    void sameTemplateDifferentParametersShareAStreakAndUnknownVersionsAreExcluded() {
        var accumulator = catalog().accumulator(at.plusSeconds(60));
        JsonNode first = generated(1), second = generated(2);
        accumulator.add("s1", snapshot(first, "correct", null), content(first), at, at);
        accumulator.add("s2", snapshot(second, "correct", null), content(second), at.plusSeconds(1), at.plusSeconds(1));
        ObjectNode unknown = generated(3).put("templateVersion", "2").put("familyKey", "template:add@2");
        accumulator.add("s3", snapshot(unknown, "correct", null), content(unknown), at, at);
        assertEquals(2, family(accumulator.result(), "template:add@1").get("streak"));
        assertEquals(1, ((Map<?, ?>) accumulator.result().get("families")).size());
    }

    @Test
    void reservoirSamplesDistinctQuestionsFromAllHistoryIndependentOfOrderOrRepeatCount() {
        var first = catalog().new Accumulator(at.plusSeconds(500), "fixed-test-salt");
        var reverse = catalog().new Accumulator(at.plusSeconds(500), "fixed-test-salt");
        for (int i = 0; i < 150; i++) {
            JsonNode q = generated(i), reversed = generated(149 - i);
            first.add("s" + i, snapshot(q, "correct", null), content(q), at, at);
            reverse.add("r" + i, snapshot(reversed, "correct", null), content(reversed), at, at);
        }
        for (int i = 0; i < 100; i++) first.add("repeat" + i, snapshot(generated(149), "correct", null), content(generated(149)), at, at);
        List<JsonNode> selected = (List<JsonNode>) first.result().get("reviewQuestions");
        assertEquals(40, selected.size());
        assertEquals(selected, reverse.result().get("reviewQuestions"));
        assertTrue(selected.stream().anyMatch(q -> Integer.parseInt(q.path("id").asText().substring(10)) < 100));
        assertEquals(40, selected.stream().map(q -> q.path("id").asText()).distinct().count());
    }

    private ObjectNode v2(JsonNode q) {
        ObjectNode snapshot = snapshot(q, "correct", at);
        snapshot.put("schema", 2).put("mode", "practice").put("seed", "fixed-seed").put("dataVersion", "v1").put("limit", 5).put("startedAt", at.toString());
        snapshot.set("targets", mapper.valueToTree(List.of("topic1")));
        snapshot.set("plan", mapper.valueToTree(List.of(q)));
        snapshot.set("selection", mapper.valueToTree(Map.of("strategyVersion", "1", "catalogVersion", "1", "asOf", at.toString(), "weights", Map.of("fixed:q1", 1))));
        ((ObjectNode) snapshot.path("answers").get(0)).put("familyKey", q.path("familyKey").asText("fixed:q1"));
        return snapshot;
    }

    @Test
    void schemaTwoRequiresFrozenSequenceAndBoundedDirectAnswers() {
        var catalog = catalog();
        ObjectNode valid = v2(fixed);
        assertDoesNotThrow(() -> catalog.validateSnapshot(valid, content(fixed)));
        assertThrows(ApiException.class, () -> catalog.validateSnapshot(valid.deepCopy().put("limit", 30), content(fixed)));
        ObjectNode bad = valid.deepCopy();
        ((ObjectNode) bad.path("answers").get(0)).put("qid", "other-question");
        ObjectNode invalidQuestion = bad;
        assertThrows(ApiException.class, () -> catalog.validateSnapshot(invalidQuestion, content(fixed)));
        bad = valid.deepCopy();
        ((ObjectNode) bad.path("answers").get(0)).put("gradeSource", "inferred");
        ObjectNode invalidSource = bad;
        assertThrows(ApiException.class, () -> catalog.validateSnapshot(invalidSource, content(fixed)));
        assertThrows(ApiException.class, () -> catalog.validateSnapshot(valid, content(generated(2))));
    }

    @Test
    void savedPlanAndAnswersCannotChangeButCatalogUpgradeDoesNotBreakActiveSession() {
        ObjectNode original = v2(generated(1));
        var oldCatalog = catalog();
        assertDoesNotThrow(() -> oldCatalog.validateSnapshot(original, content(generated(1))));
        var upgradedCatalog = new PracticeProfile(mapper, mapper.valueToTree(Map.of("data_version", "v2")), mapper.createArrayNode(), mapper.createObjectNode());
        assertDoesNotThrow(() -> upgradedCatalog.validateSnapshot(original.deepCopy().put("savedAt", at.toString()), content(generated(1)), original));
        assertThrows(ApiException.class, () -> upgradedCatalog.validateSnapshot(original, content(generated(1))));
        assertThrows(ApiException.class, () -> upgradedCatalog.validateSnapshot(original.deepCopy().put("seed", "changed"), content(generated(1)), original));
        ObjectNode changedAnswer = original.deepCopy();
        ((ObjectNode) changedAnswer.path("answers").get(0)).put("result", "wrong");
        assertThrows(ApiException.class, () -> upgradedCatalog.validateSnapshot(changedAnswer, content(generated(1)), original));
    }
}
