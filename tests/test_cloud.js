/* 真实浏览器界面之外的云端状态/幂等性测试；全部使用合成家庭。 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),Cloud=require('../assets/cloud.js');
let passed=0;
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture({staticMode=false,role='OWNER',archived=false}={}){
 const calls=[],sessions=new Map();let loseCreate=false,conflict=false,barrier=null;
 const families=[{id:'family-a',name:'合成家庭甲',role},{id:'family-b',name:'合成家庭乙',role:'EDITOR'}];
 const children={'family-a':[{id:'child-a',nickname:'样例甲',archived,version:0},{id:'child-aa',nickname:'样例乙',archived:false,version:0}],'family-b':[{id:'child-b',nickname:'样例丙',archived:false,version:0}]};
 const res=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
 async function fetcher(path,options={}){
  const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body,options});
  if(path.endsWith('capabilities'))return res(staticMode?404:200,{cloud:true,loginUrl:'oauth2/authorization/learning'});
  if(path.endsWith('/csrf'))return res(200,{token:'synthetic-csrf',headerName:'X-CSRF-TOKEN'});
  if(path.endsWith('/me'))return res(200,{id:'user-a',name:'合成成人'});
  if(path.endsWith('/families'))return res(200,families);
  const match=path.match(/families\/(family-[ab])\/children$/);if(match)return res(200,children[match[1]]);
  if(path.endsWith('/sessions')&&method==='POST'){
   if(barrier)await barrier;
   if(!sessions.has(body.id))sessions.set(body.id,{...clone(body),version:0});
   if(loseCreate){loseCreate=false;throw Error('response lost');}return res(200,sessions.get(body.id));
  }
  if(path.includes('/sessions/')&&method==='PUT'){
   if(conflict)return res(409,{detail:'合成并发冲突'});
   const id=path.split('/').pop(),old=sessions.get(id);if(body.version!==old.version)return res(409,{});
   const next={...old,...clone(body),version:old.version+1};sessions.set(id,next);return res(200,next);
  }
  throw Error('Unexpected request '+method+' '+path);
 }
 let uuid=0;const cloud=Cloud.create({fetcher,uuid:()=>`session-${++uuid}`});
 return {cloud,calls,sessions,setLoseCreate:()=>loseCreate=true,setConflict:()=>conflict=true,setBarrier:p=>barrier=p};
}
const initial={schema:1,dataVersion:'synthetic-v1',targets:['concept-a'],answers:[],options:{seed:'test',limit:12,mode:'target'}};
async function test(name,fn){await fn();passed++;console.log('✓ '+name);}
(async()=>{
 await test('静态404只浏览，不读取身份、不写第二份本地历史',async()=>{
  const {cloud,calls}=fixture({staticMode:true});await cloud.init();assert.equal(cloud.state.mode,'static');assert.equal(calls.length,1);assert.throws(()=>cloud.context(),/登录/);assert.equal(cloud.state.active,null);
  const source=fs.readFileSync('assets/cloud.js','utf8')+fs.readFileSync('assets/app.js','utf8');assert.ok(!source.includes('localStorage.setItem'));assert.ok(!source.includes('localStorage.removeItem'));assert.ok(!source.includes('Authorization:'));
 });
 await test('家庭和孩子选择独立，多家庭刷新保持当前孩子',async()=>{
  const {cloud}=fixture();await cloud.init();assert.equal(cloud.context().childId,'child-a');cloud.selectChild('child-aa');await cloud.refresh();assert.equal(cloud.context().childId,'child-aa');await cloud.selectFamily('family-b');assert.equal(cloud.context().childId,'child-b');
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
 await test('开始后固定家庭与孩子，切换界面不会混写',async()=>{
  const {cloud,calls}=fixture();await cloud.init();await cloud.begin(initial,{});await cloud.selectFamily('family-b');const next={...initial,answers:[{id:'concept-a',qid:'q1',result:'correct',text:'2'}]};await cloud.save(next,{},true);
  const writes=calls.filter(c=>['POST','PUT'].includes(c.method));assert.ok(writes.every(c=>c.path.includes('family-a/children/child-a/')));assert.equal(cloud.state.active.childId,'child-a');assert.equal(cloud.state.child.id,'child-b');
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
 await test('12张活动卡六类各2张，包含玩法、观察和简化变化',async()=>{
  const cards=JSON.parse(fs.readFileSync('data/activities.json'));assert.equal(cards.length,12);assert.equal(new Set(cards.map(a=>a.id)).size,12);const counts={};for(const a of cards){counts[a.domain]=(counts[a.domain]||0)+1;for(const k of ['materials','steps','parentPrompts','observe'])assert.ok(Array.isArray(a[k])&&a[k].length>0);assert.ok(a.easier&&a.variation&&a.version);}assert.equal(Object.keys(counts).length,6);assert.ok(Object.values(counts).every(n=>n===2));
 });
 console.log(`${passed}组家庭云端前端状态检查通过。`);
})().catch(e=>{console.error(e);process.exitCode=1;});
