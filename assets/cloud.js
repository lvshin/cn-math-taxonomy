/* 云端会话与家庭上下文；只把认证Cookie交给同源服务，不使用浏览器持久化存储。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory();else root.LearningCloud=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const OUTCOMES={INDEPENDENT:'独立完成',PROMPTED:'需要提示',TOGETHER:'共同完成',NOT_TRIED:'未尝试',PAUSED:'暂停'};
 const ROLES={OWNER:'家庭管理员',EDITOR:'记录成员',VIEWER:'只读成员'};
 const clone=x=>JSON.parse(JSON.stringify(x));
 class ApiError extends Error{constructor(status,body){super(body?.detail||body?.message||({401:'请先登录。',403:'没有这项操作的权限。',404:'内容不可见或已移除。',409:'记录已变化，请重新加载后再操作。'}[status])||'服务暂时不可用，请稍后重试。');this.status=status;this.code=body?.code;}}
 function create({fetcher=globalThis.fetch.bind(globalThis),base='api/v1/',uuid=()=>globalThis.crypto.randomUUID()}={}){
  const state={mode:'loading',me:null,families:[],children:[],family:null,child:null,active:null,notice:'正在连接学习服务…',pending:false};
  let csrf=null,running=null,latest=null,listeners=[],generation=0;
  const emit=kind=>listeners.forEach(fn=>fn(kind,state));
  function url(path){return base+path;}
  async function request(path,{method='GET',body,signal}={}){
   const headers={Accept:'application/json'};
   if(method!=='GET'&&method!=='HEAD'){
    if(!csrf){const r=await fetcher(url('csrf'),{credentials:'same-origin',headers:{Accept:'application/json'}});if(!r.ok)throw new ApiError(r.status,{});csrf=await r.json();}
    headers[csrf.headerName]=csrf.token;
   }
   if(body!==undefined)headers['Content-Type']='application/json';
   let response;try{response=await fetcher(url(path),{method,headers,credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body),signal});}catch(e){throw new ApiError(0,{detail:'网络暂时不可用。内容仍留在本页，恢复后请重试保存。'});}
   if(response.status===204)return null;
   const data=await response.json().catch(()=>({}));
   if(!response.ok){if(response.status===401){state.me=null;emit('auth');}if(response.status===403)csrf=null;throw new ApiError(response.status,data);}
   return data;
  }
  const array=x=>Array.isArray(x)?x:(x?.items||[]);
  async function init(){
   csrf=null; // 登录可能轮换会话和CSRF令牌，受邀页返回后重新取得。
   try{const r=await fetcher(url('capabilities'),{credentials:'same-origin',headers:{Accept:'application/json'}});
    if(r.status===404){state.mode='static';state.notice='教材浏览模式 · 学习记录请使用云端家庭入口';emit('ready');return;}
    if(!r.ok)throw new ApiError(r.status,{});const cap=await r.json();if(!cap.cloud)throw new Error('服务未启用云端功能。');
    state.mode='cloud';state.loginUrl=cap.loginUrl||'oauth2/authorization/learning';
    try{state.me=await request('me');await refresh();}catch(e){if(e.status!==401)throw e;state.notice='登录后，与家人共同留下每个孩子的学习过程。';}
   }catch(e){state.mode='unavailable';state.notice='学习服务暂时无法连接。教材仍可浏览，请稍后重试。';}
   emit('ready');
  }
  async function refresh(){
   state.families=array(await request('families'));
   const family=state.families.find(f=>f.id===state.family?.id)||state.families[0]||null;
   await selectFamily(family?.id);return state;
  }
  async function selectFamily(id){
   const seq=++generation,family=state.families.find(f=>f.id===id)||null,previousChildId=state.family?.id===id?state.child?.id:null;
   state.family=family;state.children=[];state.child=null;emit('context');
   if(!family)return;
   const children=array(await request(`families/${encodeURIComponent(id)}/children`));if(seq!==generation)return;
   state.children=children;state.child=children.find(c=>c.id===previousChildId)||children.find(c=>!c.archived)||children[0]||null;emit('context');
  }
  function selectChild(id){state.child=state.children.find(c=>c.id===id)||null;emit('context');}
  function context(){if(state.mode!=='cloud'||!state.me)throw new Error('请先登录云端家庭入口。');if(!state.family||!state.child)throw new Error('请先选择家庭和孩子档案。');if(state.family.role==='VIEWER')throw new Error('当前为只读成员，可查看历史，不能新增记录。');if(state.child.archived)throw new Error('这个孩子档案已归档，请选择使用中的档案。');return {familyId:state.family.id,childId:state.child.id,familyName:state.family.name,childName:state.child.nickname};}
  const childPath=ctx=>`families/${encodeURIComponent(ctx.familyId)}/children/${encodeURIComponent(ctx.childId)}`;
  function contentSnapshot(model,session){
   const ids=new Set(session.answers.map(a=>a.qid)),item=globalThis.DiagEngine?.nextItem(model.graph,session);if(item)ids.add(item.question.id);
   return {dataVersion:model.data.meta.data_version,topics:session.order.map(id=>({id,name:model.graph.byId[id]?.name,label:model.label(id)})),questions:model.data.questions.filter(q=>ids.has(q.id)).map(clone)};
  }
  function begin(snapshot,content){
   if(state.pending)throw new Error('上一轮还有待保存内容，请先重试保存或导出。');
   state.active={...context(),id:uuid(),version:null,initial:{snapshot:clone(snapshot),contentSnapshot:clone(content)},finished:false,closing:false};
   return save(snapshot,content,false);
  }
  function resume(resource,ctx){
   if(state.pending)throw new Error('当前还有待保存内容，请先重试保存。');
   state.active={...ctx,id:resource.id,version:resource.version,initial:null,finished:!!resource.finished,closing:!!resource.finished};latest=null;emit('session');
  }
  function save(snapshot,content,finished=false){
   if(!state.active)return Promise.resolve();
   // 完成的快照保持不可变；重复结束不会仅因savedAt变化而重写历史。
   if(state.active.finished)return Promise.resolve(true);
   if(state.active.closing)return flush();
   if(finished)state.active.closing=true;
   latest={snapshot:clone(snapshot),contentSnapshot:clone(content),finished:finished||state.active.finished};
   state.pending=true;emit('save');return flush();
  }
  function flush(){
   if(running)return running;
   running=(async()=>{try{
    while(latest&&state.active){const active=state.active,body=latest;latest=null;state.notice='正在保存到云端…';emit('save');
     try{
      let resource;if(active.version===null){resource=await request(childPath(active)+'/sessions',{method:'POST',body:{id:active.id,dataVersion:active.initial.snapshot.dataVersion,...active.initial}});active.version=resource.version;
       // 创建请求始终重试同一内容，再发送当前快照，避免断网后重复创建。
       if(JSON.stringify(body.snapshot)!==JSON.stringify(active.initial.snapshot)||body.finished)resource=await request(childPath(active)+'/sessions/'+active.id,{method:'PUT',body:{version:active.version,...body}});
      }else resource=await request(childPath(active)+'/sessions/'+active.id,{method:'PUT',body:{version:active.version,...body}});
      active.version=resource.version;active.finished=!!body.finished;state.notice='已保存到家庭云端';
     }catch(e){if(!latest)latest=body;state.notice=e.status===409?'保存冲突：另一页面已修改本轮。请先导出本页副本；重新打开页面后，从学习历史继续。':e.message;throw e;}
    }
    state.pending=false;emit('save');
   }catch(e){state.pending=true;emit('save');return false;}finally{running=null;}})();return running;
  }
  async function clear(){if(state.pending){await flush();if(state.pending)throw new Error('还有待保存内容，结束前请重试保存或导出。');}state.active=null;latest=null;emit('session');}
  function subscribe(fn){listeners.push(fn);return()=>{listeners=listeners.filter(x=>x!==fn);};}
  return {state,init,request,refresh,selectFamily,selectChild,context,childPath,contentSnapshot,begin,resume,save,flush,clear,subscribe,uuid,array,OUTCOMES,ROLES};
 }
 return {create,ApiError,OUTCOMES,ROLES};
});
