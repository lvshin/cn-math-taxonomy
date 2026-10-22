/* 合成家庭与亲子活动：不连接真实账号、孩子或学习数据库。 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Cloud=require('../assets/cloud.js'),P=require('../kindergarten/assets/module.js'),copy=x=>JSON.parse(JSON.stringify(x));
const card={id:'play-a',version:'v1',module:'PRESCHOOL',title:'合成小商店',themeId:'cooperate',domain:'表达与合作',summary:'一起分配角色，轮流试一试。',materials:['纸和笔'],steps:['一起决定角色','轮流提出自己的需要'],parentPrompts:['你想先试哪一种？'],observe:['怎样商量角色'],easier:'先扮演一个角色。',variation:'交换角色。',safety:'成人陪伴，使用适龄材料。',duration:'10至20分钟',setting:'室内',sourceGame:{name:'Synthetic game',url:'https://example.test/game'},episodes:[],adaptation:'家庭活动改编'};
const catalog={schema:1,version:'v1',themes:[{id:'cooperate',name:'表达与合作'}],activities:[card,{...card,id:'play-b',title:'合成搭建游戏'}]};
const record=(overrides={})=>({id:'history-a',kind:'OBSERVATION',module:'PRESCHOOL',activityId:card.id,activityVersion:card.version,activitySnapshot:copy(card),outcome:'TOGETHER',note:'合成观察甲',occurredAt:'2026-01-02T01:02:03Z',authorId:'adult-a',authorName:'合成人员',...overrides});
const tick=async()=>{for(let i=0;i<7;i++)await new Promise(setImmediate);};
let passed=0;async function test(name,fn){await fn();passed++;console.log('✓ '+name);}
async function fixture({anonymous=false,role='OWNER',archived=false,preschool=true,restore=false,restoreTarget='oauth2/authorization/learning?restore=1&module=preschool',items=[],historyGate=null,writeStatus=200}={}){
 const nodes=new Map(),all=new Set(),calls=[],events={},navigations=[],downloads=[],blobs=[],saved=new Map();let uuid=0,offline=false,writesGate=null,historyStatus=200;
 function matches(el,selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('#'))return el.id===part.slice(1);const m=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&el.attrs[m[1]]!==undefined&&(m[2]===undefined||el.attrs[m[1]]===m[2]);});}
 class Element{
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.id=attrs.id||'';this.dataset={};for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=value;this.handlers={};this.descendants=[];this.disabled=attrs.disabled!==undefined;this.value=attrs.value||'';this.textContent='';this.classList={toggle(){}};if(this.id)nodes.set(this.id,this);all.add(this);}
  set innerHTML(html){const remove=el=>{for(const child of el.descendants)remove(child);if(nodes.get(el.id)===el)nodes.delete(el.id);all.delete(el);};for(const el of this.descendants)remove(el);this.descendants=[];this.html=html;for(const m of html.matchAll(/<([a-z][\w-]*)(\s[^>]*|)>/gi)){const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';const el=new Element(m[1],attrs);this.descendants.push(el);}}
  get innerHTML(){return this.html||'';}
  addEventListener(type,fn){this.handlers[type]=fn;}
  querySelectorAll(selector){return [...all].filter(el=>el!==this&&matches(el,selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(){}click(){downloads.push(this);}submit(){navigations.push(this.action);}
 }
 const root=new Element('main',{id:'content'}),bar=new Element('section',{id:'family-context'}),draftBar=new Element('aside',{id:'draft-status'});new Element('div',{id:'toast'});new Element('a',{'data-nav':'activities'});new Element('a',{'data-nav':'history'});
 const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>copy(body)});
 async function fetcher(path,opts={}){
  const method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;calls.push({path,method,body});
  if(path.endsWith('/data/preschool.json'))return response(200,catalog);
  if(path.endsWith('/capabilities'))return response(200,{cloud:true,preschool,loginUrl:'oauth2/authorization/learning',preschoolLoginUrl:'oauth2/authorization/learning?module=preschool',...(restore?{sessionRestoreUrl:'oauth2/authorization/learning?restore=1',preschoolSessionRestoreUrl:restoreTarget}:{})});
  if(path.endsWith('/me'))return response(anonymous?401:200,{id:'adult-a',name:'合成人员'});
  if(path.endsWith('/csrf'))return response(200,{token:'synthetic-csrf',headerName:'X-CSRF-TOKEN'});
  if(path.endsWith('/families'))return response(200,[{id:'family-a',name:'合成家庭',role}]);
  if(path.endsWith('/children'))return response(200,[{id:'child-a',nickname:'样例甲',archived},{id:'child-b',nickname:'样例乙',archived:false}]);
  if(path.includes('/preschool/history?')){const child=path.includes('/child-b/')?'child-b':'child-a';if(historyGate)await historyGate({path,child});return response(historyStatus,historyStatus===200?{items:typeof items==='function'?items({path,child}):items,nextCursor:null,module:'PRESCHOOL'}:{detail:'合成历史暂时不可用'});}
  if(path.endsWith('/preschool/observations')&&method==='POST'){
   if(writesGate)await writesGate;if(offline)throw Error('synthetic offline');if(writeStatus!==200)return response(writeStatus,{detail:'合成写入被拒绝'});
   if(!saved.has(body.id))saved.set(body.id,{...copy(body),module:'PRESCHOOL',activitySnapshot:copy(card)});return response(200,saved.get(body.id));
  }
  throw Error('Unexpected '+method+' '+path);
 }
 let cloud,hash='#activities';const location={href:'https://example.test/edu/kindergarten/',assign:value=>navigations.push(value)};Object.defineProperty(location,'hash',{get:()=>hash,set(value){hash=value;events.hashchange?.();}});
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>[...all].filter(el=>matches(el,selector)),querySelector:selector=>[...all].find(el=>matches(el,selector))||null,createElement:tag=>new Element(tag),body:new Element('body')};
 class TestURL extends URL{}TestURL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic';};TestURL.revokeObjectURL=()=>{};
 const window={addEventListener:(type,fn)=>events[type]=fn,print(){calls.push({print:true});},confirm:()=>true};
 const globals={window,document,location,PreschoolActivities:P,fetch:fetcher,URL:TestURL,URLSearchParams,Blob,Intl,FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key];}},setTimeout:()=>0,clearTimeout(){},console};
 // 包装器在 VM 词法环境里使用 fetch，不调用宿主网络。
 globals.LearningCloud={create:options=>{cloud=Cloud.create({...options,uuid:()=>`synthetic-${++uuid}`});return cloud;}};
 await vm.runInNewContext(fs.readFileSync('kindergarten/assets/app.js','utf8'),globals);await tick();
 async function click(selector){const el=document.querySelector(selector);assert.ok(el,'missing '+selector+' in '+root.innerHTML.slice(0,100));if(el.disabled)return;await el.handlers.click?.({target:el,preventDefault(){}});await tick();return el;}
 async function change(selector,value){const el=document.querySelector(selector);assert.ok(el,'missing '+selector);el.value=value;await el.handlers.change?.({target:el});await tick();}
 async function input(values){const form=nodes.get('observation-form');assert.ok(form);form.values=values;await form.handlers.input?.({target:form});await tick();}
 async function submit(values){const form=nodes.get('observation-form');assert.ok(form);if(values)form.values=values;await form.handlers.submit?.({target:form,preventDefault(){}});await tick();}
 return {root,bar,draftBar,cloud,calls,saved,nodes,navigations,downloads,blobs,click,change,input,submit,events,route:async value=>{location.hash=value;await tick();},offline:value=>offline=value,gate:value=>writesGate=value,historyStatus:value=>historyStatus=value};
}
(async()=>{
 await test('匿名浏览活动与来源、打印，统一登录链接回幼儿园，不请求孩子历史',async()=>{
  const f=await fixture({anonymous:true});assert.match(f.root.innerHTML,/合成小商店/);assert.match(f.bar.innerHTML,/module=preschool/);await f.route('#activity?id=play-a');assert.match(f.root.innerHTML,/原始游戏|Synthetic game/);assert.match(f.nodes.get('record-panel').innerHTML,/统一账号登录/);assert.ok(!f.nodes.has('begin-record'));await f.click('#print-activity');assert.ok(f.calls.some(call=>call.print));await f.route('#history');assert.ok(!f.calls.some(call=>call.path?.includes('/preschool/history')));
 });
 await test('主题与关键词筛选，活动入口和小学数学分开',async()=>{
  const f=await fixture();await f.change('#activity-search','搭建');assert.match(f.root.innerHTML,/合成搭建游戏/);assert.ok(!f.root.innerHTML.includes('合成小商店'));const html=fs.readFileSync('kindergarten/index.html','utf8');assert.match(html,/href="\/edu\/math\/"/);assert.match(html,/src="\/edu\/math\/assets\/cloud.js"/);assert.match(fs.readFileSync('index.html','utf8'),/href="\/edu\/kindergarten\/"/);
 });
 await test('开始记录后切换孩子，草稿与提交始终归原孩子，不展示原孩子历史',async()=>{
  const f=await fixture();await f.route('#activity?id=play-a');await f.click('#begin-record');await f.input({outcome:'TOGETHER',note:'合成原始观察'});await f.change('#context-child','child-b');assert.match(f.draftBar.innerHTML,/样例甲/);assert.match(f.nodes.get('record-panel').innerHTML,/合成原始观察/);await f.submit({outcome:'TOGETHER',note:'合成原始观察'});const write=f.calls.find(call=>call.method==='POST'&&call.path.includes('observations'));assert.match(write.path,/children\/child-a\/preschool\/observations$/);assert.equal(write.body.note,'合成原始观察');assert.equal(f.saved.size,1);assert.ok(!f.calls.some(call=>call.path?.includes('child-a/preschool/history')));
 });
 await test('断网重试冻结同一ID、版本、时间与载荷，表单不能改成新观察凑重试',async()=>{
  const f=await fixture();await f.route('#activity?id=play-a');await f.click('#begin-record');f.offline(true);await f.submit({outcome:'PROMPTED',note:'合成断网观察'});assert.equal(f.saved.size,0);assert.match(f.draftBar.innerHTML,/尚未确认保存/);assert.match(f.nodes.get('record-panel').innerHTML,/fieldset disabled/);await f.click('#export-draft');const exported=JSON.parse(await f.blobs[0].text());assert.equal(exported.module,'PRESCHOOL');assert.equal(exported.saved,false);assert.equal(exported.ctx.childId,'child-a');assert.equal(exported.activity.title,card.title);f.offline(false);await f.click('#retry-draft');const writes=f.calls.filter(call=>call.method==='POST'&&call.path.includes('observations'));assert.equal(writes.length,2);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(f.saved.size,1);assert.equal(f.draftBar.innerHTML,'');
 });
 await test('并发提交共用一次请求，未保存草稿阻止退出并提示关闭页风险',async()=>{
  const f=await fixture();await f.route('#activity?id=play-a');await f.click('#begin-record');let release;f.gate(new Promise(resolve=>release=resolve));await f.submit({outcome:'PAUSED',note:''});await f.submit();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);await f.click('#logout');assert.deepEqual(f.navigations,[]);let prevented=false;const event={preventDefault(){prevented=true;}};f.events.beforeunload(event);assert.ok(prevented);assert.equal(event.returnValue,'');release();await tick();assert.equal(f.saved.size,1);
 });
 await test('只读成员可看独立历史，不能新增或更正；归档孩子也不可写',async()=>{
  const f=await fixture({role:'VIEWER',items:[record()]});await f.route('#activity?id=play-a');assert.ok(!f.nodes.has('begin-record'));assert.match(f.nodes.get('record-panel').innerHTML,/只读成员/);await f.route('#history');assert.match(f.nodes.get('history-items').innerHTML,/合成观察甲/);assert.ok(!f.nodes.get('history-items').innerHTML.includes('data-correct'));assert.ok(f.calls.filter(call=>call.path?.includes('history')).every(call=>call.path.includes('/preschool/history')));const g=await fixture({archived:true});g.cloud.selectChild('child-a');await g.route('#activity?id=play-a');assert.ok(!g.nodes.has('begin-record'));assert.match(g.nodes.get('record-panel').innerHTML,/已归档/);
 });
 await test('迟到的旧孩子历史响应不会覆盖当前孩子，数学记录被拒绝显示',async()=>{
  let releaseA,first=true;const gate=new Promise(resolve=>releaseA=resolve),f=await fixture({historyGate:async({child})=>{if(child==='child-a'&&first){first=false;await gate;}},items:({child})=>[record({id:child,note:child==='child-a'?'旧孩子甲内容':'当前孩子乙内容'}),record({id:'math-only',module:'MATH',note:'不应出现的数学观察'})]});await f.route('#history');await f.change('#context-child','child-b');assert.match(f.nodes.get('history-items').innerHTML,/当前孩子乙内容/);releaseA();await tick();assert.ok(!f.nodes.get('history-items').innerHTML.includes('旧孩子甲内容'));assert.ok(!f.nodes.get('history-items').innerHTML.includes('不应出现的数学观察'));
 });
 await test('切换孩子再切回也丢弃旧请求；当前档案重复加载可重试失败',async()=>{
  let release,first=true;const gate=new Promise(resolve=>release=resolve),f=await fixture({historyGate:async()=>{if(first){first=false;await gate;}},items:[record()]});await f.route('#history');await f.change('#context-child','child-b');await f.change('#context-child','child-a');const html=f.nodes.get('history-items').innerHTML;release();await tick();assert.equal(f.nodes.get('history-items').innerHTML,html);f.historyStatus(503);await f.route('#history');assert.match(f.nodes.get('history-status').innerHTML,/合成历史暂时不可用/);f.historyStatus(200);await f.click('#retry-history');assert.match(f.nodes.get('history-items').innerHTML,/合成观察甲/);assert.equal(f.nodes.get('history-status').innerHTML,'');
 });
 await test('更正使用历史活动版本与原孩子，不以当前新版卡替代旧快照',async()=>{
  const old=record({activityVersion:'old-v0',activitySnapshot:{...card,version:'old-v0',title:'当时的合成卡'}}),f=await fixture({items:[old]});await f.route('#history');await f.click('[data-correct="history-a"]');assert.match(f.nodes.get('record-panel').innerHTML,/当时的合成卡/);await f.change('#context-child','child-b');await f.submit({outcome:'INDEPENDENT',note:'根据合成记录更正'});const write=f.calls.find(call=>call.method==='POST');assert.equal(write.body.activityVersion,'old-v0');assert.equal(write.body.correctionOf,'history-a');assert.match(write.path,/children\/child-a\/preschool\/observations$/);
 });
 await test('权限撤销或409冲突保留原稿、原载荷和导出，不误报保存成功',async()=>{
  for(const status of [403,409]){const f=await fixture({writeStatus:status});await f.route('#activity?id=play-a');await f.click('#begin-record');await f.submit({outcome:'NOT_TRIED',note:'合成权限验证'});assert.equal(f.saved.size,0);assert.match(f.draftBar.innerHTML,/尚未确认保存/);assert.match(f.draftBar.innerHTML,/合成写入被拒绝/);await f.click('#retry-draft');const writes=f.calls.filter(call=>call.method==='POST');assert.deepEqual(writes[0].body,writes[1].body);assert.ok(f.nodes.has('export-draft'));}
 });
 await test('幼儿园受支持才开放记录，自动恢复只接受后端固定模块地址',async()=>{
  const old=await fixture({preschool:false});await old.route('#activity?id=play-a');assert.ok(!old.nodes.has('begin-record'));const f=await fixture({anonymous:true,restore:true});assert.deepEqual(f.navigations,['/edu/math/oauth2/authorization/learning?restore=1&module=preschool']);assert.ok(!f.navigations.includes('oauth2/authorization/learning?restore=1'));const invalid=await fixture({anonymous:true,restore:true,restoreTarget:'https://example.test/untrusted'});assert.deepEqual(invalid.navigations,[]);
 });
 await test('文本和外链安全：活动观察转义展示，非HTTPS来源不会成为可点击外链',async()=>{
  const f=await fixture({items:[record({note:'<img src=x onerror=alert(1)>',activitySnapshot:{...card,title:'<script>synthetic</script>',sourceGame:{name:'危险协议链接',url:'javascript:alert(1)'}}})]});await f.route('#history');const html=f.nodes.get('history-items').innerHTML;assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/危险协议链接/);
 });
 await test('草稿核心校验选项、固定活动快照、拒绝覆盖待保存内容',async()=>{
  const calls=[],manager=P.createDrafts({request:async(path,options)=>{calls.push({path,options});return {id:options.body.id};},uuid:()=> 'synthetic-id',now:()=> '2026-01-01T00:00:00Z'}),source=copy(card),ctx={familyId:'family-a',childId:'child-a',actorId:'adult-a'};
  manager.begin(source,ctx);source.title='外部已修改';ctx.childId='child-b';assert.equal(manager.get().activity.title,card.title);await assert.rejects(manager.submit(),/请选择/);manager.update({outcome:'TOGETHER',note:' 合成观察 '});await manager.submit();assert.match(calls[0].path,/children\/child-a\/preschool/);assert.equal(calls[0].options.body.note,'合成观察');assert.equal(manager.get(),null);
 });
 console.log(`${passed}组幼儿园活动界面与归属检查通过。`);
})().catch(error=>{console.error(error);process.exitCode=1;});
