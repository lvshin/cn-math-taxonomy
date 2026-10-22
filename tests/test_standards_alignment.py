"""Regression checks for the selected primary-only upstream standards revision.

These checks verify provenance and concept-reference semantics, not whether the
upstream transcription is a word-for-word copy of the official curriculum PDF.
"""
import json
import re
import unittest
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_COMMIT = '62b341d4b66b175413d6e3f697e37639fd96aa2d'


def read(path):
    return json.loads((ROOT / path).read_text())


class PrimaryStandardsAlignment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = read('sources/upstream/cn-curriculum-standards.json')
        cls.items = {row['id']: row for row in cls.catalog['items']}
        cls.config = read('config/standards_alignment.json')
        cls.topics = {row['id']: row for row in read('data/topics.json')}

    def test_only_primary_math_and_complete_domain_numbering(self):
        rows = self.catalog['items']
        self.assertEqual(len(rows), 77)
        self.assertEqual(len(self.items), len(rows))
        counts = Counter()
        groups = defaultdict(list)
        for row in rows:
            matched = re.fullmatch(r'cms-2022:([123])\.(NA|GG|SP|IP)\.(\d{2})', row['id'])
            self.assertIsNotNone(matched, row['id'])
            stage, domain, number = matched.groups()
            groups[stage, domain].append(int(number))
            counts[stage] += 1
            self.assertFalse(row['verbatim'], row['id'])
            self.assertRegex(row['page_or_ref'], r'^课标印刷页码 \d+$')
        self.assertEqual(counts, {'1': 18, '2': 29, '3': 30})
        for key, numbers in groups.items():
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)), key)
        self.assertNotIn('english', self.catalog)

    def test_local_provenance_does_not_claim_independent_pdf_or_teacher_review(self):
        source = self.catalog['source']
        revision = source['primary_revision']
        self.assertEqual(revision['upstream_commit'], UPSTREAM_COMMIT)
        self.assertEqual(revision['review_status'], 'ai_draft_not_teacher_reviewed')
        self.assertTrue(revision['upstream_reported_page_location'])
        self.assertFalse(revision['independently_page_checked'])
        self.assertFalse(revision['independently_text_checked'])
        self.assertIn('综合与实践', revision['scope'])
        self.assertIn('不声称条文已对齐', revision['scope'])
        self.assertIn('未独立', source['page_numbering'])
        self.assertIn('original_2022_pdf', source['reference_urls'])
        self.assertIn('非2025修订版', source['url_label'])
        self.assertEqual(source['url'], source['reference_urls']['original_2022_pdf'])
        # The 2022 reference is not silently relabelled as the 2025 official file.
        self.assertNotEqual(source['reference_urls']['original_2022_pdf'],
                            source['reference_urls']['revision_2025_official_pdf'])

    def test_missing_clauses_and_truncated_sentence_are_present(self):
        self.assertIn('模型意识和几何直观', self.items['cms-2022:3.NA.10']['text'])
        self.assertIn('各种媒体', self.items['cms-2022:3.SP.03']['text'])
        self.assertIn('百分数', self.items['cms-2022:3.SP.04']['text'])
        self.assertIn('数据意识', self.items['cms-2022:3.SP.05']['text'])
        self.assertTrue(self.items['cms-2022:2.SP.06']['text'].endswith('形成初步的数据意识和应用意识。'))
        self.assertIn('y/x=5', self.items['cms-2022:3.NA.09']['text'])
        self.assertIn('＜，＝，＞', self.items['cms-2022:1.NA.02']['text'])

    def test_probability_reference_migration_keeps_its_original_meaning(self):
        self.assertEqual(self.config['standard_id_migrations'], {
            'cms-2022:3.SP.03': 'cms-2022:3.SP.06',
            'cms-2022:3.SP.04': 'cms-2022:3.SP.07',
        })
        expected = {
            'cnm_p140': ['cms-2022:3.SP.06', 'cms-2022:3.SP.07'],
            'cnm_p141': ['cms-2022:3.SP.07'],
        }
        for topic_id, references in expected.items():
            self.assertEqual([r['id'] for r in self.topics[topic_id]['standards']], references)
            for ref in references:
                self.assertEqual(self.items[ref]['section'], '随机现象发生的可能性')
                self.assertIn('可能性', self.items[ref]['text'])
        # A broad ID replacement must not overwrite the newly added clauses.
        self.assertEqual(self.items['cms-2022:3.SP.03']['clause'], '(3)')
        self.assertIn('百分数', self.items['cms-2022:3.SP.04']['text'])

    def test_percentage_references_no_longer_deny_the_explicit_clause(self):
        topics = ('cnm_p194', 'cnm_p195', 'cnm_p196', 'cnm_p197', 'cnm_p198', 'cnm_p205')
        self.assertEqual(set(self.config['topic_overrides']), set(topics))
        for topic_id in topics:
            refs = self.topics[topic_id]['standards']
            self.assertEqual([ref['id'] for ref in refs], ['cms-2022:3.SP.04'])
            self.assertEqual(refs[0]['confidence'], 'exact' if topic_id == 'cnm_p194' else 'inferred')
            self.assertTrue(refs[0]['note'])
            self.assertNotRegex(refs[0]['note'], '没有.*点名|未点名|没有单独点名')
            # This reference correction does not assign a previously unmapped topic.
            self.assertEqual(self.topics[topic_id]['placement_status'], 'unmapped')
            self.assertEqual(self.topics[topic_id]['question_count'], 0)

    def test_references_are_valid_and_only_declared_topics_are_rebound(self):
        original = {row['id']: row for row in read('sources/upstream/topics.json')}
        changed = set(self.config['expected_legacy_references'])
        self.assertEqual(changed, set(self.config['topic_overrides']) | {'cnm_p140', 'cnm_p141'})
        for topic_id, topic in self.topics.items():
            refs = topic['standards']
            self.assertEqual(len({ref['id'] for ref in refs}), len(refs), topic_id)
            for ref in refs:
                self.assertIn(ref['id'], self.items, topic_id)
                self.assertIn(ref['confidence'], ('exact', 'inferred'))
                if ref['confidence'] == 'inferred':
                    self.assertTrue(ref.get('note'), topic_id)
            if topic_id in original and topic_id not in changed:
                self.assertEqual(refs, original[topic_id]['standards'], topic_id)
        for topic_id, refs in self.config['expected_legacy_references'].items():
            self.assertEqual(refs, [ref['id'] for ref in original[topic_id]['standards']], topic_id)

    def test_built_catalog_matches_selected_source_snapshot(self):
        self.assertEqual(read('data/cn-curriculum-standards.json'), self.catalog)
        self.assertEqual(self.config['upstream_commit'], UPSTREAM_COMMIT)


if __name__ == '__main__':
    unittest.main()
