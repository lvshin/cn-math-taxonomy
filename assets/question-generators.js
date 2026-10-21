/* 独立、确定性的规则变式。参数仅使用安全整数，分数和小数不依赖浮点运算。 */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory();
 else root.MathQuestionGenerators=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function copy(x){return JSON.parse(JSON.stringify(x));}
 function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){const r=a%b;a=b;b=r;}return a||1;}
 function fraction(n,d){if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||!d)throw new Error('无效有理数');if(d<0){n=-n;d=-d;}const g=gcd(n,d);return d/g===1?String(n/g):n/g+'/'+(d/g);}
 function decimal(n,scale){if(!Number.isSafeInteger(n)||!Number.isInteger(scale)||scale<0||scale>6)throw new Error('无效小数');const sign=n<0?'-':'';let s=String(Math.abs(n)).padStart(scale+1,'0');if(scale)s=s.slice(0,-scale)+'.'+s.slice(-scale);return sign+s.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');}
 function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
 function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
 function integer(rng,min,max){if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min>max)throw new Error('无效模板数值范围');return min+Math.floor(rng()*(max-min+1));}
 function required(t,key){const v=t[key];if(!Number.isSafeInteger(v))throw new Error('模板缺少整数参数 '+key);return v;}
 function paramsFor(t,rng){
  const pick=(a,b)=>integer(rng,a,b),max=()=>required(t,'max'),min=()=>t.min===undefined?0:required(t,'min');
  switch(t.kind){
   case 'neighbor':return {n:pick(min(),max()),delta:t.delta||1};
   case 'compare':{const a=pick(min(),max());let b=pick(min(),max()-1);if(b>=a)b++;return {a,b};}
   case 'compose':return {n:pick(min(),max())};
   case 'add':{const a=pick(min(),max()-min());return {a,b:pick(min(),max()-a)};}
   case 'subtract':{const a=pick(min(),max());return {a,b:pick(min(),a)};}
   case 'multiply':return {a:pick(t.aMin||1,required(t,'aMax')),b:pick(t.bMin||1,required(t,'bMax'))};
   case 'divide':{const d=pick(t.dMin||2,required(t,'dMax'));return {q:pick(Math.max(1,Math.ceil((t.dividendMin||1)/d)),Math.min(required(t,'qMax'),Math.floor((t.dividendMax||99999)/d))),d};}
   case 'mixed':return {a:pick(1,max()),b:pick(1,max()),c:pick(1,max())};
   case 'fraction-add':{const d=pick(3,max()),a=pick(1,d-1);return {a,b:pick(1,d-a),d};}
   case 'fraction-subtract':{const d=pick(3,max()),a=pick(2,d-1);return {a,b:pick(1,a-1),d};}
   case 'fraction-unlike':{const c=pick(2,12);let d=pick(2,11);if(d>=c)d++;return {a:pick(1,c-1),b:pick(1,d-1),c,d};}
   case 'fraction-mixed':{const c=pick(2,12),d=pick(2,12),a=pick(1,c-1),b=pick(1,d-1),n=a*d+b*c,den=c*d,f=pick(Math.max(2,Math.ceil(den/n)),12);return {a,b,c,d,e:pick(1,Math.min(f-1,Math.floor(n*f/den))),f};}
   case 'fraction-reduce':{const d=pick(2,max()),a=pick(1,d-1),factor=pick(2,9);return {a,d,factor};}
   case 'decimal-add':return {a:pick(1,max()),b:pick(1,max())};
   case 'decimal-multiply':return {a:pick(1,max()),b:pick(1,t.bMax||max())};
   case 'decimal-divide':return {q:pick(1,max()),d:pick(2,t.dMax||9)};
   case 'decimal-mixed':return {a:pick(1,max()),b:pick(1,max()),c:pick(1,9)};
   case 'decimal-fraction':return {n:pick(1,99)};
   case 'unit':return {n:pick(1,max())};
   case 'elapsed':{const start=pick(7*60,19*60),duration=pick(5,180);return {start,duration};}
   case 'clock24':return {hour:pick(1,11),minute:pick(0,11)*5};
   case 'equation':return {x:pick(1,max()),a:pick(2,20)};
   case 'rectangle-perimeter':case 'rectangle-area':{const a=pick(3,max());return {a,b:pick(2,a-1)};}
   case 'parallelogram-area':return {base:pick(2,max()),height:pick(2,max())};
   case 'triangle-area':return {base:pick(2,max())*2,height:pick(2,max())};
   case 'trapezoid-area':{const a=pick(2,max());let b=pick(2,max()-1);if(b>=a)b++;return {a:a*2,b:b*2,height:pick(2,max())};}
   case 'circle-perimeter':case 'circle-area':return {radius:pick(1,max())};
   case 'cylinder-volume':case 'cone-volume':return {radius:pick(1,max()),height:pick(1,max())*3};
   default:throw new Error('未支持的变式模板：'+t.kind);
  }
 }
 function render(t,p){
  const f=fraction,d=decimal;let prompt,answer,explanation;const {a,b,c}=p;
  switch(t.kind){
   case 'neighbor':answer=String(p.n+p.delta);prompt=`${p.n} 的${p.delta>0?'后':'前'}面一个数是几？`;explanation=`${p.n}${p.delta>0?'加':'减'}1，得到${answer}。`;break;
   case 'compare':answer=String(Math.max(a,b));prompt=`${a}和${b}中，较大的数是几？`;explanation=`${Math.max(a,b)}大于${Math.min(a,b)}。`;break;
   case 'compose':{const place=t.place||10,high=Math.floor(p.n/place),low=p.n%place;answer=String(p.n);prompt=`${high}个${place===1000?'千':place===100?'百':'十'}和${low}个一合起来是几？`;explanation=`${high}×${place}+${low}=${answer}。`;break;}
   case 'add':answer=String(a+b);prompt=`${a}+${b}=？`;explanation=`把${a}和${b}合起来，得到${answer}。`;break;
   case 'subtract':answer=String(a-b);prompt=`${a}−${b}=？`;explanation=`从${a}中减去${b}，得到${answer}。`;break;
   case 'multiply':answer=String(a*b);prompt=`${a}×${b}=？`;explanation=`${a}×${b}=${answer}。`;break;
   case 'divide':answer=String(p.q);prompt=`${p.q*p.d}÷${p.d}=？`;explanation=`${p.d}×${p.q}=${p.q*p.d}，所以商是${p.q}。`;break;
   case 'mixed':if(t.brackets===false){answer=String(a+b*c);prompt=`${a}+${b}×${c}=？`;explanation=`先乘后加：${b}×${c}=${b*c}，${a}+${b*c}=${answer}。`;}else{answer=String((a+b)*c);prompt=`（${a}+${b}）×${c}=？`;explanation=`先算括号：${a}+${b}=${a+b}，再算${a+b}×${c}=${answer}。`;}break;
   case 'fraction-add':answer=f(a+b,p.d);prompt=`${a}/${p.d}+${b}/${p.d}=？（可写分数）`;explanation=`分母不变，分子相加，得到${answer}。`;break;
   case 'fraction-subtract':answer=f(a-b,p.d);prompt=`${a}/${p.d}−${b}/${p.d}=？（可写分数）`;explanation=`分母不变，分子相减，得到${answer}。`;break;
   case 'fraction-unlike':answer=f(a*p.d+b*p.c,p.c*p.d);prompt=`${a}/${p.c}+${b}/${p.d}=？（可写分数）`;explanation=`通分成${a*p.d}/${p.c*p.d}和${b*p.c}/${p.c*p.d}，相加并约分得到${answer}。`;break;
   case 'fraction-mixed':answer=f(a*p.d*p.f+b*p.c*p.f-p.e*p.c*p.d,p.c*p.d*p.f);prompt=`${a}/${p.c}+${b}/${p.d}−${p.e}/${p.f}=？（可写分数）`;explanation=`先通分，再按从左到右的顺序相加、相减并约分，得到${answer}。`;break;
   case 'fraction-reduce':answer=f(p.a,p.d);prompt=`把${p.a*p.factor}/${p.d*p.factor}约成最简分数。`;explanation=`分子、分母同时除以它们的最大公因数，得到${answer}。`;break;
   case 'decimal-add':answer=d(a+b,t.scale);prompt=`${d(a,t.scale)}+${d(b,t.scale)}=？`;explanation=`对齐小数点相加，得到${answer}。`;break;
   case 'decimal-multiply':answer=d(a*b,t.aScale+t.bScale);prompt=`${d(a,t.aScale)}×${d(b,t.bScale)}=？`;explanation=`先算${a}×${b}=${a*b}，再按两个因数共${t.aScale+t.bScale}位小数确定小数点，得到${answer}。`;break;
   case 'decimal-divide':answer=d(p.q,t.qScale);prompt=`${d(p.q*p.d,t.qScale+t.dScale)}÷${d(p.d,t.dScale)}=？`;explanation=`${d(p.d,t.dScale)}×${answer}=${d(p.q*p.d,t.qScale+t.dScale)}，所以商是${answer}。`;break;
   case 'decimal-mixed':answer=d((a+b)*c,2);prompt=`（${d(a,1)}+${d(b,1)}）×${d(c,1)}=？`;explanation=`先算括号得到${d(a+b,1)}，再乘${d(c,1)}，得到${answer}。`;break;
   case 'decimal-fraction':answer=f(p.n,100);prompt=`把${d(p.n,2)}化成最简分数。`;explanation=`写成${p.n}/100再约分，得到${answer}。`;break;
   case 'unit':answer=String(p.n*t.factor);prompt=`${p.n}${t.from}等于多少${t.to}？（只填数）`;explanation=`1${t.from}=${t.factor}${t.to}，${p.n}×${t.factor}=${answer}。`;break;
   case 'elapsed':{const end=p.start+p.duration,clock=n=>`${Math.floor(n/60)}时${n%60}分`;answer=String(p.duration);prompt=`同一天，从${clock(p.start)}到${clock(end)}，经过多少分钟？`;explanation=`把时刻都换成分钟：${end}−${p.start}=${answer}分钟。`;break;}
   case 'clock24':answer=String(p.hour+12);prompt=`下午${p.hour}时${p.minute}分，用24时记时法是几时${p.minute}分？（只填“时”的数值）`;explanation=`下午时刻加12：${p.hour}+12=${answer}。`;break;
   case 'equation':{const op=t.operation||'add';answer=String(p.x);if(op==='multiply'){prompt=`解方程：${p.a}x=${p.a*p.x}，x=？`;explanation=`等式两边同时除以${p.a}，x=${p.x}。`;}else if(op==='subtract'){prompt=`解方程：x−${p.a}=${p.x-p.a}，x=？`;explanation=`等式两边同时加${p.a}，x=${p.x}。`;}else{prompt=`解方程：x+${p.a}=${p.x+p.a}，x=？`;explanation=`等式两边同时减${p.a}，x=${p.x}。`;}break;}
   case 'rectangle-perimeter':answer=String(2*(a+b));prompt=`长方形长${a}厘米、宽${b}厘米，周长是多少厘米？`;explanation=`（长+宽）×2=（${a}+${b}）×2=${answer}厘米。`;break;
   case 'rectangle-area':answer=String(a*b);prompt=`长方形长${a}厘米、宽${b}厘米，面积是多少平方厘米？`;explanation=`长×宽=${a}×${b}=${answer}平方厘米。`;break;
   case 'parallelogram-area':answer=String(p.base*p.height);prompt=`平行四边形底${p.base}厘米、高${p.height}厘米，面积是多少平方厘米？`;explanation=`底×高=${p.base}×${p.height}=${answer}平方厘米。`;break;
   case 'triangle-area':answer=String(p.base*p.height/2);prompt=`三角形底${p.base}厘米、高${p.height}厘米，面积是多少平方厘米？`;explanation=`底×高÷2=${p.base}×${p.height}÷2=${answer}平方厘米。`;break;
   case 'trapezoid-area':answer=String((a+b)*p.height/2);prompt=`梯形上底${a}厘米、下底${b}厘米、高${p.height}厘米，面积是多少平方厘米？`;explanation=`（上底+下底）×高÷2=（${a}+${b}）×${p.height}÷2=${answer}平方厘米。`;break;
   case 'circle-perimeter':answer=d(628*p.radius,2);prompt=`圆的半径为${p.radius}厘米，周长是多少厘米？（π取3.14）`;explanation=`2πr=2×3.14×${p.radius}=${answer}厘米。`;break;
   case 'circle-area':answer=d(314*p.radius*p.radius,2);prompt=`圆的半径为${p.radius}厘米，面积是多少平方厘米？（π取3.14）`;explanation=`πr²=3.14×${p.radius}×${p.radius}=${answer}平方厘米。`;break;
   case 'cylinder-volume':answer=d(314*p.radius*p.radius*p.height,2);prompt=`圆柱底面半径${p.radius}厘米、高${p.height}厘米，体积是多少立方厘米？（π取3.14）`;explanation=`πr²h=3.14×${p.radius}×${p.radius}×${p.height}=${answer}立方厘米。`;break;
   case 'cone-volume':answer=d(314*p.radius*p.radius*(p.height/3),2);prompt=`圆锥底面半径${p.radius}厘米、高${p.height}厘米，体积是多少立方厘米？（π取3.14）`;explanation=`πr²h÷3=3.14×${p.radius}×${p.radius}×${p.height}÷3=${answer}立方厘米。`;break;
   default:throw new Error('未支持的变式模板：'+t.kind);
  }
  return {id:'generated:'+t.id+'@'+t.version+':'+hash(stable(p)),topicId:t.topicId,type:'numeric',difficulty:'standard',prompt,answer,explanation,familyKey:'template:'+t.id+'@'+t.version,templateId:t.id,templateVersion:t.version,params:copy(p),origin:'rule-generated',review_status:'ai_draft_not_teacher_reviewed'};
 }
 function generate(t,rng){if(!t||typeof t.id!=='string'||!t.id||!Number.isInteger(t.version)||t.version<1||typeof t.topicId!=='string')throw new Error('无效变式模板');return render(t,paramsFor(t,rng));}
 return {generate,render,fraction,decimal,hash,stable};
});
