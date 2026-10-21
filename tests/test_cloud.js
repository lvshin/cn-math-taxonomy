/* 真实浏览器界面之外的云端状态/幂等性测试；全部使用合成家庭。 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Cloud=require('../assets/cloud.js');
let passed=0;
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture({staticMode=false,role='OWNER',archived=false,signedIn=true,sessionRestoreUrl,capabilityStatus=200,adaptive=false,profileStatus=200,profileOverride}={}){
 const calls=[],sessions=new Map(),navigations=[];let loseCreate=false,conflict=false,barrier=null;
 const familyOptions=[{id:'family-a',name:'合成家庭甲',role},{id:'family-b',name:'合成家庭乙',role:'EDITOR'}];let families=[familyOptions[0]];
 const children={'family-a':[{id:'child-a',nickname:'样例甲',archived,version:0},{id:'child-aa',nickname:'样例乙',archived:false,version:0}],'family-b':[{id:'child-b',nickname:'样例丙',archived:false,version:0}]};
 const res=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
 async function fetcher(path,options={}){
  const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body,options});
  if(path.endsWith('capabilities'))return res(staticMode?404:capabilityStatus,{cloud:true,loginUrl:'oauth2/authorization/learning',sessionRestoreUrl,...(adaptive?{adaptivePractice:true}:{})});
  if(path.endsWith('/csrf'))return res(200,{token:'synthetic-csrf',headerName:'X-CSRF-TOKEN'});
  if(path.endsWith('/me'))return signedIn?res(200,{id:'user-a',name:'合成成人'}):res(401,{code:'UNAUTHENTICATED'});
  if(path.endsWith('/families'))return res(200,families);
  const match=path.match(/families\/(family-[ab])\/children$/);if(match)return res(200,children[match[1]]);
  if(path.endsWith('/practice-profile'))return res(profileStatus,profileOverride||{schema:1,dataVersion:'synthetic-v1',asOf:'2026-01-01T00:00:00Z',topicIds:['concept-a'],families:{},reviewQuestions:[]});
  if(path.endsWith('/sessions')&&method==='POST'){
   if(!signedIn)return res(401,{code:'UNAUTHENTICATED'});
   if(barrier)await barrier;
   if(!sessions.has(body.id))sessions.set(body.id,{...clone(body),version:0});
   if(loseCreate){loseCreate=false;throw Error('response lost');}return res(200,sessions.get(body.id));
  }
  if(path.includes('/sessions/')&&method==='PUT'){
   if(!signedIn)return res(401,{code:'UNAUTHENTICATED'});
   if(conflict)return res(409,{detail:'合成并发冲突'});
   const id=path.split('/').pop(),old=sessions.get(id);if(body.version!==old.version)return res(409,{});
   const next={...old,...clone(body),version:old.version+1};sessions.set(id,next);return res(200,next);
  }
  throw Error('Unexpected request '+method+' '+path);
 }
 let uuid=0;const cloud=Cloud.create({fetcher,uuid:()=>`session-${++uuid}`,navigate:target=>navigations.push(target)});
 return {cloud,calls,sessions,navigations,setSignedIn:value=>signedIn=value,setLoseCreate:()=>loseCreate=true,setConflict:()=>conflict=true,setBarrier:p=>barrier=p,setFamily:id=>families=id?[familyOptions.find(f=>f.id===id)]:[]};
}
// 只模拟本模块使用的DOM接口，运行实际条件渲染与事件处理；浏览器布局另行验证。
function uiFixture(cloud,{previewFamily='family-b',used=false,historyItems=[]}={}){
 const nodes=new Map(),calls=[],messages=[],submittedForms=[];let routeCount=0;
 class Element{
  constructor(id){this.id=id;this.html='';this.ids=[];this.handlers={};this.children=[];}
  set innerHTML(value){for(const id of this.ids){const node=nodes.get(id);if(node)node.innerHTML='';nodes.delete(id);}this.ids=[];this.html=value;for(const match of value.matchAll(/\bid="([^"]+)"/g)){this.ids.push(match[1]);nodes.set(match[1],new Element(match[1]));}}
  get innerHTML(){return this.html;}
  querySelector(selector){return selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;}
  querySelectorAll(){return [];}
  addEventListener(type,fn){this.handlers[type]=fn;}
  append(...children){this.children.push(...children);}
  submit(){submittedForms.push(this);}
 }
 const root=new Element('root'),bar=new Element('family-context');nodes.set('root',root);nodes.set('family-context',bar);
 const original=cloud.request;cloud.request=async(path,options={})=>{calls.push({path,...options});if(path.endsWith('/history'))return {items:historyItems};if(path==='invitations/preview'){if(used)throw new Cloud.ApiError(409,{code:'INVITATION_USED'});return {familyId:previewFamily,familyName:previewFamily?'受邀合成家庭':null,role:previewFamily?'EDITOR':null,expiresAt:'2099-01-01T00:00:00Z'};}if(path.endsWith('/members')||path.endsWith('/invitations'))return [];return original(path,options);};
 const document={getElementById:id=>nodes.get(id)||null,querySelector:selector=>nodes.get(selector.slice(1))||null,createElement:tag=>Object.assign(new Element(''),{tagName:tag.toUpperCase()}),body:new Element('body')};
 const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync('assets/cloud-ui.js','utf8'),{window,document,LearningCloud:Cloud,URL,URLSearchParams,history:{replaceState(){}},location:{href:'https://example.test/edu/math/'},CSS:{escape:x=>x},FormData,console});
 const ui=window.LearningCloudUI.create(cloud,{root,toast:message=>messages.push(message),onRoute(){routeCount++;},onResume(){}});
 async function route(name,params={}){ui.renderRoute(name,new URLSearchParams(params));await new Promise(setImmediate);return root.innerHTML;}
 return {ui,route,root,bar,nodes,calls,messages,submittedForms,get routeCount(){return routeCount;}};
}
const initial={schema:1,dataVersion:'synthetic-v1',targets:['concept-a'],answers:[],options:{seed:'test',limit:12,mode:'target'}};
async function test(name,fn){await fn();passed++;console.log('✓ '+name);}
(async()=>{
 await test('静态404只浏览，不读取身份、不写第二份本地历史',async()=>{
  const {cloud,calls}=fixture({staticMode:true});await cloud.init();assert.equal(cloud.state.mode,'static');assert.equal(calls.length,1);assert.throws(()=>cloud.context(),/登录/);assert.equal(cloud.state.active,null);
  const source=fs.readFileSync('assets/cloud.js','utf8')+fs.readFileSync('assets/app.js','utf8');assert.ok(!source.includes('localStorage.setItem'));assert.ok(!source.includes('localStorage.removeItem'));assert.ok(!source.includes('Authorization:'));
 });
 await test('首次身份401只按服务端设备标记自动恢复一次，不先加载家庭',async()=>{
  const target='oauth2/authorization/learning?restore=1',f=fixture({signedIn:false,sessionRestoreUrl:target});await f.cloud.init();assert.deepEqual(f.navigations,[target]);assert.match(f.cloud.state.notice,/正在恢复/);assert.ok(!f.calls.some(c=>c.path.endsWith('/families')));await f.cloud.init();assert.deepEqual(f.navigations,[target]);assert.equal(f.cloud.state.mode,'cloud');
 });
 await test('没有设备标记仍显示普通登录，恢复失败清标记后不再跳转',async()=>{
  const f=fixture({signedIn:false});await f.cloud.init();assert.equal(f.navigations.length,0);const view=uiFixture(f.cloud);await view.route('family');assert.match(view.root.innerHTML,/使用统一账号登录/);assert.match(view.root.innerHTML,/记住我/);assert.match(view.root.innerHTML,/30天/);assert.ok(view.root.innerHTML.includes('href="oauth2/authorization/learning"'));await f.cloud.init();assert.equal(f.navigations.length,0);
 });
 await test('自动恢复只接受固定同源授权入口，忽略外部或被改写的目标',async()=>{
  for(const target of ['https://other.example/','//other.example/','javascript:alert(1)','oauth2/authorization/learning?restore=1&next=https://other.example/']){const f=fixture({signedIn:false,sessionRestoreUrl:target});await f.cloud.init();assert.equal(f.navigations.length,0);}
 });
 await test('已有有效会话不重复恢复登录，静态站和服务异常不触发认证',async()=>{
  for(const options of [{},{staticMode:true},{capabilityStatus:503}]){const f=fixture({...options,sessionRestoreUrl:'oauth2/authorization/learning?restore=1'});await f.cloud.init();assert.equal(f.navigations.length,0);if(options.staticMode||options.capabilityStatus)assert.ok(!f.calls.some(c=>c.path.endsWith('/me')));}
 });
 await test('保存时身份失效保留本轮和待保存内容，不自动跳走或重复认证',async()=>{
  const f=fixture({sessionRestoreUrl:'oauth2/authorization/learning?restore=1'});await f.cloud.init();await f.cloud.begin(initial,{});f.setSignedIn(false);const next={...initial,answers:[{qid:'q1',result:'correct'}]};await f.cloud.save(next,{},true);assert.equal(f.cloud.state.pending,true);assert.equal(f.cloud.state.active.id,'session-1');assert.equal(f.cloud.state.me,null);assert.equal(f.navigations.length,0);assert.equal(f.sessions.get('session-1').snapshot.answers.length,0);await f.cloud.init();assert.equal(f.navigations.length,0);f.setSignedIn(true);await f.cloud.init();await f.cloud.flush();assert.equal(f.sessions.get('session-1').snapshot.answers.length,1);assert.equal(f.cloud.state.pending,false);
 });
 await test('单个家庭中切换孩子，刷新保持当前孩子',async()=>{
  const {cloud}=fixture();await cloud.init();assert.equal(cloud.state.families.length,1);assert.equal(cloud.context().childId,'child-a');cloud.selectChild('child-aa');await cloud.refresh();assert.equal(cloud.context().childId,'child-aa');
 });
 await test('无家庭才显示创建表单，所有家庭角色加入后均不再显示',async()=>{
  const empty=fixture();empty.setFamily(null);await empty.cloud.init();const fresh=uiFixture(empty.cloud);await fresh.route('family');assert.ok(fresh.nodes.has('new-family'));assert.match(fresh.root.innerHTML,/一个成人账号只能有一个家庭/);
  for(const role of ['OWNER','EDITOR','VIEWER']){const f=fixture({role});await f.cloud.init();const joined=uiFixture(f.cloud);await joined.route('family');assert.ok(!joined.nodes.has('new-family'));assert.match(joined.root.innerHTML,/我的家庭：合成家庭甲/);assert.match(joined.root.innerHTML,/不能再创建或加入其他家庭/);assert.ok(joined.nodes.has('leave-family'));}
 });
 await test('设置记住我先明确退出范围，并复用带CSRF的退出和待保存保护',async()=>{
  const {cloud}=fixture();await cloud.init();const view=uiFixture(cloud);await view.route('family');assert.match(view.root.innerHTML,/<button id="remember-login" type="button">退出后设置“记住我”/);assert.match(view.root.innerHTML,/这会结束统一账号在其他应用的旧登录/);assert.ok(!view.root.innerHTML.includes('?relogin='));const button=view.nodes.get('remember-login');assert.ok(button);cloud.state.pending=true;await button.handlers.click();assert.equal(view.submittedForms.length,0);assert.ok(!view.calls.some(c=>c.path==='csrf'));assert.match(view.messages.at(-1),/待保存内容/);cloud.state.pending=false;await button.handlers.click();assert.equal(view.submittedForms.length,1);const form=view.submittedForms[0];assert.equal(form.method,'POST');assert.equal(form.action,'logout');assert.equal(form.children[0].type,'hidden');assert.equal(form.children[0].name,'_csrf');assert.equal(form.children[0].value,'synthetic-csrf');view.ui.renderBar();await view.nodes.get('cloud-logout').onclick();assert.equal(view.submittedForms.length,2);
 });
 await test('家庭栏显示固定家庭名称，仍可切换孩子',async()=>{
  const {cloud}=fixture();await cloud.init();const view=uiFixture(cloud);view.ui.renderBar();assert.ok(!view.nodes.has('context-family'));assert.match(view.bar.innerHTML,/aria-label="当前家庭">合成家庭甲/);view.nodes.get('context-child').onchange({target:{value:'child-aa'}});assert.equal(cloud.state.child.id,'child-aa');
 });
 await test('已有家庭不能接受另一家庭邀请或开户邀请，同家庭无需重复接受',async()=>{
  for(const target of ['family-b',null,'family-a']){const {cloud}=fixture();await cloud.init();const view=uiFixture(cloud,{previewFamily:target});await view.route('invite',{token:'synthetic-token'});assert.ok(!view.nodes.has('accept-invite'));assert.ok(!view.nodes.has('register-invite'));assert.match(view.root.innerHTML,/前往家庭管理/);assert.match(view.root.innerHTML,target==='family-a'?/无需重复接受/:/不能通过开户邀请/);assert.ok(!view.calls.some(c=>c.path==='invitations/accept'));}
 });
 await test('邀请页重新核对服务端家庭资格，阻止另一标签页加入后接受',async()=>{
  const f=fixture();f.setFamily(null);await f.cloud.init();const view=uiFixture(f.cloud);f.setFamily('family-a');await view.route('invite',{token:'synthetic-token'});assert.match(view.root.innerHTML,/合成家庭甲/);assert.ok(!view.nodes.has('accept-invite'));assert.equal(f.calls.filter(c=>c.path.endsWith('/families')).length,2);assert.equal(f.cloud.state.family.id,'family-a');assert.equal(f.cloud.state.child.id,'child-a');assert.match(view.bar.innerHTML,/当前家庭">合成家庭甲/);assert.equal(view.routeCount,0,'资格刷新不能触发邀请页反复重绘');await view.route('family');assert.ok(!view.nodes.has('new-family'));assert.match(view.root.innerHTML,/我的家庭：合成家庭甲/);
 });
 await test('已消费邀请重开给出明确结果和家庭管理入口',async()=>{
  const f=fixture();f.setFamily(null);await f.cloud.init();const view=uiFixture(f.cloud,{used:true});f.setFamily('family-a');await view.route('invite',{token:'synthetic-token'});assert.match(view.root.innerHTML,/邀请已使用/);assert.match(view.root.innerHTML,/前往家庭管理/);assert.ok(!view.nodes.has('accept-invite'));assert.ok(!view.nodes.has('retry-view'));assert.equal(f.cloud.state.family.id,'family-a');await view.route('family');assert.ok(!view.nodes.has('new-family'));
 });
 await test('尚无家庭的登录成员仍可确认邀请，运营者可为其他家庭开户',async()=>{
  const f=fixture();f.setFamily(null);await f.cloud.init();const invited=uiFixture(f.cloud);await invited.route('invite',{token:'synthetic-token'});assert.ok(invited.nodes.has('accept-invite'));
  const operator=fixture();await operator.cloud.init();operator.cloud.state.me.operator=true;const view=uiFixture(operator.cloud);await view.route('family');assert.ok(!view.nodes.has('new-family'));assert.ok(view.nodes.has('operator-invite'));assert.match(view.nodes.get('operator-panel').innerHTML,/邀请其他尚未加入家庭的成人/);
 });
 await test('只读成员、归档孩子不能开启新练习',async()=>{
  const read=fixture({role:'VIEWER'}).cloud;await read.init();assert.throws(()=>read.begin(initial,{}),/只读/);
  const archived=fixture({archived:true}).cloud;await archived.init();archived.selectChild('child-a');assert.throws(()=>archived.context(),/归档/);
 });
 await test('写请求带同源Cookie和CSRF，不携带认证令牌',async()=>{
  const {cloud,calls}=fixture();await cloud.init();await cloud.begin(initial,{});const call=calls.find(c=>c.method==='POST');assert.equal(call.options.headers['X-CSRF-TOKEN'],'synthetic-csrf');assert.equal(call.options.credentials,'same-origin');assert.ok(!Object.keys(call.options.headers).some(k=>k.toLowerCase()==='authorization'));
 });
 await test('登录返回重新初始化后不复用旧CSRF令牌',async()=>{
  const {cloud,calls}=fixture();await cloud.init();await cloud.begin(initial,{});await cloud.clear();await cloud.init();await cloud.begin(initial,{});assert.equal(calls.filter(c=>c.path.endsWith('/csrf')).length,2);
 });
 await test('开始后固定家庭与孩子，切换孩子不会混写',async()=>{
  const {cloud,calls}=fixture();await cloud.init();await cloud.begin(initial,{});cloud.selectChild('child-aa');const next={...initial,answers:[{id:'concept-a',qid:'q1',result:'correct',text:'2'}]};await cloud.save(next,{},true);
  const writes=calls.filter(c=>['POST','PUT'].includes(c.method));assert.ok(writes.every(c=>c.path.includes('family-a/children/child-a/')));assert.equal(cloud.state.active.childId,'child-a');assert.equal(cloud.state.child.id,'child-aa');
 });
 await test('创建响应丢失后重试同一ID同一初始内容，再保存最新答案',async()=>{
  const f=fixture();await f.cloud.init();f.setLoseCreate();await f.cloud.begin(initial,{title:'初始内容'});assert.equal(f.cloud.state.pending,true);
  const next={...initial,answers:[{id:'concept-a',qid:'q1',result:'wrong'}]};await f.cloud.save(next,{title:'新快照'},true);const creates=f.calls.filter(c=>c.method==='POST');assert.equal(creates.length,2);assert.deepEqual(creates[0].body,creates[1].body);assert.equal(f.sessions.size,1);assert.equal(f.sessions.get('session-1').snapshot.answers.length,1);assert.equal(f.sessions.get('session-1').finished,true);assert.equal(f.cloud.state.pending,false);
 });
 await test('慢网络下串行合并快照，不用旧版本并发覆盖',async()=>{
  const f=fixture();await f.cloud.init();let release;f.setBarrier(new Promise(r=>release=r));const start=f.cloud.begin(initial,{});await Promise.resolve();const one={...initial,answers:[{qid:'q1'}]},two={...initial,answers:[{qid:'q1'},{qid:'q2'}]};f.cloud.save(one,{});f.cloud.save(two,{},true);release();await start;const saved=f.sessions.get('session-1');assert.equal(saved.snapshot.answers.length,2);assert.equal(saved.finished,true);assert.equal(f.cloud.state.pending,false);
 });
 await test('409保留待保存状态，不覆盖远端，也不允许静默结束或开新轮',async()=>{
  const f=fixture();await f.cloud.init();await f.cloud.begin(initial,{});f.setConflict();await f.cloud.save({...initial,answers:[{qid:'q1'}]},{});assert.equal(f.cloud.state.pending,true);assert.match(f.cloud.state.notice,/冲突/);await assert.rejects(()=>f.cloud.clear(),/待保存/);assert.throws(()=>f.cloud.begin(initial,{}),/待保存/);assert.equal(f.sessions.get('session-1').snapshot.answers.length,0);
 });
 await test('历史继续使用原会话ID与版本，不创建另一份会话',async()=>{
  const f=fixture();await f.cloud.init();await f.cloud.begin(initial,{});await f.cloud.clear();f.cloud.resume(f.sessions.get('session-1'),{familyId:'family-a',childId:'child-a'});await f.cloud.save({...initial,answers:[{qid:'q1'}]},{});assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.sessions.size,1);
 });
 await test('已结束或正在结束的快照不会因重复结束时间变化而重写',async()=>{
  const f=fixture();await f.cloud.init();await f.cloud.begin(initial,{});let release;const first={...initial,savedAt:'2026-01-01T00:00:00Z',answers:[{qid:'q1'}]};const finish=f.cloud.save(first,{},true);f.cloud.save({...first,savedAt:'2026-01-01T00:00:01Z'}, {},true);await finish;const writes=f.calls.filter(c=>c.method==='PUT').length;await f.cloud.save({...first,savedAt:'2026-01-01T00:00:02Z'}, {},true);assert.equal(f.calls.filter(c=>c.method==='PUT').length,writes);assert.equal(f.sessions.get('session-1').snapshot.savedAt,first.savedAt);await f.cloud.clear();assert.equal(f.cloud.state.active,null);
 });
 await test('随机练习只在新后端启用，画像请求固定家庭孩子且失败不降级为空历史',async()=>{
  const old=fixture();await old.cloud.init();assert.equal(old.cloud.state.adaptivePractice,false);await assert.rejects(()=>old.cloud.practiceProfile(old.cloud.context()),/尚未启用/);assert.ok(!old.calls.some(c=>c.path.endsWith('/practice-profile')));
  const f=fixture({adaptive:true});await f.cloud.init();const ctx=f.cloud.context();f.cloud.selectChild('child-aa');const profile=await f.cloud.practiceProfile(ctx);assert.deepEqual(profile.topicIds,['concept-a']);assert.ok(f.calls.at(-1).path.includes('/family-a/children/child-a/practice-profile'));
  const failed=fixture({adaptive:true,profileStatus:503});await failed.cloud.init();await assert.rejects(()=>failed.cloud.practiceProfile(failed.cloud.context()),e=>e.status===503);
  const malformed=fixture({adaptive:true,profileOverride:{schema:1,dataVersion:'synthetic-v1',topicIds:[],families:[],reviewQuestions:[]}});await malformed.cloud.init();await assert.rejects(()=>malformed.cloud.practiceProfile(malformed.cloud.context()),/暂时无法读取/);
 });
 await test('指定开始上下文发生切换时拒绝新建，切回也保留revision变化',async()=>{
  const f=fixture();await f.cloud.init();const ctx=f.cloud.context(),rev=f.cloud.contextRevision();f.cloud.selectChild('child-aa');assert.throws(()=>f.cloud.begin(initial,{},ctx),/已切换/);assert.equal(f.sessions.size,0);f.cloud.selectChild('child-a');assert.notEqual(f.cloud.contextRevision(),rev);
 });
 await test('动态题历史显示当时题干、参考答案解析和人工记录，不引用新版题库',async()=>{
  const f=fixture();await f.cloud.init();const snap={schema:2,mode:'review',dataVersion:'frozen-content',answers:[{id:'concept-a',qid:'dynamic-q',result:'correct',text:'<当时回答>',gradeSource:'manual',answeredAt:'2026-01-01T01:00:00Z'}]},content={topics:[{id:'concept-a',name:'原知识点'}],questions:[{id:'dynamic-q',topicId:'concept-a',type:'numeric',prompt:'当时随机题：6+8',answer:'14',explanation:'当时解析，不用当前模板补猜'}]};const view=uiFixture(f.cloud,{historyItems:[{id:'history-a',kind:'SESSION',snapshot:snap,contentSnapshot:content,finished:true,authorId:'user-a'}]});await view.route('history');const html=view.nodes.get('history-list').innerHTML;assert.match(html,/复习 · 1次直接作答/);assert.match(html,/当时随机题：6\+8/);assert.match(html,/当时参考答案：14/);assert.match(html,/当时解析/);assert.match(html,/人工记录/);assert.match(html,/&lt;当时回答&gt;/);assert.ok(!html.includes('<当时回答>'));
 });
 await test('schema2完整导出副本拒绝走旧JSON导入，避免重复作答统计',async()=>{
  const f=fixture();await f.cloud.init();const view=uiFixture(f.cloud);await view.route('history');await view.nodes.get('import-file').onchange({target:{files:[{size:100,text:async()=>JSON.stringify({schema:2,dataVersion:'synthetic-v1',plan:[],answers:[]})}]}});assert.ok(view.messages.some(m=>/不适用旧JSON导入/.test(m)));assert.ok(!view.calls.some(c=>c.path.includes('/imports/preview')));
 });
 await test('12张活动卡六类各2张，包含玩法、观察和简化变化',async()=>{
  const cards=JSON.parse(fs.readFileSync('data/activities.json'));assert.equal(cards.length,12);assert.equal(new Set(cards.map(a=>a.id)).size,12);const counts={};for(const a of cards){counts[a.domain]=(counts[a.domain]||0)+1;for(const k of ['materials','steps','parentPrompts','observe'])assert.ok(Array.isArray(a[k])&&a[k].length>0);assert.ok(a.easier&&a.variation&&a.version);}assert.equal(Object.keys(counts).length,6);assert.ok(Object.values(counts).every(n=>n===2));
 });
 console.log(`${passed}组家庭云端前端状态检查通过。`);
})().catch(e=>{console.error(e);process.exitCode=1;});
