/* 实际前端事件与云端状态：仅使用合成家庭，不连接正式账号或学习库。 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Cloud=require('../assets/cloud.js'),Model=require('../assets/model.js'),E=require('../diagnose/engine.js');
const copy=x=>JSON.parse(JSON.stringify(x)),data={};
for(const n of ['meta','topics','dependencies','questions','books','placements','cn-curriculum-standards','practice_templates'])data[n==='cn-curriculum-standards'?'standards':n]=JSON.parse(fs.readFileSync('data/'+n+'.json'));
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('✓ '+name);}
async function fixture({adaptive=true,role='OWNER',profileTopics=['cnm_p029'],resources=[]}={}){
 const figures=[],calls=[],sessions=new Map(resources.map(r=>[r.id,copy(r)])),nodes=new Map(),all=new Set(),events={},downloads=[],blobs=[];let profileGate=null,profileStatus=200,failWrites=false,uuid=0,onResume;
 function matches(el,selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('#'))return el.id===part.slice(1);const m=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&el.attrs[m[1]]!==undefined&&(m[2]===undefined||el.attrs[m[1]]===m[2]);});}
 class Element{
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.id=attrs.id||'';this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=v;this.handlers={};this.descendants=[];this.disabled=attrs.disabled!==undefined;this.value=attrs.value||'';this.textContent='';this.classList={toggle(){}};if(this.id)nodes.set(this.id,this);all.add(this);}
  set innerHTML(html){for(const el of this.descendants){if(nodes.get(el.id)===el)nodes.delete(el.id);all.delete(el);}this.descendants=[];this.html=html;for(const m of html.matchAll(/<([a-z][\w-]*)(\s[^>]*|)>/gi)){const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';const el=new Element(m[1],attrs);this.descendants.push(el);}}
  get innerHTML(){return this.html||'';}
  addEventListener(type,fn){this.handlers[type]=fn;}
  querySelectorAll(sel){return [...all].filter(el=>el!==this&&matches(el,sel));}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  closest(sel){return matches(this,sel)?this:null;}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  click(){downloads.push(this);}
  append(){}
 }
 const root=new Element('main',{id:'content'});new Element('div',{id:'toast'});new Element('section',{id:'family-context'});
 const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>copy(body)});
 async function fetcher(path,opts={}){
  const method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;calls.push({path,method,body});
  if(path.startsWith('data/')){const n=path.slice(5,-5);return response(200,data[n==='cn-curriculum-standards'?'standards':n]);}
  if(path.endsWith('/capabilities'))return response(200,{cloud:true,...(adaptive?{adaptivePractice:true}:{})});
  if(path.endsWith('/me'))return response(200,{id:'adult-a',name:'合成人员'});
  if(path.endsWith('/csrf'))return response(200,{token:'synthetic-csrf',headerName:'X-CSRF-TOKEN'});
  if(path.endsWith('/families'))return response(200,[{id:'family-a',name:'合成家庭',role}]);
  if(path.endsWith('/children'))return response(200,[{id:'child-a',nickname:'样例甲',archived:false},{id:'child-b',nickname:'样例乙',archived:false}]);
  if(path.endsWith('/practice-profile')){if(profileGate)await profileGate;return response(profileStatus,profileStatus===200?{schema:1,dataVersion:data.meta.data_version,asOf:'2026-01-01T00:00:00Z',topicIds:profileTopics,families:{},reviewQuestions:[]}:{detail:'合成画像读取失败'});}
  if(path.endsWith('/sessions')&&method==='POST'){if(failWrites)throw Error('synthetic offline');if(!sessions.has(body.id))sessions.set(body.id,{...copy(body),version:0});return response(200,sessions.get(body.id));}
  if(path.includes('/sessions/')&&method==='PUT'){if(failWrites)throw Error('synthetic offline');const old=sessions.get(path.split('/').at(-1));if(!old||old.version!==body.version)return response(409,{});const next={...old,...copy(body),version:old.version+1};sessions.set(old.id,next);return response(200,next);}
  throw Error('Unexpected '+method+' '+path);
 }
 const cloud=Cloud.create({fetcher,uuid:()=>`synthetic-${++uuid}`});
 const location={hash:'#practice',href:'https://example.test/edu/math/',hostname:'example.test'};let hash=location.hash;
 Object.defineProperty(location,'hash',{get:()=>hash,set(value){hash=value;events.hashchange?.();}});
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:sel=>[...all].filter(el=>matches(el,sel)),querySelector:sel=>[...all].find(el=>matches(el,sel))||null,createElement:tag=>new Element(tag)};
 const MathQuestionFigures={mount:(container,figure)=>{if(container)figures.push(copy(figure));return !!container;}};
 const window={MathQuestionFigures,DiagEngine:E,addEventListener:(type,fn)=>events[type]=fn,scrollTo(){},print(){}};
 const ui={create(c,opts){onResume=opts.onResume;c.subscribe(kind=>{if(['context','ready','auth'].includes(kind))opts.onRoute();});return {renderRoute:()=>false,renderBar(){}};}};
 class TestURL extends URL{}
 TestURL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-export';};TestURL.revokeObjectURL=()=>{};
 const globals={MathQuestionFigures,window,document,location,LearningCloud:{create:()=>cloud},LearningCloudUI:ui,SuzhouMath:Model,fetch:fetcher,URL:TestURL,URLSearchParams,Blob,FormData:class{constructor(el){this.el=el;}get(name){return this.el.values?.[name];}},setTimeout:()=>0,clearTimeout(){},console,history:{replaceState(_,__,hashValue){hash=hashValue;}}};
 await vm.runInNewContext(fs.readFileSync('assets/app.js','utf8'),globals);await tick();
 async function click(selector){const el=document.querySelector(selector);assert.ok(el,'missing '+selector+' in '+root.innerHTML.slice(0,120));if(el.disabled)return;const ev={target:el,preventDefault(){}};if(el.onclick)await el.onclick(ev);else if(el.handlers.click)await el.handlers.click(ev);else root.handlers.click?.(ev);await tick();return el;}
 async function answer(text){const form=nodes.get('answer-form');assert.ok(form);form.values={answer:text};form.onsubmit({target:form,preventDefault(){}});await tick();}
 async function change(selector,value){const el=document.querySelector(selector);el.value=String(value);if(el.onchange)el.onchange({target:el});else el.handlers.change?.({target:el});await tick();}
 return {figures,root,cloud,calls,sessions,nodes,click,answer,change,route:async h=>{location.hash=h;await tick();},resume:(resource,ctx)=>onResume(resource,ctx),gate:promise=>profileGate=promise,status:n=>profileStatus=n,failWrites:value=>failWrites=value,downloads,blobs};
}
(async()=>{
 await test('旧后端隐藏新入口，原诊断仍能作答和保存时间/判分来源',async()=>{
  const f=await fixture({adaptive:false});assert.ok(!f.root.innerHTML.includes('data-review'));await f.click('[data-start]');const resource=[...f.sessions.values()][0];assert.equal(resource.snapshot.schema,1);const M=Model.create(data),s=M.restore(resource.snapshot),q=M.next(s).question;await f.answer(q.answer);const saved=[...f.sessions.values()][0];assert.equal(saved.snapshot.answers[0].gradeSource,'auto');assert.ok(Number.isFinite(Date.parse(saved.snapshot.answers[0].answeredAt)));assert.ok(!f.calls.some(c=>c.path.endsWith('practice-profile')));
 });
 await test('首页分别展示固定题总数与独立变式模板，不把测试样本计为题库',async()=>{
  const f=await fixture();await f.route('#home');assert.match(f.root.innerHTML,/>898<\/strong><small>道固定题/);assert.match(f.root.innerHTML,/70个变式模板/);assert.match(f.root.innerHTML,/覆盖66个知识点/);
 });
 await test('图谱选择题例题保留完整可选说法，不只展示指代题干和图',async()=>{
  const f=await fixture();await f.route('#map?id=cnm_p105');const sample=Model.create(data,data.practice_templates).graph.bank.cnm_p105.find(q=>q.figure);assert.equal(sample.type,'choice');for(const choice of sample.choices)assert.ok(f.nodes.get('topic-detail').innerHTML.includes(choice.text),choice.key);assert.ok(f.figures.length>0);
 });
 await test('固定题扩充后保留v3已开始的两题轮次，继续不混入新题',async()=>{
  const resource=JSON.parse(fs.readFileSync('tests/fixtures/v3-practice.json')),f=await fixture({resources:[resource]});assert.equal(resource.snapshot.plan.length,2);assert.equal(data.questions.filter(q=>q.topicId==='cnm_p003').length,10);await f.resume(resource,f.cloud.context());await tick();assert.match(f.root.innerHTML,/共2题/);await f.answer(resource.snapshot.plan[0].answer);const saved=[...f.sessions.values()][0];assert.equal(saved.snapshot.dataVersion,'2026-10-20-suzhou-v3');assert.deepEqual(saved.snapshot.plan,resource.snapshot.plan);assert.deepEqual(saved.contentSnapshot,resource.contentSnapshot);
 });
 await test('几和第几扩充后新轮完整练习10道不同固定题',async()=>{
  const f=await fixture();await f.route('#map?book=1a&id=cnm_p003');await f.click('[data-practice]');await f.click('#start-adaptive');const resource=[...f.sessions.values()][0];assert.equal(resource.snapshot.plan.length,10);assert.equal(new Set(resource.snapshot.plan.map(q=>q.id)).size,10);assert.ok(resource.snapshot.plan.every(q=>q.topicId==='cnm_p003'));for(const q of resource.snapshot.plan){await f.answer(q.answer);await f.click('#next-question');}const saved=[...f.sessions.values()][0];assert.equal(saved.snapshot.answers.length,10);assert.ok(saved.finished);assert.match(f.root.innerHTML,/本次巩固记录/);
 });
 await test('一键复习默认10题，答对第一题后仍连续出题并冻结完整内容',async()=>{
  const f=await fixture();await f.click('[data-review]');let resource=[...f.sessions.values()][0];assert.equal(resource.snapshot.schema,2);assert.equal(resource.snapshot.limit,10);assert.deepEqual(resource.snapshot.targets,['cnm_p029']);assert.deepEqual(resource.contentSnapshot.questions,resource.snapshot.plan);const q=resource.snapshot.plan[0];await f.answer(q.answer);resource=[...f.sessions.values()][0];assert.equal(resource.snapshot.answers.length,1);assert.equal(resource.snapshot.answers[0].result,'correct');assert.equal(resource.finished,false);await f.click('#next-question');assert.ok(f.nodes.get('answer-form'));assert.match(f.root.innerHTML,/第2题/);
 });
 await test('5和20题可选，巩固入口从知识点及当前单元范围启动',async()=>{
  const f=await fixture();await f.change('#practice-count',5);await f.click('[data-review]');assert.equal([...f.sessions.values()][0].snapshot.limit,5);
  await f.route('#map?book=1b&id=cnm_p029');await f.click('[data-practice]');assert.match(f.root.innerHTML,/支持随机变式/);await f.change('#practice-count',20);await f.click('#start-adaptive');const next=[...f.sessions.values()].at(-1);assert.equal(next.snapshot.limit,20);assert.deepEqual(next.snapshot.targets,['cnm_p029']);
  await f.route('#map?book=1b');const unit=data.books.find(b=>b.id==='1b').units.find(u=>u.topic_ids.includes('cnm_p029'));await f.change('#unit-filter',unit.id);await f.click('#scope-practice');await f.click('#start-adaptive');assert.deepEqual(new Set([...f.sessions.values()].at(-1).snapshot.targets),new Set(unit.topic_ids));
 });
 await test('画像读取失败不创建空历史练习，清楚提示并可重试',async()=>{
  const f=await fixture();f.status(503);await f.click('[data-review]');assert.equal(f.sessions.size,0);assert.match(f.root.innerHTML,/合成画像读取失败/);assert.ok(f.nodes.has('retry-practice-start'));f.status(200);await f.click('#retry-practice-start');assert.equal(f.sessions.size,1);
 });
 await test('尚无直接历史提示先选知识点，不能混入其他孩子历史',async()=>{
  const f=await fixture({profileTopics:[]});await f.click('[data-review]');assert.equal(f.sessions.size,0);assert.match(f.root.innerHTML,/还没有直接尝试过/);assert.match(f.root.innerHTML,/选择知识点/);
 });
 await test('画像等待中切换孩子再切回也取消启动，连续点击只发一次画像请求',async()=>{
  const f=await fixture();let release;f.gate(new Promise(resolve=>release=resolve));await f.click('[data-review]');await f.click('[data-review]');assert.equal(f.calls.filter(c=>c.path.endsWith('/practice-profile')).length,1);f.cloud.selectChild('child-b');f.cloud.selectChild('child-a');release();await tick();assert.equal(f.sessions.size,0);assert.match(f.root.innerHTML,/档案已切换/);
 });
 await test('开始后切换孩子不改本轮归属，写入始终属于开始时孩子',async()=>{
  const f=await fixture();await f.click('[data-review]');f.cloud.selectChild('child-b');await tick();assert.match(f.root.innerHTML,/本轮记录：合成家庭 \/ 样例甲/);const q=[...f.sessions.values()][0].snapshot.plan[0];await f.answer(q.answer);assert.ok(f.calls.filter(c=>['POST','PUT'].includes(c.method)&&c.path.includes('/sessions')).every(c=>c.path.includes('/child-a/')));
 });
 await test('先确认旧轮保存再读取新画像，未保存失败时不新建练习',async()=>{
  const f=await fixture();await f.click('[data-review]');const q=[...f.sessions.values()][0].snapshot.plan[0];f.failWrites(true);await f.answer(q.answer);assert.equal(f.cloud.state.pending,true);await f.route('#map?book=1b&id=cnm_p029');await f.click('[data-practice]');await f.click('#start-adaptive');assert.equal(f.calls.filter(c=>c.path.endsWith('/practice-profile')).length,1);assert.equal(f.sessions.size,1);f.failWrites(false);await f.click('#retry-practice-start');assert.equal(f.sessions.size,2);const profileIndex=f.calls.findLastIndex(c=>c.path.endsWith('/practice-profile')),finishIndex=f.calls.findLastIndex(c=>c.method==='PUT'&&c.body.finished);assert.ok(finishIndex<profileIndex);assert.equal([...f.sessions.values()][0].finished,true);
 });
 await test('固定题库不足提前结束，结果只有直接作答不显示推断掌握',async()=>{
  const M=Model.create(data,data.practice_templates),topic=data.topics.find(t=>M.placements[t.id]?.length&&E.isTestable(M.graph,t.id)&&!M.support(t.id).generated&&M.graph.bank[t.id].length<10);assert.ok(topic);const f=await fixture({profileTopics:[topic.id]});await f.click('[data-review]');const initial=[...f.sessions.values()][0];assert.ok(initial.snapshot.plan.length<10);assert.match(f.root.innerHTML,/少于所选10题/);for(const q of initial.snapshot.plan){await f.answer(q.answer);await f.click('#next-question');}assert.match(f.root.innerHTML,/本次复习记录/);assert.ok(!f.root.innerHTML.includes('第二题通过'));assert.ok(!f.root.innerHTML.includes('建议回看的顺序'));assert.ok(!f.root.innerHTML.includes('推断掌握'));
 });
 await test('跨设备恢复使用完整旧题计划，模板/教材更新不改题序或答案',async()=>{
  const f=await fixture();await f.click('[data-review]');const resource=copy([...f.sessions.values()][0]);resource.snapshot.dataVersion='frozen-old-version';resource.contentSnapshot.dataVersion='frozen-old-version';resource.snapshot.selection.catalogVersion='frozen-old-catalog';resource.contentSnapshot.topics[0].name='当时的知识点名称';resource.version=3;const g=await fixture({resources:[resource]});await g.resume(resource,g.cloud.context());await tick();assert.match(g.root.innerHTML,new RegExp(resource.snapshot.plan[0].prompt.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));await g.answer(resource.snapshot.plan[0].answer);const next=[...g.sessions.values()][0];assert.equal(next.version,4);assert.equal(next.snapshot.dataVersion,'frozen-old-version');assert.deepEqual(next.snapshot.plan,resource.snapshot.plan);assert.deepEqual(next.contentSnapshot,resource.contentSnapshot);assert.equal(next.snapshot.answers[0].result,'correct');
 });
 await test('图形在练习和结果渲染当时快照，旧无图轮次不补最新图',async()=>{
  const M=Model.create(data,data.practice_templates),base=data.questions.find(q=>q.figure),question={...copy(base),familyKey:'fixed:'+base.id};
  const state=M.startPractice([base.topicId],{profile:{schema:1,dataVersion:data.meta.data_version,topicIds:[],families:{},reviewQuestions:[]},limit:5,seed:'figure-ui',now:'2026-01-01T00:00:00Z'});state.plan=[question];
  const content=Cloud.create({fetcher:async()=>{}}).contentSnapshot(M,state),resource={id:'illustrated-session',snapshot:M.snapshot(state),contentSnapshot:content,finished:false,version:0};
  const f=await fixture({resources:[resource]});await f.resume(resource,f.cloud.context());await tick();assert.deepEqual(f.figures.at(-1),question.figure);await f.answer(question.answer);await f.click('#next-question');assert.deepEqual(f.figures.at(-1),question.figure);assert.deepEqual([...f.sessions.values()][0].contentSnapshot,content);
  const old=copy(resource);old.id='old-no-figure';delete old.snapshot.plan[0].figure;delete old.contentSnapshot.questions[0].figure;const g=await fixture({resources:[old]});await g.resume(old,g.cloud.context());await tick();assert.equal(g.figures.length,0);await g.answer(question.answer);assert.ok(![...g.sessions.values()][0].snapshot.plan[0].figure);
 });
 await test('百分数题明确接受带百分号并在参考答案显示单位，普通人数题保持原判分',async()=>{
  const f=await fixture({profileTopics:['cnm_p199']});await f.click('[data-review]');const round=[...f.sessions.values()][0],marked=round.snapshot.plan.filter(q=>q.percent===true);assert.equal(marked.length,2);
  for(const q of round.snapshot.plan){if(q.percent===true)assert.match(f.root.innerHTML,/写下百分数/);await f.answer(q.percent===true?q.answer+'%':q.answer);assert.equal([...f.sessions.values()][0].snapshot.answers.at(-1).result,'correct');if(q.percent===true)assert.ok(f.root.innerHTML.includes(q.answer+'%'));await f.click('#next-question');}
  const saved=[...f.sessions.values()][0];assert.equal(saved.snapshot.plan.filter(q=>q.percent===true).length,2);assert.deepEqual(saved.contentSnapshot.questions,saved.snapshot.plan);
 });
 await test('改正题意后旧选择题仍按冻结题型续办，新题库不改变旧参考答案',async()=>{
  const correction=JSON.parse(fs.readFileSync('config/upstream_correctness.json')).questions.cnm_p112_q1,M=Model.create(data,data.practice_templates),old={...copy(correction.expected),familyKey:'fixed:cnm_p112_q1'};
  const state=M.startPractice([old.topicId],{profile:{schema:1,dataVersion:data.meta.data_version,topicIds:[],families:{},reviewQuestions:[]},limit:5,seed:'old-fixed-round',now:'2026-01-01T00:00:00Z'});state.plan=[old];state.dataVersion='2026-10-22-suzhou-v5';
  const resource={id:'old-choice-round',snapshot:M.snapshot(state),contentSnapshot:Cloud.create({fetcher:async()=>{}}).contentSnapshot(M,state),finished:false,version:0},f=await fixture({resources:[resource]});await f.resume(resource,f.cloud.context());await tick();assert.match(f.root.innerHTML,/先算小括号里面的/);await f.answer('A');const saved=[...f.sessions.values()][0];assert.equal(saved.snapshot.answers[0].result,'correct');assert.equal(saved.snapshot.plan[0].type,'choice');assert.deepEqual(saved.contentSnapshot,resource.contentSnapshot);assert.equal(data.questions.find(q=>q.id===old.id).answer,'10');
 });
 await test('schema2内容快照键顺序兼容PG JSONB，内容冲突拒绝恢复',async()=>{
  const M=Model.create(data,data.practice_templates),profile={schema:1,dataVersion:data.meta.data_version,topicIds:[],families:{},reviewQuestions:[]},s=M.startPractice(['cnm_p029'],{profile,limit:5,seed:'synthetic',now:'2026-01-01T00:00:00Z'}),cloud=Cloud.create({fetcher:async()=>{}}),content=cloud.contentSnapshot(M,s),snap=M.snapshot(s);const reordered=JSON.parse(JSON.stringify(content),(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v);assert.ok(M.restore(snap,reordered));reordered.questions[0].answer='changed';assert.equal(M.restore(snap,reordered),null);
 });
 await test('人工对照只在明确确认后记一次，保留manual判题来源',async()=>{
  const f=await fixture();await f.click('[data-review]');await f.answer('未能自动识别的写法');assert.equal([...f.sessions.values()][0].snapshot.answers.length,0);assert.match(f.root.innerHTML,/请对照参考答案/);await f.click('[data-manual="correct"]');const answer=[...f.sessions.values()][0].snapshot.answers[0];assert.equal(answer.gradeSource,'manual');assert.equal(answer.result,'correct');assert.equal(answer.text,'未能自动识别的写法');
 });
 await test('导出包含完整随机题计划与当时内容，不能仅导出题目ID',async()=>{
  const f=await fixture();await f.click('[data-review]');const original=[...f.sessions.values()][0];await f.click('#export-session');const exported=JSON.parse(await f.blobs[0].text());assert.equal(exported.schema,2);assert.deepEqual(exported.plan,original.snapshot.plan);assert.deepEqual(exported.contentSnapshot,original.contentSnapshot);assert.ok(exported.plan.every(q=>q.prompt&&q.answer!==undefined&&q.explanation&&q.familyKey));
 });
 await test('只读成员不启动新画像/练习',async()=>{const f=await fixture({role:'VIEWER'});assert.ok(!f.root.innerHTML.includes('data-review'));assert.equal(f.sessions.size,0);assert.ok(!f.calls.some(c=>c.path.endsWith('/practice-profile')));});
 console.log(`${passed}组随机练习界面与恢复检查通过。`);
})().catch(error=>{console.error(error);process.exitCode=1;});
