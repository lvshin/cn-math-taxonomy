#!/usr/bin/env node
/* 诊断引擎测试：node tests/test_engine.js （无依赖，仅用 assert） */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../diagnose/engine.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const sorted = (it) => Array.from(it).sort();

/* ------------------------------------------------------------ 手造小图
 *   X(外部) <- F <- E <- C <---hard--- T
 *              F <- D <---hard--- T
 *              F <- B <---soft--- T
 *   Z 与 T 无关
 * topics 顺序：X F E C D B T Z（同级先修按此顺序出题）
 */
function mk(id, extra) {
  return Object.assign({
    id: id, name: id, external: false,
    diagnostic_question: { question: id + '?', answer: '1' }
  }, extra || {});
}
const smallTopics = [
  mk('X', { external: true, diagnostic_question: undefined }),
  mk('F'), mk('E'), mk('C'), mk('D'), mk('B'), mk('T'), mk('Z')
];
const smallDeps = [
  { topicId: 'F', prerequisiteId: 'X', strength: 'hard' },
  { topicId: 'E', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'C', prerequisiteId: 'E', strength: 'hard' },
  { topicId: 'D', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'B', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'B', strength: 'soft' },   // 故意把 soft 写在 hard 前面
  { topicId: 'T', prerequisiteId: 'D', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'C', strength: 'hard' }
];
const G = E.buildGraph(smallTopics, smallDeps);

function run(session, script) {
  // script: {id: 'correct'|'wrong'|'skip'} —— 按引擎的出题顺序作答，返回 [会话, 出题顺序]
  const asked = [];
  let s = session;
  for (let guard = 0; guard < 100; guard++) {
    const q = E.nextQuestion(G, s);
    if (!q) break;
    asked.push(q);
    assert.ok(script[q], '脚本里没有 ' + q + ' 的答案');
    s = E.applyAnswer(G, s, q, script[q]);
  }
  return [s, asked];
}

function assertTopological(order, graph) {
  const pos = new Map(order.map((id, i) => [id, i]));
  order.forEach((id) => {
    graph.prereqs[id].forEach((p) => {
      if (pos.has(p.id)) assert.ok(pos.get(p.id) < pos.get(id), p.id + ' 应排在 ' + id + ' 之前');
    });
  });
}

console.log('小型手造图（每个知识点只有一道题——回退模式：答错即薄弱）');

test('祖先子图：目标 + 全部祖先（含外部节点），不含无关点', () => {
  assert.deepStrictEqual(sorted(E.ancestors(G, 'T')), ['B', 'C', 'D', 'E', 'F', 'X']);
  assert.deepStrictEqual(sorted(E.ancestors(G, 'E')), ['F', 'X']);
  assert.deepStrictEqual(sorted(E.ancestors(G, 'X')), []);
  const sub = E.subgraph(G, ['T']);
  assert.deepStrictEqual(sorted(sub.nodes), ['B', 'C', 'D', 'E', 'F', 'T', 'X']);
});

test('拓扑序：每个先修都排在依赖它的点之前', () => {
  const sub = E.subgraph(G, ['T']);
  assertTopological(sub.nodes, G);
  assert.strictEqual(sub.nodes[0], 'X');
  assert.strictEqual(sub.nodes[sub.nodes.length - 1], 'T');
  const multi = E.subgraph(G, ['C', 'D']);
  assertTopological(multi.nodes, G);
  assert.deepStrictEqual(sorted(multi.nodes), ['C', 'D', 'E', 'F', 'X']);
});

test('先修按 hard 优先、再 soft', () => {
  assert.deepStrictEqual(G.prereqs.T.map((p) => p.id + ':' + p.strength), ['C:hard', 'D:hard', 'B:soft']);
});

test('第一题问目标本身', () => {
  const s = E.createSession(G, ['T']);
  assert.strictEqual(E.nextQuestion(G, s), 'T');
});

test('答对：该点及所有祖先（含外部）视为掌握并跳过', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'T', 'correct');
  assert.strictEqual(E.nextQuestion(G, s), null);
  ['B', 'C', 'D', 'E', 'F', 'X', 'T'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'mastered', id));
  assert.strictEqual(s.status.T.src, 'direct');
  assert.strictEqual(s.status.F.src, 'inferred');
  assert.strictEqual(E.statusOf(s, 'Z'), 'unknown');
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sum.weak, []);
  assert.deepStrictEqual(sum.roots, []);
  assert.deepStrictEqual(sum.path, []);
  assert.strictEqual(sum.asked, 1);
});

