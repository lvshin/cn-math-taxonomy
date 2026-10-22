#!/usr/bin/env python3
"""从可审阅的原始资料构建静态数据，不访问网络或家庭 Vault。"""
import copy
import hashlib
import json
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'config'))
from curriculum import BOOKS, NEW, EDGE_REPLACEMENTS
from question_overrides import Q

def read(path):
    return json.loads((ROOT / path).read_text())

def write(path, value):
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def tid(value):
    return f'cnm_p{value:03}' if isinstance(value, int) else value

def append_supplements(questions, assigned):
    """Append original concept questions without renumbering or editing the existing bank."""
    seen_topics = set()
    for level in ('lower', 'middle', 'upper'):
        source = read(f'config/question_supplements_{level}.json')
        if source.get('schema') != 1 or not isinstance(source.get('topics'), dict):
            raise ValueError('补充题库格式不正确：' + level)
        for key, rows in source['topics'].items():
            if key not in assigned or key in seen_topics or not rows:
                raise ValueError('补充知识点重复或未落册：' + key)
            seen_topics.add(key)
            for i, row in enumerate(rows, 1):
                if not all(isinstance(row.get(field), str) and row[field].strip() for field in ('prompt', 'explanation', 'focus')):
                    raise ValueError('补充题缺少题干、解析或检查目标：' + key)
                if row.get('difficulty') not in ('basic', 'standard'):
                    raise ValueError('补充题难度无效：' + key)
                q = dict(id=f'{key}_extra_{i:03}', topicId=key, prompt=row['prompt'], explanation=row['explanation'],
                         difficulty=row['difficulty'], practice_focus=row['focus'], origin='suzhou-supplement',
                         review_status='ai_draft_not_teacher_reviewed')
                answer = row.get('answer')
                if isinstance(answer, list):
                    if len(answer) < 3 or any(not isinstance(x, str) or not x.strip() for x in answer) or len(set(answer)) != len(answer):
                        raise ValueError('补充题选项无效：' + q['id'])
                    offset = int(hashlib.sha256(q['id'].encode()).hexdigest()[:4], 16) % len(answer)
                    choices = answer[offset:] + answer[:offset]
                    q.update(type='choice', choices=[dict(key=chr(65+j), text=x) for j, x in enumerate(choices)],
                             answer=chr(65+choices.index(answer[0])))
                else:
                    if not isinstance(answer, str) or not isinstance(row.get('verify'), str) or not row['verify'].strip():
                        raise ValueError('数值补充题缺少标准答案或独立算式：' + q['id'])
                    Fraction(answer)
                    q.update(type='numeric', answer=answer, verify=row['verify'])
                questions.append(q)

def align_standards(topics):
    alignment = read('config/standards_alignment.json')
    if alignment.get('schema') != 1:
        raise ValueError('课标迁移配置版本无效')
    by_id = {t['id']: t for t in topics}
    for key, expected in alignment['expected_legacy_references'].items():
        if key not in by_id or [s['id'] for s in by_id[key]['standards']] != expected:
            raise ValueError('课标旧引用与声明基线不符：' + key)
    for topic in topics:
        changed = False
        for standard in topic.get('standards', []):
            if standard['id'] in alignment['standard_id_migrations']:
                standard['id'] = alignment['standard_id_migrations'][standard['id']]
                changed = True
        if topic['id'] in alignment['topic_overrides']:
            topic.update(copy.deepcopy(alignment['topic_overrides'][topic['id']]))
            changed = True
        if changed:
            topic['standard_mapping_source'] = 'suzhou-upstream-alignment'
    known = {s['id'] for s in read('sources/upstream/cn-curriculum-standards.json')['items']}
    if any(ref['id'] not in known for t in topics for ref in t.get('standards', [])):
        raise ValueError('课标引用指向不存在的条款')


def attach_figures(questions, assigned):
    catalog = read('config/question_figures.json')
    if catalog.get('schema') != 1 or not isinstance(catalog.get('entries'), dict) or not catalog.get('version'):
        raise ValueError('图示配置格式不正确')
    by_id = {q['id']: q for q in questions}
    for key, entry in catalog['entries'].items():
        question = by_id.get(key)
        if question is None or question['topicId'] not in assigned or question['prompt'] != entry['expected_prompt']:
            raise ValueError('图示与当前题干不符：' + key)
        figure = entry['figure']
        if figure.get('schema') != 1 or not isinstance(figure.get('nodes'), list) or not figure.get('alt'):
            raise ValueError('图示结构不正确：' + key)
        question['figure'] = copy.deepcopy(figure)
    return len(catalog['entries'])


