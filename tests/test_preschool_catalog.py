"""Public preschool content provenance, safe structure, and independent reproducible build."""
import copy
import importlib.util
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('preschool_builder', ROOT / 'scripts/build_preschool.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

# Reviewed against the selected existing game cards; no private-vault dependency at build/test time.
SOURCE_EPISODES = {
    'Hotel': ['S01E10'], 'Hand Stories': ['S01E21'], 'Bad Mood': ['S02E40'],
    'Musical Statues': ['S03E27'], 'Butterflies': ['S01E15'], 'Helicopter': ['S02E25'],
    'Pass the Parcel': ['S03E14'], 'Library': ['S02E30'], 'Daddy Robot': ['S01E04'],
    'BBQ': ['S01E07'], 'Obstacle Course': ['S03E03', 'S03E30'], 'Shadowlands': ['S01E05'],
    'Fairy Garden': ['S01E30', 'S02E31'], 'Octopus': ['S02E41'], 'Café': [],
    'Barky Boats': ['S02E31', 'S01E29', 'S03E45'],
}


class PreschoolCatalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'config/preschool.json').read_text(encoding='utf-8'))

    def test_initial_batch_has_sixteen_activities_in_eight_themes(self):
        self.assertEqual(self.catalog['version'], '2026-10-22-preschool-v1')
        self.assertEqual(len(self.catalog['themes']), 8)
        self.assertEqual(len(self.catalog['activities']), 16)
        self.assertEqual(set(Counter(a['themeId'] for a in self.catalog['activities']).values()), {2})
        self.assertEqual({a['id'] for a in self.catalog['activities']}, {
            'bluey-hotel-requests', 'bluey-hand-story', 'bluey-mood-puppet', 'bluey-music-statues',
            'bluey-butterfly-invitation', 'bluey-helicopter-plan', 'bluey-parcel-turns', 'bluey-library-rules',
            'bluey-tidy-robot', 'bluey-pretend-picnic', 'bluey-floor-course', 'bluey-shadow-path',
            'bluey-paper-garden', 'bluey-octopus-ideas', 'bluey-cafe-hello-goodbye', 'bluey-paper-boat-journey',
        })
        builder.validate(self.catalog)

    def test_sources_and_adaptations_are_separate_and_known(self):
        self.assertEqual({a['sourceGame']['name'] for a in self.catalog['activities']}, set(SOURCE_EPISODES))
        for activity in self.catalog['activities']:
            with self.subTest(activity=activity['id']):
                self.assertEqual(activity['adaptation'], '家庭活动改编')
                self.assertEqual(activity['module'], 'PRESCHOOL')
                self.assertEqual(activity['version'], '1')
                self.assertEqual(activity['sourceGame']['chineseNameStatus'], 'working-translation')
                self.assertTrue(activity['sourceGame']['summary'].startswith('原游戏'))
                self.assertEqual([e['id'] for e in activity['episodes']], SOURCE_EPISODES[activity['sourceGame']['name']])
                self.assertTrue(all(e['titleSource'] == 'TMDB zh-CN' for e in activity['episodes']))
        cafe = next(a for a in self.catalog['activities'] if a['sourceGame']['name'] == 'Café')
        self.assertEqual(cafe['episodes'], [])
        self.assertIn('待确认', cafe['episodeNote'])

    def test_public_catalog_has_no_private_records_or_internal_links(self):
        encoded = json.dumps(self.catalog, ensure_ascii=False)
        self.assertIsNone(builder.PRIVATE_PATTERN.search(encoded))
        for key in ('score', 'mastery', 'rank', 'childId', 'familyId', 'feedback', 'observations'):
            self.assertNotIn('"' + key + '"', encoded)
        self.assertIn('可随时', encoded)
        self.assertIn('未经学前教育专业人员审核', self.catalog['notice'])

    def test_reproducible_output_and_primary_school_data_version_stays_independent(self):
        output = (ROOT / 'data/preschool.json').read_bytes()
        self.assertEqual(output, builder.encode(builder.validate(self.catalog)))
        self.assertEqual(output, builder.encode(builder.validate(copy.deepcopy(self.catalog))))
        self.assertEqual(self.catalog['version'], '2026-10-22-preschool-v1')
        self.assertNotIn('suzhou', self.catalog['version'])
        self.assertNotIn('preschool', (ROOT / 'scripts/build.py').read_text())

    def test_complete_play_instructions_and_process_only_observation_prompts(self):
        for activity in self.catalog['activities']:
            with self.subTest(activity=activity['id']):
                self.assertGreaterEqual(len(activity['steps']), 4)
                self.assertGreaterEqual(len(activity['parentPrompts']), 2)
                self.assertGreaterEqual(len(activity['observe']), 2)
                self.assertTrue(activity['safety'])
                self.assertIn('可随时结束', activity['duration'])
                self.assertNotRegex(' '.join(activity['observe']), r'达标|排名|正常|落后|诊断|掌握|几分|分数|必须')

    def test_builder_rejects_invalid_associations_sources_and_privacy(self):
        bad_catalogs = []
        for field, value in [('module', 'MATH'), ('themeId', 'unknown'), ('id', '../private'), ('version', '0'),
                             ('observe', []), ('summary', '\u03c0\u03c0 的私人反馈'), ('adaptation', '官方原作玩法')]:
            invalid = copy.deepcopy(self.catalog)
            invalid['activities'][0][field] = value
            bad_catalogs.append(invalid)
        invalid = copy.deepcopy(self.catalog)
        invalid['activities'][0]['sourceGame']['url'] = 'https://example.com/not-source'
        bad_catalogs.append(invalid)
        invalid = copy.deepcopy(self.catalog)
        invalid['activities'][0]['episodes'][0]['url'] = 'https://www.bluey.tv/watch/season-3/hotel/'
        bad_catalogs.append(invalid)
        invalid = copy.deepcopy(self.catalog)
        invalid['activities'][0]['episodes'] = []
        bad_catalogs.append(invalid)
        invalid = copy.deepcopy(self.catalog)
        invalid['activities'][1]['id'] = invalid['activities'][0]['id']
        bad_catalogs.append(invalid)
        for index, invalid in enumerate(bad_catalogs):
            with self.subTest(case=index), self.assertRaises(ValueError):
                builder.validate(invalid)


if __name__ == '__main__':
    unittest.main()
