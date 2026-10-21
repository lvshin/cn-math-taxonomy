'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const G=require('../assets/question-generators.js'),P=require('../assets/practice.js'),E=require('../diagnose/engine.js');
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'../data/'+n+'.json'),'utf8'));
const data=Object.fromEntries(['meta','topics','questions','placements'].map(n=>[n,read(n)])),catalog=read('practice_templates'),M=P.create(data,catalog);
const NOW=Date.parse('2026-10-21T08:00:00Z'),empty=()=>({schema:1,dataVersion:data.meta.data_version,asOf:new Date(NOW).toISOString(),topicIds:[],families:{},reviewQuestions:[]});
let passed=0,generatedCount=0;
function test(name,fn){fn();passed++;console.log('ok '+name);}
// Independent BigInt fraction arithmetic; expected answers below are read from the question text.
function rat(n,d=1n){n=BigInt(n);d=BigInt(d);if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return [n/(a||1n),d/(a||1n)];}
function number(s){if(s.includes('/')){const [a,b]=s.split('/');return rat(a,b);}const [a,b='']=s.split('.');return rat(BigInt(a+b),10n**BigInt(b.length));}
const add=(x,y)=>rat(x[0]*y[1]+y[0]*x[1],x[1]*y[1]),sub=(x,y)=>rat(x[0]*y[1]-y[0]*x[1],x[1]*y[1]),mul=(x,y)=>rat(x[0]*y[0],x[1]*y[1]),div=(x,y)=>rat(x[0]*y[1],x[1]*y[0]);
function expr(s){
 const tokens=s.replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[×]/g,'*').replace(/[÷]/g,'/').replace(/[−]/g,'-').match(/\d+(?:\.\d+)?|[()+\-*/]/g);let pos=0;
 function atom(){if(tokens[pos]==='('){pos++;const v=sum();assert.equal(tokens[pos++],')');return v;}return number(tokens[pos++]);}
 function product(){let v=atom();while(['*','/'].includes(tokens[pos])){const op=tokens[pos++];v=(op==='*'?mul:div)(v,atom());}return v;}
 function sum(){let v=product();while(['+','-'].includes(tokens[pos])){const op=tokens[pos++];v=(op==='+'?add:sub)(v,product());}return v;}
 const result=sum();assert.equal(pos,tokens.length);return result;
}
function expected(q,t){
 const n=q.prompt.match(/\d+(?:\.\d+)?/g).map(Number),r=number;
 switch(t.kind){
  case 'neighbor':return rat(n[0]+(/后面/.test(q.prompt)?1:-1));
  case 'compare':return rat(Math.max(...n));
  case 'compose':return rat(n[0]*(q.prompt.includes('千')?1000:q.prompt.includes('百')?100:10)+n[1]);
  case 'add':case 'subtract':case 'multiply':case 'divide':case 'mixed':case 'fraction-add':case 'fraction-subtract':case 'fraction-unlike':case 'fraction-mixed':case 'decimal-add':case 'decimal-multiply':case 'decimal-divide':case 'decimal-mixed':return expr(q.prompt.split('=')[0]);
  case 'fraction-reduce':return rat(n[0],n[1]);
  case 'decimal-fraction':return r(String(n[0]));
  case 'unit':{const units={'元:角':10,'米:厘米':100,'厘米:毫米':10,'分米:厘米':10,'千米:米':1000,'平方米:平方分米':100,'时:分':60};const parts=q.prompt.match(/^\d+(.+)等于多少(.+)？/);return rat(n[0]*units[parts[1]+':'+parts[2]]);}
  case 'elapsed':return rat((n[2]*60+n[3])-(n[0]*60+n[1]));
  case 'clock24':return rat(n[0]+12);
  case 'equation':return q.prompt.includes('x+')?rat(n[1]-n[0]):rat(n[1],n[0]);
  case 'rectangle-perimeter':return rat(2*(n[0]+n[1]));
  case 'rectangle-area':case 'parallelogram-area':return rat(n[0]*n[1]);
  case 'triangle-area':return rat(n[0]*n[1],2);
  case 'trapezoid-area':return rat((n[0]+n[1])*n[2],2);
  case 'circle-perimeter':return mul(r('6.28'),rat(n[0]));
  case 'circle-area':return mul(r('3.14'),rat(n[0]*n[0]));
  case 'cylinder-volume':return mul(r('3.14'),rat(n[0]*n[0]*n[1]));
  case 'cone-volume':return mul(r('3.14'),rat(n[0]*n[0]*n[1],3));
  default:throw new Error('缺少独立核算：'+t.kind);
 }
}
test('模板独立版本，全部准确引用已落册知识点；教材与题库版本不变',()=>{
 assert.equal(catalog.schema,1);assert.ok(catalog.version);assert.equal(new Set(catalog.templates.map(t=>t.id)).size,catalog.templates.length);
 const mapped=new Set(data.placements.map(p=>p.topicId));for(const t of catalog.templates){assert.ok(mapped.has(t.topicId),t.topicId);assert.equal(t.version,1);}
 assert.equal(data.meta.data_version,'2026-10-20-suzhou-v3');assert.equal(data.questions.length,458);
 assert.equal(fs.readFileSync(path.join(__dirname,'../config/practice_templates.json'),'utf8'),fs.readFileSync(path.join(__dirname,'../data/practice_templates.json'),'utf8'));
 assert.deepEqual(new Set(catalog.templates.map(t=>data.topics.find(x=>x.id===t.topicId).grade)),new Set([1,2,3,4,5,6]));
});
test('每个模板1000个固定种子，独立按题干BigInt核算答案、精度和参数边界',()=>{
 for(const t of catalog.templates){const unique=new Set();for(let i=0;i<1000;i++){
  const rng=E.mulberry32(i*2654435761>>>0),q=G.generate(t,rng);generatedCount++;unique.add(q.prompt);
  assert.deepEqual(number(q.answer),expected(q,t),t.id+' '+q.prompt);assert.equal(E.judgeQuestion(q,q.answer).verdict,'correct',q.id);
  assert.equal(q.familyKey,'template:'+t.id+'@1');assert.equal(q.topicId,t.topicId);assert.deepEqual(G.render(t,q.params),q);
  for(const v of Object.values(q.params))assert.ok(Number.isSafeInteger(v));assert.ok(q.explanation.includes(q.answer));assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(q)));
  if(['add','subtract'].includes(t.kind)){assert.ok(q.params.a>=0);assert.ok(Number(q.answer)>=0);assert.ok(Number(q.answer)<=t.max);}
  if(t.kind==='divide'){const dividend=q.params.q*q.params.d;assert.equal(dividend%q.params.d,0);assert.ok(dividend>0);if(t.dividendMin)assert.ok(dividend>=t.dividendMin);if(t.dividendMax)assert.ok(dividend<=t.dividendMax);}
  if(t.kind==='elapsed')assert.ok(q.params.start+q.params.duration<24*60);
  if(['rectangle-perimeter','rectangle-area'].includes(t.kind))assert.ok(q.params.a>q.params.b);
 }assert.ok(unique.size>=Math.min(3,1000),t.id+'应有不同变式');}
});
test('按知识点教学含义独立约束口诀、位数、异分母与图形，不以模板配置代替依据',()=>{
 const ids=['cnm_p039','cnm_p046','cnm_p106','cnm_p071','cnm_p072','cnm_p033','cnm_p034','sj014','cnm_p083','cnm_p173','cnm_p174','cnm_p149','cnm_p078','cnm_p089'];
 for(const id of ids){const t=catalog.templates.find(x=>x.topicId===id);assert.ok(t);for(let i=0;i<1000;i++){
  const q=G.generate(t,E.mulberry32(i*1103515245>>>0)),n=q.prompt.match(/\d+(?:\.\d+)?/g).map(Number),a=Number(q.answer);
  switch(id){
   case 'cnm_p039':assert.ok(n[0]>=2&&n[0]<=6);assert.ok(n[1]>=1&&n[1]<=6);break;
   case 'cnm_p046':assert.ok(n[1]>=1&&n[1]<=6);assert.ok(a>=1&&a<=6);assert.equal(n[0],n[1]*a);break;
   case 'cnm_p106':assert.ok(n[1]>=10&&n[1]<=99);assert.ok(n[0]>=10&&n[0]<=999);break;
   case 'cnm_p071':case 'cnm_p072':assert.ok(n[0]>=100&&n[0]<=999);assert.ok(n[1]>=100&&n[1]<=999);assert.ok(a>=0&&a<=999);break;
   case 'cnm_p033':case 'cnm_p034':assert.ok(n[0]>=10&&n[0]<=99);assert.ok(n[1]>=10&&n[1]<=99);assert.ok(a>=0&&a<=99);break;
   case 'sj014':assert.ok(n[0]>=10&&n[0]<=99);assert.ok(n[1]>=1&&n[1]<=9);break;
   case 'cnm_p083':assert.ok(n[0]>=10&&n[0]<=999);assert.ok(n[1]>=1&&n[1]<=9);break;
   case 'cnm_p173':assert.notEqual(n[1],n[3]);assert.ok(n[0]<n[1]&&n[2]<n[3]);break;
   case 'cnm_p174':assert.ok(q.prompt.includes('+')&&q.prompt.includes('−'));assert.ok(number(q.answer)[0]>=0n);break;
   case 'cnm_p149':assert.notEqual(n[0],n[1]);break;
   case 'cnm_p078':case 'cnm_p089':assert.ok(n[0]>n[1]);break;
  }
 }}
});
test('巩固默认10题，5/10/20独立完成；首题答对不结束，不回溯',()=>{
 for(const limit of [5,10,20]){let s=M.start(['cnm_p133'],{limit,seed:'complete'+limit,now:NOW,profile:empty()});assert.equal(s.plan.length,limit);assert.equal(s.answers.length,0);const source=JSON.stringify(s);s=M.apply(s,'correct',{text:s.plan[0].answer,answeredAt:new Date(NOW).toISOString(),gradeSource:'auto'});assert.notEqual(M.next(s),null);assert.equal(JSON.parse(source).answers.length,0);while(M.next(s)){const item=M.next(s);assert.equal(item.topicId,'cnm_p133');s=M.apply(s,'correct');}assert.equal(M.summary(s).correct,limit);assert.equal(M.summary(s).finished,true);}
 assert.equal(M.start(['cnm_p133'],{profile:empty(),now:NOW}).limit,10);assert.throws(()=>M.start(['cnm_p133'],{limit:9,profile:empty()}));
});
test('同种子同画像冻结同计划，不同种子有不同题目，每轮不重复',()=>{
 const opts={seed:'repeat',profile:empty(),now:NOW,limit:20};const a=M.start(['cnm_p145'],opts),b=M.start(['cnm_p145'],opts);assert.deepEqual(a,b);
 const c=M.start(['cnm_p145'],{...opts,seed:'other'});assert.notDeepEqual(a.plan,c.plan);
 for(const s of [a,c]){assert.equal(new Set(s.plan.map(q=>q.id)).size,s.plan.length);assert.equal(new Set(s.plan.map(q=>q.prompt)).size,s.plan.length);}
});
test('未覆盖点仅固定题，候选不足提前结束，review没有历史提示选择知识点',()=>{
 assert.equal(M.support('cnm_p014').generated,false);assert.equal(M.support('cnm_p133').generated,true);
 const s=M.start(['cnm_p014'],{seed:'fixed',limit:20,now:NOW,profile:empty()});assert.equal(s.plan.length,data.questions.filter(q=>q.topicId==='cnm_p014').length);assert.equal(M.summary(s).shortage,true);assert.ok(s.plan.every(q=>q.familyKey.startsWith('fixed:')));
 assert.throws(()=>M.start([],{mode:'review',profile:empty()}),/先选择知识点/);
 const p=empty();p.topicIds=['cnm_p133'];const r=M.start(['cnm_p145'],{mode:'review',profile:p});assert.ok(r.plan.every(q=>q.topicId==='cnm_p133'));
});
test('答对降整个题型族权重，连续答对更低；7天线性恢复，答错/跳过权重3',()=>{
 const h=(result,streak=1,last=NOW)=>({lastResult:result,streak,lastAt:new Date(last).toISOString()});
 assert.equal(P.weight(null,NOW),1);assert.equal(P.weight(h('correct'),NOW),.5);assert.equal(P.weight(h('correct',3),NOW),.25);assert.equal(P.weight(h('correct',20),NOW),.2);
 assert.equal(P.weight(h('correct',1,NOW-3.5*86400000),NOW),.75);assert.equal(P.weight(h('correct',1,NOW-7*86400000),NOW),1);assert.equal(P.weight(h('correct',1,NOW-90*86400000),NOW),1);
 assert.equal(P.weight(h('wrong'),NOW),3);assert.equal(P.weight(h('skip'),NOW),3);assert.equal(P.weight(h('correct',1,NOW+86400000),NOW),.5);
 const p=empty(),key='template:cnm_p133-decimal-multiply@1';p.families[key]={topicId:'cnm_p133',...h('correct',4)};
 const s=M.start(['cnm_p133'],{profile:p,seed:'families',now:NOW});assert.equal(s.selection.weights[key].weight,.2);assert.ok(s.plan.filter(q=>q.familyKey===key).every(q=>s.selection.weights[q.familyKey].weight===.2));
});
test('80/20桶和不足互补：已答对仍出现，全部答对也能复习',()=>{
 const p=empty();p.topicIds=['cnm_p133','cnm_p145'];const key='template:cnm_p133-decimal-multiply@1';p.families[key]={topicId:'cnm_p133',lastResult:'correct',streak:4,lastAt:new Date(NOW).toISOString()};
 for(let i=0;i<50;i++){const s=M.start(p.topicIds,{profile:p,seed:'quota'+i,now:NOW});assert.equal(s.plan.filter(q=>q.familyKey===key).length,2);}
 for(const t of catalog.templates.filter(t=>p.topicIds.includes(t.topicId)))p.families['template:'+t.id+'@1']={topicId:t.topicId,lastResult:'correct',streak:4,lastAt:new Date(NOW).toISOString()};
 for(const q of data.questions.filter(q=>p.topicIds.includes(q.topicId)))p.families['fixed:'+q.id]={topicId:q.topicId,lastResult:'correct',streak:4,lastAt:new Date(NOW).toISOString()};
 const s=M.start([],{mode:'review',profile:p,seed:'all-correct',now:NOW,limit:20});assert.equal(s.plan.length,20);assert.ok(s.plan.every(q=>s.selection.weights[q.familyKey].bucket==='correct'));
});
test('从旧历史返回的原生成题有非零复现机会，同时可抽到同题型新数字',()=>{
 const t=catalog.templates.find(t=>t.topicId==='cnm_p133'),q=G.generate(t,()=>.12),p=empty();p.topicIds=[q.topicId];p.reviewQuestions=[q];p.families[q.familyKey]={topicId:q.topicId,lastResult:'correct',streak:2,lastAt:new Date(NOW).toISOString()};
 let original=0,variant=0;for(let i=0;i<100;i++){const s=M.start([],{mode:'review',profile:p,seed:'history'+i,now:NOW});original+=s.plan.some(x=>x.id===q.id)?1:0;variant+=s.plan.some(x=>x.familyKey===q.familyKey&&x.id!==q.id)?1:0;}
 assert.ok(original>0);assert.ok(variant>0);
});
test('按孩子独立画像，同一seed按各自历史调整；不依赖或修改画像',()=>{
 const a=empty(),b=empty(),key='template:cnm_p133-decimal-multiply@1';a.families[key]={topicId:'cnm_p133',lastResult:'correct',streak:4,lastAt:new Date(NOW).toISOString()};b.families[key]={topicId:'cnm_p133',lastResult:'wrong',streak:0,lastAt:new Date(NOW).toISOString()};const before=JSON.stringify([a,b]);
 const sa=M.start(['cnm_p133'],{profile:a,seed:'children',now:NOW}),sb=M.start(['cnm_p133'],{profile:b,seed:'children',now:NOW});assert.equal(sa.selection.weights[key].weight,.2);assert.equal(sb.selection.weights[key].weight,3);assert.equal(JSON.stringify([a,b]),before);
 assert.throws(()=>M.start(['cnm_p133'],{profile:{...a,dataVersion:'bad'}}),/请重试/);
});
test('schema2冻结顺序、内容、权重和作答；新版教材模板与画像改变不影响恢复',()=>{
 let s=M.start(['cnm_p133'],{profile:empty(),seed:'restore',now:NOW});s=M.apply(s,'wrong',{text:'unknown',answeredAt:new Date(NOW).toISOString(),gradeSource:'manual'});const snap=M.snapshot(s),before=JSON.stringify(snap);
 const changed=P.create({...data,meta:{...data.meta,data_version:'future'},questions:[]},{schema:1,version:'future',templates:[]});const restored=changed.restore(snap);assert.ok(restored);assert.deepEqual(restored.plan,s.plan);assert.deepEqual(restored.selection,s.selection);assert.deepEqual(changed.next(restored),M.next(s));assert.equal(JSON.stringify(snap),before);assert.equal(restored.answers[0].gradeSource,'manual');
 while(M.next(s))s=M.apply(s,'skip');assert.equal(M.next(M.restore(M.snapshot(s))),null);
});
test('损坏/不合法/错序记录拒绝，恢复不接受schema1并由原适配层负责',()=>{
 const raw=M.snapshot(M.start(['cnm_p133'],{profile:empty(),seed:'invalid',now:NOW}));const bad=fn=>{const x=JSON.parse(JSON.stringify(raw));fn(x);assert.equal(M.restore(x),null);};
 bad(x=>x.schema=1);bad(x=>x.plan.push(x.plan[0]));bad(x=>x.plan[0].topicId='unknown');bad(x=>x.plan[0].answer=null);bad(x=>x.limit=1000);bad(x=>x.answers=[{id:x.plan[1].topicId,qid:x.plan[1].id,result:'correct'}]);assert.equal(M.restore('{bad'),null);
});
console.log(`${passed}组规则变式与复习检查通过；${generatedCount}道生成题按题干独立核算通过。`);