test('答错：回溯先修，hard 先于 soft，深度优先', () => {
  const s0 = E.createSession(G, ['T']);
  const [s, asked] = run(s0, { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  // T 错 -> 先修 C,D（hard，按文件顺序）再 B（soft）；C 错 -> 先问 C 的先修 E，再回到 D、B
  assert.deepStrictEqual(asked, ['T', 'C', 'E', 'D', 'B']);
  assert.strictEqual(E.nextQuestion(G, s), null);
});

test('答错后首个追问是 hard 先修，soft 排最后', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'T', 'wrong');
  assert.strictEqual(E.nextQuestion(G, s), 'C');
  s = E.applyAnswer(G, s, 'C', 'correct'); // C 对 -> E、F、X 掌握
  assert.strictEqual(E.nextQuestion(G, s), 'D');
  s = E.applyAnswer(G, s, 'D', 'correct');
  assert.strictEqual(E.nextQuestion(G, s), 'B');
});

test('「不会」(skip) 与答错等效', () => {
  const [a] = run(E.createSession(G, ['T']), { T: 'skip', C: 'skip', E: 'correct', D: 'correct', B: 'correct' });
  const [b] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  assert.deepStrictEqual(a.status, b.status);
});

test('已判定的点不重复问；共享先修只问一次', () => {
  const [, asked] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'wrong' });
  assert.strictEqual(new Set(asked).size, asked.length);
  assert.deepStrictEqual(asked, ['T', 'C', 'E', 'F', 'D', 'B']);
});

test('题量上限生效，剩余标为未测', () => {
  const s0 = E.createSession(G, ['T'], { limit: 2 });
  const [s, asked] = run(s0, { T: 'wrong', C: 'wrong' });
  assert.deepStrictEqual(asked, ['T', 'C']);
  assert.strictEqual(E.nextQuestion(G, s), null);
  const sum = E.summarize(G, s);
  assert.strictEqual(sum.asked, 2);
  assert.strictEqual(sum.limitReached, true);
  assert.deepStrictEqual(sorted(sum.untested), ['B', 'D', 'E', 'F', 'X']);
  assert.deepStrictEqual(sorted(sum.weak), ['C', 'T']);
  // 根因 C：它的先修 E 还没测到，要标出来
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['C']);
  assert.deepStrictEqual(sum.roots[0].pendingPrereqs, ['E']);
});

test('limit 默认 16，limit=1 只问目标', () => {
  assert.strictEqual(E.DEFAULT_LIMIT, 16);
  assert.strictEqual(E.createSession(G, ['T']).limit, 16);
  const s0 = E.createSession(G, ['T'], { limit: 1 });
  const [, asked] = run(s0, { T: 'wrong' });
  assert.deepStrictEqual(asked, ['T']);
});

test('根因：薄弱且先修中没有薄弱点；路径为拓扑序且不含已掌握', () => {
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sorted(sum.weak), ['C', 'T']);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['C']);
  assert.deepStrictEqual(sum.path.map((p) => p.id), ['C', 'T']);
  assert.strictEqual(sum.path[0].isRoot, true);
  assert.strictEqual(sum.path[1].isTarget, true);
  assert.deepStrictEqual(sorted(sum.mastered), ['B', 'D', 'E', 'F', 'X']);
  assert.strictEqual(sum.finished, true);
  assert.strictEqual(sum.limitReached, false);
});

test('多个根因：路径含根因到目标之间所有未掌握点，拓扑序', () => {
  // T、C、E、D 薄弱；F 掌握 -> E、D 都是根因；B 掌握
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'correct' });
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sorted(sum.roots.map((r) => r.id)), ['D', 'E']);
  assert.deepStrictEqual(sorted(sum.path.map((p) => p.id)), ['C', 'D', 'E', 'T']);
  assertTopological(sum.path.map((p) => p.id), G);
  sum.path.forEach((p) => assert.notStrictEqual(p.status, 'mastered'));
  assert.deepStrictEqual(sum.path.filter((p) => p.isRoot).map((p) => p.id).sort(), ['D', 'E']);
});

