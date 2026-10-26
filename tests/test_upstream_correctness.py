"""Selected upstream corrections, with immutable source and per-question provenance.

This checks mathematics and the declared replacement boundary. It does not claim
teacher review, infer mastery, or modify saved learning records.
"""
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUESTION_IDS = {'cnm_p005_q2', 'cnm_p025_q1', 'cnm_p040_q3', 'cnm_p112_q1'}
METADATA = {'origin', 'review_status', 'figure', 'content_correction'}


def read(path):
    return json.loads((ROOT / path).read_text())


class UpstreamCorrectness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = read('config/upstream_correctness.json')
        cls.source = {q['id']: q for q in read('sources/upstream/questions.json')}
        cls.current = {q['id']: q for q in read('data/questions.json')}

    def test_explicit_immutable_old_objects_and_stable_ids(self):
        self.assertEqual(self.config['schema'], 1)
        self.assertEqual(self.config['review_status'], 'ai_draft_not_teacher_reviewed')
        self.assertEqual(set(self.config['questions']), QUESTION_IDS)
        self.assertEqual(self.config['applies_to_question_snapshot'],
                         '10a0f562b32433b785729661c2164756cb933154')
        for qid, entry in self.config['questions'].items():
            self.assertEqual(entry['expected'], self.source[qid], qid)
            self.assertEqual(entry['expected']['id'], qid)
            self.assertEqual(entry['replacement']['id'], qid)
            self.assertEqual(entry['expected']['topicId'], entry['replacement']['topicId'])
            self.assertEqual(entry['expected']['difficulty'], entry['replacement']['difficulty'])
            self.assertRegex(entry['source_commit'], r'^[0-9a-f]{40}$')
            self.assertTrue(entry['reason'].strip())
            self.assertEqual(entry['remove_fields'],
                             sorted(set(entry['expected']) - set(entry['replacement'])))

    def test_choices_answer_the_number_asked_with_independent_values(self):
        for qid, correct in [('cnm_p005_q2', str(0)), ('cnm_p025_q1', str(13 - 10))]:
            question = self.config['questions'][qid]['replacement']
            self.assertEqual(question['type'], 'choice')
            self.assertTrue(all(c['text'].isdigit() for c in question['choices']))
            self.assertEqual(next(c['text'] for c in question['choices']
                                  if c['key'] == question['answer']), correct)
        self.assertEqual(self.config['questions']['cnm_p005_q2']['replacement']['verify'], '0')
        self.assertEqual(self.config['questions']['cnm_p025_q1']['replacement']['verify'], '13-10')

    def test_numeric_context_is_self_contained_and_arithmetic_correct(self):
        length = self.config['questions']['cnm_p040_q3']['replacement']
        self.assertEqual(length['type'], 'numeric')
        for condition in ('3 厘米', '2 厘米', '首尾接在一起', '多少厘米'):
            self.assertIn(condition, length['prompt'])
        self.assertEqual(length['answer'], str(3 + 2))
        self.assertEqual(length['verify'], '3+2')
        mixed = self.config['questions']['cnm_p112_q1']['replacement']
        self.assertEqual(mixed['type'], 'numeric')
        self.assertIn('50－（8＋12）×2', mixed['prompt'])
        self.assertEqual(mixed['answer'], str(50 - (8 + 12) * 2))
        self.assertEqual(mixed['verify'], '50-(8+12)*2')
        self.assertNotIn('choices', mixed)
        self.assertEqual(self.config['questions']['cnm_p112_q1']['remove_fields'], ['choices'])

    def test_built_reused_questions_change_only_the_four_declared_objects(self):
        reused = [q for q in self.current.values() if q['origin'] == 'upstream-reused']
        self.assertEqual(len(reused), 180)
        for question in reused:
            qid = question['id']
            actual = {k: v for k, v in question.items() if k not in METADATA}
            entry = self.config['questions'].get(qid)
            self.assertEqual(actual, entry['replacement'] if entry else self.source[qid], qid)
            if entry:
                self.assertEqual(question['content_correction'], entry['source_commit'])
            else:
                self.assertNotIn('content_correction', question)
            self.assertEqual(question['review_status'], 'ai_draft_not_teacher_reviewed')

    def test_probability_requires_no_hard_classification_gate(self):
        changes = self.config['dependency_overrides']
        self.assertEqual(len(changes), 1)
        entry = changes[0]
        expected, replacement = entry['expected'], entry['replacement']
        source = read('sources/upstream/dependencies.json')
        self.assertIn(expected, source)
        self.assertEqual((expected['topicId'], expected['prerequisiteId']),
                         ('cnm_p140', 'cnm_p037'))
        self.assertEqual(expected['strength'], 'hard')
        self.assertEqual(replacement['strength'], 'soft')
        self.assertIn('但不会前者也可以开始学后者', replacement['reason'])
        actual = [d for d in read('data/dependencies.json')
                  if d['topicId'] == 'cnm_p140' and d['prerequisiteId'] == 'cnm_p037']
        self.assertEqual(len(actual), 1)
        self.assertEqual({k: actual[0][k] for k in replacement}, replacement)
        self.assertEqual(actual[0]['review_status'], 'ai_draft_not_teacher_reviewed')


if __name__ == '__main__':
    unittest.main()
