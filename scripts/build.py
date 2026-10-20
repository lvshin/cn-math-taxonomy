#!/usr/bin/env python3
"""从可审阅的原始资料构建静态数据，不访问网络或家庭 Vault。"""
import copy
import hashlib
import json
import sys
from collections import Counter
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

def build():
    topics = copy.deepcopy(read('sources/upstream/topics.json'))
    deps = copy.deepcopy(read('sources/upstream/dependencies.json'))
    evidence = read('config/book_evidence.json')
    books, placements = [], []
    for bid, edition, toc_page, units in BOOKS:
        grade, semester = int(bid[0]), '上' if bid[1] == 'a' else '下'
        book = dict(id=bid, grade=grade, semester=semester,
                    title=f'{"一二三四五六"[grade-1]}年级{semester}册', edition_label=edition,
                    publisher='江苏凤凰教育出版社', series='苏教版·2022课标修订系列',
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
    questions.sort(key=lambda q:q['id'])
    for t in topics:
        t['question_count'] = sum(q['topicId']==t['id'] for q in questions)
    catalog_counts = Counter(b['catalog_status'] for b in books)
    meta = dict(schema_version=1, data_version='2026-10-20-suzhou-v2', as_of='2026-10-20',
                title='苏州小学数学知识地图', scope='苏教新版小学1—6年级；目录与概念映射分开标注',
                upstream=dict(url='https://github.com/xiaoyang111222/cn-math-taxonomy',
                              commit='10a0f562b32433b785729661c2164756cb933154',license='CC BY-NC 4.0'),
                counts=dict(concepts=len(topics), mapped_concepts=len(assigned), questions=len(questions),
                            dependencies=len(deps), pdf_catalogs=catalog_counts['pdf_checked'],
                            official_catalogs=catalog_counts['official_checked'],
                            external_catalogs=catalog_counts['external_outline'], pending_catalogs=catalog_counts['pending'],
                            rewritten_questions=sum(q['origin']=='suzhou-rewritten' for q in questions)),
                limitations=['知识点拆分、落册和先修关系为AI整理稿，未经教师审核。',
                             '目录核对不等于逐节内容核定；有目录的单元也可能尚未拆分知识点。',
                             '四上仅有第三方参考目录；四下、五下、六下新版目录待补。',
                             '原项目课标小学条文来自公开转写，尚未与教育部PDF逐页核对。',
                             '练习结果是局部线索，不能作为完整掌握程度或学习能力的结论。'])
    for path,value in [('topics.json',topics),('dependencies.json',deps),('questions.json',questions),
                       ('books.json',books),('placements.json',placements),('meta.json',meta)]:
        write('data/'+path,value)
    write('data/cn-curriculum-standards.json',read('sources/upstream/cn-curriculum-standards.json'))
    print(json.dumps(meta['counts'],ensure_ascii=False))

if __name__ == '__main__':
    build()
