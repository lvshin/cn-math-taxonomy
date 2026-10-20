/* 教材、概念和练习适配层。无 DOM，浏览器和 Node 共用。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports) module.exports=factory(require('../diagnose/engine.js'));
 else root.SuzhouMath=factory(root.DiagEngine);
})(typeof self!=='undefined'?self:this,function(E){
 'use strict';
 const STORAGE_KEY='suzhou-math-taxonomy:session:v1';
 function create(data){
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
   const s=E.summarize(graph,session);
   // 新版跨册重排；保持先修拓扑顺序，不能按原人教年级排列。
   s.path.sort((a,b)=>order.get(a.id)-order.get(b.id));
   s.directMastered=s.mastered.filter(id=>session.status[id]?.src==='direct');
   s.inferredMastered=s.mastered.filter(id=>session.status[id]?.src==='inferred');
   s.unmappedPrerequisites=session.order.filter(id=>!placements[id]?.length);
   return s;
  }
  function snapshot(s){return {schema:1,dataVersion:data.meta.data_version,savedAt:new Date().toISOString(),targets:s.targets,answers:s.answers,options:{seed:s.seed,limit:s.limit,mode:s.mode,avoid:s.avoid}};}
  function restore(raw){
   try{
    const x=typeof raw==='string'?JSON.parse(raw):raw;
    if(!x||x.schema!==1||x.dataVersion!==data.meta.data_version||!Array.isArray(x.targets)||!x.targets.length||x.targets.some(id=>!E.isTestable(graph,id))||!Array.isArray(x.answers)||x.answers.length>80||!x.options||!Number.isInteger(x.options.limit)||x.options.limit<1||x.options.limit>40||!['target','screen'].includes(x.options.mode)||typeof x.options.seed!=='string')return null;
    let s=start(x.targets,x.options);
    for(const a of x.answers){
     const next=E.nextItem(graph,s);
     if(!next||a.id!==next.topicId||a.qid!==next.question.id||!['correct','wrong','skip'].includes(a.result))return null;
     s=E.applyAnswer(graph,s,a.id,a.result,{text:a.text});
    }
    return s;
   }catch(_){return null;}
  }
  return {data,graph,books,units,placements,label,topicsFor,start,summary,snapshot,restore};
 }
 return {create,STORAGE_KEY};
});
