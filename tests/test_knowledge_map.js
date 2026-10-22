/* 图谱几何、控件与清理；合成DOM，不连接账号、网络或学习记录。 */
'use strict';
const assert=require('node:assert/strict'),MapView=require('../assets/knowledge-map.js');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('✓ '+name);}
function fixture({native=false,reject=false}={}){
 class Element{
  constructor(){this.style={};this.attrs={};this.dataset={};this.events={};this.children=[];this.disabled=false;this.textContent='';this.classes=new Set();this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(name,fn){this.events[name]=fn;}
  removeEventListener(name,fn){if(this.events[name]===fn)delete this.events[name];}
  querySelector(selector){return selector==='svg'?this.children.find(x=>x.svg):this.children.find(x=>selector===`[data-map-action="${x.dataset.mapAction}"]`);}
  contains(child){return this.children.includes(child);}
  closest(selector){return selector==='[data-map-action]'&&this.dataset.mapAction?this:null;}
 }
 const doc=new Element(),panel=new Element(),viewport=new Element(),controls=new Element(),status=new Element(),svg=new Element();
 doc.body={style:{overflow:'auto'}};doc.fullscreenElement=null;let observed=0,disconnected=0,observerCallback;
 const win={ResizeObserver:class{constructor(callback){observerCallback=callback;}observe(element){assert.equal(element,viewport);observed++;}disconnect(){disconnected++;}}};
 doc.defaultView=win;viewport.ownerDocument=doc;viewport.clientWidth=400;viewport.clientHeight=300;viewport.scrollLeft=0;viewport.scrollTop=0;svg.svg=true;viewport.children.push(svg);
 for(const action of ['zoom-in','zoom-out','fit','focus','fullscreen']){const button=new Element();button.dataset.mapAction=action;controls.children.push(button);}
 const button=action=>controls.children.find(x=>x.dataset.mapAction===action);
 if(native){panel.requestFullscreen=async()=>{if(reject)throw Error('synthetic denied');doc.fullscreenElement=panel;doc.events.fullscreenchange?.();};doc.exitFullscreen=async()=>{doc.fullscreenElement=null;doc.events.fullscreenchange?.();};}
 const controller=MapView.mount({viewport,panel,controls,status,width:1000,height:800,focus:{x:700,y:500,width:160,height:60}});
 function click(action){let prevented=false;controls.events.click({target:button(action),preventDefault(){prevented=true;}});assert.ok(prevented);}
 function key(key,target=viewport,extra={}){let prevented=false;panel.events.keydown({key,target,preventDefault(){prevented=true;},...extra});return prevented;}
 return {doc,panel,viewport,controls,status,svg,controller,button,click,key,replaceSvg(){const next=new Element();next.svg=true;viewport.children=[next];return next;},resize:()=>observerCallback(),observers:()=>({observed,disconnected})};
}
(async()=>{
 await test('适应图谱比例有留白且不会放大或缩到不可操作',()=>{
  assert.equal(MapView.fitScale(1000,800,{width:400,height:300}),.345);
  assert.equal(MapView.fitScale(100,100,{width:1200,height:800}),1);
  assert.equal(MapView.fitScale(100000,100000,{width:400,height:300}),MapView.MIN_SCALE);
 });
 await test('当前点居中受实际画布范围约束',()=>{
  assert.deepEqual(MapView.center(1000,800,{width:400,height:300},1,{x:780,y:530}),{left:580,top:380});
  assert.deepEqual(MapView.center(1000,800,{width:400,height:300},1,{x:2000,y:-20}),{left:600,top:0});
  assert.deepEqual(MapView.center(1000,800,{width:1400,height:1000},1,{x:780,y:530}),{left:0,top:0});
 });
 await test('缩放保持可见区域中心且有上下限',()=>{
  const result=MapView.zoom(1000,800,{width:400,height:300},1,1.25,{left:200,top:100});
  assert.deepEqual(result,{scale:1.25,left:300,top:162.5});
  assert.equal(MapView.zoom(1000,800,{width:400,height:300},1,999,{left:0,top:0}).scale,MapView.MAX_SCALE);
  assert.equal(MapView.zoom(1000,800,{width:400,height:300},1,.001,{left:0,top:0}).scale,MapView.MIN_SCALE);
 });
 await test('挂载只调整SVG显示尺寸和滚动，不改viewBox或节点内容',()=>{
  const f=fixture();assert.equal(f.status.textContent,'100%');assert.equal(f.viewport.scrollLeft,580);assert.equal(f.viewport.scrollTop,380);assert.deepEqual(f.svg.attrs,{width:'1000',height:'800'});assert.equal(f.svg.style.minWidth,'0');f.controller.destroy();
 });
 await test('控件缩放到边界后禁用，适应与定位可分别使用',()=>{
  const f=fixture();for(let i=0;i<20;i++)f.click('zoom-in');assert.equal(f.status.textContent,'250%');assert.ok(f.button('zoom-in').disabled);
  for(let i=0;i<30;i++)f.click('zoom-out');assert.equal(f.status.textContent,'20%');assert.ok(f.button('zoom-out').disabled);
  f.click('fit');assert.equal(f.status.textContent,'35%');assert.equal(f.viewport.scrollLeft,0);f.controller.zoomBy(2);f.click('focus');assert.equal(f.viewport.scrollLeft,290);assert.ok(!f.button('zoom-in').disabled);f.controller.destroy();
 });
 await test('键盘仅在图谱空白焦点处理，不拦截节点键盘或浏览器缩放',()=>{
  const f=fixture();assert.ok(f.key('+'));assert.equal(f.status.textContent,'125%');assert.ok(!f.key('+',f.button('zoom-in')));assert.ok(!f.key('+',f.viewport,{ctrlKey:true}));assert.ok(!f.key('Enter'));assert.ok(f.key('0'));assert.equal(f.status.textContent,'35%');assert.ok(f.key('Home'));f.controller.destroy();
 });
 await test('不支持原生全屏时面板展开，Escape退出并恢复原滚动状态',async()=>{
  const f=fixture();await f.controller.toggleFullscreen();assert.ok(f.panel.classes.has('is-map-expanded'));assert.equal(f.doc.body.style.overflow,'hidden');assert.equal(f.button('fullscreen').attrs['aria-pressed'],'true');assert.ok(f.key('Escape',f.button('fullscreen')));assert.equal(f.doc.body.style.overflow,'auto');assert.equal(f.button('fullscreen').textContent,'全屏查看');f.controller.destroy();
 });
 await test('浏览器原生全屏退出状态同步，不锁定页面滚动',async()=>{
  const f=fixture({native:true});await f.controller.toggleFullscreen();assert.equal(f.doc.fullscreenElement,f.panel);assert.equal(f.doc.body.style.overflow,'auto');assert.equal(f.button('fullscreen').textContent,'退出全屏');await f.doc.exitFullscreen();assert.equal(f.button('fullscreen').attrs['aria-pressed'],'false');f.controller.destroy();
 });
 await test('原生全屏被拒绝时可回退面板展开且可退出',async()=>{
  const f=fixture({native:true,reject:true});await f.controller.toggleFullscreen();assert.ok(f.controller.state().expanded);await f.controller.toggleFullscreen();assert.ok(!f.controller.state().expanded);f.controller.destroy();
 });
 await test('窄屏与容器尺寸改变重新定位，保持原缩放比例',()=>{
  const f=fixture();f.controller.zoomBy(1.25);f.viewport.clientWidth=280;f.viewport.clientHeight=210;f.resize();assert.equal(f.status.textContent,'125%');assert.equal(f.viewport.scrollLeft,835);assert.equal(f.viewport.scrollTop,557.5);f.controller.destroy();
 });
 await test('切换地图或离开页面销毁控件和监听，恢复展开前状态',async()=>{
  const f=fixture();await f.controller.toggleFullscreen();f.controller.destroy();f.controller.destroy();assert.equal(f.doc.body.style.overflow,'auto');assert.equal(f.panel.classes.size,0);assert.deepEqual(f.controls.events,{});assert.deepEqual(f.panel.events,{});assert.deepEqual(f.doc.events,{});assert.deepEqual(f.observers(),{observed:1,disconnected:1});const before=f.status.textContent;f.controller.zoomBy(2);f.controller.fit();assert.equal(f.status.textContent,before);
 });
 await test('原生全屏下销毁仅退出当前图谱，不修改其他应用状态',async()=>{
  const f=fixture({native:true});await f.controller.toggleFullscreen();f.controller.destroy();assert.equal(f.doc.fullscreenElement,null);
  const g=fixture({native:true});g.doc.fullscreenElement={other:true};g.controller.destroy();assert.deepEqual(g.doc.fullscreenElement,{other:true});
 });
 await test('全屏请求尚未完成时切页，迟到结果仍退出且不重复申请',async()=>{
  const f=fixture({native:true});let release,requests=0;f.panel.requestFullscreen=()=>{requests++;return new Promise(resolve=>{release=()=>{f.doc.fullscreenElement=f.panel;resolve();};});};
  const pending=f.controller.toggleFullscreen();await f.controller.toggleFullscreen();assert.equal(requests,1);f.controller.destroy();release();await pending;assert.equal(f.doc.fullscreenElement,null);assert.equal(f.doc.body.style.overflow,'auto');
 });
 await test('全屏内切换节点和基础层数保留展开与缩放，定位新点且不重复绑定',async()=>{
  for(const native of [true,false]){
   const f=fixture({native});f.controller.zoomBy(1.25);await f.controller.toggleFullscreen();const svg=f.replaceSvg();
   f.controller.update({width:1600,height:1200,focus:{x:500,y:700,width:200,height:100}});
   assert.equal(f.status.textContent,'125%');assert.equal(svg.attrs.width,'2000');assert.equal(svg.attrs.height,'1500');assert.ok(f.controller.state().expanded);assert.equal(f.viewport.scrollLeft,550);assert.equal(f.viewport.scrollTop,787.5);assert.deepEqual(f.observers(),{observed:1,disconnected:0});
   f.click('zoom-in');assert.equal(f.status.textContent,'156%');f.controller.destroy();assert.equal(f.doc.body.style.overflow,'auto');assert.equal(f.doc.fullscreenElement,null);
  }
 });
 console.log(`${passed}组知识图谱交互检查通过。`);
})().catch(error=>{console.error(error);process.exitCode=1;});
