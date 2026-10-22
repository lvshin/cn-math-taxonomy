/* 幼儿园活动草稿独立于小学练习。只在当前页内存中暂存，确认云端保存后才完成。 */
(function(root,factory){if(typeof module!=='undefined'&&module.exports)module.exports=factory();else root.PreschoolActivities=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const OUTCOMES={INDEPENDENT:'自己尝试',PROMPTED:'提示后参与',TOGETHER:'一起参与',NOT_TRIED:'还未尝试',PAUSED:'中途暂停'};
 const copy=value=>JSON.parse(JSON.stringify(value));
 const sameContext=(a,b)=>!!a&&!!b&&a.familyId===b.familyId&&a.childId===b.childId;
 const canWrite=s=>s.mode==='cloud'&&!!s.me&&!!s.family&&!!s.child&&s.family.role!=='VIEWER'&&!s.child.archived;
 function readContext(s){if(s.mode!=='cloud'||!s.me||!s.family||!s.child)return null;return {familyId:s.family.id,childId:s.child.id,familyName:s.family.name,childName:s.child.nickname};}
 function createDrafts({request,uuid,now=()=>new Date().toISOString(),onChange=()=>{}}){
  let draft=null,running=null;
  const notify=()=>onChange(draft);
  function begin(activity,ctx,{correctionOf=null,outcome='',note=''}={}){
   if(draft)throw Error('还有一份活动草稿。请先保存，或导出后放弃。');
   if(!ctx||!activity?.id||!activity.version)throw Error('活动或孩子档案不可用，请重新选择。');
   draft={ctx:copy(ctx),activity:copy(activity),correctionOf,outcome,note,status:'draft',error:'',body:null};notify();return draft;
  }
  function update({outcome,note}){
   if(!draft)throw Error('请先开始本次活动记录。');
   if(draft.body)throw Error('首次提交的内容已固定。请重试原记录，保存后再追加更正。');
   if(outcome!==undefined)draft.outcome=outcome;if(note!==undefined)draft.note=note;return draft;
  }
  function submit(){
   if(running)return running;
   if(!draft)return Promise.resolve(null);
   if(!draft.body){
    if(!Object.hasOwn(OUTCOMES,draft.outcome))return Promise.reject(Error('请选择这次的参与情况。'));
    const note=String(draft.note||'').trim();if(note.length>2000)return Promise.reject(Error('观察请保留在2000字以内。'));
    draft.body={id:uuid(),activityId:draft.activity.id,activityVersion:draft.activity.version,outcome:draft.outcome,note,occurredAt:now()};
    if(draft.correctionOf)draft.body.correctionOf=draft.correctionOf;
   }
   const target=draft;target.status='saving';target.error='';notify();
   running=(async()=>{try{
    const path=`families/${encodeURIComponent(target.ctx.familyId)}/children/${encodeURIComponent(target.ctx.childId)}/preschool/observations`;
    const saved=await request(path,{method:'POST',body:copy(target.body)});if(draft===target)draft=null;notify();return saved;
   }catch(error){target.status='pending';target.error=error.message;notify();throw error;}finally{running=null;}})();return running;
  }
  function discard(){if(running)throw Error('正在保存，请稍后再操作。');draft=null;notify();}
  return {get:()=>draft,begin,update,submit,discard,export:()=>draft?copy({schema:1,module:'PRESCHOOL',saved:false,...draft}):null};
 }
 return {OUTCOMES,sameContext,canWrite,readContext,createDrafts};
});
