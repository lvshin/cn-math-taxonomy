/* 家长操作的亲子活动入口；家庭/孩子复用云端，活动记录使用独立命名空间。 */
(()=>{
 'use strict';
 const P=PreschoolActivities,root=document.getElementById('content'),bar=document.getElementById('family-context'),draftBar=document.getElementById('draft-status');
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const copy=value=>JSON.parse(JSON.stringify(value)),list=value=>Array.isArray(value)?value:[],roles={OWNER:'家庭管理员',EDITOR:'记录成员',VIEWER:'只读成员'};
 const base='/edu/math/',loginPath='oauth2/authorization/learning?module=preschool',restorePath='oauth2/authorization/learning?restore=1&module=preschool';
 let capabilities={},catalog=null,catalogError='',routeSeq=0,historyPage=null,filter='',query='',toastTimer;
 const cloud=LearningCloud.create({base:base+'api/v1/',fetcher:async(path,opts)=>{
  const response=await fetch(path,opts);
  if(!path.endsWith('/capabilities')||!response.ok)return response;
  capabilities=await response.json();
  // 数学会话恢复的默认回跳不适用于本入口；这里只接受后端固定的幼儿园回跳。
  const adjusted={...capabilities,loginUrl:base+loginPath,sessionRestoreUrl:null};
  return {ok:true,status:response.status,json:async()=>adjusted};
 }}),s=cloud.state;
 function toast(message){const node=document.getElementById('toast');node.textContent=message;node.className='visible';clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.className='',6000);}
 const date=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'时间待确认':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);};
 function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 const drafts=P.createDrafts({request:cloud.request,uuid:cloud.uuid,onChange(){renderDraftBar();renderRecordPanel();}});
 function canSaveDraft(draft=drafts.get()){
  return !!draft&&capabilities.preschool===true&&s.mode==='cloud'&&s.me&&s.me.id===draft.ctx.actorId&&s.family?.id===draft.ctx.familyId&&s.family.role!=='VIEWER'&&s.children.some(child=>child.id===draft.ctx.childId&&!child.archived);
 }
 function frame(title,description,html){root.innerHTML=`<section class="page-heading"><p class="eyebrow">幼儿园 · 亲子活动</p><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p></section>${html}`;}
 function notice(message){return `<div class="notice">${esc(message)}</div>`;}
 function signin(text='使用统一账号登录',newTab=false){return `<a class="btn primary" href="${base+loginPath}"${newTab?' target="_blank" rel="noopener"':''}>${esc(text)} →</a>`;}
 function familyLink(){return '<a href="/edu/math/#family" class="btn">家庭与孩子管理 ↗</a>';}
 function sourceLink(url,label){try{const parsed=new URL(url);if(parsed.protocol!=='https:')return esc(label);return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;}catch{return esc(label);}}
 function renderBar(){
  let html;
  if(s.mode==='loading')html='<p role="status">正在连接家庭服务…</p>';
  else if(s.mode==='static')html='<p>当前为活动浏览模式。云端登录后可按孩子保存记录。</p>';
  else if(s.mode==='unavailable')html='<p>家庭服务暂时无法连接，活动仍可浏览。</p><button id="retry-cloud">重试连接</button>';
  else if(!s.me)html=`<p>和小学数学共用家庭与孩子档案，活动记录单独保存。</p>${signin()}`;
  else html=`<div class="context-selectors"><div><span class="field-caption">家庭</span><strong>${esc(s.family?.name||'尚未加入家庭')}</strong>${s.family?`<small>${esc(roles[s.family.role]||'家庭成员')}</small>`:''}</div><label>孩子<select id="context-child" aria-label="当前孩子">${s.children.length?s.children.map(child=>`<option value="${esc(child.id)}"${child.id===s.child?.id?' selected':''}>${esc(child.nickname)}${child.archived?'（已归档）':''}</option>`).join(''):'<option value="">尚无孩子档案</option>'}</select></label></div><div class="context-account"><span>${esc(s.me.name)}</span><a href="/edu/math/#family">家庭管理 ↗</a><button id="logout">退出登录</button></div>`;
  bar.innerHTML=`<div class="context-inner">${html}</div>`;
  document.getElementById('context-child')?.addEventListener('change',event=>cloud.selectChild(event.target.value));
  document.getElementById('retry-cloud')?.addEventListener('click',()=>act(async()=>{await cloud.init();route();}));
  document.getElementById('logout')?.addEventListener('click',()=>act(async()=>{
   if(drafts.get())throw Error('还有一份活动草稿，请先保存或导出后放弃，再退出登录。');
   const csrf=await cloud.request('csrf'),form=document.createElement('form'),input=document.createElement('input');form.method='POST';form.action=base+'logout';input.type='hidden';input.name=csrf.parameterName||'_csrf';input.value=csrf.token;form.append(input);document.body.append(form);form.submit();
  }));renderDraftBar();
 }
 async function act(fn){try{await fn();}catch(error){toast(error.message||'这一步暂时未完成，请重试。');}}
 function renderDraftBar(){
  const d=drafts.get();if(!d){draftBar.innerHTML='';return;}
  const blocked=!canSaveDraft(d),saving=d.status==='saving';
  draftBar.innerHTML=`<div class="draft-banner"><div><strong>${esc(d.ctx.childName)}的${d.correctionOf?'更正':'活动'}草稿 · ${esc(d.activity.title)}</strong><p>${esc(saving?'正在保存，请稍候…':d.status==='pending'?'尚未确认保存。首次提交内容已保留，请重试原记录。':'草稿只留在本页，请在关闭前保存或导出。')}${!P.sameContext(d.ctx,P.readContext(s))?' 当前选择已切换，草稿仍属于原来的孩子。':''}</p>${d.error?`<p class="error">${esc(d.error)}</p>`:''}${blocked?'<p>原档案目前不可记录；请核对登录、成员权限和档案状态。草稿仍保留。</p>':''}</div><div class="actions"><a class="btn" href="#draft">回到草稿</a>${d.body?`<button id="retry-draft" class="primary"${saving||blocked?' disabled':''}>${saving?'正在保存…':'重试保存'}</button>`:''}<button id="export-draft">导出草稿</button><button id="discard-draft"${saving?' disabled':''}>放弃草稿</button></div>${!s.me?signin('重新登录后返回本页',true)+'<button id="refresh-draft-auth">已登录，重新连接</button>':''}</div>`;
  document.getElementById('retry-draft')?.addEventListener('click',()=>act(saveDraft));
  document.getElementById('export-draft')?.addEventListener('click',()=>download(drafts.export(),'幼儿园活动-待保存草稿.json'));
  document.getElementById('discard-draft')?.addEventListener('click',()=>{if(window.confirm('放弃这份尚未确认保存的草稿？如提交时断网，云端可能已经收到，请先重试或核对原孩子历史。')){drafts.discard();route();}});
  document.getElementById('refresh-draft-auth')?.addEventListener('click',()=>act(async()=>{await cloud.init();route();}));
 }
 function ul(items,ordered=false){const tag=ordered?'ol':'ul';return `<${tag}>${list(items).map(item=>`<li>${esc(item)}</li>`).join('')}</${tag}>`;}
 function sources(activity){
  const game=activity.sourceGame||{},episodes=list(activity.episodes);
  return `<details class="sources"><summary>活动灵感与剧集线索</summary><p>${esc(activity.adaptation||'家庭活动改编')}。玩法与提示为家庭改编，动画及原始游戏权利归各自权利人。</p>${game.url?`<p>游戏来源：${sourceLink(game.url,game.name||game.chineseName||'原始游戏')} ${game.chineseName?`<span class="muted">（${esc(game.chineseName)}${game.chineseNameStatus==='working-translation'?'，工作译名':''}）</span>`:''}</p>${game.summary?`<p class="muted">原始游戏线索：${esc(game.summary)}</p>`:''}`:''}${episodes.length?`<ul>${episodes.map(episode=>`<li>${sourceLink(episode.url,episode.title||episode.englishTitle||episode.id)}${episode.englishTitle?` · ${esc(episode.englishTitle)}`:''}${episode.titleSource?` <small>标题来源：${esc(episode.titleSource)}</small>`:''}</li>`).join('')}</ul>`:`<p>${esc(activity.episodeNote||'不依赖观看动画，也可以直接开展活动。')}</p>`}<p class="muted">本页提供活动提示与来源链接，不提供动画视频或剧照。活动版本：${esc(activity.version)}</p></details>`;
 }
 function activityBody(activity,{historical=false}={}){
  return `<article class="panel activity-detail printable"><div class="activity-meta"><span class="pill">${esc(activity.domain)}</span><span>${esc(activity.duration||'按孩子的兴致进行')}</span><span>${esc(activity.setting||'按场地调整')}</span></div>${historical?`<h2>${esc(activity.title)}</h2><p>${esc(activity.summary||'')}</p>`:''}<section><h2>准备什么</h2>${ul(activity.materials)}</section><section><h2>一起怎么玩</h2>${ul(activity.steps,true)}</section><section class="prompt-box"><h2>家长可以这样说</h2>${ul(activity.parentPrompts)}</section><section><h2>留意这些小片段</h2>${ul(activity.observe)}<p class="muted">只观察这一次的参与过程，给自己尝试、拒绝、求助和暂停留出空间。</p></section><div class="variations"><section><h3>简单一点</h3><p>${esc(activity.easier)}</p></section><section><h3>换个玩法</h3><p>${esc(activity.variation)}</p></section></div>${activity.safety?`<section class="safety"><h3>开始前看一眼</h3>${Array.isArray(activity.safety)?ul(activity.safety):`<p>${esc(activity.safety)}</p>`}</section>`:''}${sources(activity)}</article>`;
 }
 function renderActivities(){
  if(!catalog){frame('一起玩点什么？','先挑一个今天愿意尝试的小活动。',notice(catalogError||'正在加载活动…')+(catalogError?'<button id="retry-catalog">重新加载活动</button>':''));document.getElementById('retry-catalog')?.addEventListener('click',()=>act(loadCatalog));return;}
  const themes=list(catalog.themes),cards=list(catalog.activities).filter(activity=>(!filter||activity.themeId===filter)&&(!query||(activity.title+' '+activity.summary+' '+activity.domain).includes(query)));
  frame('把日常，变成一起玩的时间',catalog.intro||'从布鲁伊的游戏得到灵感。家长挑活动，孩子在线下体验；喜欢就多玩几次，也可以随时暂停。',`<div class="intro-strip"><span>${catalog.activities.length}个亲子活动</span><span>${themes.length}个主题</span><span>运动 · 表达 · 合作 · 创造</span></div><section class="activity-filters" aria-label="筛选活动"><label>按主题<select id="theme-filter"><option value="">全部主题</option>${themes.map(theme=>`<option value="${esc(theme.id)}"${theme.id===filter?' selected':''}>${esc(theme.name)}</option>`).join('')}</select></label><label class="search-label">找一个感兴趣的玩法<input id="activity-search" type="search" maxlength="80" value="${esc(query)}" placeholder="试试：合作、想象、户外"></label></section>${filter?`<p class="filter-description muted">${esc(themes.find(theme=>theme.id===filter)?.description||'')}</p>`:''}<section class="activity-grid" aria-label="亲子活动列表">${cards.length?cards.map((activity,i)=>`<article class="activity-card tone-${i%4}"><span class="pill">${esc(activity.domain)}</span><h2><a href="#activity?id=${encodeURIComponent(activity.id)}">${esc(activity.title)}</a></h2><p>${esc(activity.summary||'一起体验，留下本次过程。')}</p><p class="card-meta">${esc(activity.duration||'时间可灵活调整')} · ${esc(activity.setting||'按场地调整')}</p><a href="#activity?id=${encodeURIComponent(activity.id)}" class="card-link" aria-label="打开${esc(activity.title)}">打开活动卡 <span aria-hidden="true">→</span></a></article>`).join(''):'<div class="empty"><h2>换个关键词试试</h2><p>也可以选择“全部主题”，看看其他玩法。</p></div>'}</section><section class="gentle-note"><h2>一起参与，比完成一张卡更重要</h2><p>先听孩子怎么想，再给一句提示。一次小尝试、一段新说法，都可以留作家长回看的片段。</p>${catalog.notice?`<p class="content-notice">${esc(catalog.notice)}</p>`:''}</section>`);
  document.getElementById('theme-filter').addEventListener('change',event=>{filter=event.target.value;renderActivities();});
  document.getElementById('activity-search').addEventListener('change',event=>{query=event.target.value.trim();renderActivities();});
 }
 function renderActivity(id){
  const activity=catalog?.activities.find(card=>card.id===id);if(!activity){frame('这张活动卡暂时无法打开','可以返回活动库重新选择。','<a class="btn" href="#activities">返回活动库</a>');return;}
  frame(activity.title,activity.summary||'一起体验，也可以随时简化或暂停。',`<div class="actions page-actions"><a class="btn" href="#activities">← 返回活动库</a><button id="print-activity">打印活动卡</button></div>${activityBody(activity)}<section id="record-panel" class="panel record-panel"></section>`);
  document.getElementById('print-activity').addEventListener('click',()=>window.print());renderRecordPanel(activity);
 }
 function renderRecordPanel(provided){
  const node=document.getElementById('record-panel');if(!node)return;
  const d=drafts.get(),activity=provided||catalog?.activities.find(card=>card.id===new URLSearchParams((location.hash.split('?')[1]||'')).get('id'));
  if(d){
   const saving=d.status==='saving',frozen=!!d.body,canSave=canSaveDraft(d);
   node.innerHTML=`<p class="eyebrow">${d.correctionOf?'追加更正 · 原记录保留':'家长留下一个片段'}</p><h2>${esc(d.activity.title)}</h2><p class="record-target">记录给 <strong>${esc(d.ctx.familyName)} / ${esc(d.ctx.childName)}</strong></p>${!P.sameContext(d.ctx,P.readContext(s))?notice('当前选择已切换。这份草稿仍记给上方孩子；保存后才能开始另一份记录。'):''}<form id="observation-form"><fieldset${frozen?' disabled':''}><legend>这次怎样参与？</legend><div class="outcome-options">${Object.entries(P.OUTCOMES).map(([value,label])=>`<label><input type="radio" name="outcome" value="${value}"${d.outcome===value?' checked':''} required> ${label}</label>`).join('')}</div><label class="note-label">一句观察（可选）<textarea name="note" rows="4" maxlength="2000" placeholder="例如：自己提出轮流当店长，还帮我画了一张菜单。">${esc(d.note||'')}</textarea></label></fieldset><p class="muted">只记看见、听见的过程。没有尝试和中途暂停，也可以如实留下。</p><button type="submit" class="primary"${saving||!canSave?' disabled':''}>${saving?'正在保存…':frozen?'重试保存原记录':d.correctionOf?'保存这次更正':'保存活动记录'}</button><p id="save-status" role="status">${esc(d.error||(frozen?'首次提交内容已固定，重试不会新增第二条。':'草稿尚未保存到云端。'))}</p>${!canSave?'<p class="error">原档案目前不可记录。请核对登录、成员权限和档案状态。</p>':''}</form>`;
   const form=document.getElementById('observation-form');form.addEventListener('input',()=>{if(!drafts.get()?.body){const values=new FormData(form);drafts.update({outcome:values.get('outcome')||'',note:values.get('note')||''});}});
   form.addEventListener('submit',event=>{event.preventDefault();if(!drafts.get()?.body){const values=new FormData(form);drafts.update({outcome:values.get('outcome')||'',note:values.get('note')||''});}act(saveDraft);});return;
  }
  node.innerHTML=`<h2>留下本次活动记录</h2><p>游戏结束后再由家长填写。可以只选参与情况，也可以写一句具体观察。</p>${capabilities.preschool===true&&P.canWrite(s)&&activity?`<p>当前档案：<strong>${esc(s.family.name)} / ${esc(s.child.nickname)}</strong></p><button id="begin-record" class="primary">开始本次记录</button>`:s.mode==='cloud'&&!s.me?signin():`<p>${esc(s.family?.role==='VIEWER'?'你是只读成员，可以查看活动记录。':s.child?.archived?'当前孩子档案已归档，历史仍保留。':s.me&&capabilities.preschool!==true?'当前服务尚未开放幼儿园活动记录，请稍后重试。':'登录并选择可记录的孩子档案后，就可以保存观察。')}</p>${familyLink()}`}`;
  document.getElementById('begin-record')?.addEventListener('click',()=>act(async()=>{const ctx={...cloud.context(),actorId:s.me.id};drafts.begin(activity,ctx);renderRecordPanel(activity);}));
 }
 async function saveDraft(){
  if(!canSaveDraft())throw Error('原档案目前不可记录，请核对登录、成员权限和档案状态。草稿仍保留。');
  const target=copy(drafts.get().ctx);await drafts.submit();toast(`已保存到${target.childName}的幼儿园活动记录。`);
  // 用户已切换档案时保留当前视图，不将原孩子历史显示在新档案下。
  if(P.sameContext(target,P.readContext(s)))location.hash='#history';else route();
 }
 function historicalDetails(item){const activity=item.activitySnapshot;if(!activity||activity.unavailable)return '<p class="muted">这份记录未留存当时的活动内容，保留活动ID与版本。</p>';return `<details class="historical-card"><summary>回看当时的活动卡 · ${esc(item.activityVersion)}</summary>${activityBody(activity,{historical:true})}</details>`;}
 function renderHistoryItems(){
  const target=document.getElementById('history-items');if(!target||!historyPage)return;
  const ctx=P.readContext(s);if(!P.sameContext(historyPage.ctx,ctx)||historyPage.revision!==cloud.contextRevision())return;
  const corrected=new Set(historyPage.items.map(item=>item.correctionOf).filter(Boolean));
  target.innerHTML=historyPage.items.length?historyPage.items.map(item=>{
   const isOwn=String(item.authorId)===String(s.me.id),correct=capabilities.preschool===true&&P.canWrite(s)&&(isOwn||s.family.role==='OWNER');
   return `<article class="panel history-item"><div class="history-meta">${esc(date(item.occurredAt))} · ${esc(item.authorName||'家庭成员')}${item.correctionOf?' · 追加更正':''}${corrected.has(item.id)?' · 已有后续更正':''}</div><h2>${esc(item.activitySnapshot?.title||item.activityId)}</h2><span class="pill">${esc(P.OUTCOMES[item.outcome]||item.outcome)}</span><p class="observation-note">${esc(item.note||'本次未填写额外观察。')}</p>${historicalDetails(item)}${correct?`<button data-correct="${esc(item.id)}">追加更正</button>`:''}</article>`;
  }).join(''):'<section class="panel empty"><h2>从一次一起玩开始</h2><p>这里保存当前孩子的幼儿园活动记录，小学数学记录在另一个入口查看。</p><a href="#activities" class="btn">选一个亲子活动 →</a></section>';
  target.querySelectorAll('[data-correct]').forEach(button=>button.addEventListener('click',()=>act(async()=>{
   const item=historyPage.items.find(entry=>entry.id===button.dataset.correct);if(!item)return;
   const current=P.readContext(s);if(!P.canWrite(s)||!P.sameContext(historyPage.ctx,current)||historyPage.revision!==cloud.contextRevision())throw Error('孩子档案已切换，请重新加载记录。');
   drafts.begin(item.activitySnapshot||{id:item.activityId,version:item.activityVersion,title:item.activityId},{...historyPage.ctx,actorId:s.me.id},{correctionOf:item.id,outcome:item.outcome,note:item.note||''});location.hash='#draft';
  })));
  const more=document.getElementById('history-more');more.innerHTML=historyPage.nextCursor?`<button id="load-more"${historyPage.loading?' disabled':''}>${historyPage.loading?'正在加载…':'加载更早记录'}</button>`:'';
  document.getElementById('load-more')?.addEventListener('click',()=>act(()=>loadHistory(true)));
 }
 async function loadHistory(more=false){
  const current=P.readContext(s);if(!current)return;
  if(more&&(!historyPage||historyPage.loading||!historyPage.nextCursor))return;
  const seq=routeSeq,revision=cloud.contextRevision(),page=more?historyPage:{ctx:current,revision,items:[],nextCursor:null,loading:false};historyPage=page;page.loading=true;
  const status=document.getElementById('history-status');if(status)status.innerHTML='';
  if(more)renderHistoryItems();
  try{
   const response=await cloud.request(cloud.childPath(current)+'/preschool/history?limit=50'+(more?'&cursor='+encodeURIComponent(page.nextCursor):''));
   if(seq!==routeSeq||revision!==cloud.contextRevision()||historyPage!==page||!P.sameContext(current,P.readContext(s)))return;
   // 服务端隔离为主，页面也拒绝显示其他模块或意外返回的档案。
   const incoming=cloud.array(response).filter(item=>item.module==='PRESCHOOL'&&(!item.childId||item.childId===current.childId)&&(!item.familyId||item.familyId===current.familyId));
   const ids=new Set(page.items.map(item=>item.id));page.items.push(...incoming.filter(item=>{if(ids.has(item.id))return false;ids.add(item.id);return true;}));page.nextCursor=response.nextCursor||null;page.loading=false;renderHistoryItems();
  }catch(error){
   if(seq!==routeSeq||revision!==cloud.contextRevision()||historyPage!==page)return;
   page.loading=false;const status=document.getElementById('history-status');if(status){status.innerHTML=`<p class="error">${esc(error.message)}</p><button id="retry-history">重试读取${more?'更早记录':''}</button>`;document.getElementById('retry-history').addEventListener('click',()=>act(()=>loadHistory(more)));}if(more)renderHistoryItems();
  }
 }
 function renderHistory(){
  historyPage=null;const ctx=P.readContext(s);
  if(!ctx){frame('活动记录','每个孩子有自己的活动片段，与小学数学历史分开保存。',`<section class="panel empty"><p>${s.me?'请先建立或加入家庭，并选择孩子档案。':'登录后可查看家人为孩子留下的活动记录。'}</p>${s.mode==='cloud'&&!s.me?signin():familyLink()}</section>`);return;}
  frame(`${ctx.childName}的活动片段`,`${ctx.familyName} · 幼儿园活动记录。只留下当次过程，原始记录和追加更正都会保留。`,'<div id="history-status" role="status"></div><div id="history-items"><p role="status">正在读取当前孩子的记录…</p></div><div id="history-more" class="actions"></div>');act(()=>loadHistory());
 }
 function route(){
  ++routeSeq;const hash=location.hash.slice(1)||'activities',parts=hash.split('?'),view=parts[0],params=new URLSearchParams(parts[1]||'');
  document.querySelectorAll('[data-nav]').forEach(link=>link.classList.toggle('current',link.dataset.nav===(view==='history'?'history':'activities')));
  if(view==='history')renderHistory();else if(view==='draft'){
   const draft=drafts.get();if(!draft){frame('还没有活动草稿','选择一张活动卡，再开始本次记录。','<a class="btn primary" href="#activities">去挑一个活动 →</a>');return;}
   frame(draft.correctionOf?'更正这次观察':'留住这个小片段','草稿始终属于开始记录时选定的孩子。',`${activityBody(draft.activity,{historical:true})}<section id="record-panel" class="panel record-panel"></section>`);renderRecordPanel();
  }else if(view==='activity')renderActivity(params.get('id'));else renderActivities();
 }
 async function loadCatalog(){
  catalogError='';try{
   const response=await fetch(base+'data/preschool.json',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw Error('活动资料暂时无法读取。');
   const payload=await response.json();if(!Array.isArray(payload.activities)||!payload.activities.length||!Array.isArray(payload.themes))throw Error('活动资料暂时无法读取。');catalog=payload;
  }catch(error){catalogError=error.message;}
  route();
 }
 cloud.subscribe(kind=>{if(['context','ready','auth'].includes(kind)){renderBar();route();}});
 window.addEventListener('hashchange',route);
 window.addEventListener('beforeunload',event=>{if(drafts.get()){event.preventDefault();event.returnValue='';}});
 renderBar();route();
 Promise.all([loadCatalog(),cloud.init()]).then(()=>{
  renderBar();route();if(!s.me&&s.mode==='cloud'&&capabilities.preschool===true&&capabilities.preschoolSessionRestoreUrl===restorePath&&!drafts.get())location.assign(base+restorePath);
 }).catch(error=>toast(error.message));
})();
