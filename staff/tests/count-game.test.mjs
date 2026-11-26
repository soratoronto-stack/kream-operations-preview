import test from 'node:test';import assert from 'node:assert/strict';
import {createStepState,renderOrderSteps} from '../order-steps.mjs';
import {incomingQuantity} from '../count-planning.mjs';
import {sheetUnitPolicy} from '../sheet-unit-policy.mjs';
function screen({binary=false,preview=false,fail=false}={}){
 const p={id:'p'},state=createStepState('finch','2026-11-22'),saved=[],checks=[],basket=[];state.typed.p=binary?'1':'5';state.edited.add('p');
 const host={innerHTML:'',contains:()=>true,querySelector:()=>null};
 renderOrderSteps(host,{state,items:[p],key:'all',t:ko=>ko,esc:String,name:()=> 'Product',unitLabel:()=> 'Box',picture:()=>'',lastStock:()=>9,parse:(_,s)=>Number(s),getQty:()=>0,setQty:(_,q)=>basket.push(q),qtyStep:()=>1,qtyDisplay:(_,q)=>q,yesNo:()=>binary,suggest:()=>3,saveStock:async(_,n)=>{if(fail)throw Error('conflict');saved.push(n);},saveAvailability:async(_,has)=>{if(fail)throw Error('offline');checks.push(has);},allIds:[],preview});
 return {host,state,saved,checks,basket,commit:()=>host.onclick({target:{closest:()=>({dataset:{os:'prev'}})}})};
}
test('availability answers never overwrite a physical stock quantity',async()=>{const s=screen({binary:true});await s.commit();assert.deepEqual(s.saved,[]);assert.deepEqual(s.checks,[true]);assert.equal(s.state.done.has('p'),true);});
test('a failed count does not change basket or mark the item done',async()=>{const s=screen({fail:true});await s.commit();assert.deepEqual(s.basket,[]);assert.equal(s.state.done.has('p'),false);assert.equal(s.state.failed.has('p'),true);});
test('successful physical count is saved before changing basket; preview saves nothing',async()=>{const s=screen();await s.commit();assert.deepEqual(s.saved,[5]);assert.deepEqual(s.basket,[3]);const preview=screen({preview:true});await preview.commit();assert.deepEqual(preview.saved,[]);assert.deepEqual(preview.basket,[]);assert.equal(preview.state.edited.size,0);});
const order=(id,date,quantity,extra={})=>({id,delivery_date:date,store_id:'finch',status:'submitted',kream_order_items:[{product_id:'p',quantity}],...extra});
const planned=extra=>incomingQuantity({store:'finch',today:'2026-11-22',date:'2026-11-23',product:'p',...extra});
test('future deliveries and other stores cannot suppress tomorrow order',()=>{assert.equal(planned({orders:[order('a','2026-11-23',3),order('b','2026-12-15',100),order('c','2026-11-23',20,{store_id:'downtown'})]}),3);});
test('partial receipts subtract only received units; finalized dispatch uses actual sent',()=>{const orders=[order('a','2026-11-23',10,{dispatch_finalized_at:'now'})],dispatches=[{order_id:'a',kream_dispatch_items:[{product_id:'p',quantity:6}]}],receipts=[{order_id:'a',kream_receipt_items:[{product_id:'p',quantity:2}]}];assert.equal(planned({orders,dispatches,receipts}),4);assert.equal(planned({orders:[order('a','2026-11-23',10,{status:'received'})]}),0);});
test('owner-confirmed retail portions and financier pack sizes differ correctly',()=>{assert.equal(sheetUnitPolicy({subgroup:'미니 스콘',order_unit:'Bag'}).package_quantity,3);assert.equal(sheetUnitPolicy({subgroup:'휘낭시에',order_unit:'Bag'}).package_quantity,20);assert.equal(sheetUnitPolicy({name_ko:'오미자 시럽'}).mode,'availability');});
test('list view shows today’s saved count instead of last time',()=>{const state=createStepState('finch','2026-11-22');state.key='all';state.view='list';const host={innerHTML:'',contains:()=>true,querySelector:()=>null};renderOrderSteps(host,{state,items:[{id:'a'},{id:'b'}],key:'all',t:ko=>ko,esc:String,name:p=>p.id,unitLabel:()=>'',picture:()=>'',lastStock:p=>p.id==='a'?7:4,todayValue:p=>p.id==='a'?7:null,parse:(_,s)=>Number(s),getQty:()=>0,setQty(){},qtyStep:()=>1,qtyDisplay:(_,q)=>q,suggest:()=>null,saveStock:async()=>{},allIds:[]});const rows=host.innerHTML.split('os-row').slice(1);assert.match(rows[0],/<em>7<\/em><small>오늘/);assert.match(rows[1],/<em>4<\/em><small>지난번/);});

test('a delivery that already arrived on the count day is not counted again as on the way',()=>{const orders=[order('today','2026-11-22',5),order('tomorrow','2026-11-23',3)];assert.equal(incomingQuantity({orders,store:'finch',today:'2026-11-23',date:'2026-11-23',product:'p'}),3);});

