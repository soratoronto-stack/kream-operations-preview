import {subcategoryStyle} from '../category-colors.mjs';
import {displayQuantity,inputQuantity} from '../packing.mjs';
import {halfBoxCount,packingHint} from '../packing.mjs';
import * as productDrag from '../product-drag.mjs';
import * as workplaceModule from '../workplaces.mjs';
import {quantityStep} from '../quantity-step.mjs';
import * as availability from '../store-availability.mjs';
import * as subcategoryModule from '../subcategory-drag.mjs';
import * as settlementModule from '../settlement.mjs';
import * as catalogModule from '../catalog-editor.mjs';
import * as dailyModule from '../daily-log.mjs';
import * as replenishmentModule from '../replenishment.mjs';
import * as layoutModule from '../order-layout.mjs';
import * as checklistModule from '../checklist.mjs';
import * as journalModule from '../production-log.mjs';
import * as overviewModule from '../overview.mjs';
import * as stockModule from '../store-stock.mjs';
import * as dispatchModule from '../dispatch.mjs';
import * as productionModule from '../production.mjs';
import * as wasteModule from '../waste.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {visiblePages,canPreview,scopePreview} from '../access.mjs';
import fs from 'node:fs';import vm from 'node:vm';
import * as access from '../access.mjs';import * as core from '../core.mjs';import * as presentation from '../presentation.mjs';import * as operations from '../operations.mjs';
// Load the same named module bindings as the app; newly added UI dependencies
// must not turn permission regressions into missing-mock ReferenceErrors.
const appDependencies={};
for(const match of fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8').matchAll(/^import \{([^}]+)\} from '([^']+)';/gm)){
 const namespace=await import(new URL(match[2].split('?')[0],new URL('../app.mjs',import.meta.url)));
 for(const binding of match[1].split(',')){const [name,alias]=binding.trim().split(/\s+as\s+/);appDependencies[alias||name]=namespace[name];}
}

test('preview is owner-only and factory manager adds only purchasing',()=>{assert.equal(canPreview({role:'owner',active:true},'manager'),true);for(const role of ['employee','manager','factory','midland_owner'])assert.equal(canPreview({role,active:true},'owner'),false);assert.equal(canPreview({role:'owner',active:false},'employee'),false);assert.equal(canPreview({role:'owner',active:true},'made-up'),false);const staff=visiblePages('factory_staff'),manager=visiblePages('factory_manager');assert.ok(staff.includes('inventory'));assert.deepEqual(manager.filter(p=>!staff.includes(p)),['hr','costs','purchases','catalogreview']);assert.deepEqual(staff.filter(p=>!manager.includes(p)),[]);assert.ok(!visiblePages('factory').includes('purchases'));});
test('employee preview scopes orders and receipts and excludes unpublished/wrong-store guides',()=>{const data={orders:[{id:'a',store_id:'finch'},{id:'b',store_id:'midland'}],receipts:[{order_id:'a',store_id:'finch'},{order_id:'b',store_id:'midland'}],guides:[{id:'g',store_id:null,published:true},{id:'draft',store_id:'finch',published:false},{id:'other',store_id:'midland',published:true},{id:'archived',store_id:'finch',published:true,archived:true}]};const scoped=scopePreview('employee','finch',data);assert.deepEqual(scoped.orders.map(o=>o.id),['a']);assert.equal(scoped.receipts.length,1);assert.deepEqual(scoped.guides.map(g=>g.id),['g']);assert.deepEqual(scopePreview('manager','finch',data).guides.map(g=>g.id),['g','draft']);});
function fixture(timers={}){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){},insertAdjacentHTML(_,html){this.innerHTML=html+this.innerHTML;},replaceChildren(){},appendChild(){},focus(){},innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{toggle(){},remove(){},add(){}},querySelector:s=>node(s),querySelectorAll:()=>[],scrollIntoView(){}});return nodes.get(id);};const ctx=vm.createContext({subcategoryStyle,displayQuantity,inputQuantity,...productDrag,setInterval:()=>0,setTimeout:()=>0,clearTimeout(){},...timers,...workplaceModule,halfBoxCount,packingHint,quantityStep,...availability,...settlementModule,...subcategoryModule,...catalogModule,...dailyModule,...replenishmentModule,...layoutModule,...checklistModule,...journalModule,...overviewModule,...stockModule,...dispatchModule,...productionModule,...wasteModule,...core,...presentation,...operations,...access,...appDependencies,confirmDeliveryDate:async()=>true,URLSearchParams,Intl,Date,console,localStorage:{getItem:()=>null,setItem(){}},location:{hash:''},document:{querySelector:node,querySelectorAll:()=>[],documentElement:{},body:{classList:{toggle(){},remove(){},add(){}}}},window:{addEventListener(){}},confirm:()=>true});const source=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/boot\(\);\s*$/,'');vm.runInContext(source+`;user={id:'owner'};profile={role:'owner',active:true,display_name:'Owner'};stores=[{id:'finch',name:'Finch'},{id:'midland',name:'Midland'}];store='finch';quantities={milk:7};dirty=true;note='Unsaved owner note';draft={id:'owner-draft',revision:4};orders=[{id:'owner-order',store_id:'finch'}];receiptOrders=[...orders,{id:'other-order',store_id:'midland'}];catalog=[{id:'milk',name_ko:'우유',name_en:'Milk',category:'원재료·음료',subgroup:'유제품',order_unit:'EA',unit_confirmed:true,active:true}];`,ctx);return {ctx,node};}
test('enter, change role/store and exit preserve owner draft and block callbacks in preview',async()=>{const {ctx,node}=fixture();vm.runInContext("changePreview('employee','midland');",ctx);assert.equal(vm.runInContext('profile.role',ctx),'owner');assert.equal(vm.runInContext('draft',ctx),null);assert.equal(vm.runInContext('store',ctx),'midland');assert.equal(vm.runInContext('orders[0].id',ctx),'other-order');assert.ok(!node('#navigation').innerHTML.includes('data-page="catalog"'));assert.equal(node('#save').disabled,true);await vm.runInContext('run(async()=>{throw new Error("should not execute")})',ctx);assert.match(node('#message').textContent,/미리보기/);await assert.rejects(vm.runInContext('persistDraft()',ctx),/PREVIEW_READ_ONLY/);vm.runInContext("quantities.milk=99;changePreview('factory_manager');changePreview('owner');",ctx);assert.equal(vm.runInContext('quantities.milk',ctx),7);assert.equal(vm.runInContext('note',ctx),'Unsaved owner note');assert.equal(vm.runInContext('draft.id',ctx),'owner-draft');assert.equal(vm.runInContext('dirty',ctx),true);assert.equal(vm.runInContext('store',ctx),'finch');});
test('ordinary staff cannot activate or see the owner preview controls',()=>{const {ctx,node}=fixture();vm.runInContext("profile={role:'employee',active:true,display_name:'Employee'};changePreview('manager');render();",ctx);assert.equal(vm.runInContext('previewRole',ctx),'');assert.ok(!node('#portal').innerHTML.includes('id="previewRole"'));});