test('外部（小学）节点不出题；根因的外部先修单独标出', () => {
  const [s, asked] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'wrong', D: 'wrong', B: 'wrong' });
  assert.ok(!asked.includes('X'));
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['F']);
  assert.deepStrictEqual(sum.roots[0].externalPrereqs, ['X']);
  assert.deepStrictEqual(sum.roots[0].pendingPrereqs, []);
  assert.deepStrictEqual(sum.untested, ['X']);
});

test('多目标：离目标最近的先问；答对一个即覆盖其余祖先目标', () => {
  const s0 = E.createSession(G, ['C', 'T', 'D']);
  assert.strictEqual(E.nextQuestion(G, s0), 'T');
  const s1 = E.applyAnswer(G, s0, 'T', 'correct');
  assert.strictEqual(E.nextQuestion(G, s1), null);
  assert.deepStrictEqual(E.summarize(G, s1).path, []);
});

test('多目标：互不相关的目标都会被问到', () => {
  const s0 = E.createSession(G, ['T', 'Z']);
  const [, asked] = run(s0, { T: 'correct', Z: 'correct' });
  assert.deepStrictEqual(sorted(asked), ['T', 'Z']);
});

test('直接作答的判定不会被推断覆盖', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'E', 'wrong');
  s = E.applyAnswer(G, s, 'T', 'correct');
  assert.strictEqual(E.statusOf(s, 'E'), 'weak');
  assert.strictEqual(E.statusOf(s, 'C'), 'mastered');
});

test('applyAnswer 不修改入参；replay 与逐步作答一致', () => {
  const s0 = E.createSession(G, ['T']);
  const snap = JSON.stringify(s0);
  const s1 = E.applyAnswer(G, s0, 'T', 'wrong');
  assert.strictEqual(JSON.stringify(s0), snap);
  const s2 = E.applyAnswer(G, s1, 'C', 'correct');
  const r = E.replay(G, ['T'], [{ id: 'T', result: 'wrong' }, { id: 'C', result: 'correct' }]);
  assert.deepStrictEqual(r, s2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s2)), s2); // 可序列化
  assert.throws(() => E.applyAnswer(G, s0, 'T', 'maybe'));
  assert.throws(() => E.createSession(G, ['nope']));
});

test('路径图布局：先修在上层，边不跨回', () => {
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'correct' });
  const sum = E.summarize(G, s);
  const lay = E.layout(G, s, sum);
  const layer = Object.fromEntries(lay.nodes.map((n) => [n.id, n.layer]));
  lay.edges.forEach((e) => assert.ok(layer[e.from] < layer[e.to], e.from + '->' + e.to));
  assert.ok(lay.nodes.some((n) => n.id === 'T' && n.isTarget));
  assert.ok(lay.nodes.some((n) => n.id === 'E' && n.isRoot));
});


/* ------------------------------------------------------------ 两题判定（手造题库） */
console.log('两题判定');

const DIFFS = { b: 'basic', s: 'standard', a: 'advanced' };
function mq(topicId, n, diff, extra) {
  return Object.assign({
    id: topicId + '_q' + n, topicId: topicId, difficulty: DIFFS[diff] || diff, type: 'numeric',
    prompt: topicId + ' 第 ' + n + ' 题', answer: '1', explanation: '解析'
  }, extra || {});
}
// T 的先修：P1(hard) <- R，P2(hard)；每个知识点 4 题：q1 标准、q2 标准、q3 基础、q4 提高
const bankTopics = ['R', 'P1', 'P2', 'T'].map((id) => mk(id, { diagnostic_question: undefined }));
const bankDeps = [
  { topicId: 'P1', prerequisiteId: 'R', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'P1', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'P2', strength: 'hard' }
];
const bankQs = [];
['R', 'P1', 'P2', 'T'].forEach((id) => {
  bankQs.push(mq(id, 1, 's'), mq(id, 2, 's'), mq(id, 3, 'b'), mq(id, 4, 'a'));
});
const G2 = E.buildGraph(bankTopics, bankDeps, bankQs);

