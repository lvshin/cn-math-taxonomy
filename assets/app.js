/* 教材地图与练习界面；长期学习记录由家庭云端服务统一保存。 */
(async function(){
 'use strict';
 const E=window.DiagEngine, root=document.getElementById('content');
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cn=['','一','二','三','四','五','六'];
 let M,session=null,feedback=null,selected='cnm_p001',bookFilter='1a',unitFilter='',search='',domain='',depth=2;
 let toastTimer;
 const cloud=LearningCloud.create();
 const cloudUI=LearningCloudUI.create(cloud,{root,toast,onRoute:()=>{if(M)render();},onResume:async(resource,ctx)=>{const restored=M.restore(resource.snapshot);if(!restored)throw Error('这份记录的内容版本与当前题库不同，可在历史中查看原始作答，不能直接继续或重新判分。');cloud.context();cloud.resume(resource,ctx);session=restored;feedback=null;go('#practice');}});
 cloud.subscribe(()=>{document.querySelectorAll('[data-save-notice]').forEach(el=>el.textContent=cloud.state.notice);});
 function toast(text){document.getElementById('toast').textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>document.getElementById('toast').textContent='',4000);}
 function pill(b){
  if(b.catalog_status==='pdf_provisional')return '<span class="pill external">暂选 · 目录抽查</span>';
  if(['pdf_checked','official_checked'].includes(b.catalog_status))return '<span class="pill">目录已核</span>';
  return b.catalog_status==='external_outline'?'<span class="pill external">参考目录</span>':'<span class="pill pending">目录待补</span>';
 }
 function catalogNote(b){
  const note=b.catalog_status==='pdf_provisional'?'暂选扫描本：目录与首尾已抽查，详细版本和全文仍待比对。':b.catalog_status==='pdf_checked'?'目录已与所列本地PDF核对；不代表出版版次或全文校审通过。':b.catalog_status==='official_checked'?'目录已与国家平台正式版核对。':b.catalog_status==='external_outline'?'第三方参考目录，教材文件仍待取得。':'目录待补，本册尚不提供知识点和练习。';
  return note+(b.evidence?.official_comparison?' '+b.evidence.official_comparison:'')+' 知识点按单元主题推断，尚未逐节核定。';
 }
 function go(hash){if(location.hash===hash)render();else location.hash=hash;}
 function save(finished=false){return session?cloud.save(M.snapshot(session),cloud.contentSnapshot(M,session),finished):Promise.resolve();}
 async function begin(ids,screen=false){
  try{cloud.context();if(cloud.state.pending)throw Error('上一轮还有待保存内容，请先重试保存或导出。');if(session){await save(true);if(cloud.state.pending)throw Error('上一轮尚未保存，请恢复网络后重试。');}const next=M.start(ids,{mode:screen?'screen':'target',limit:screen?12:16});cloud.begin(M.snapshot(next),cloud.contentSnapshot(M,next));session=next;feedback=null;go('#practice');}catch(e){toast(e.message);}
 }
 function sessionContext(){const a=cloud.state.active;return a?`<div class="session-context"><strong>本轮记录：${esc(a.familyName)} / ${esc(a.childName)}</strong><small>开始后已固定归属。上方切换孩子，不会改变这轮练习的记录对象。</small></div>`:'';}
 function home(){
  const c=M.data.meta.counts;
  root.innerHTML=`<div class="wrap"><section class="hero"><div><div class="eyebrow">苏州小学 · 现用苏教教材 · 学习地图</div><h1>每一道难题，<br>都有一条<em>来路。</em></h1><p>沿着教材找知识，沿着知识找基础。<br>把一至六年级的数学连接起来，从眼前这一步，找到可以重新出发的地方。</p><div class="actions"><a class="btn primary" href="#map?book=1a">打开知识地图 <span>↗</span></a><a class="btn subtle" href="#practice">从一道练习开始 →</a></div></div><div class="hero-illustration" aria-label="示意：整数乘法、小数意义连接到小数乘法和分段计费"><div class="diagram-top"><span>知识不是孤立的小岛</span><span>01 — 06</span></div><div class="flow"><div class="flow-node">整数乘法<small>计算基础</small></div><div class="flow-node">小数的意义<small>数量理解</small></div><div class="flow-node">小数乘法<small>连接已有经验</small></div><div class="flow-node">生活中的分段计费<small>把数学用在真实问题里</small></div></div><div class="diagram-note">示意关系 · 实际先修关系见知识图谱</div></div></section><div class="stats"><div class="stat"><strong>${c.pdf_catalogs+c.official_catalogs}</strong><small>册目录已核</small><span>${c.provisional_catalogs}册暂选 · 十二册均有目录</span></div><div class="stat"><strong>${c.mapped_concepts}</strong><small>个知识点已映射</small><span>按单元主题整理 · 仍需逐节核定</span></div><div class="stat"><strong>${c.questions}</strong><small>道练习稿</small><span>${c.rewritten_questions}道针对概念重写</span></div><div class="stat"><strong>1—6</strong><small>年级入口</small><span>知识图谱 · 练习 · 学习路径</span></div></div><section><div class="section-head"><div><div class="eyebrow">从正在学的那一册开始</div><h2>把教材，展开成一张地图</h2><p>目录依据现有十二册教材；四至六下采用现用2013版，四上保持暂选。知识点落位和先修关系为 AI 整理稿。</p></div><a class="text-link" href="#sources">查看版本与核对范围 ↗</a></div><div class="shelf">${[1,2,3,4,5,6].map(g=>`<article class="grade-card"><div class="grade-top"><strong>${cn[g]}年级</strong><span>苏教版 · 数学</span></div>${['a','b'].map(s=>{const b=M.books[g+s],n=M.topicsFor(b.id).length;return `<a class="book-link" href="#map?book=${b.id}"><div><strong>${s==='a'?'上册':'下册'} <span aria-hidden="true">↗</span></strong><small>${n?`${n}个映射知识点 · ${esc(b.edition_label)}`:'目录待取得'}</small></div>${pill(b)}</a>`;}).join('')}</article>`).join('')}</div></section><div class="notice"><strong>这是一份可使用、也在继续核对的学习地图。</strong> 目录已核对，不等于知识点、练习和先修关系已由教师审定。练习只提供局部线索，不把答对一题视为完整掌握。<a class="text-link" href="#sources">了解资料边界</a></div></div>`;
 }
 function bookOptions(){return '<option value="">全部概念</option>'+M.data.books.map(b=>`<option value="${b.id}">${b.title}${b.catalog_status==='pending'?' · 待补':b.catalog_status==='pdf_provisional'?' · 暂选':b.catalog_status==='external_outline'?' · 参考':''}</option>`).join('')+'<option value="unmapped">教材位置待核的基础概念</option>';}
 function renderMap(){
  const b=M.books[bookFilter];
  root.innerHTML=`<div class="map-wrap"><div class="page-heading"><div><div class="eyebrow">看见知识之间的连接</div><h1>知识图谱</h1><p>点击一个知识点，看看它从哪里来，又通向哪里。</p></div><div class="actions"><button id="scope-check" class="btn">当前范围小检查 ↗</button></div></div><div class="map-layout"><aside class="panel"><div class="filters"><label>选择册次<select id="book-filter">${bookOptions()}</select></label><label>选择单元<select id="unit-filter"><option value="">全部单元</option>${(b?.units||[]).map(u=>`<option value="${u.id}">${esc(u.title)}${u.topic_ids.length?'':' · 待拆分'}</option>`).join('')}</select></label><label>知识领域<select id="domain-filter"><option value="">全部领域</option>${['数与代数','图形与几何','统计与概率','综合与实践'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="filter-search">搜索知识点<input type="search" id="topic-search" placeholder="试试“乘法”“面积”“分类”" value="${esc(search)}"></label></div><div class="topic-count" id="topic-count"></div><div class="topic-list" id="topic-list"></div></aside><section class="panel"><div id="book-status" class="book-status"></div><div class="graph-head"><h2>先修 → 当前 → 后续</h2><label>回看 <select id="graph-depth" aria-label="先修显示层数"><option value="1">1层基础</option><option value="2">2层基础</option><option value="3">3层基础</option></select></label></div><div class="legend"><span>必要基础</span><span>辅助关系</span><span>灰色：教材位置待核</span></div><div class="graph-scroller" id="graph"></div><div class="graph-caption" id="graph-caption"></div></section><aside class="panel detail" id="topic-detail"></aside></div></div>`;
  document.getElementById('book-filter').value=bookFilter;
  document.getElementById('unit-filter').value=unitFilter;
  document.getElementById('domain-filter').value=domain;
  document.getElementById('graph-depth').value=String(depth);
  document.getElementById('book-filter').onchange=e=>{bookFilter=e.target.value;unitFilter='';search='';domain='';selected=M.topicsFor(bookFilter)[0]?.id||null;history.replaceState(null,'','#map'+(bookFilter?'?book='+bookFilter:''));renderMap();};
  document.getElementById('unit-filter').onchange=e=>{unitFilter=e.target.value;selected=M.topicsFor(bookFilter,unitFilter,search,domain)[0]?.id||null;updateList();updateGraph();};
  document.getElementById('domain-filter').onchange=e=>{domain=e.target.value;selected=M.topicsFor(bookFilter,unitFilter,search,domain)[0]?.id||null;updateList();updateGraph();};
  document.getElementById('topic-search').oninput=e=>{search=e.target.value;const list=M.topicsFor(bookFilter,unitFilter,search,domain);if(!list.some(t=>t.id===selected))selected=list[0]?.id||null;updateList();updateGraph();};
  document.getElementById('graph-depth').onchange=e=>{depth=Number(e.target.value);updateGraph();};
  document.getElementById('scope-check').onclick=()=>begin(M.topicsFor(bookFilter,unitFilter,search,domain).map(t=>t.id),true);
  document.getElementById('book-status').innerHTML=b?`${pill(b)} ${esc(b.title)} · ${esc(b.edition_label)}<br><small>${esc(catalogNote(b))}</small>`:'全图包含已映射的概念，以及教材位置尚待核定的基础概念。';
  updateList();updateGraph();
 }
 function updateList(){
  const list=M.topicsFor(bookFilter,unitFilter,search,domain);
  document.getElementById('topic-count').textContent=`${list.length}个知识点 · 落位为AI整理稿`;
  document.getElementById('scope-check').disabled=!list.some(t=>E.isTestable(M.graph,t.id));
  document.getElementById('topic-list').innerHTML=list.length?list.map(t=>`<button class="topic-item${t.id===selected?' selected':''}" data-topic="${t.id}">${esc(t.name)}<small>${esc(t.domain)} · ${t.question_count?`${t.question_count}道题`:'教材位置待核'}</small></button>`).join(''):'<div class="empty">这个范围尚无知识点。<br>换一册或清空搜索试试。</div>';
 }
 function selectTopic(id){if(!M.graph.byId[id])return;selected=id;history.replaceState(null,'','#map?'+new URLSearchParams({...(bookFilter?{book:bookFilter}:{}),id}));updateList();updateGraph();}
 function updateGraph(){
  const graphBox=document.getElementById('graph'),detail=document.getElementById('topic-detail');
  const t=M.graph.byId[selected];
  if(!t){graphBox.innerHTML='<div class="empty">等待这一册的目录和知识点。</div>';detail.innerHTML='<div class="empty">选择一个知识点，查看学习线索。</div>';document.getElementById('graph-caption').textContent='目录缺口见“版本与来源”。';return;}
  const ids=new Set([t.id]);let front=[t.id];
  for(let l=0;l<depth;l++){const next=[];for(const id of front)for(const p of M.graph.prereqs[id])if(!ids.has(p.id)){ids.add(p.id);next.push(p.id);}front=next;}
  M.graph.dependents[t.id].slice(0,10).forEach(d=>ids.add(d.id));
  const ordered=E.topoSort(M.graph,ids),layer={},rows=[];
  ordered.forEach(id=>{layer[id]=Math.max(0,...M.graph.prereqs[id].filter(p=>ids.has(p.id)).map(p=>layer[p.id]+1));(rows[layer[id]]||=[]).push(id);});
  const width=Math.max(540,rows.length*205+40),height=Math.max(360,...rows.map(r=>r.length*83+50));
  const pos={};rows.forEach((row,l)=>row.forEach((id,i)=>pos[id]={x:25+l*205,y:25+i*83+(height-50-row.length*83)/2}));
  const edges=M.data.dependencies.filter(d=>ids.has(d.topicId)&&ids.has(d.prerequisiteId));
  graphBox.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${esc(t.name)}的局部先修关系图"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#9bad8b"/></marker></defs>${edges.map(d=>{const a=pos[d.prerequisiteId],b=pos[d.topicId];return `<path d="M${a.x+165},${a.y+28} C${a.x+190},${a.y+28} ${b.x-25},${b.y+28} ${b.x},${b.y+28}" fill="none" stroke="#a8b798" stroke-width="1.4" ${d.strength==='soft'?'stroke-dasharray="4 4"':''} marker-end="url(#arrow)"><title>${esc(d.reason)}</title></path>`;}).join('')}${ordered.map(id=>{const n=M.graph.byId[id],p=pos[id],active=id===selected,mapped=M.placements[id]?.length;const fill=active?'#173f38':mapped?'#fffef8':'#eaede5',ink=active?'#fffef8':'#314d3e';const chars=Array.from(n.name);return `<g role="button" tabindex="0" data-topic="${id}" aria-label="查看${esc(n.name)}"><title>${esc(n.name)} — ${esc(M.label(id))}</title><rect x="${p.x}" y="${p.y}" width="165" height="57" rx="10" fill="${fill}" stroke="${active?'#173f38':'#bac9aa'}"/><text x="${p.x+82.5}" y="${p.y+21}" text-anchor="middle" fill="${ink}" font-size="11.5" font-family="system-ui"><tspan x="${p.x+82.5}">${esc(chars.slice(0,12).join(''))}</tspan><tspan x="${p.x+82.5}" dy="18" font-size="${chars.length>12?'11':'9'}">${chars.length>12?esc(chars.slice(12,25).join('')):mapped?esc(M.books[M.placements[id][0].bookId].title):'教材位置待核'}</tspan></text></g>`;}).join('')}</svg>`;
  document.getElementById('graph-caption').textContent=`显示${ordered.length}个关联概念 · 向前${depth}层，向后最多10个直接关联 · 可横向滚动，点击节点继续探索。`;
  const ps=M.placements[t.id]||[],stdById=Object.fromEntries((M.data.standards.items||[]).map(s=>[s.id,s]));
  detail.innerHTML=`<div class="panel-padding"><span class="pill">${esc(t.domain)}</span><h2>${esc(t.name)}</h2><div class="location">${ps.length?ps.map(p=>`${esc(M.books[p.bookId].title)}${M.books[p.bookId].catalog_status==='pdf_provisional'?'（暂选）':''} · ${esc(M.units[p.unitId].title)}${M.units[p.unitId].printed_page?' · 单元始于第'+M.units[p.unitId].printed_page+'页':''}`).join('<br>'):'苏教教材位置待核，保留作基础概念参考。'}<br>落位：按单元主题推断，待逐节核定。</div><h3>这一步要理解什么</h3><p>${esc(t.description)}</p><h3>可以这样检查自己</h3><ul>${t.mastery_criteria.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><button class="btn primary" data-start="${t.id}" ${E.isTestable(M.graph,t.id)?'':'disabled'}>${E.isTestable(M.graph,t.id)?'练这个知识点 ↗':'教材位置待核，暂不出题'}</button><h3>先用到哪些基础</h3>${M.graph.prereqs[t.id].map(p=>`<button class="neighbor" data-topic="${p.id}">${esc(M.graph.byId[p.id].name)} <small>${p.strength==='hard'?'必要基础':'辅助关系'} · ${esc(p.reason)}</small></button>`).join('')||'<p class="muted">从直观数数和实物经验开始。</p>'}<details class="standard"><summary>课标参考与资料状态</summary><p>拆分、先修和题库均为AI整理稿，未经教师审核。</p>${(t.standards||[]).map(s=>`<p>${esc(s.id)} · ${s.confidence==='exact'?'原项目直接映射':'原项目推断映射'}<br>${esc(stdById[s.id]?.text||'')}<br>小学条文未与教育部PDF逐页核对。</p>`).join('')||'<p>新拆分概念尚未单独挂接课标条目。</p>'}</details></div>`;
 }
 function answerText(q){return q.type==='choice'?(q.choices.find(c=>c.key===q.answer)?.text||q.answer):q.answer;}
 function renderPractice(){
  if(!session&&(cloud.state.mode!=='cloud'||!cloud.state.me||!cloud.state.child||cloud.state.family?.role==='VIEWER'||cloud.state.child.archived)){root.innerHTML=`<div class="practice-wrap"><div class="page-heading"><div><div class="eyebrow">为每个孩子留下独立的学习过程</div><h1>从家庭和孩子开始</h1><p>云端是长期记录的统一来源。登录并选择可记录的孩子后，再开始练习。</p></div></div><section class="panel practice-intro"><h2>${cloud.state.mode==='static'?'当前仅浏览教材':'准备好再慢慢来'}</h2><p>每个知识点最多2题。本题直接答对、需要再试和未观察分别保留；推断跳过的基础不会变成长期掌握。</p><div><a class="btn primary" href="#family">家庭管理 / 选择孩子 →</a> <a class="btn" href="#activities">看看亲子活动</a></div></section></div>`;return;}
  if(!session){root.innerHTML=`<div class="practice-wrap"><div class="page-heading"><div><div class="eyebrow">先从一小步开始</div><h1>练习与学习线索</h1><p>每个知识点最多2题。两题都没做对，再回看相关基础。</p></div></div><div class="panel practice-intro"><h2>想从哪里开始？</h2><p class="muted">先选正在学的知识点，也可以试试下面几个。每一轮练习独立保存在当前孩子的云端历史；也可导出留存。</p><div class="sample-row"><button data-start="cnm_p020">一下 · 9加几</button><button data-start="sj013">二下 · 两位数乘一位数</button><button data-start="cnm_p089">四上 · 长方形的面积</button><button data-start="cnm_p158">五上 · 最大公因数</button><button data-start="cnm_p145">五下 · 解方程</button><button data-start="sj024">六上 · 分段计费</button><button data-start="cnm_p209">六下 · 圆锥体积</button></div><div><a class="btn primary" href="#map">到教材里选一个知识点 ↗</a></div><p class="muted" style="font-size:12px">题库与先修关系未经教师审核。练习结果用于选择复习起点，不能据此判断完整掌握或学习能力。</p></div></div>`;return;}
  const item=E.nextItem(M.graph,session);
  if(!item&&!feedback){renderResults(false);return;}
  const shown=feedback?.item||item,q=shown.question,t=M.graph.byId[shown.topicId],n=session.answers.length+(feedback?0:1);
  root.innerHTML=`<div class="practice-wrap"><div class="page-heading"><div><div class="eyebrow">给思考一点时间</div><h1>${session.mode==='screen'?'范围小检查':'顺着基础，慢慢来'}</h1><p>${session.mode==='screen'?'本次只检查所选范围，不向范围外追问。最多12题，未测部分单独保留。':'第一题答对时会跳过相关基础；第二题答对标为不稳，两题都错才回看基础。'}</p></div></div>${sessionContext()}<section class="panel question-card"><div class="question-meta"><span>第${n}题 / 最多${session.limit}题</span><span>这个知识点的第${shown.attempt}题</span></div><div class="progress"><span style="width:${Math.min(100,session.answers.length/session.limit*100)}%"></span></div><div class="question-topic">${esc(t.name)} · ${esc(t.grade?cn[t.grade]+'年级'+t.semester+'册':'教材位置待核')}</div><h2>${esc(q.prompt)}</h2>${feedback?feedbackHTML(feedback):`<form id="answer-form">${q.type==='choice'?`<fieldset><legend>选择答案</legend>${q.choices.map(c=>`<label class="choice"><input type="radio" name="answer" value="${c.key}" required><span>${c.key} · ${esc(c.text)}</span></label>`).join('')}</fieldset>`:`<div class="answer-field"><label for="answer-input">写下答案（分数可写成 1/2）</label><input id="answer-input" name="answer" autocomplete="off" required placeholder="在这里作答"></div>`}<div class="actions"><button class="btn primary" type="submit">提交答案 →</button><button class="btn subtle" type="button" id="skip-answer">暂时不会</button></div></form>`}</section><div class="session-toolbar"><span data-save-notice>${esc(cloud.state.notice)}</span><div><button id="finish-session">先看本次线索</button><button id="export-session">导出记录</button></div></div></div>`;
  if(!feedback){
   document.getElementById('answer-form').onsubmit=e=>{e.preventDefault();const text=new FormData(e.target).get('answer');if(!String(text||'').trim())return;const verdict=E.judgeQuestion(q,text);if(verdict.verdict==='manual'){feedback={item:shown,result:'manual',text:String(text)};renderPractice();}else commit(shown,verdict.verdict,String(text));};
   document.getElementById('skip-answer').onclick=()=>commit(shown,'skip','');
  }
  document.getElementById('finish-session').onclick=()=>{feedback=null;renderResults(true);};
  document.getElementById('export-session').onclick=exportSession;
 }
 function feedbackHTML(f){
  const q=f.item.question;
  if(f.result==='manual')return `<div class="feedback wrong"><strong>请对照参考答案</strong><p>你的写法暂时无法可靠自动判断。</p><p class="reference">参考：${esc(answerText(q))}<br>${esc(q.explanation)}</p><div class="actions"><button class="btn primary" data-manual="correct">我的答案意思相同</button><button class="btn" data-manual="wrong">需要再练</button></div></div>`;
  return `<div class="feedback${f.result==='correct'?'':' wrong'}" role="status"><strong>${f.result==='correct'?'这一步，做对了。':f.result==='skip'?'一起看看这一步。':'再看一下这里。'}</strong><p class="reference">参考答案：${esc(answerText(q))}</p><p>${esc(q.explanation||'可以用数量、图形或逆运算再检查一次。')}</p><div class="actions"><button class="btn primary" id="next-question">${E.nextItem(M.graph,session)?'继续下一步 →':'查看本次线索 →'}</button></div></div>`;
 }
 function commit(item,result,text){session=E.applyAnswer(M.graph,session,item.topicId,result,{text});feedback={item,result,text};save(!E.nextItem(M.graph,session));renderPractice();}
 function renderResults(early){
  const s=M.summary(session),notComplete=!!E.nextItem(M.graph,session),direct=session.answers.length;
  root.innerHTML=`<div class="practice-wrap"><div class="page-heading"><div><div class="eyebrow">找到下一步就很好</div><h1>本次练习线索</h1><p>${notComplete?'本次尚未结束，可以继续练习。':s.limitReached?'已达到题量上限，仍有未测知识点。':'本次出题已结束。'}</p></div></div>${sessionContext()}<section class="panel results"><h2>${s.path.length?'先把这些连接补起来':'把这次的思考留下来'}</h2><p class="muted" style="font-size:13px;margin-top:10px">共作答${direct}题。结果依据这几道题和暂定先修关系推断，不代表整册掌握程度。</p><div class="result-stats"><div><strong>${s.directMastered.length}</strong><span>本题直接答对</span></div><div><strong>${s.shaky.length}</strong><span>第二题通过 · 不稳</span></div><div><strong>${s.weak.length-s.unconfirmed.length}</strong><span>两题未通过</span></div><div><strong>${s.untested.length+s.unconfirmed.length}</strong><span>未测或待确认</span></div></div>${s.unconfirmed.length?`<div class="result-note">${s.unconfirmed.length}个点只做了第一题，未完成第二题，暂不归为已确认的薄弱点。</div>`:''}${s.inferredMastered.length?`<p class="muted" style="font-size:12px">另有${s.inferredMastered.length}个基础概念在本轮被暂时跳过；它们尚未直接观察，不计入长期掌握。</p>`:''}${s.unmappedPrerequisites.length?`<div class="result-note">这条路径包含${s.unmappedPrerequisites.length}个教材位置尚待核定的基础概念，不会将它们按原人教版册次出题。资料缺口也可能影响回溯结果。</div>`:''}<h3 style="margin-top:25px">建议回看的顺序</h3>${s.path.length?s.path.map((p,i)=>`<div class="path-step"><span>${i+1}</span><div><a href="#map?id=${p.id}">${esc(M.graph.byId[p.id].name)}</a><small>${esc(M.label(p.id))} · ${s.unconfirmed.includes(p.id)?'待确认':p.status==='weak'?'需要再练':p.status==='shaky'?'不太稳定':'尚未检查'}</small></div></div>`).join(''):'<div class="empty">本次没有足够证据生成补习路径。答对所选题，也不代表相关知识已经全面掌握。</div>'}<div class="actions">${notComplete?'<button class="btn primary" id="resume-session">继续练习 →</button>':'<button class="btn primary" id="retry-session">再练一轮 →</button>'}<button class="btn" id="export-session">导出记录</button><button class="btn" id="print-result">打印</button><button class="btn subtle" id="clear-session">结束并选新知识点</button></div><div class="answer-log"><h3>回看作答记录</h3>${session.answers.map((a,i)=>{const q=E.questionById(M.graph,a.qid);return `<details><summary>${i+1}. ${esc(M.graph.byId[a.id].name)} · ${a.result==='correct'?'答对':a.result==='skip'?'暂时不会':'未答对'}</summary><p>${esc(q?.prompt)}<br>你的答案：${esc(a.text||'暂时不会')}<br>参考：${esc(q?answerText(q):'')}<br>${esc(q?.explanation)}</p></details>`;}).join('')}</div></section></div>`;
  document.getElementById('resume-session')?.addEventListener('click',()=>{feedback=null;renderPractice();});
  document.getElementById('retry-session')?.addEventListener('click',()=>begin(session.targets,session.mode==='screen'));
  document.getElementById('export-session').onclick=exportSession;
  document.getElementById('print-result').onclick=()=>window.print();
  document.getElementById('clear-session').onclick=async()=>{await save(true);try{await cloud.clear();session=null;feedback=null;renderPractice();}catch(e){toast(e.message);}};
 }
 function exportSession(){
  if(!session)return;
  const blob=new Blob([JSON.stringify({...M.snapshot(session),summary:M.summary(session)},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='苏州数学练习记录-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前练习记录。');
 }
 function sources(){
  const c=M.data.meta.counts;
  root.innerHTML=`<div class="wrap"><div class="page-heading"><div><div class="eyebrow">知道地图是怎样画出来的</div><h1>版本、来源与核对范围</h1><p>核对时点：${esc(M.data.meta.as_of)}。目录证据、教材选择、知识点映射和题库审核分别标注。</p></div></div>
  <section class="panel source-card"><h2>当前采用的教材</h2><p>按现有十二册苏教教材组织：四至六下采用现用2013系列，四上116页扫描本暂选。${c.pdf_catalogs}册目录已与所列PDF核对，${c.provisional_catalogs}册为暂选目录抽查，${c.pending_catalogs}册目录待补。教材系列、课标年份、版权版次和资源学期标签分开记录。</p><p>六上按120页双页扫描件的“放大与缩小”组织；官网正式版为“比例尺”，两种目录的差异保留在下表。四、五下与官网过渡本目录的差异也保留，不自动替换当前选用文件。教材PDF留在原知识库，不随程序分发。未取得覆盖所有学校的逐校配书清单。</p>
  <div class="table-scroll"><table class="source-table"><thead><tr><th>册次</th><th>目录状态</th><th>证据与限制</th><th>映射</th></tr></thead><tbody>${M.data.books.map(b=>`<tr><td>${b.title}<br><small>${esc(b.edition_label)}<br>${esc(b.series)}</small></td><td>${pill(b)}<br>${b.toc_pdf_page?(b.catalog_status==='official_checked'?'官网目录：第':'目录：PDF第')+b.toc_pdf_page+'页':''}</td><td>${b.evidence?.filename?`${esc(b.evidence.filename)} · ${b.evidence.pages}页<br><small>SHA-256：<code>${esc(b.evidence.sha256)}</code></small>`:'目录文件待补'}${b.evidence?.official_reader?`<br><a href="${esc(b.evidence.official_reader)}" target="_blank" rel="noopener">国家平台版本对照</a>`:''}${b.evidence?.version_evidence?'<br><small>'+esc(b.evidence.version_evidence)+'</small>':''}${b.evidence?.official_comparison?'<p>'+esc(b.evidence.official_comparison)+'</p>':''}${b.evidence?.quality_note?'<br><small>'+esc(b.evidence.quality_note)+'</small>':''}</td><td>${M.topicsFor(b.id).length}个知识点<br><small>${b.units.filter(u=>!u.topic_ids.length).length}个单元/活动待细化</small></td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel source-card"><h2>哪些已经核对，哪些还没有</h2><ul>${M.data.meta.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>“目录已核”只指目录文字与所列教材对照；四上“暂选”不因目录相符变为正式版本认证。单个知识点目前只映射到单元主题，页码是单元开始页。空单元和综合复习保留待拆分，不把目录齐全写成知识点全覆盖。</p><p>全图保留${c.concepts-c.mapped_concepts}个未落册的基础概念，显示可能的先修缺口。这些概念暂不出题；不按人教版原册次补齐当前混合版次教材中的空缺。</p></section>
  <section class="panel source-card"><h2>原项目与改编</h2><p>图谱基础、课标参考和自适应诊断引擎来自 <a href="https://github.com/xiaoyang111222/cn-math-taxonomy" target="_blank" rel="noopener">xiaoyang111222 / cn-math-taxonomy</a>，使用快照 <code>10a0f562</code>，遵循 <a href="LICENSE">CC BY-NC 4.0</a>。保留原始小学概念ID，苏教补充概念采用sj前缀。重建教材目录、落册关系、界面与部分先修关系；重写${c.rewritten_questions}道概念练习，其余${c.questions-c.rewritten_questions}道复用原项目练习稿。</p><p>原项目和本改编均未经教师审核。云端学习记录按家庭、孩子和记录成员保存；本机仅作资料浏览。旧版浏览器记录可导出并经预览导入。历史保留当时内容快照，数据变化时不会直接混入新题库。</p></section></div>`;
 }
 function render(){
  const [route,qs='']=(location.hash.slice(1)||'home').split('?'),params=new URLSearchParams(qs);
  document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===route;a.classList.toggle('active',active);active?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current');});
  if(cloudUI.renderRoute(route,params)){document.title=({'family':'家庭与孩子','activities':'亲子数学','history':'学习历史','invite':'接受邀请'}[route])+' · 小学数学';return;}
  if(route==='map'){
   if(params.has('book')&&(M.books[params.get('book')]||['','unmapped'].includes(params.get('book')))){bookFilter=params.get('book');unitFilter='';search='';domain='';selected=M.topicsFor(bookFilter)[0]?.id||null;}
   if(params.has('id')&&M.graph.byId[params.get('id')]){selected=params.get('id');if(!params.has('book')){bookFilter=M.placements[selected]?.[0]?.bookId||'unmapped';unitFilter='';search='';domain='';}}
   renderMap();
  }else if(route==='practice')renderPractice();else if(route==='sources')sources();else home();
  document.title=({'map':'知识图谱','practice':'练习与记录','sources':'版本与来源'}[route]||'教材地图')+' · 苏州小学数学';
 }
 root.addEventListener('click',e=>{
  const topic=e.target.closest('[data-topic]');if(topic){selectTopic(topic.dataset.topic);return;}
  const start=e.target.closest('[data-start]');if(start){begin([start.dataset.start]);return;}
  const manual=e.target.closest('[data-manual]');if(manual&&feedback?.result==='manual'){commit(feedback.item,manual.dataset.manual,feedback.text);return;}
  if(e.target.closest('#next-question')){feedback=null;renderPractice();}
 });
 root.addEventListener('keydown',e=>{const node=e.target.closest('g[data-topic]');if(node&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectTopic(node.dataset.topic);}});
 try{
  const names=['meta','topics','dependencies','questions','books','placements','cn-curriculum-standards'];
  // Avoid request bursts through the remote proxy; publish the dataset only after all files load.
  const all=[];
  for(const n of names){
   const r=await fetch('data/'+n+'.json');
   if(!r.ok){console.error('Math data load failed',n,r.url,r.status);throw Error('读取'+({'meta':'资料说明','topics':'知识点','dependencies':'先修关系','questions':'题库','books':'教材目录','placements':'教材映射','cn-curriculum-standards':'课标参考'}[n])+'失败（HTTP '+r.status+'）');}
   all.push(await r.json());
  }
  const data=Object.fromEntries(names.map((n,i)=>[n==='cn-curriculum-standards'?'standards':n,all[i]]));M=SuzhouMath.create(data);
  // 旧浏览器记录保持原样，只提供显式导出和带目标孩子的预览导入。
  cloudUI.renderBar();
  await cloud.init();
  window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});render();
 }catch(e){root.innerHTML=`<div class="wrap"><div class="notice"><strong>地图暂时未能加载。</strong><p>${esc(e.message)}。${/^(127\.0\.0\.1|localhost)$/.test(location.hostname)?'请使用项目里的“启动.command”打开本地服务，勿直接双击HTML。':'请检查网络和服务状态后重试。'}</p><button onclick="location.reload()">重新加载</button></div></div>`;}
})();
