'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../diagnose/engine.js'),S=require('../assets/model.js');
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'../data/'+n+'.json'),'utf8'));
const data={meta:read('meta'),topics:read('topics'),dependencies:read('dependencies'),questions:read('questions'),books:read('books'),placements:read('placements'),standards:read('cn-curriculum-standards')};
const M=S.create(data);let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
test('所有ID唯一；引用和题目至少两题有效',()=>{
 for(const arr of [data.topics,data.questions,data.books])assert.equal(new Set(arr.map(x=>x.id)).size,arr.length);
 for(const p of data.placements){assert.ok(M.graph.byId[p.topicId]);assert.ok(M.units[p.unitId]);assert.equal(p.bookId,p.unitId.split('-')[0]);assert.equal(p.status,'inferred');}
 for(const d of data.dependencies){assert.ok(M.graph.byId[d.topicId]);assert.ok(M.graph.byId[d.prerequisiteId]);assert.notEqual(d.topicId,d.prerequisiteId);}
 for(const t of data.topics){assert.equal(t.question_count,M.graph.bank[t.id].length);if(t.placement_status==='inferred')assert.ok(t.question_count>=2);else{assert.equal(t.grade,null);assert.equal(t.semester,null);assert.equal(t.question_count,0);assert.ok(!E.isTestable(M.graph,t.id));}}
});
test('没有有向环；映射的必要先修不晚于其后续册次',()=>{
 const sorted=E.topoSort(M.graph,data.topics.map(t=>t.id));assert.equal(sorted.length,data.topics.length);
 for(const d of data.dependencies){const a=M.graph.byId[d.topicId],b=M.graph.byId[d.prerequisiteId];if(a.grade&&b.grade&&d.strength==='hard')assert.ok(E.gradeRank(M.graph,a.id)>=E.gradeRank(M.graph,b.id),`${a.id}<${b.id}`);}
});
test('12册入口，7册PDF目录、1册官网目录、1册参考目录、3册待补；所有年级均可浏览',()=>{
 assert.equal(data.books.length,12);assert.equal(data.books.filter(b=>b.catalog_status==='pdf_checked').length,7);
 assert.equal(data.books.filter(b=>b.catalog_status==='official_checked').length,1);
 assert.equal(M.books['6a'].catalog_status,'official_checked');assert.equal(M.books['6a'].evidence.filename,undefined);
 assert.equal(data.meta.counts.pdf_catalogs,7);assert.equal(data.meta.counts.official_catalogs,1);
 assert.equal(data.books.filter(b=>b.catalog_status==='external_outline').length,1);
 for(let g=1;g<=6;g++)assert.ok(M.topicsFor(g+'a').length);
 for(const bid of ['4b','5b','6b']){assert.equal(M.books[bid].catalog_status,'pending');assert.equal(M.topicsFor(bid).length,0);assert.equal(M.books[bid].units.length,0);}
 assert.ok(M.books['6a'].units.some(u=>u.title.includes('数与运算的再认识')));
 assert.ok(M.books['6a'].units.some(u=>u.title==='七 确定位置'));
 assert.ok(M.books['6a'].units.some(u=>u.title==='六 比例尺'));
});
test('不沿用人教版册次；新旧范围没有混排',()=>{
 assert.equal(M.placements.cnm_p020[0].bookId,'1b');
 assert.equal(M.placements.cnm_p153[0].bookId,'5a');
 assert.equal(M.placements.cnm_p133[0].bookId,'6a');
 assert.equal(M.placements.cnm_p099[0].bookId,'3b');
 assert.equal(M.placements.cnm_p016,undefined); // 11—20的题不冒充11—19。
 assert.equal(M.placements.cnm_p028,undefined); // 100以内的整套概念不冒充20—99。
 for(const t of M.topicsFor('1a'))if(t.id==='sj003'||t.id==='sj004')for(const q of M.graph.bank[t.id])assert.ok(!/20/.test(q.prompt));
 assert.equal(M.topicsFor('4b','', '乘法').length,0);
 assert.equal(M.topicsFor('5a')[0].id,'cnm_p127');
 assert.equal(M.topicsFor('1a').findIndex(t=>t.id==='sj001')<M.topicsFor('1a').findIndex(t=>t.id==='cnm_p008'),true);
});
test('每道题的标准答案可判为正确；选项不重样，引用准确',()=>{
 for(const q of data.questions){assert.ok(M.graph.byId[q.topicId]);assert.ok(q.explanation);assert.equal(E.judgeQuestion(q,q.answer).verdict,'correct',q.id);
  if(q.type==='choice'){assert.equal(new Set(q.choices.map(c=>c.key)).size,q.choices.length);assert.equal(new Set(q.choices.map(c=>c.text)).size,q.choices.length);assert.ok(q.choices.some(c=>c.key===q.answer));}
 }
});
test('每个已映射概念都可完成全对、全错路径；不会问未落册概念',()=>{
 for(const t of data.topics.filter(t=>t.question_count))for(const result of ['correct','wrong']){
  let s=M.start([t.id],{seed:'test',limit:16});let guard=0;
  while(E.nextItem(M.graph,s)){const q=E.nextItem(M.graph,s);assert.ok(M.placements[q.topicId]?.length);s=E.applyAnswer(M.graph,s,q.topicId,result);assert.ok(++guard<=16);}
  const out=M.summary(s),position=new Map(out.path.map((p,i)=>[p.id,i]));
  for(const d of data.dependencies)if(position.has(d.topicId)&&position.has(d.prerequisiteId))assert.ok(position.get(d.prerequisiteId)<position.get(d.topicId));
 }
});
test('两错才回溯、第二题对是不稳，范围检查不越界',()=>{
 const id='cnm_p133';let s=M.start([id],{seed:'test'});
 s=E.applyAnswer(M.graph,s,id,'wrong');assert.equal(E.nextItem(M.graph,s).topicId,id);
 const shaky=E.applyAnswer(M.graph,s,id,'correct');assert.deepEqual(M.summary(shaky).shaky,[id]);assert.equal(E.nextItem(M.graph,shaky),null);
 s=E.applyAnswer(M.graph,s,id,'wrong');assert.notEqual(E.nextItem(M.graph,s)?.topicId,id);
 let screen=M.start([id],{seed:'test',mode:'screen'});screen=E.applyAnswer(M.graph,screen,id,'wrong');screen=E.applyAnswer(M.graph,screen,id,'wrong');assert.equal(E.nextItem(M.graph,screen),null);
});
test('存储重放保持题目与答案；拒绝错版、损坏及篡改记录',()=>{
 let s=M.start(['cnm_p133'],{seed:'restore',limit:16});
 for(let i=0;i<5&&E.nextItem(M.graph,s);i++)s=E.applyAnswer(M.graph,s,E.nextItem(M.graph,s).topicId,'wrong',{text:'0'});
 const raw=M.snapshot(s),restored=M.restore(JSON.stringify(raw));assert.deepEqual(restored.answers,s.answers);assert.deepEqual(E.nextItem(M.graph,restored),E.nextItem(M.graph,s));
 assert.equal(M.restore({...raw,dataVersion:'old'}),null);assert.equal(M.restore('{bad json'),null);
 const bad=JSON.parse(JSON.stringify(raw));bad.answers[0].qid='fake_q1';assert.equal(M.restore(bad),null);
 assert.equal(M.restore({...raw,options:{...raw.options,limit:9999}}),null);
});
test('结果区分直接作答与推断掌握，第一题错提前结束保留待确认',()=>{
 let s=M.start(['cnm_p133'],{seed:'test'});s=E.applyAnswer(M.graph,s,'cnm_p133','correct');const out=M.summary(s);
 assert.deepEqual(out.directMastered,['cnm_p133']);assert.ok(out.inferredMastered.length>0);
 s=M.start(['cnm_p133'],{seed:'test',limit:1});s=E.applyAnswer(M.graph,s,'cnm_p133','wrong');assert.deepEqual(M.summary(s).unconfirmed,['cnm_p133']);
});
console.log(`${passed}组苏州适配检查通过；${data.topics.filter(t=>t.question_count).length}个目标的全对/全错流程通过。`);