/** 按脚本作答：script[id] = [第一题结果, 第二题结果]；返回 [会话, 出过的 (知识点#第几题) 序列]。 */
function run2(session, script) {
  const seq = [];
  let s = session;
  for (let guard = 0; guard < 100; guard++) {
    const it = E.nextItem(G2, s);
    if (!it) break;
    seq.push(it.topicId + '#' + it.attempt);
    const r = script[it.topicId][it.attempt - 1];
    assert.ok(r, '脚本缺少 ' + it.topicId + ' 第 ' + it.attempt + ' 题');
    s = E.applyAnswer(G2, s, it.topicId, r);
  }
  return [s, seq];
}

test('题库：isTestable 看题库；有题库时 hasBank 为 true，回退模式为 false', () => {
  assert.strictEqual(G2.hasBank, true);
  assert.strictEqual(G.hasBank, false);
  assert.strictEqual(G2.bank.T.length, 4);
  assert.strictEqual(G.bank.T[0].type, 'legacy');
});

test('第一题答对 → 掌握，并推断祖先掌握；只问 1 题', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), { T: ['correct'] });
  assert.deepStrictEqual(seq, ['T#1']);
  ['T', 'P1', 'P2', 'R'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'mastered', id));
  assert.strictEqual(s.status.T.src, 'direct');
  assert.strictEqual(s.status.R.src, 'inferred');
});

test('第一题错 → 再出第二题（同一知识点），此时还没有结论、不回溯', () => {
  let s = E.createSession(G2, ['T']);
  s = E.applyAnswer(G2, s, 'T', 'wrong');
  assert.strictEqual(E.nextQuestion(G2, s), 'T');
  const it = E.nextItem(G2, s);
  assert.strictEqual(it.attempt, 2);
  assert.notStrictEqual(it.question.id, s.answers[0].qid);
  assert.strictEqual(s.status.T, undefined);
  assert.strictEqual(E.isUnconfirmed(s, 'T'), true);
});

test('错 + 错 → 薄弱，并向先修回溯（P1、P2 依次，再深入 R）', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), {
    T: ['wrong', 'skip'], P1: ['wrong', 'wrong'], R: ['correct'], P2: ['correct']
  });
  assert.deepStrictEqual(seq, ['T#1', 'T#2', 'P1#1', 'P1#2', 'R#1', 'P2#1']);
  assert.strictEqual(E.statusOf(s, 'T'), 'weak');
  assert.strictEqual(E.statusOf(s, 'P1'), 'weak');
  assert.strictEqual(E.statusOf(s, 'R'), 'mastered');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['P1']);
  assert.deepStrictEqual(sum.shaky, []);
});

test('错 + 对 → 不稳（shaky），且不向先修回溯', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), { T: ['wrong', 'correct'] });
  assert.deepStrictEqual(seq, ['T#1', 'T#2']);
  assert.strictEqual(E.statusOf(s, 'T'), 'shaky');
  assert.strictEqual(E.nextQuestion(G2, s), null);
  ['P1', 'P2', 'R'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'unknown', id));
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.shaky, ['T']);
  assert.deepStrictEqual(sum.weak, []);
  assert.deepStrictEqual(sum.roots, []);
  assert.deepStrictEqual(sorted(sum.untested), ['P1', 'P2', 'R']);
  // 不稳的点要进学习路径
  assert.deepStrictEqual(sum.path.map((p) => [p.id, p.status]), [['T', 'shaky']]);
});

test('不稳的先修若同时被别处判为薄弱，路径含它及其后代', () => {
  const [s] = run2(E.createSession(G2, ['T']), {
    T: ['wrong', 'wrong'], P1: ['wrong', 'correct'], P2: ['wrong', 'wrong'], R: ['correct']
  });
  assert.strictEqual(E.statusOf(s, 'P1'), 'shaky');
  assert.strictEqual(E.statusOf(s, 'P2'), 'weak');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['P2']);
  assert.deepStrictEqual(sorted(sum.path.map((p) => p.id)), ['P1', 'P2', 'T']);
  assert.strictEqual(sum.path.find((p) => p.id === 'P1').status, 'shaky');
  assertTopological(sum.path.map((p) => p.id), G2);
});

