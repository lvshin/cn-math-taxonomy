/* SVG 图谱交互：借鉴上游图谱的缩放与当前点定位，独立于教材数据和练习记录。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory();
 else root.KnowledgeMap=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const MIN_SCALE=.2,MAX_SCALE=2.5;
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function bounds(width,height,view,scale){return {left:Math.max(0,width*scale-view.width),top:Math.max(0,height*scale-view.height)};}
 function center(width,height,view,scale,point){
  const b=bounds(width,height,view,scale);
  return {left:clamp(point.x*scale-view.width/2,0,b.left),top:clamp(point.y*scale-view.height/2,0,b.top)};
 }
 function fitScale(width,height,view){return clamp(Math.min(Math.max(1,view.width-24)/width,Math.max(1,view.height-24)/height,1),MIN_SCALE,MAX_SCALE);}
 function zoom(width,height,view,oldScale,newScale,scroll){
  const scale=clamp(newScale,MIN_SCALE,MAX_SCALE),point={x:(scroll.left+view.width/2)/oldScale,y:(scroll.top+view.height/2)/oldScale};
  return {scale,...center(width,height,view,scale,point)};
 }
 function mount(options){
  const {viewport,panel,controls,status}=options;
  let {width,height,focus:target}=options,svg=viewport?.querySelector('svg');
  const valid=(shape,node)=>node&&[shape.width,shape.height].every(n=>Number.isFinite(n)&&n>0)&&shape.focus&&[shape.focus.x,shape.focus.y,shape.focus.width,shape.focus.height].every(Number.isFinite);
  if(!panel||!controls||!valid(options,svg))throw Error('图谱视图尚未准备好。');
  const doc=options.document||viewport.ownerDocument,win=options.window||doc?.defaultView;
  let scale=1,destroyed=false,expanded=false,fullPending=false,previousOverflow='',observer=null;
  const view=()=>({width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)});
  let point={x:target.x+target.width/2,y:target.y+target.height/2};
  const fullButton=controls.querySelector('[data-map-action="fullscreen"]');
  function paint(){
   svg.setAttribute('width',String(Math.round(width*scale*100)/100));
   svg.setAttribute('height',String(Math.round(height*scale*100)/100));
   svg.style.minWidth='0';
   if(status)status.textContent=Math.round(scale*100)+'%';
   const plus=controls.querySelector('[data-map-action="zoom-in"]'),minus=controls.querySelector('[data-map-action="zoom-out"]');
   if(plus)plus.disabled=scale>=MAX_SCALE;
   if(minus)minus.disabled=scale<=MIN_SCALE;
  }
  function scroll(position){viewport.scrollLeft=position.left;viewport.scrollTop=position.top;}
  function focus(){if(!destroyed)scroll(center(width,height,view(),scale,point));}
  function update(next){
   if(destroyed)return;
   const node=viewport.querySelector('svg');
   if(!valid(next,node))throw Error('图谱视图尚未准备好。');
   width=next.width;height=next.height;target=next.focus;svg=node;point={x:target.x+target.width/2,y:target.y+target.height/2};
   paint();focus();
  }
  function fit(){if(destroyed)return;scale=fitScale(width,height,view());paint();scroll(center(width,height,view(),scale,{x:width/2,y:height/2}));}
  function zoomBy(factor){
   if(destroyed||!Number.isFinite(factor)||factor<=0)return;
   const next=zoom(width,height,view(),scale,scale*factor,{left:viewport.scrollLeft,top:viewport.scrollTop});
   scale=next.scale;paint();scroll(next);
  }
  function fullState(){
   const active=expanded||doc?.fullscreenElement===panel;
   if(fullButton){fullButton.textContent=active?'退出全屏':'全屏查看';fullButton.setAttribute('aria-pressed',String(active));}
  }
  function fallback(active){
   if(active===expanded)return;
   expanded=active;panel.classList.toggle('is-map-expanded',active);
   if(doc?.body){if(active){previousOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';}else doc.body.style.overflow=previousOverflow;}
   fullState();focus();
  }
  async function toggleFullscreen(){
   if(destroyed||fullPending)return;
   if(expanded){fallback(false);return;}
   fullPending=true;
   try{
    if(doc?.fullscreenElement===panel&&typeof doc.exitFullscreen==='function')await doc.exitFullscreen();
    else if(typeof panel.requestFullscreen==='function')await panel.requestFullscreen();
    else fallback(true);
   }catch(_){if(!destroyed)fallback(true);}
   finally{fullPending=false;}
   if(destroyed&&doc?.fullscreenElement===panel&&typeof doc.exitFullscreen==='function')try{await doc.exitFullscreen();}catch(_){}
   if(!destroyed){fullState();focus();}
  }
  function onClick(event){
   const button=event.target.closest('[data-map-action]');if(!button||!controls.contains(button))return;
   const actions={'zoom-in':()=>zoomBy(1.25),'zoom-out':()=>zoomBy(.8),fit,focus,fullscreen:toggleFullscreen};
   if(actions[button.dataset.mapAction]){event.preventDefault();actions[button.dataset.mapAction]();}
  }
  function onKey(event){
   if(event.key==='Escape'&&expanded){event.preventDefault();fallback(false);return;}
   if(event.target!==viewport||event.altKey||event.ctrlKey||event.metaKey)return;
   const action={'+':()=>zoomBy(1.25),'=':()=>zoomBy(1.25),'-':()=>zoomBy(.8),'0':fit,Home:focus}[event.key];
   if(action){event.preventDefault();action();}
  }
  function onFullChange(){if(destroyed)return;fullState();focus();}
  controls.addEventListener('click',onClick);panel.addEventListener('keydown',onKey);doc?.addEventListener('fullscreenchange',onFullChange);
  if(win?.ResizeObserver){observer=new win.ResizeObserver(()=>{if(!destroyed)focus();});observer.observe(viewport);}
  paint();fullState();focus();
  function destroy(){
   if(destroyed)return;
   fallback(false);destroyed=true;observer?.disconnect();controls.removeEventListener('click',onClick);panel.removeEventListener('keydown',onKey);doc?.removeEventListener('fullscreenchange',onFullChange);
   if(doc?.fullscreenElement===panel&&typeof doc.exitFullscreen==='function')Promise.resolve(doc.exitFullscreen()).catch(()=>{});
  }
  return {update,zoomBy,fit,focus,toggleFullscreen,destroy,state:()=>({scale,expanded:expanded||doc?.fullscreenElement===panel})};
 }
 return {mount,center,fitScale,zoom,MIN_SCALE,MAX_SCALE};
});
