/* 受限的题目图示：只从结构化数据创建 SVG，不解析 HTML 或外部 SVG 字符串。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory();
 else root.MathQuestionFigures=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const NS='http://www.w3.org/2000/svg';
 const TAGS=new Set(['g','rect','line','circle','ellipse','polygon','polyline','path','text']);
 const GEOMETRY={rect:['x','y','width','height','rx','ry'],line:['x1','y1','x2','y2'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],polygon:['points'],polyline:['points'],path:['d'],text:['x','y'],g:[]};
 const PRESENTATION=['fill','stroke','stroke-width','fill-opacity','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin'];
 const TEXT=['font-size','font-weight','text-anchor'];
 const NUMBER=/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
 const keys=(obj,allowed)=>Object.keys(obj).every(key=>allowed.includes(key));
 const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const finite=(value,min=-10000,max=10000)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
 function numbers(value){const list=value.match(NUMBER);return !!list&&list.every(n=>Number.isFinite(Number(n))&&Math.abs(Number(n))<=10000);}
 function attribute(tag,key,value){
  if(!(GEOMETRY[tag].includes(key)||PRESENTATION.includes(key)||(tag==='text'&&TEXT.includes(key))))return false;
  if(key==='fill'||key==='stroke')return value==='none'||value==='currentColor';
  if(key==='stroke-linecap')return ['round','butt','square'].includes(value);
  if(key==='stroke-linejoin')return ['round','miter','bevel'].includes(value);
  if(key==='text-anchor')return ['start','middle','end'].includes(value);
  if(key==='font-weight')return ['normal','bold',400,500,600,650,700,800].includes(value);
  if(key==='stroke-dasharray')return typeof value==='string'&&value.length<=100&&/^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?){0,7}$/.test(value)&&value.match(NUMBER).every(n=>Number(n)<=50);
  if(key==='points')return typeof value==='string'&&value.length<=4000&&/^[\d\s.,eE+\-]+$/.test(value)&&numbers(value)&&value.match(NUMBER).length%2===0;
  if(key==='d')return typeof value==='string'&&value.length<=4000&&/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(value)&&numbers(value);
  if(key==='fill-opacity'||key==='stroke-opacity')return finite(value,0,1);
  if(key==='stroke-width')return finite(value,0,12);
  if(key==='font-size')return finite(value,8,32);
  return finite(value,['width','height','r','rx','ry'].includes(key)?0:-10000);
 }
 function validate(figure){
  try{
   if(!object(figure)||!keys(figure,['schema','viewBox','alt','nodes'])||figure.schema!==1||typeof figure.alt!=='string'||!figure.alt.trim()||figure.alt.length>600||!Array.isArray(figure.viewBox)||figure.viewBox.length!==4||figure.viewBox[0]!==0||figure.viewBox[1]!==0||!figure.viewBox.slice(2).every(x=>finite(x,1,2000))||!Array.isArray(figure.nodes)||!figure.nodes.length||figure.nodes.length>256)return false;
   let count=0;
   function node(n,depth){
    if(++count>256||depth>4||!object(n)||!keys(n,['tag','attrs','text','children'])||!TAGS.has(n.tag)||!object(n.attrs)||Object.entries(n.attrs).some(([key,value])=>!attribute(n.tag,key,value)))return false;
    if(n.tag==='text'){if(typeof n.text!=='string'||n.text.length>200||n.children!==undefined)return false;}
    else if(n.text!==undefined)return false;
    if(n.children!==undefined&&!(n.tag==='g'&&Array.isArray(n.children)&&n.children.length<=256&&n.children.every(c=>node(c,depth+1))))return false;
    return true;
   }
   return figure.nodes.every(n=>node(n,0));
  }catch(_){return false;}
 }
 function create(figure,doc){
  if(!validate(figure))return null;
  doc=doc||(typeof document!=='undefined'?document:null);
  if(!doc||typeof doc.createElement!=='function'||typeof doc.createElementNS!=='function')return null;
  const wrap=doc.createElement('figure');wrap.setAttribute('class','question-figure');
  const svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox',figure.viewBox.join(' '));svg.setAttribute('role','img');svg.setAttribute('aria-label',figure.alt);svg.setAttribute('focusable','false');
  const title=doc.createElementNS(NS,'title');title.textContent=figure.alt;svg.appendChild(title);
  function createNode(n){const el=doc.createElementNS(NS,n.tag);for(const [key,value] of Object.entries(n.attrs))el.setAttribute(key,String(value));if(n.tag==='text')el.textContent=n.text;for(const child of n.children||[])el.appendChild(createNode(child));return el;}
  for(const n of figure.nodes)svg.appendChild(createNode(n));
  const caption=doc.createElement('figcaption');caption.textContent='示意图，不按实际尺寸绘制；以题干条件为准。';wrap.appendChild(svg);wrap.appendChild(caption);return wrap;
 }
 function mount(container,figure){if(!container)return false;const node=create(figure,container.ownerDocument);if(!node)return false;container.appendChild(node);return true;}
 return {validate,create,mount};
});