test('第二题优先 basic；第一题已是 basic 时取同难度，没有就取最容易的剩余题', () => {
  const firstDiffs = new Set();
  for (let i = 0; i < 60; i++) {
    const s1 = E.applyAnswer(G2, E.createSession(G2, ['P2'], { seed: 'k' + i }), 'P2', 'wrong');
    const first = E.questionById(G2, s1.answers[0].qid);
    firstDiffs.add(first.difficulty);
    assert.notStrictEqual(first.difficulty, 'advanced', '有非 advanced 题时第一题不出 advanced');
    const second = E.nextItem(G2, s1).question;
    if (first.difficulty === 'standard') assert.strictEqual(second.id, 'P2_q3', '第二题应是唯一的 basic');
    else assert.strictEqual(second.difficulty, 'standard', '第一题是 basic 时没有别的 basic，取同级以上最容易的');
  }
  assert.ok(firstDiffs.has('standard') && firstDiffs.has('basic'), '随机应能抽到不同难度');
  // 没有 basic 时取同难度：标准×3 + 提高×1
  const topics3 = [mk('M', { diagnostic_question: undefined })];
  const qs3 = [mq('M', 1, 's'), mq('M', 2, 's'), mq('M', 3, 's'), mq('M', 4, 'a')];
  const G3 = E.buildGraph(topics3, [], qs3);
  for (let i = 0; i < 20; i++) {
    const s1 = E.applyAnswer(G3, E.createSession(G3, ['M'], { seed: i }), 'M', 'wrong');
    assert.strictEqual(E.nextItem(G3, s1).question.difficulty, 'standard');
  }
  // 第一题是 standard 且存在更容易的非 basic 题不可能（只有 3 档）；提高题只在没有其它选择时才出
  const qs4 = [mq('M', 1, 'a'), mq('M', 2, 'a')];
  const G4 = E.buildGraph(topics3, [], qs4);
  const s4 = E.applyAnswer(G4, E.createSession(G4, ['M'], { seed: 1 }), 'M', 'wrong');
  assert.strictEqual(E.nextItem(G4, s4).question.difficulty, 'advanced');
});

test('种子固定时选题确定；不同种子能得到不同选题', () => {
  const trace = (seed) => {
    const [s] = run2(E.createSession(G2, ['T'], { seed: seed }), {
      T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], R: ['wrong', 'wrong'], P2: ['wrong', 'wrong']
    });
    return s.answers.map((a) => a.qid).join(',');
  };
  assert.strictEqual(trace('abc'), trace('abc'));
  assert.strictEqual(trace(42), trace('42'));
  const variants = new Set();
  for (let i = 0; i < 40; i++) variants.add(trace('s' + i));
  assert.ok(variants.size > 5, '不同种子应产生不同的题目序列（得到 ' + variants.size + ' 种）');
  // 重放与逐步作答一致，题号也一致
  const [s2] = run2(E.createSession(G2, ['T'], { seed: 9 }), { T: ['wrong', 'correct'] });
  const r = E.replay(G2, ['T'], s2.answers, { seed: 9 });
  assert.deepStrictEqual(r, s2);
});

test('已出题避让：优先出没出过的题，全出过也不会卡住', () => {
  const avoid = ['T_q1', 'T_q2'];
  for (let i = 0; i < 40; i++) {
    const s0 = E.createSession(G2, ['T'], { seed: i, avoid: avoid });
    const first = E.nextItem(G2, s0).question;
    assert.ok(!avoid.includes(first.id), '第一题应避开出过的题：' + first.id);
  }
  const all = G2.bank.T.map((q) => q.id);
  const s1 = E.createSession(G2, ['T'], { seed: 1, avoid: all });
  const it = E.nextItem(G2, s1);
  assert.ok(it && all.includes(it.question.id));
  // 第二题：basic 优先于“没出过”——q3 是唯一 basic，即使它出过也还是 q3
  let hit = 0;
  for (let i = 0; i < 40; i++) {
    const s0 = E.createSession(G2, ['T'], { seed: i, avoid: ['T_q3'] });
    const a1 = E.nextItem(G2, s0).question;
    if (a1.difficulty !== 'standard') continue;
    const s2 = E.applyAnswer(G2, s0, 'T', 'wrong');
    assert.strictEqual(E.nextItem(G2, s2).question.id, 'T_q3');
    hit++;
  }
  assert.ok(hit > 5);
  // 同一次会话里不会重复出同一道题
  const [s3] = run2(E.createSession(G2, ['T']), { T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], P2: ['wrong', 'wrong'], R: ['wrong', 'wrong'] });
  const qids = s3.answers.map((a) => a.qid);
  assert.strictEqual(new Set(qids).size, qids.length);
});

