'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const F=require('../assets/question-figures.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const catalog=JSON.parse(fs.readFileSync('config/question_figures.json','utf8'));
const questions=new Map(JSON.parse(fs.readFileSync('data/questions.json','utf8')).map(q=>[q.id,q]));
const placements=new Set(JSON.parse(fs.readFileSync('data/placements.json','utf8')).map(p=>p.topicId));
const figures=Object.fromEntries(Object.entries(catalog.entries).map(([id,e])=>[id,e.figure]));
const texts=f=>f.nodes.filter(n=>n.tag==='text').map(n=>n.text);
let passed=0;
function test(name,fn){fn();passed++;console.log('✓ '+name);}
function near(a,b){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
function fakeDocument(){
 const doc={};
 class Element{
  constructor(tag,namespace){this.tagName=tag;this.namespaceURI=namespace;this.ownerDocument=doc;this.attributes={};this.children=[];this.textContent='';}
  setAttribute(k,v){this.attributes[k]=v;}
  appendChild(child){this.children.push(child);return child;}
  set innerHTML(_){throw Error('HTML parsing is forbidden');}
 }
 doc.createElement=tag=>new Element(tag,null);
 doc.createElementNS=(namespace,tag)=>new Element(tag,namespace);
 return doc;
}
function descendants(el){return [el,...el.children.flatMap(descendants)];}
test('22张图对应13个已落册知识点，按题干锁定，旧文字、选项和标准答案仍由原题负责',()=>{
 assert.equal(catalog.schema,1);assert.equal(catalog.upstream_commit,'7be0aa56e97497c685ecead41f40dad7dfac45a9');
 assert.equal(Object.keys(figures).length,22);
 const topics=new Set();
 for(const [id,e]of Object.entries(catalog.entries)){
  const q=questions.get(id);assert.ok(q,id);assert.equal(e.expected_prompt,q.prompt,id);assert.ok(placements.has(q.topicId),id);topics.add(q.topicId);
  assert.match(e.source_question_id,/^cnm_p\d{3}_q\d+$/);assert.ok(e.adaptation.trim());assert.ok(F.validate(e.figure),id);
  assert.equal(typeof e.figure,'object');assert.equal(e.figure.schema,1);assert.ok(!Object.hasOwn(e,'answer'));assert.ok(!Object.hasOwn(e,'choices'));
 }
 assert.equal(topics.size,13);
 assert.equal(catalog.entries.cnm_p077_q1.source_question_id,'cnm_p077_q2');
 assert.equal(catalog.entries.cnm_p207_q1.source_question_id,'cnm_p207_q3');
 assert.equal(catalog.entries.cnm_p207_q2.source_question_id,'cnm_p207_q1');
 assert.ok(!Object.keys(figures).some(id=>/^cnm_p16[013]_/.test(id)),'未落册立体图形不因上游有图而出题');
});
test('面积图用当前苏教条件，几何坐标比例与独立面积计算一致',()=>{
 const points=id=>figures[id].nodes.find(n=>n.tag==='polygon').attrs.points.split(' ').map(p=>p.split(',').map(Number));
 const para=points('cnm_p147_q1'),tri=points('cnm_p148_q1'),trap=points('cnm_p149_q1');
 near((para[1][0]-para[0][0])/(para[0][1]-para[3][1]),8/5);
 near((tri[1][0]-tri[0][0])/(tri[0][1]-tri[2][1]),10/6);
 near((trap[3][0]-trap[0][0])/(trap[1][1]-trap[0][1]),3/4);
 near((trap[2][0]-trap[1][0])/(trap[1][1]-trap[0][1]),7/4);
 for(const [id,labels,answer]of [['cnm_p147_q1',['8厘米','5厘米'],8*5],['cnm_p148_q1',['10厘米','6厘米'],10*6/2],['cnm_p149_q1',['3厘米','7厘米','4厘米'],(3+7)*4/2]]){
  assert.deepEqual(texts(figures[id]),labels,id);assert.equal(Number(questions.get(id).answer),answer,id);
  const altitude=figures[id].nodes.find(n=>n.tag==='line'&&n.attrs['stroke-dasharray']);assert.equal(altitude.attrs.x1,altitude.attrs.x2,id);
 }
});
test('周长、长方形面积、圆与体积图只标当前题已知值',()=>{
 for(const [id,a,b,answer]of [['cnm_p078_q1',8,3,2*(8+3)],['cnm_p078_q2',6,6,4*6],['cnm_p089_q1',7,4,7*4],['cnm_p089_q2',5,5,5*5]]){
  const rect=figures[id].nodes.find(n=>n.tag==='rect');near(rect.attrs.width/rect.attrs.height,a/b);assert.equal(Number(questions.get(id).answer),answer,id);
  assert.deepEqual(texts(figures[id]),a===b?[a+'厘米']:[a+'厘米',b+'厘米']);
 }
 for(const [id,v,diameter]of [['cnm_p188_q2',4,false],['cnm_p190_q1',10,true],['cnm_p190_q2',3,false],['cnm_p192_q1',2,false],['cnm_p192_q2',10,true]]){
  const fig=figures[id],dimension=fig.nodes.find(n=>n.tag==='line');assert.deepEqual(texts(fig),[v+'厘米']);assert.equal(dimension.attrs.x1,diameter?50:120);
  assert.ok(fig.alt.includes(diameter?'直径':'半径'));
 }
 assert.ok(texts(figures.cnm_p188_extra_001).includes('10 cm'));assert.equal(questions.get('cnm_p188_extra_001').answer,'5');
 assert.ok(texts(figures.cnm_p207_q1).includes('底面积 12 cm²'));assert.ok(texts(figures.cnm_p207_q1).includes('h = 4 cm'));assert.equal(Number(questions.get('cnm_p207_q1').answer),12*4);
 assert.ok(texts(figures.cnm_p207_q2).includes('r = 2 cm'));assert.ok(texts(figures.cnm_p207_q2).includes('h = 5 cm'));near(Number(questions.get('cnm_p207_q2').answer),3.14*2*2*5);
 assert.ok(texts(figures.cnm_p209_q1).includes('体积 30 cm³'));assert.equal(Number(questions.get('cnm_p209_q1').answer),30/3);
 assert.deepEqual(texts(figures.cnm_p209_q2),['5厘米','底面积18平方厘米']);assert.equal(Number(questions.get('cnm_p209_q2').answer),18*5/3);
});
test('不解析原始SVG，拒绝脚本、外部引用、事件、样式与越界属性',()=>{
 const good=figures.cnm_p147_q1;
 for(const raw of [undefined,null,'<svg onload="alert(1)"></svg>','<svg><script>alert(1)</script></svg>',{},[],{...good,svg:'<svg/>'}])assert.equal(F.validate(raw),false);
 for(const tag of ['script','foreignObject','image','use','a','animate','set','iframe','style']){const bad=copy(good);bad.nodes.push({tag,attrs:{}});assert.equal(F.validate(bad),false,tag);}
 for(const [attr,value]of [['onload','alert(1)'],['onclick','alert(1)'],['href','https://example.test/image'],['xlink:href','#source'],['style','background:url(https://example.test)'],['fill','url(#any)'],['filter','url(#any)'],['stroke','red'],['font-family','remote'],['id','something']]){
  const bad=copy(good);bad.nodes[0].attrs[attr]=value;assert.equal(F.validate(bad),false,attr);
 }
 for(const value of ['M 0 0 L Infinity 2','M 0 0 L 1e999 2','url(https://example.test)','M 0 0<script>']){const bad=copy(good);bad.nodes=[{tag:'path',attrs:{d:value}}];assert.equal(F.validate(bad),false,value);}
});
test('限制坐标、节点数、深度、文字和画布大小；错误图不影响文字题',()=>{
 const good=figures.cnm_p147_q1;
 for(const value of [NaN,Infinity,-1,2001]){const bad=copy(good);bad.viewBox[2]=value;assert.equal(F.validate(bad),false);}
 for(const value of [NaN,Infinity,10001,'4']){const bad=copy(good);bad.nodes[0]={tag:'circle',attrs:{cx:value,cy:10,r:5}};assert.equal(F.validate(bad),false);}
 const many=copy(good);many.nodes=Array.from({length:257},()=>copy(good.nodes[0]));assert.equal(F.validate(many),false);
 const deep=copy(good);let n=deep.nodes[0];for(let i=0;i<6;i++)n={tag:'g',attrs:{},children:[n]};deep.nodes=[n];assert.equal(F.validate(deep),false);
 const largeText=copy(good);largeText.nodes=[{tag:'text',attrs:{x:1,y:1},text:'a'.repeat(201)}];assert.equal(F.validate(largeText),false);
 const doc=fakeDocument(),container=doc.createElement('div');assert.equal(F.mount(container,undefined),false);assert.equal(container.children.length,0);
});
test('只用DOM/SVG安全API，提供可读标题与打印说明，不把文字当标记执行',()=>{
 const doc=fakeDocument(),input=copy(figures.cnm_p147_q1);input.alt='<img src=x onerror=alert(1)>也是普通文字';input.nodes.push({tag:'text',attrs:{x:10,y:10},text:'<script>alert(1)</script>'});const before=copy(input);
 const el=F.create(input,doc);assert.ok(el);assert.equal(el.tagName,'figure');assert.equal(el.attributes.class,'question-figure');assert.deepEqual(input,before);
 const svg=el.children[0];assert.equal(svg.namespaceURI,'http://www.w3.org/2000/svg');assert.equal(svg.attributes.role,'img');assert.equal(svg.attributes['aria-label'],input.alt);assert.equal(svg.attributes.focusable,'false');assert.equal(svg.attributes['aria-hidden'],undefined);assert.equal(svg.children[0].tagName,'title');assert.equal(svg.children[0].textContent,input.alt);
 assert.ok(el.children[1].textContent.includes('以题干条件为准'));assert.ok(descendants(el).every(n=>!['script','img'].includes(n.tagName)));
 assert.ok(descendants(el).some(n=>n.textContent==='<script>alert(1)</script>'));
});
test('无图旧快照不回查新题，新轮图示随完整快照冻结并可跨设备重建',()=>{
 const doc=fakeDocument(),oldQuestion={id:'cnm_p147_q1',prompt:questions.get('cnm_p147_q1').prompt};assert.equal(F.create(oldQuestion.figure,doc),null);
 const newQuestion={...copy(oldQuestion),figure:copy(figures.cnm_p147_q1)},frozen=JSON.parse(JSON.stringify(newQuestion));newQuestion.figure.alt='后续版本';newQuestion.figure.nodes[0].attrs.points='0,0 1,0 1,1';
 assert.notEqual(frozen.figure.alt,newQuestion.figure.alt);assert.ok(F.validate(frozen.figure));const container=doc.createElement('div');assert.equal(F.mount(container,frozen.figure),true);assert.equal(container.children[0].children[0].attributes['aria-label'],figures.cnm_p147_q1.alt);
 assert.equal(oldQuestion.figure,undefined);
});
console.log(`${passed}组结构图示、条件对应、安全渲染与快照检查通过。`);