def build():
    topics = copy.deepcopy(read('sources/upstream/topics.json'))
    align_standards(topics)
    deps = copy.deepcopy(read('sources/upstream/dependencies.json'))
    evidence = read('config/book_evidence.json')
    books, placements = [], []
    for bid, edition, toc_page, units in BOOKS:
        grade, semester = int(bid[0]), '上' if bid[1] == 'a' else '下'
        book = dict(id=bid, grade=grade, semester=semester,
                    title=f'{"一二三四五六"[grade-1]}年级{semester}册', edition_label=edition,
                    publisher='江苏凤凰教育出版社', series=evidence.get(bid, {}).get('series', '苏教版·修订系列'),
                    catalog_status=evidence.get(bid, {}).get('catalog_status') or ('pdf_checked' if toc_page else ('external_outline' if units else 'pending')),
                    toc_pdf_page=toc_page, evidence=evidence.get(bid), units=[])
        for index, (title, page, concept_ids) in enumerate(units):
            uid = f'{bid}-u{index+1:02}'
            book['units'].append(dict(id=uid, title=title, printed_page=page,
                                      topic_ids=[tid(n) for n in concept_ids],
                                      coverage='partial' if concept_ids else 'not_decomposed'))
            for n in concept_ids:
                placements.append(dict(topicId=tid(n), bookId=bid, unitId=uid,
                                       status='inferred', evidence_level='unit_title',
                                       note='按已收集目录的主题作概念映射，尚未逐节逐页或由教师核定。'))
        books.append(book)

    for key, (name, domain, desc, criteria, prerequisites) in NEW.items():
        topics.append(dict(id=key, name=name, domain=domain, type='conceptual', description=desc,
                           mastery_criteria=criteria, external=False, standards=[]))
        for p in prerequisites:
            deps.append(dict(topicId=key, prerequisiteId=tid(p), strength='hard',
                             reason='这是理解本概念所需的数量或图形基础。', source='suzhou-ai-draft'))
    for n, edges in EDGE_REPLACEMENTS.items():
        key = tid(n)
        deps = [d for d in deps if d['topicId'] != key]
        for p, strength, *reason in edges:
            deps.append(dict(topicId=key, prerequisiteId=tid(p), strength=strength,
                             reason=reason[0] if reason else '按概念关系调整，供后续教师审核。',
                             source='suzhou-ai-draft'))
    book_index = {b['id']: b for b in books}
    unit_index = {u['id']: u for b in books for u in b['units']}
    assigned = {p['topicId'] for p in placements}
    by_id = {t['id']: t for t in topics}
    for t in topics:
        old_grade, old_semester, old_chapter = t.pop('grade',None), t.pop('semester',None), t.pop('chapter',None)
        t.pop('diagnostic_question', None)  # 未落册概念不能回退成一道未经适配的默认题。
        t['origin'] = dict(project='cn-math-taxonomy' if t['id'].startswith('cnm_') else 'suzhou-math-taxonomy',
                           source_id=t['id'], original_grade=old_grade, original_semester=old_semester,
                           original_chapter=old_chapter)
        t['review_status'] = 'ai_draft_not_teacher_reviewed'
        ps = [p for p in placements if p['topicId'] == t['id']]
        t['placement_status'] = 'inferred' if ps else 'unmapped'
        t['grade'], t['semester'], t['chapter'] = None, None, '教材位置待核'
        if ps:
            b, u = book_index[ps[0]['bookId']], unit_index[ps[0]['unitId']]
            t['grade'], t['semester'] = b['grade'], b['semester']
            t['chapter'] = b['title'] + ' ' + u['title']
    deps = [dict(d, review_status='ai_draft_not_teacher_reviewed') for d in deps]
    questions = []
    overrides = {tid(k): v for k,v in Q.items()}
    for q in read('sources/upstream/questions.json'):
        if q['topicId'] in assigned and q['topicId'] not in overrides:
            q = copy.deepcopy(q)
            q['origin'] = 'upstream-reused'
            q['review_status'] = 'ai_draft_not_teacher_reviewed'
            questions.append(q)
    for key, rows in overrides.items():
        if key not in assigned:
            raise ValueError('重写题目对应知识点尚未落册：' + key)
        for i,(prompt, answer, explanation) in enumerate(rows,1):
            q = dict(id=key+f'_q{i}', topicId=key, prompt=prompt,
                     explanation=explanation, difficulty='basic' if i==2 else 'standard',
                     origin='suzhou-rewritten', review_status='ai_draft_not_teacher_reviewed')
            if isinstance(answer,list):
                correct = answer[0]
                offset = int(hashlib.sha256(q['id'].encode()).hexdigest()[:4],16) % len(answer)
                choices = answer[offset:] + answer[:offset]
                q.update(type='choice', choices=[dict(key=chr(65+j),text=x) for j,x in enumerate(choices)],
                         answer=chr(65+choices.index(correct)))
            else:
                q.update(type='numeric', answer=answer)
            questions.append(q)
    append_supplements(questions, assigned)
    figure_count = attach_figures(questions, assigned)
    if len({q['id'] for q in questions}) != len(questions):
        raise ValueError('题目ID重复')
    questions.sort(key=lambda q:q['id'])
    for t in topics:
        t['question_count'] = sum(q['topicId']==t['id'] for q in questions)
    catalog_counts = Counter(b['catalog_status'] for b in books)
    meta = dict(schema_version=1, data_version='2026-10-22-suzhou-v5', as_of='2026-10-22',
                title='苏州小学数学知识地图', scope='现用苏教小学1—6年级十二册；四上暂选，四至六下采用2013系列',
                upstream=dict(url='https://github.com/xiaoyang111222/cn-math-taxonomy',
                              commit='10a0f562b32433b785729661c2164756cb933154',
                              checked_commit='62b341d4b66b175413d6e3f697e37639fd96aa2d',
                              selected_updates=['primary-standards-2025', 'geometry-figure-adaptation', 'map-interaction-adaptation'],
                              license='CC BY-NC 4.0'),
                counts=dict(concepts=len(topics), mapped_concepts=len(assigned), questions=len(questions),
                            dependencies=len(deps), illustrated_questions=figure_count, primary_standards=77, pdf_catalogs=catalog_counts['pdf_checked'],
                            official_catalogs=catalog_counts['official_checked'],
                            provisional_catalogs=catalog_counts['pdf_provisional'],
                            external_catalogs=catalog_counts['external_outline'], pending_catalogs=catalog_counts['pending'],
                            rewritten_questions=sum(q['origin']=='suzhou-rewritten' for q in questions),
                            supplemented_questions=sum(q['origin']=='suzhou-supplement' for q in questions)),
                limitations=['知识点拆分、落册和先修关系为AI整理稿，未经教师审核。',
                             '目录核对不等于逐节内容核定；有目录的单元也可能尚未拆分知识点。',
                             '四上116页扫描本保持暂选；目录及首尾已抽查，详细版次与全文仍待比对。',
                             '四至六下按现用2013系列组织，课标年份和具体出版版次分别记录。',
                             '六上按已收录扫描件的放大与缩小目录组织，保留与官网比例尺单元的差异。',
                             '小学课标参考共77条：数与代数、图形与几何、统计与概率66条采用上游2025修订整理；综合与实践11条保留原整理，仅采用上游页码。本改编未独立逐字逐页核验。',
                             '练习结果是局部线索，不能作为完整掌握程度或学习能力的结论。'])
    for path,value in [('topics.json',topics),('dependencies.json',deps),('questions.json',questions),
                       ('books.json',books),('placements.json',placements),('meta.json',meta)]:
        write('data/'+path,value)
    write('data/cn-curriculum-standards.json',read('sources/upstream/cn-curriculum-standards.json'))
    # 规则模板独立版本化；固定题扩充提升数据版本，不顺带改变模板版本。
    templates = read('config/practice_templates.json')
    if templates.get('schema') != 1 or not templates.get('version') or not isinstance(templates.get('templates'), list):
        raise ValueError('无效的规则变式目录')
    seen_templates = set()
    for template in templates['templates']:
        if template['id'] in seen_templates or template['topicId'] not in assigned or not isinstance(template['version'], int) or template['version'] < 1:
            raise ValueError('变式ID重复、知识点未落册或版本无效：' + template['id'])
        seen_templates.add(template['id'])
    # 保留配置字节，便于审阅生成产物与来源完全一致。
    (ROOT / 'data/practice_templates.json').write_bytes((ROOT / 'config/practice_templates.json').read_bytes())
    print(json.dumps(meta['counts'],ensure_ascii=False))

if __name__ == '__main__':
    build()