test('题量上限按“题”计：2 题一个知识点；只答错第一题就到上限 → 暂按薄弱，标为未复测', () => {
  const [s, seq] = run2(E.createSession(G2, ['T'], { limit: 3 }), {
    T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], R: ['wrong', 'wrong'], P2: ['wrong', 'wrong']
  });
  assert.deepStrictEqual(seq, ['T#1', 'T#2', 'P1#1']);
  assert.strictEqual(s.answers.length, 3);
  assert.strictEqual(E.nextQuestion(G2, s), null);
  assert.strictEqual(E.statusOf(s, 'P1'), 'weak');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.unconfirmed, ['P1']);
  assert.strictEqual(sum.limitReached, true);
  assert.deepStrictEqual(sorted(sum.untested), ['P2', 'R']);
});

test('同一知识点只有一道题时：答错直接薄弱（无第二题）', () => {
  const G5 = E.buildGraph(bankTopics, bankDeps, [mq('T', 1, 's'), mq('P1', 1, 's'), mq('P2', 1, 's'), mq('R', 1, 's')]);
  let s = E.applyAnswer(G5, E.createSession(G5, ['T']), 'T', 'wrong');
  assert.strictEqual(E.statusOf(s, 'T'), 'weak');
  assert.strictEqual(E.nextQuestion(G5, s), 'P1');
});

test('applyAnswer 不修改入参（含 attempts）；答题记录带 qid 与用户答案', () => {
  const s0 = E.createSession(G2, ['T'], { seed: 5 });
  const snap = JSON.stringify(s0);
  const s1 = E.applyAnswer(G2, s0, 'T', 'wrong', { text: '42' });
  assert.strictEqual(JSON.stringify(s0), snap);
  assert.strictEqual(s1.answers[0].text, '42');
  assert.ok(/^T_q\d$/.test(s1.answers[0].qid));
  const snap1 = JSON.stringify(s1);
  E.applyAnswer(G2, s1, 'T', 'correct');
  assert.strictEqual(JSON.stringify(s1), snap1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s1)), s1);
});

test('判题（按题型）：choice 比字母，也接受选项文字；numeric 数值等价；short 精确匹配 + accept；self 自评', () => {
  const ch = { type: 'choice', answer: 'B', choices: [{ key: 'A', text: '1/2' }, { key: 'B', text: '-3' }, { key: 'C', text: '相切' }] };
  const j = (q, u) => E.judgeQuestion(q, u).verdict;
  assert.strictEqual(j(ch, 'B'), 'correct');
  assert.strictEqual(j(ch, ' b '), 'correct');
  assert.strictEqual(j(ch, '(B)'), 'correct');
  assert.strictEqual(j(ch, 'B.'), 'correct');
  assert.strictEqual(j(ch, 'A'), 'wrong');
  assert.strictEqual(j(ch, '-3'), 'correct');
  assert.strictEqual(j(ch, '－３'), 'correct');
  assert.strictEqual(j(ch, '1/2'), 'wrong');
  assert.strictEqual(j(ch, '相切'), 'wrong');
  assert.strictEqual(j(ch, 'E'), 'manual');
  assert.strictEqual(j(ch, '随便写'), 'manual');
  assert.strictEqual(j(ch, ''), 'manual');
  const num = { type: 'numeric', answer: '-1/2' };
  assert.strictEqual(j(num, '-0.5'), 'correct');
  assert.strictEqual(j(num, '－１/２'), 'correct');
  assert.strictEqual(j(num, '1/2'), 'wrong');
  const ord = { type: 'numeric', answer: '3，-2' };
  assert.strictEqual(j(ord, '3，-2'), 'correct');
  assert.strictEqual(j(ord, '3, -2'), 'correct');
  assert.strictEqual(j(ord, '-2，3'), 'wrong');       // 有序：顺序错
  assert.strictEqual(j(ord, '3'), 'wrong');
  const unord = { type: 'numeric', answer: '3，-2', unordered: true };
  assert.strictEqual(j(unord, '-2，3'), 'correct');
  assert.strictEqual(j(unord, '-2 和 3'), 'correct');
  assert.strictEqual(j(unord, '-2，4'), 'wrong');
  const sh = { type: 'short', answer: 'y=2x+1', accept: ['2x+1', 'f(x)=2x+1'] };
  assert.strictEqual(j(sh, 'y = 2x + 1'), 'correct');
  assert.strictEqual(j(sh, 'Y＝2X+1'), 'correct');
  assert.strictEqual(j(sh, 'f(x)=2x+1'), 'correct');
  assert.strictEqual(j(sh, 'y=1+2x'), 'manual');       // 等价写法无法可靠判断，交给自评
  const quad = { type: 'short', answer: '第三象限' };
  assert.strictEqual(j(quad, '第三象限'), 'correct');
  assert.strictEqual(j(quad, '第二象限'), 'manual');
  assert.strictEqual(j({ type: 'self', answer: '略' }, '略'), 'manual');
  assert.strictEqual(j({ type: 'legacy', answer: '3' }, '3.0'), 'correct');
});

