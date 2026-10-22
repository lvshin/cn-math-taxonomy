#!/usr/bin/env python3
"""Validate and build the independent preschool catalog without network or private-vault access."""
import argparse
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'config/preschool.json'
OUTPUT = ROOT / 'data/preschool.json'
ID_PATTERN = re.compile(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z')
PRIVATE_PATTERN = re.compile(r'\u03c0\u03c0|家庭反馈|共看反馈|Family Vault|\[\[|/[U]sers/|(?<![A-Za-z])[A-Za-z]:[\\/]|tail[a-z0-9]*\.ts\.net|localhost|127\.0\.0\.1', re.I)
TEXT_FIELDS = ('id', 'version', 'title', 'themeId', 'domain', 'summary', 'easier', 'variation',
               'duration', 'participants', 'setting', 'adaptation')
LIST_FIELDS = ('materials', 'steps', 'parentPrompts', 'observe')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def require_url(value, host, path_prefix):
    require(nonempty(value), '来源链接不能为空')
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and parsed.netloc == host and parsed.path.startswith(path_prefix)
            and not parsed.username and not parsed.password and not parsed.query, '来源链接须使用允许的 HTTPS 来源')


def validate(catalog):
    require(isinstance(catalog, dict) and catalog.get('schema') == 1, '幼儿园目录 schema 无效')
    require(nonempty(catalog.get('version')) and re.fullmatch(r'\d{4}-\d{2}-\d{2}-preschool-v[1-9]\d*', catalog['version']), '幼儿园目录版本无效')
    for key in ('title', 'intro', 'notice', 'reviewStatus'):
        require(nonempty(catalog.get(key)), '幼儿园目录缺少说明：' + key)
    require(catalog['reviewStatus'] == 'family-adaptations-not-professionally-reviewed', '专业审核状态不能省略')
    themes = catalog.get('themes')
    activities = catalog.get('activities')
    require(isinstance(themes, list) and themes and isinstance(activities, list) and activities, '主题或活动为空')
    theme_ids = []
    for theme in themes:
        require(isinstance(theme, dict), '主题格式无效')
        require(all(nonempty(theme.get(k)) for k in ('id', 'name', 'description')), '主题缺少字段')
        require(ID_PATTERN.fullmatch(theme['id']), '主题 ID 无效')
        theme_ids.append(theme['id'])
    require(len(set(theme_ids)) == len(theme_ids), '主题 ID 重复')
    activity_ids = []
    sources = []
    title_by_episode = {}
    for activity in activities:
        require(isinstance(activity, dict), '活动格式无效')
        require(activity.get('module') == 'PRESCHOOL', '活动模块必须是 PRESCHOOL')
        require(all(nonempty(activity.get(k)) for k in TEXT_FIELDS), '活动缺少文本字段')
        require(ID_PATTERN.fullmatch(activity['id']), '活动 ID 无效')
        require(re.fullmatch(r'[1-9]\d*', activity['version']), '活动版本无效')
        require(activity['themeId'] in theme_ids, '活动引用了不存在的主题')
        require(activity['adaptation'] == '家庭活动改编', '活动必须明确标注家庭改编')
        activity_ids.append(activity['id'])
        for key in LIST_FIELDS:
            require(isinstance(activity.get(key), list) and activity[key] and all(nonempty(x) for x in activity[key]), '活动缺少列表：' + key)
        if 'safety' in activity:
            require(isinstance(activity['safety'], list) and all(nonempty(x) for x in activity['safety']), '安全提示格式无效')
        source = activity.get('sourceGame')
        require(isinstance(source, dict), '缺少游戏来源')
        require(all(nonempty(source.get(k)) for k in ('name', 'chineseName', 'summary')), '游戏来源缺少字段')
        require(source.get('chineseNameStatus') == 'working-translation', '游戏中文名必须标记工作译名')
        require_url(source.get('url'), 'blueypedia.fandom.com', '/wiki/List_of_Games')
        sources.append(source['name'])
        episodes = activity.get('episodes')
        require(isinstance(episodes, list), '对应动画须为列表')
        require(episodes or (nonempty(activity.get('episodeNote')) and '待确认' in activity['episodeNote']), '无对应动画须保留待确认说明')
        episode_ids = []
        for episode in episodes:
            require(isinstance(episode, dict), '动画来源格式无效')
            require(all(nonempty(episode.get(k)) for k in ('id', 'title', 'englishTitle', 'titleSource', 'url')), '动画来源缺少字段')
            require(re.fullmatch(r'S0[1-3]E\d{2}', episode['id']), '动画 ID 无效')
            require(episode['titleSource'] == 'TMDB zh-CN', '动画中文标题须保留来源')
            season = int(episode['id'][1:3])
            require_url(episode['url'], 'www.bluey.tv', '/watch/season-' + str(season) + '/')
            entry = (episode['title'], episode['englishTitle'], episode['url'])
            require(episode['id'] not in title_by_episode or title_by_episode[episode['id']] == entry, '同集动画来源不一致')
            title_by_episode[episode['id']] = entry
            episode_ids.append(episode['id'])
        require(len(set(episode_ids)) == len(episode_ids), '同一活动重复关联动画')
    require(len(set(activity_ids)) == len(activity_ids), '活动 ID 重复')
    require(len(set(sources)) == len(sources), '首批活动不重复使用同一来源游戏')
    require(set(Counter(a['themeId'] for a in activities)) == set(theme_ids), '存在没有活动的主题')
    require(not PRIVATE_PATTERN.search(json.dumps(catalog, ensure_ascii=False)), '幼儿园目录包含私有内容或内部链接')
    return catalog


def encode(catalog):
    return (json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def build(check=False):
    catalog = validate(json.loads(SOURCE.read_text(encoding='utf-8')))
    content = encode(catalog)
    if check:
        require(OUTPUT.exists() and OUTPUT.read_bytes() == content, '幼儿园产物与配置不一致，请运行 build_preschool.py')
    else:
        OUTPUT.write_bytes(content)
    print(f'preschool: {len(catalog["themes"])} themes, {len(catalog["activities"])} activities; {catalog["version"]}')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='只读核对产物是否与配置一致')
    args = parser.parse_args()
    build(check=args.check)