test('general manager has store manager pages without prices, settlement, factory or owner controls',()=>{
 const allowed=access.visiblePages('general_manager');
 for(const p of ['manual','receiving','order','history','waste','daily','sop'])assert.ok(allowed.includes(p));
 for(const p of ['settlement','production','purchases','overview'])assert.ok(!allowed.includes(p));
 assert.equal(access.canPreview({role:'manager',general_manager:true,active:true},'employee'),false);
 const {ctx}=fixture();vm.runInContext("changePreview('general_manager','midland');",ctx);
 assert.equal(vm.runInContext('screenRole()',ctx),'general_manager');
 assert.equal(vm.runInContext('screenProfile().role',ctx),'manager');
 assert.equal(vm.runInContext('screenStores().length',ctx),2);
});

test('signup screen includes multiple workplace checkboxes and a name without a role selector',()=>{const {ctx,node}=fixture();vm.runInContext("user=null;profile=null;mode='signup';signupLocations=[{id:'finch',name:'Finch'},{id:'midland',name:'Midland'}];signupWorkplaces=['finch','midland'];renderAuth();",ctx);const html=node('#auth').innerHTML;assert.match(html,/name="displayName"/);assert.equal((html.match(/checked/g)||[]).length,2);assert.match(html,/근무지 선택 · 복수 선택 가능/);assert.doesNotMatch(html,/name="role"/);});
test('basket shows direct quantity editing, removal and final submit inside the basket',()=>{
 const {ctx,node}=fixture();vm.runInContext(`cartOpen=true;renderCart();`,ctx);const html=node('#cart').innerHTML;assert.match(html,/data-cart-quantity="milk"/);assert.match(html,/data-cart-step="-1"/);assert.match(html,/data-cart-step="1"/);assert.match(html,/data-remove-cart="milk"/);assert.match(html,/id="basketSubmit"/);
});
test('loading a saved past delivery date keeps products and the explicitly selected date',async()=>{
 const {ctx}=fixture();ctx.savedBasket={id:'shared',store_id:'finch',delivery_date:'2020-01-01',items:[{product_id:'milk',quantity:9}],note:'keep',revision:2};
 vm.runInContext(`db={from(table){if(table!=='kream_store_baskets')throw Error(table);const q={select(){return q},eq(){return q},is(){return q},maybeSingle:async()=>({data:savedBasket})};return q;}}`,ctx);
 await vm.runInContext('loadDraft()',ctx);assert.equal(vm.runInContext('date',ctx),'2020-01-01');assert.equal(vm.runInContext('quantities.milk',ctx),9);
});
test('combined manager routes store and factory modules to the corresponding profile and assigned stores',()=>{
 const {ctx}=fixture();vm.runInContext("profile={role:'factory',factory_manager:true,store_manager:true,active:true,store_ids:['finch']};page='order';",ctx);
 assert.equal(vm.runInContext('screenRole()',ctx),'manager_factory');assert.equal(vm.runInContext('screenProfile().role',ctx),'manager');assert.equal(vm.runInContext('screenStores().length',ctx),1);
 vm.runInContext("page='productionlog'",ctx);assert.equal(vm.runInContext('screenProfile().role',ctx),'factory');
 vm.runInContext("page='waste';combinedArea='factory'",ctx);assert.equal(vm.runInContext('screenProfile().role',ctx),'factory');
});