test('PRNG：mulberry32 相同种子相同序列，输出在 [0,1)', () => {
  const a = E.mulberry32(123), b = E.mulberry32(123);
  for (let i = 0; i < 100; i++) { const x = a(); assert.strictEqual(x, b()); assert.ok(x >= 0 && x < 1); }
});

/* ------------------------------------------------------------ 答案规范化与判题 */
console.log('答案规范化与判题');

function verdict(user, ref) { return E.judgeAnswer(user, ref).verdict; }

test('规范化：全角转半角、去空格、中文标点、度', () => {
  assert.strictEqual(E.normalizeText('　１／２ '), '1/2');
  assert.strictEqual(E.normalizeText('90 度'), '90°');
  assert.strictEqual(E.normalizeText('－３，（２）'), '-3,(2)');
  assert.strictEqual(E.normalizeText('x²'), 'x^2');
  assert.strictEqual(E.normalizeText('A、B；C'), 'a,b;c');
  assert.strictEqual(E.normalizeText('答：60°。'), '60°');
});

test('分数与小数等价："１/２" vs "0.5"', () => {
  assert.strictEqual(verdict('１/２', '0.5'), 'correct');
  assert.strictEqual(verdict('0.5', '1/2'), 'correct');
  assert.strictEqual(verdict('2/4', '1/2'), 'correct');
  assert.strictEqual(verdict('-1/2', '-0.5'), 'correct');
  assert.strictEqual(verdict('－１／２', '-(1/2)'), 'correct');
  assert.strictEqual(verdict('1/3', '0.333'), 'wrong');
  assert.strictEqual(verdict('1又1/2', '3/2'), 'correct');
  assert.strictEqual(verdict('1 1/2', '1.5'), 'correct');
  assert.strictEqual(verdict('50%', '1/2'), 'correct');
  assert.strictEqual(verdict('3/5', '3/5'), 'correct');
  assert.strictEqual(verdict('3/5', '5/3'), 'wrong');
});

test('角度："90 度" vs "90°"', () => {
  assert.strictEqual(verdict('90 度', '90°'), 'correct');
  assert.strictEqual(verdict('90', '90°'), 'correct');
  assert.strictEqual(verdict('６０°', '60度'), 'correct');
  assert.strictEqual(verdict('50°', '60°'), 'wrong');
});

test('多个答案顺序无关："-3 和 -1/2" vs "-1/2，-3"', () => {
  assert.strictEqual(verdict('-3 和 -1/2', '-1/2，-3'), 'correct');
  assert.strictEqual(verdict('-1/2、-3', '-3 和 -1/2'), 'correct');
  assert.strictEqual(verdict('-3', '-3 和 -1/2'), 'wrong');
  assert.strictEqual(verdict('-3，-1/2，0', '-3 和 -1/2'), 'wrong');
  assert.strictEqual(verdict('x=3 或 x=2', 'x=2 或 x=3'), 'correct');
  assert.strictEqual(verdict('2,3', 'x=2 或 x=3'), 'correct');
  assert.strictEqual(verdict('3；3', '3；3'), 'correct');
});

test('带变量名的答案：x=… 可省略变量名，但 x、y 不能互换', () => {
  assert.strictEqual(verdict('3', 'x=3'), 'correct');
  assert.strictEqual(verdict('x=3', '3'), 'correct');
  assert.strictEqual(verdict('y=2，x=3', 'x=3，y=2'), 'correct');
  assert.strictEqual(verdict('3，2', 'x=3，y=2'), 'correct');
  assert.strictEqual(verdict('x=2，y=3', 'x=3，y=2'), 'wrong');
  assert.strictEqual(verdict('2，3', 'x=3，y=2'), 'wrong');
});

