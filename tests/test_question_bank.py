"""Coverage, independent arithmetic, and immutable v3 baseline for the added fixed bank."""
import hashlib
import importlib.util
import json
import re
import unittest
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('question_audit', ROOT / 'scripts/audit_questions.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def read(name):
    return json.loads((ROOT / name).read_text())


class FixedQuestionBank(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions = read('data/questions.json')
        cls.mapped = {p['topicId'] for p in read('data/placements.json')}
        cls.generated = {t['topicId'] for t in read('data/practice_templates.json')['templates']}
        cls.added = [q for q in cls.questions if q['origin'] == 'suzhou-supplement']

    def test_original_458_questions_change_only_by_declared_corrections(self):
        # Reverse only four explicit audited fixes; every other legacy field remains locked.
        corrections = read('config/upstream_correctness.json')['questions']
        self.assertEqual(set(corrections), {'cnm_p005_q2', 'cnm_p025_q1', 'cnm_p040_q3', 'cnm_p112_q1'})
        original = []
        for question in self.questions:
            if question['origin'] == 'suzhou-supplement':
                continue
            row = {k: v for k, v in question.items() if k != 'figure'}
            if row['id'] in corrections:
                correction = corrections[row['id']]
                self.assertEqual(row.pop('content_correction'), correction['source_commit'])
                self.assertEqual({k: row.get(k) for k in correction['replacement']}, correction['replacement'])
                for key in set(correction['replacement']) - set(correction['expected']):
                    row.pop(key, None)
                row.update(correction['expected'])
            original.append(row)
        canonical = json.dumps(original, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(len(original), 458)
        # Verified published v3 bank; changing existing IDs, wording, answers or explanations fails.
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), '1611d110f940fe829b3b5dd2b10cc54f60f1fd9be2528463f77dba9b163bbc9b')

    def test_fixed_only_concepts_have_enough_questions(self):
        counts = Counter(q['topicId'] for q in self.questions)
        self.assertEqual(len(self.questions), 898)
        self.assertEqual(len(self.added), 440)
        self.assertEqual({q['topicId'] for q in self.added}, self.mapped - self.generated)
        self.assertEqual(len(self.mapped - self.generated), 118)
        for topic in self.mapped - self.generated:
            self.assertGreaterEqual(counts[topic], 6, topic)
        self.assertEqual(counts['cnm_p003'], 10)
        self.assertTrue(all(q['topicId'] in self.mapped for q in self.questions))
        self.assertEqual(len({q['id'] for q in self.questions}), len(self.questions))

    def test_percentage_mode_is_explicit_and_only_marks_percentage_answers(self):
        marked = [q for q in self.questions if q.get('percent') is True]
        self.assertEqual({q['id'] for q in marked}, {'cnm_p199_extra_002', 'cnm_p199_extra_004'})
        self.assertEqual({q['answer'] for q in marked}, {'25', '30'})
        for question in marked:
            self.assertEqual(question['type'], 'numeric')
            self.assertIn('百分之几', question['prompt'])
        quantity = next(q for q in self.questions if q['id'] == 'cnm_p199_extra_001')
        self.assertNotIn('percent', quantity)
        self.assertEqual(quantity['answer'], '10')

    def test_no_repeated_prompts_within_a_concept(self):
        prompts = defaultdict(set)
        for question in self.questions:
            normalized = re.sub(r'\s+', '', unicodedata.normalize('NFKC', question['prompt']))
            self.assertNotIn(normalized, prompts[question['topicId']], question['id'])
            prompts[question['topicId']].add(normalized)

    def test_supplements_have_solutions_and_different_focuses(self):
        focuses = defaultdict(set)
        for question in self.added:
            self.assertEqual(question['review_status'], 'ai_draft_not_teacher_reviewed')
            self.assertTrue(question['explanation'].strip(), question['id'])
            self.assertTrue(question['practice_focus'].strip(), question['id'])
            focuses[question['topicId']].add(question['practice_focus'])
            if question['type'] == 'choice':
                choices = question['choices']
                self.assertGreaterEqual(len(choices), 3)
                self.assertEqual(len({c['text'] for c in choices}), len(choices))
                normalized = [re.sub(r'\s+', '', unicodedata.normalize('NFKC', c['text'])) for c in choices]
                self.assertEqual(len(set(normalized)), len(normalized), question['id'])
                # Different decimal/fraction spellings must not offer the same numerical answer twice.
                numerical = [audit.normalized(text) for text in normalized]
                self.assertEqual(len(set(numerical)), len(numerical), question['id'])
                self.assertEqual(sum(c['key'] == question['answer'] for c in choices), 1)
        self.assertTrue(all(len(values) >= 2 for values in focuses.values()))

    def test_all_new_numeric_answers_have_independent_exact_arithmetic(self):
        numeric = [q for q in self.added if q['type'] == 'numeric']
        self.assertGreater(len(numeric), 0)
        for question in numeric:
            expression = audit.ast.parse(question['verify'], mode='eval')
            self.assertTrue(any(isinstance(node, audit.ast.BinOp) for node in audit.ast.walk(expression)), question['id'])
            calculated = audit.calc(expression)
            self.assertEqual(audit.normalized(calculated), audit.normalized(question['answer']), question['id'])


if __name__ == '__main__':
    unittest.main()