test('두쫀쿠: 반박스·한박스를 골라도 다음으로 넘어가고 주문이 들어가요 (음수 값 없음)',async()=>{
 for(const [pick,order] of [['32',0],['16',32],['0',64]]){
  const p={id:'d'},state=createStepState('finch','2026-11-24'),saved=[],basket=[];state.typed.d=pick;state.edited.add('d');
  const host={innerHTML:'',contains:()=>true,querySelector:()=>null};
  const strict=(_,s)=>{const n=Number(s);if(!Number.isFinite(n)||n<0)throw Error('STOCK');return n;};
  renderOrderSteps(host,{state,items:[p],key:'all',t:ko=>ko,esc:String,name:()=> '두바이쫀득쿠키',unitLabel:()=> 'box',picture:()=>'',lastStock:()=>0,parse:strict,getQty:()=>0,setQty:(_,q)=>basket.push(q),qtyStep:()=>32,qtyDisplay:(_,q)=>q,yesNo:()=>false,suggest:()=>null,saveStock:async(_,v)=>saved.push(v),saveAvailability:async()=>{},
   choices:()=>[['32','충분'],['16','반박스'],['0','한박스']],choiceOrder:(_,v)=>({'32':0,'16':32,'0':64})[String(v)]??null});
  await host.onclick({target:{closest:()=>({dataset:{os:'prev'}})}});
  assert.equal(state.done.has('d'),true,pick);assert.deepEqual(saved,[Number(pick)]);
  if(order)assert.deepEqual(basket,[order]);
 }
 const app=(await import('node:fs')).readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(app,/'-1',t\('반박스 주문'/);assert.match(app,/'32':0,'16':32,'0':64/);
});

test('개수로만 세는 품목(크로와상 3개/봉 등)은 소수점 키가 없고, 잘못된 숫자는 알맞은 안내', ()=>{
 const p={id:'w'},state=createStepState('finch','2026-11-24');state.key='all';
 const host={innerHTML:'',contains:()=>true,querySelector:()=>null};
 const base={state,items:[p],key:'all',t:ko=>ko,esc:String,name:()=> '스윗 크로와상 쿠키',unitLabel:()=> 'Bag',picture:()=>'',lastStock:()=>3,parse:(_,s)=>{const n=Number(s);if(!Number.isInteger(n)||n<0)throw Error('X');return n/3;},getQty:()=>0,setQty:()=>{},qtyStep:()=>1,qtyDisplay:(_,q)=>q,yesNo:()=>false,suggest:()=>null,saveStock:async()=>{},saveAvailability:async()=>{}};
 renderOrderSteps(host,{...base,wholeOnly:()=>true});assert.doesNotMatch(host.innerHTML,/data-key="\."/);
 renderOrderSteps(host,{...base,wholeOnly:()=>false});assert.match(host.innerHTML,/data-key="\."/);
});

test('두쫀쿠: 고르면 그 버튼 하나만 눌리고, 바로 넘어가지 않아서 다시 바꿀 수 있어요',async()=>{
 const p={id:'d'},state=createStepState('finch','2026-11-24');
 let nextClicks=0;const warn={textContent:''};
 const host={innerHTML:'',contains:()=>true,querySelector:sel=>sel==='#osWarn'?warn:sel.includes('next')?{click:()=>nextClicks++}:null};
 renderOrderSteps(host,{state,items:[p],key:'all',t:ko=>ko,esc:String,name:()=> '두바이쫀득쿠키',unitLabel:()=> 'box',picture:()=>'',lastStock:()=>0,parse:(_,s)=>Number(s),getQty:()=>0,setQty:()=>{},qtyStep:()=>32,qtyDisplay:(_,q)=>q,yesNo:()=>false,suggest:()=>null,saveStock:async()=>{},
  choices:()=>[['32','충분'],['16','반박스'],['0','한박스']],choiceOrder:(_,v)=>({'32':0,'16':32,'0':64})[String(v)]??null});
 const mk=v=>({dataset:{yn:v},classList:{on:false,toggle(c,f){this.on=f;}},setAttribute(){},blur(){}});
 const btns=['32','16','0'].map(mk);const group={classList:{contains:c=>c==='many'},querySelectorAll:()=>btns};btns.forEach(b=>b.parentElement=group);
 const realTimeout=globalThis.setTimeout;let timers=0;globalThis.setTimeout=(f,ms)=>{timers++;return 0;};
 try{
  await host.onclick({target:{closest:()=>btns[1]}});   // 반박스
  await host.onclick({target:{closest:()=>btns[0]}});   // 마음 바꿔서 충분
 }finally{globalThis.setTimeout=realTimeout;}
 assert.deepEqual(btns.map(b=>b.classList.on),[true,false,false]);   // 하나만 눌림
 assert.equal(state.typed.d,'32');assert.equal(timers,0);assert.equal(nextClicks,0);   // 자동으로 안 넘어감
 assert.match(warn.textContent,/다음을 눌러/);
});

test('최소수량이 없는 품목은 세고 나면 주문 줄이 바로 보이고, 다른 품목은 "주문 수량 바꾸기"로 열어요', ()=>{
 const mk=(sug)=>{const p={id:'y'},state=createStepState('finch','2026-11-26');state.key='all';state.typed.y='2';state.edited.add('y');
  const host={innerHTML:'',contains:()=>true,querySelector:()=>null};
  renderOrderSteps(host,{state,items:[p],key:'all',t:ko=>ko,esc:String,name:()=> '블루베리 요거트케이크',unitLabel:()=> 'EA',picture:()=>'',lastStock:()=>1,parse:(_,s)=>Number(s),getQty:()=>0,setQty:()=>{},qtyStep:()=>1,qtyDisplay:(_,q)=>q,yesNo:()=>false,suggest:()=>sug,saveStock:async()=>{},saveAvailability:async()=>{}});
  return host.innerHTML;};
 const none=mk(null);assert.match(none,/최소수량이 없어서 직접 담아요/);assert.match(none,/data-os="qplus"/);
 const auto=mk(3);assert.match(auto,/주문 수량 바꾸기/);assert.doesNotMatch(auto,/data-os="qplus"/);
});