test('manual basket save opens confirmation using acknowledged saved contents, not later edits',async()=>{
 const {ctx,node}=fixture();ctx.saveDraft=async()=>({id:'basket',store_id:'finch',delivery_date:'2026-11-05',items:[{product_id:'milk',quantity:7}],note:'saved note',revision:5});
 vm.runInContext("date=tomorrowToronto();renderOrderArea();",ctx);await node('#save').onclick();
 assert.equal(vm.runInContext('page',ctx),'orderSaved');assert.equal(vm.runInContext('orderConfirmation.items[0].quantity',ctx),7);
 vm.runInContext("quantities.milk=99;renderOrderConfirmation(document.querySelector('#proof'));",ctx);
 assert.match(node('#proof').innerHTML,/발주함에 저장했어요/);assert.match(node('#proof').innerHTML,/7 EA/);assert.doesNotMatch(node('#proof').innerHTML,/99 EA/);assert.match(node('#proof').innerHTML,/confirmationContinue/);
});
test('acknowledged submission opens completion even when history refresh fails',async()=>{
 const {ctx,node}=fixture();ctx.submitDraft=async()=> 'confirmed-order';
 vm.runInContext("page='order';draft={id:'basket',revision:2,store_id:'finch',delivery_date:'2026-11-05',items:[{product_id:'milk',quantity:7}],note:''};db={from(){throw new Error('History unavailable')}};",ctx);
 await vm.runInContext('completeBasketSubmission()',ctx);
 assert.equal(vm.runInContext('page',ctx),'orderComplete');assert.equal(vm.runInContext('uncertain',ctx),false);assert.equal(vm.runInContext('draft.submitted_order_id',ctx),'confirmed-order');
 vm.runInContext("renderOrderConfirmation(document.querySelector('#proof'))",ctx);assert.match(node('#proof').innerHTML,/KR-CONFIRME/);assert.match(node('#proof').innerHTML,/발주가 완료됐어요/);assert.match(node('#proof').innerHTML,/confirmationHistory/);
});
test('unconfirmed submission keeps the basket and retry state without showing success',async()=>{
 const {ctx}=fixture();ctx.submitDraft=async()=>{throw new Error('Network lost')};
 vm.runInContext("page='order';draft={id:'basket',revision:2};",ctx);
 await assert.rejects(vm.runInContext('completeBasketSubmission()',ctx),/Network lost/);
 assert.equal(vm.runInContext('page',ctx),'order');assert.equal(vm.runInContext('orderConfirmation',ctx),null);assert.equal(vm.runInContext('uncertain',ctx),true);assert.equal(vm.runInContext('draft.id',ctx),'basket');
});