test('单位：别名等价，缺省单位放行，不同单位判错', () => {
  assert.strictEqual(verdict('12米', '12 m'), 'correct');
  assert.strictEqual(verdict('12', '12 m'), 'correct');
  assert.strictEqual(verdict('12 cm', '12 m'), 'wrong');
  assert.strictEqual(verdict('25 平方米', '25 m²'), 'correct');
  assert.strictEqual(verdict('1,000', '1000'), 'correct');
});

test('显式百分数题接受数值与百分号，普通题和旧无标记快照保留原判法', () => {
  const verdict = (q, value) => E.judgeQuestion(q, value).verdict;
  for (const answer of ['25', '30', '12.5', '0', '100']) {
    const q = { type: 'numeric', answer, percent: true };
    for (const value of [answer, answer + '%', answer + '％', '  ' + answer + ' %  ']) {
      assert.strictEqual(verdict(q, value), 'correct', answer + ': ' + value);
    }
    assert.strictEqual(verdict(q, String(Number(answer) + 1) + '%'), 'wrong');
    if (answer !== '0') assert.strictEqual(verdict(q, String(Number(answer) / 100)), 'wrong');
  }
  const precise = { type: 'numeric', answer: '33.333333333333333333', percent: true };
  assert.strictEqual(verdict(precise, '33.333333333333333333%'), 'correct');
  assert.strictEqual(verdict(precise, '33.333333333333333334%'), 'wrong');
  assert.strictEqual(verdict({ type: 'numeric', answer: '12.5', percent: true }, '12.50％'), 'correct');
  assert.strictEqual(verdict({ type: 'numeric', answer: '0.25' }, '25%'), 'correct');
  assert.strictEqual(verdict({ type: 'numeric', answer: '25' }, '25%'), 'wrong');
  assert.strictEqual(verdict({ type: 'numeric', answer: '25', percent: false }, '25%'), 'wrong');
  assert.strictEqual(verdict({ type: 'numeric', answer: '25', percent: 'true' }, '25%'), 'wrong');
  assert.notStrictEqual(verdict({ type: 'numeric', answer: '25', percent: true }, '25%米'), 'correct');
});

test('坐标等有括号的多值答案', () => {
  assert.strictEqual(verdict('（１，２）', '(1,2)'), 'correct');
  assert.strictEqual(verdict('(1, 2)', '(1,2)'), 'correct');
  assert.strictEqual(verdict('(2,1)', '(1,2)'), 'wrong');
  assert.strictEqual(verdict('(0.5,2)', '(1/2,2)'), 'correct');
});

test('无法可靠解析的答案（文字、代数式）：只在完全相同时判对，否则交给用户自评', () => {
  assert.strictEqual(verdict('相切', '相切'), 'correct');
  assert.strictEqual(verdict('相离', '相切'), 'manual');
  assert.strictEqual(verdict('y=2x+3', 'y=2x+3'), 'correct');
  assert.strictEqual(verdict('2x+3', 'y=2x+3'), 'correct');
  assert.strictEqual(verdict('y=3x+2', 'y=2x+3'), 'manual');
  assert.strictEqual(verdict('(x-2)^2-1', 'y=(x-2)²-1'), 'correct');
  assert.strictEqual(verdict('共 11 种', '共 11 种，每种有 6 个正方形'), 'manual');
  assert.strictEqual(verdict('', '3'), 'manual');
  assert.strictEqual(verdict('不知道', '3'), 'manual');
});

test('判题不抛异常：奇怪输入', () => {
  ['', ' ', '(', ')))', '1/0', '/', '--1', '1/2/3', '％', '😀', null, undefined, '１２３４５６７８９０１２３４５６７８９０/３'].forEach((u) => {
    ['3', '1/2', '相切', 'x=2 或 x=3', '', '(1,2)'].forEach((r) => {
      const v = E.judgeAnswer(u, r).verdict;
      assert.ok(['correct', 'wrong', 'manual'].includes(v));
    });
  });
});

console.log(`引擎纯逻辑：${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
