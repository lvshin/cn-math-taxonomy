/* 教材、概念和练习适配层。无 DOM，浏览器和 Node 共用。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports) module.exports=factory(require('../diagnose/engine.js'),require('./practice.js'));
 else root.SuzhouMath=factory(root.DiagEngine,root.PracticeMath);
})(typeof self!=='undefined'?self:this,function(E,P){
 'use strict';
 const canonical=x=>JSON.stringify(x,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
 const STORAGE_KEY='suzhou-math-taxonomy:session:v1';
 function create(data,catalog){
  const practice=P&&catalog?P.create(data,catalog):null,frozen=new WeakMap();
  const graph=E.buildGraph(data.topics,data.dependencies,data.questions);
  const books=Object.fromEntries(data.books.map(b=>[b.id,b]));
  const units=Object.fromEntries(data.books.flatMap(b=>b.units.map(u=>[u.id,u])));
  const placements=Object.create(null);
  data.placements.forEach(p=>(placements[p.topicId]||=[]).push(p));
  const order=new Map(E.topoSort(graph,data.topics.map(t=>t.id)).map((id,i)=>[id,i]));
  function label(id){
   const p=(placements[id]||[])[0];
   return p?books[p.bookId].title+' · '+units[p.unitId].title:'基础概念 · 苏教教材位置待核';
  }
  function topicsFor(bookId,unitId,query,domain){
   const result=data.topics.filter(t=>{
    const ps=placements[t.id]||[];
    if(bookId==='unmapped'?ps.length:bookId&&!ps.some(p=>p.bookId===bookId))return false;
    if(unitId&&!ps.some(p=>p.unitId===unitId))return false;
    if(domain&&t.domain!==domain)return false;
    const hay=t.name+' '+t.description+' '+ps.map(p=>units[p.unitId].title).join(' ');
    return !query||hay.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
   });
   // 册次内按目录顺序，而非沿用上游人教版 topics 数组的顺序。
   const rank=t=>{
    const ps=(placements[t.id]||[]).filter(p=>!bookId||p.bookId===bookId);
    if(!ps.length)return 1e9+graph.index[t.id];
    const p=ps[0],bi=data.books.findIndex(b=>b.id===p.bookId),ui=books[p.bookId].units.findIndex(u=>u.id===p.unitId);
    return bi*100000+ui*1000+graph.index[t.id];
   };
   return result.sort((a,b)=>rank(a)-rank(b));
  }
  function start(ids,opts){
   const active=ids.filter(id=>E.isTestable(graph,id));
   if(!active.length)throw new Error('这个范围的练习尚未整理。');
   return E.createSession(graph,active,Object.assign({limit:16,seed:String(Date.now())},opts));
  }
  function summary(session){
   if(session.schema===2)return practice.summary(session);
   const s=E.summarize(graph,session);
   // 新版跨册重排；保持先修拓扑顺序，不能按原人教年级排列。
   s.path.sort((a,b)=>order.get(a.id)-order.get(b.id));
   s.directMastered=s.mastered.filter(id=>session.status[id]?.src==='direct');
   s.inferredMastered=s.mastered.filter(id=>session.status[id]?.src==='inferred');
   s.unmappedPrerequisites=session.order.filter(id=>!placements[id]?.length);
   return s;
  }
  function snapshot(s){if(s.schema===2)return practice.snapshot(s);return {schema:1,dataVersion:data.meta.data_version,savedAt:new Date().toISOString(),targets:s.targets,answers:s.answers,options:{seed:s.seed,limit:s.limit,mode:s.mode,avoid:s.avoid}};}
  function restore(raw,content){
   try{
    const x=typeof raw==='string'?JSON.parse(raw):raw;
    if(x?.schema===2){
     if(!practice)return null;
     // 历史题干、答案与解析取当时快照，不取当前教材或模板。
     const restored=practice.restore(x);
     if(!restored)return null;
     if(content){
      if(content.dataVersion!==x.dataVersion||!Array.isArray(content.questions))return null;
      const saved=new Map(content.questions.map(q=>[q.id,q]));
      for(const entry of restored.plan){const q=entry.question||entry;if(!saved.has(q.id)||canonical(saved.get(q.id))!==canonical(q))return null;}
     }
     if(content)frozen.set(restored,JSON.parse(JSON.stringify(content)));
     return restored;
    }
    if(!x||x.schema!==1||x.dataVersion!==data.meta.data_version||!Array.isArray(x.targets)||!x.targets.length||x.targets.some(id=>!E.isTestable(graph,id))||!Array.isArray(x.answers)||x.answers.length>80||!x.options||!Number.isInteger(x.options.limit)||x.options.limit<1||x.options.limit>40||!['target','screen'].includes(x.options.mode)||typeof x.options.seed!=='string')return null;
    let s=start(x.targets,x.options);
    for(const a of x.answers){
     const next=E.nextItem(graph,s);
     if(!next||a.id!==next.topicId||a.qid!==next.question.id||!['correct','wrong','skip'].includes(a.result))return null;
     s=E.applyAnswer(graph,s,a.id,a.result,{text:a.text});
     if(a.answeredAt)s.answers[s.answers.length-1].answeredAt=a.answeredAt;
     if(['auto','manual'].includes(a.gradeSource))s.answers[s.answers.length-1].gradeSource=a.gradeSource;
    }
    return s;
   }catch(_){return null;}
  }
  function startPractice(ids,opts){if(!practice)throw Error('随机变式资料尚未加载，请刷新后重试。');return practice.start(ids,opts);}
  function next(s){return s.schema===2?practice.next(s):E.nextItem(graph,s);}
  function apply(s,item,result,extra={}){
   const details={...extra,answeredAt:extra.answeredAt||new Date().toISOString(),gradeSource:extra.gradeSource||'auto'};
   if(s.schema===2){const updated=practice.apply(s,result,details);if(frozen.has(s))frozen.set(updated,frozen.get(s));return updated;}
   const updated=E.applyAnswer(graph,s,item.topicId,result,{text:details.text}),answer=updated.answers[updated.answers.length-1];
   answer.answeredAt=details.answeredAt;answer.gradeSource=details.gradeSource;return updated;
  }
  function question(s,qid){if(s.schema===2){const entry=s.plan.find(q=>(q.question||q).id===qid);return entry&&(entry.question||entry);}return E.questionById(graph,qid);}
  function frozenContent(s){return frozen.get(s)||null;}
  function support(id){return practice?practice.support(id):{generated:false,label:'固定题库',templates:0};}
  return {data,graph,books,units,placements,label,topicsFor,start,startPractice,next,apply,question,support,frozenContent,summary,snapshot,restore};
 }
 return {create,STORAGE_KEY};
});