test('the basket submit button reaches confirmed completion with reordered JSONB properties exactly once',async()=>{
 const {ctx,node}=fixture();let submissions=0;
 ctx.saveDraft=async(_db,_draft,p)=>({id:'shared',revision:23,store_id:p.store_id,delivery_date:p.delivery_date,note:p.note,items:p.items.map(i=>({quantity:i.quantity,product_id:i.product_id}))});
 ctx.submitDraft=async()=>{submissions++;return 'confirmed-from-cart'};
 vm.runInContext("orderView='grid';date=tomorrowToronto();db={from(){throw Error('History unavailable')}};cartOpen=true;renderOrderArea();",ctx);
 await node('#basketSubmit').onclick();
 assert.equal(submissions,1);assert.equal(vm.runInContext('page',ctx),'orderComplete');assert.equal(vm.runInContext('orderConfirmation.orderId',ctx),'confirmed-from-cart');assert.equal(vm.runInContext('cartOpen',ctx),false);
});
test('a real colleague addition requires another review and does not submit an unreviewed basket',async()=>{
 const {ctx,node}=fixture();let submissions=0;
 ctx.saveDraft=async(_db,_draft,p)=>({id:'shared',revision:23,store_id:p.store_id,delivery_date:p.delivery_date,note:p.note,items:[...p.items,{quantity:2,product_id:'colleague-item'}]});
 ctx.submitDraft=async()=>{submissions++;return 'not-called'};
 vm.runInContext("orderView='grid';date=tomorrowToronto();cartOpen=true;renderOrderArea();",ctx);await node('#basketSubmit').onclick();
 assert.equal(submissions,0);assert.equal(vm.runInContext('page',ctx),'order');assert.match(node('#message').textContent,/다른 직원/);assert.equal(vm.runInContext('quantities["colleague-item"]',ctx),2);
});

test('sourdough is a must-check count and its category tab stays visible under Needs order',()=>{
 const {ctx,node}=fixture();vm.runInContext("catalog.push({id:'sourdough',name_ko:'플레인 사워도우',category:'빵류',subgroup:'사워도우',order_unit:'개',unit_confirmed:true,active:true});orderMode='catalog';filter='need';renderCategories();",ctx);
 assert.match(node('#categories').innerHTML,/data-work-category="빵류"/);assert.equal(vm.runInContext("skipCount(catalog.find(p=>p.id==='sourdough'))",ctx),false);
});
test('completion state is rebuilt from saved daily counts rather than remembered browser ticks',()=>{
 const {ctx}=fixture();vm.runInContext("stepState=createStepState(store,countDate());stepState.done.add('milk');stock=[];stepStateFor();",ctx);assert.equal(vm.runInContext("stepState.done.has('milk')",ctx),false);
});
test('direct catalog browsing includes bread without a duplicate All-items screen',()=>{
 const {ctx,node}=fixture();vm.runInContext("orderMode='catalog';catalogCategory='빵류';catalogSubgroup='사워도우';orderView='steps';catalog.push({id:'sourdough',name_ko:'플레인 사워도우',category:'빵류',subgroup:'사워도우',order_unit:'개',unit_confirmed:true,active:true});stock=[{product_id:'sourdough',on_hand:1,physical_count_at:new Date().toISOString()}];renderProducts();",ctx);
 const html=['#products','#allReq','#allExtra'].map(k=>node(k).innerHTML).join('');assert.doesNotMatch(html,/전체 목록/);assert.match(html,/플레인 사워도우/);
});
test('packaging question asks about one box without changing its order unit',()=>{
 const {ctx}=fixture();assert.equal(vm.runInContext("packagingProduct({category:'포장·소모품',subgroup:'컵류'})",ctx),true);assert.equal(vm.runInContext("packagingProduct({category:'포장·소모품',subgroup:'청소용품'})",ctx),false);
 const source=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');assert.match(source,/한 박스 이상 남아 있나요/);
});

