/* 巩固与复习：与诊断引擎独立；选题一次冻结，恢复时不重抽、不重新判分。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./question-generators.js'));
 else root.PracticeMath=factory(root.MathQuestionGenerators);
})(typeof self!=='undefined'?self:this,function(G){
 'use strict';
 const STRATEGY_VERSION='weighted-families-v1',DAY=86400000,RESULTS=['correct','wrong','skip'];
 const copy=x=>JSON.parse(JSON.stringify(x));
 const unique=a=>Array.from(new Set(a));
 function random(seed){let a=parseInt(G.hash(String(seed)),16);return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
 function familyKey(q){return q.familyKey||(q.templateId&&q.templateVersion?'template:'+q.templateId+'@'+q.templateVersion:'fixed:'+q.id);}
 function weight(history,now){
  if(!history||!RESULTS.includes(history.lastResult))return 1;
  if(history.lastResult!=='correct')return 3;
  const base=Math.max(.2,1/(Math.max(1,Number(history.streak)||1)+1));
  const last=Date.parse(history.lastAt),elapsed=Number.isFinite(last)?Math.max(0,now-last):0;
  return base+(1-base)*Math.min(1,elapsed/(7*DAY));
 }
 function questionValid(q){
  if(!q||typeof q!=='object'||typeof q.id!=='string'||!q.id||q.id.length>250||typeof q.topicId!=='string'||typeof q.prompt!=='string'||!q.prompt||q.prompt.length>10000||typeof q.explanation!=='string'||q.explanation.length>20000||!['numeric','choice','short','self'].includes(q.type)||!['string','number'].includes(typeof q.answer))return false;
  if(q.type==='choice'&&(!Array.isArray(q.choices)||q.choices.length<2||q.choices.length>20||q.choices.some(c=>!c||typeof c.key!=='string'||typeof c.text!=='string')||!q.choices.some(c=>c.key===q.answer)))return false;
  return typeof familyKey(q)==='string'&&familyKey(q).length<=300;
 }
 function identity(q){return q.type+'|'+q.prompt.replace(/\s+/g,'').normalize('NFKC');}
 function create(data,catalog){
  if(!G||!data||!data.meta||!Array.isArray(data.topics)||!Array.isArray(data.questions)||!catalog||catalog.schema!==1||!catalog.version||!Array.isArray(catalog.templates))throw new Error('练习数据尚未完整加载，请重试。');
  const byTopic=new Map(data.topics.map(t=>[t.id,t])),mapped=new Set((data.placements||[]).map(p=>p.topicId));
  const allowed=id=>byTopic.has(id)&&(mapped.size?mapped.has(id):byTopic.get(id).placement_status!=='unmapped');
  const templates=catalog.templates.filter(t=>allowed(t.topicId)),templateIds=new Set();
  for(const t of templates){if(templateIds.has(t.id))throw new Error('重复的变式模板');templateIds.add(t.id);G.generate(t,()=>.5);}
  const fixed=data.questions.filter(q=>allowed(q.topicId)&&questionValid(q));
  function support(id){const n=templates.filter(t=>t.topicId===id).length;return {generated:n>0,label:n?'支持随机变式':'固定题库',templates:n};}
  function start(topicIds,options){
   const opts=options||{},mode=opts.mode||'practice',limit=opts.limit===undefined?10:opts.limit;
   if(!['practice','review'].includes(mode)||![5,10,20].includes(limit))throw new Error('请选择5、10或20题。');
   const now=opts.now===undefined?Date.now():typeof opts.now==='number'?opts.now:Date.parse(opts.now);
   if(!Number.isFinite(now))throw new Error('无效的练习时间。');
   const profile=opts.profile;
   if(!profile||profile.schema!==1||profile.dataVersion!==data.meta.data_version||!Array.isArray(profile.topicIds)||!profile.families||typeof profile.families!=='object'||Array.isArray(profile.families)||!Array.isArray(profile.reviewQuestions))throw new Error('未能读取孩子的练习画像，请重试。');
   const targets=unique((mode==='review'?profile.topicIds:Array.isArray(topicIds)?topicIds:[]).filter(allowed));
   if(!targets.length)throw new Error(mode==='review'?'这个孩子还没有直接作答记录，请先选择知识点练习。':'这个范围的练习尚未整理。');
   const targetSet=new Set(targets),seed=String(opts.seed===undefined?now:opts.seed),rng=random(seed),families=new Map();
   if(seed.length>200)throw new Error('无效的随机种子。');
   function add(q,t){
    const key=t?'template:'+t.id+'@'+t.version:familyKey(q),topicId=t?t.topicId:q.topicId;
    let family=families.get(key);if(family&&family.topicId!==topicId)return;
    if(!family){const saved=profile.families[key],h=saved?.topicId===topicId?saved:null;family={key,topicId,weight:weight(h,now),correct:h?.lastResult==='correct',questions:[],template:null,exhausted:false};families.set(key,family);}
    if(t)family.template=t;else if(!family.questions.some(x=>x.id===q.id&&identity(x)===identity(q)))family.questions.push({...copy(q),familyKey:key});
   }
   fixed.filter(q=>targetSet.has(q.topicId)).forEach(q=>add(q));
   templates.filter(t=>targetSet.has(t.topicId)).forEach(t=>add(null,t));
   profile.reviewQuestions.slice(0,40).filter(q=>questionValid(q)&&targetSet.has(q.topicId)).forEach(q=>add(q));
   const weights=Object.fromEntries(Array.from(families.values(),f=>[f.key,{topicId:f.topicId,weight:f.weight,bucket:f.correct?'correct':'practice'}]));
   const plan=[],ids=new Set(),seen=new Set(),quota=Array.from({length:limit},(_,i)=>i<Math.round(limit*.2));
   for(let i=quota.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[quota[i],quota[j]]=[quota[j],quota[i]];}
   function drawFamily(pool){let cursor=rng()*pool.reduce((sum,f)=>sum+f.weight,0);for(const f of pool){cursor-=f.weight;if(cursor<=0)return f;}return pool[pool.length-1];}
   function drawQuestion(f){
    const historical=f.questions.filter(q=>!ids.has(q.id)&&!seen.has(identity(q)));
    if(historical.length&&(!f.template||rng()<.5))return historical[Math.floor(rng()*historical.length)];
    if(f.template)for(let i=0;i<120;i++){const q=G.generate(f.template,rng);if(!ids.has(q.id)&&!seen.has(identity(q)))return q;}
    return historical.length?historical[Math.floor(rng()*historical.length)]:null;
   }
   for(const correct of quota){
    let chosen=null;
    while(!chosen){const all=Array.from(families.values()).filter(f=>!f.exhausted);if(!all.length)break;const preferred=all.filter(f=>f.correct===correct),pool=preferred.length?preferred:all,f=drawFamily(pool);chosen=drawQuestion(f);if(!chosen)f.exhausted=true;}
    if(!chosen)break;chosen=copy(chosen);chosen.familyKey=familyKey(chosen);plan.push(chosen);ids.add(chosen.id);seen.add(identity(chosen));
   }
   if(!plan.length)throw new Error('这个范围的练习尚未整理。');
   return {schema:2,dataVersion:data.meta.data_version,mode,seed,targets,limit,startedAt:new Date(now).toISOString(),plan,answers:[],selection:{strategyVersion:STRATEGY_VERSION,catalogVersion:catalog.version,asOf:profile.asOf||new Date(now).toISOString(),weights}};
  }
  function next(s){const q=s.plan[s.answers.length];return q?{topicId:q.topicId,question:copy(q),index:s.answers.length,total:s.plan.length}:null;}
  function apply(s,result,extra){
   if(!RESULTS.includes(result))throw new Error('作答结果必须是 correct / wrong / skip');
   const n=next(s);if(!n)throw new Error('本轮练习已结束。');const out=copy(s),x=extra||{};
   const at=x.answeredAt===undefined?new Date().toISOString():x.answeredAt;
   if(!Number.isFinite(Date.parse(at)))throw new Error('无效作答时间。');
   if(x.gradeSource!==undefined&&!['auto','manual'].includes(x.gradeSource))throw new Error('无效判题来源。');
   const answer={id:n.topicId,qid:n.question.id,familyKey:n.question.familyKey,result,answeredAt:at,gradeSource:x.gradeSource||'auto'};
   if(x.text!==undefined&&x.text!==null&&String(x.text)!=='')answer.text=String(x.text);
   out.answers.push(answer);return out;
  }
  function snapshot(s){return {...copy(s),savedAt:new Date().toISOString()};}
  function restore(raw){
   try{
    const s=typeof raw==='string'?JSON.parse(raw):copy(raw);
    if(!s||s.schema!==2||typeof s.dataVersion!=='string'||!s.dataVersion||!['practice','review'].includes(s.mode)||typeof s.seed!=='string'||s.seed.length>200||![5,10,20].includes(s.limit)||!Array.isArray(s.targets)||!s.targets.length||s.targets.some(t=>typeof t!=='string')||!Array.isArray(s.plan)||!s.plan.length||s.plan.length>s.limit||!Array.isArray(s.answers)||s.answers.length>s.plan.length||!s.selection||typeof s.selection.strategyVersion!=='string'||typeof s.selection.catalogVersion!=='string'||!s.selection.weights||typeof s.selection.weights!=='object'||!Number.isFinite(Date.parse(s.startedAt)))return null;
    const ids=new Set(),seen=new Set(),targets=new Set(s.targets);
    for(const q of s.plan){if(!questionValid(q)||!targets.has(q.topicId)||typeof q.familyKey!=='string'||ids.has(q.id)||seen.has(identity(q)))return null;ids.add(q.id);seen.add(identity(q));}
    for(let i=0;i<s.answers.length;i++){const a=s.answers[i],q=s.plan[i];if(!a||a.id!==q.topicId||a.qid!==q.id||a.familyKey!==q.familyKey||!RESULTS.includes(a.result)||!Number.isFinite(Date.parse(a.answeredAt))||!['auto','manual'].includes(a.gradeSource)||a.text!==undefined&&typeof a.text!=='string')return null;}
    return s;
   }catch(_){return null;}
  }
  function summary(s){
   const counts={correct:0,wrong:0,skip:0},topicResults={};
   for(const a of s.answers){counts[a.result]++;const t=topicResults[a.id]||={correct:0,wrong:0,skip:0};t[a.result]++;}
   return {mode:s.mode,counts,...counts,answered:s.answers.length,asked:s.answers.length,total:s.plan.length,limit:s.limit,completed:s.answers.length===s.plan.length,finished:s.answers.length===s.plan.length,shortage:s.plan.length<s.limit,topicResults};
  }
  return {start,next,apply,snapshot,restore,summary,support};
 }
 return {create,weight,familyKey,STRATEGY_VERSION};
});