test('autosave waits while either order memo is focused, then saves the exact text after leaving it',async()=>{
 let timer,rendered=0,saves=[];
 const {ctx}=fixture({setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){timer=null;}});
 ctx.render=()=>{rendered++;};
 ctx.saveDraft=async(db,previous,payload)=>{saves.push(payload);return {...payload,id:previous.id,revision:previous.revision+1};};
 vm.runInContext("db={};date=defaultReceiptDate();draft={id:'basket',store_id:'finch',revision:1,items:[],note:''};note='Milk 1';dirty=true;",ctx);
 for(const id of ['note','basketExtraRequests']){
  ctx.document.activeElement={id,tagName:'TEXTAREA'};
  vm.runInContext('scheduleBasketSave()',ctx);assert.ok(timer);await timer();
  assert.equal(saves.length,0);assert.equal(rendered,0);assert.equal(vm.runInContext('dirty',ctx),true);
 }
 ctx.document.activeElement={tagName:'BUTTON'};
 ctx.nextNote='Milk 1\nLabels 2';vm.runInContext("note=nextNote;scheduleBasketSave()",ctx);await timer();await new Promise(r=>setImmediate(r));
 assert.equal(saves.length,1);assert.equal(saves[0].note,'Milk 1\nLabels 2');assert.equal(vm.runInContext('note',ctx),'Milk 1\nLabels 2');assert.equal(vm.runInContext('dirty',ctx),false);assert.equal(rendered,1);
});

test('a shared-basket refresh already in flight does not replace a newly focused memo',async()=>{
 const intervals=[];const {ctx}=fixture({setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;}});
 let resolveRead,rendered=0;ctx.render=()=>{rendered++;};
 const read=new Promise(resolve=>{resolveRead=resolve;});const query={select(){return this},eq(){return this},is(){return this},maybeSingle(){return read}};
 ctx.refreshDb={from:()=>query};vm.runInContext("db=refreshDb;dirty=false;draft={id:'basket',revision:1,items:[],note:'Saved note'};note='Saved note';",ctx);
 ctx.document.activeElement={tagName:'BUTTON'};
 const request=intervals.find(i=>i.ms===15000).fn();
 ctx.document.activeElement={id:'note',tagName:'TEXTAREA'};
 resolveRead({data:{id:'basket',revision:2,items:[],note:'Colleague note',delivery_date:'2099-01-01'}});await request;
 assert.equal(rendered,0);assert.equal(vm.runInContext('note',ctx),'Saved note');assert.equal(vm.runInContext('draft.revision',ctx),1);
});
test('a stock refresh already in flight does not redraw an order memo opened while waiting',async()=>{
 const intervals=[];const {ctx}=fixture({setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;}});
 let resolveRead,redraws=0;ctx.renderOrderArea=()=>{redraws++;};
 const read=new Promise(resolve=>{resolveRead=resolve;});const query={select(){return this},eq(){return this},then(resolve,reject){return read.then(resolve,reject)}};
 ctx.refreshDb={from:()=>query};vm.runInContext("db=refreshDb;dirty=false;stock=[];availabilityChecks=[];",ctx);ctx.document.activeElement={tagName:'BUTTON'};
 const request=intervals.filter(i=>i.ms===15000)[1].fn();ctx.document.activeElement={id:'basketExtraRequests',tagName:'TEXTAREA'};
 resolveRead({data:[]});await request;assert.equal(redraws,0);
});

test('mixed staff keep store employee rights while factory managers use factory HR context',()=>{
 const {ctx}=fixture();
 vm.runInContext("profile={role:'factory',factory_manager:false,store_manager:false,active:true,store_ids:['finch']};page='order';",ctx);
 assert.equal(vm.runInContext('screenRole()',ctx),'employee_factory');assert.equal(vm.runInContext('screenProfile().role',ctx),'employee');assert.equal(vm.runInContext('screenStores().length',ctx),1);
 vm.runInContext("page='dispatch'",ctx);assert.equal(vm.runInContext('screenProfile().role',ctx),'factory');
 vm.runInContext("profile.factory_manager=true;page='hr';entryFactory=false;",ctx);assert.equal(vm.runInContext('screenProfile().role',ctx),'factory');
 vm.runInContext("profile.factory_manager=false;profile.store_manager=true;page='order';",ctx);assert.equal(vm.runInContext('screenRole()',ctx),'manager_factory_staff');assert.equal(vm.runInContext('screenProfile().role',ctx),'manager');
});

test('declining the receipt date prevents both saving and submission',async()=>{const {ctx,node}=fixture();let saves=0,sends=0;ctx.confirmDeliveryDate=async()=>false;ctx.saveDraft=async()=>{saves++;};ctx.submitDraft=async()=>{sends++;};vm.runInContext("orderView='grid';date=tomorrowToronto();cartOpen=true;renderOrderArea();",ctx);await node('#basketSubmit').onclick();assert.equal(saves,0);assert.equal(sends,0);assert.equal(vm.runInContext('quantities.milk',ctx),7);assert.equal(vm.runInContext('page',ctx),'order');});
