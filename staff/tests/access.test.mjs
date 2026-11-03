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
test('preview is owner-only and factory manager adds only purchasing',()=>{assert.equal(canPreview({role:'owner',active:true},'manager'),true);for(const role of ['employee','manager','factory','midland_owner'])assert.equal(canPreview({role,active:true},'owner'),false);assert.equal(canPreview({role:'owner',active:false},'employee'),false);assert.equal(canPreview({role:'owner',active:true},'made-up'),false);const staff=visiblePages('factory_staff'),manager=visiblePages('factory_manager');assert.ok(staff.includes('inventory'));assert.deepEqual(manager.filter(p=>!staff.includes(p)),['purchases','catalogreview']);assert.deepEqual(staff.filter(p=>!manager.includes(p)),[]);assert.ok(!visiblePages('factory').includes('purchases'));});
test('employee preview scopes orders and receipts and excludes unpublished/wrong-store guides',()=>{const data={orders:[{id:'a',store_id:'finch'},{id:'b',store_id:'midland'}],receipts:[{order_id:'a',store_id:'finch'},{order_id:'b',store_id:'midland'}],guides:[{id:'g',store_id:null,published:true},{id:'draft',store_id:'finch',published:false},{id:'other',store_id:'midland',published:true},{id:'archived',store_id:'finch',published:true,archived:true}]};const scoped=scopePreview('employee','finch',data);assert.deepEqual(scoped.orders.map(o=>o.id),['a']);assert.equal(scoped.receipts.length,1);assert.deepEqual(scoped.guides.map(g=>g.id),['g']);assert.deepEqual(scopePreview('manager','finch',data).guides.map(g=>g.id),['g','draft']);});
function fixture(){const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){},innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{toggle(){}},querySelector:s=>node(s),querySelectorAll:()=>[],scrollIntoView(){}});return nodes.get(id);};const ctx=vm.createContext({setInterval:()=>0,setTimeout:()=>0,clearTimeout(){},...workplaceModule,quantityStep,...availability,...settlementModule,...subcategoryModule,...catalogModule,...dailyModule,...replenishmentModule,...layoutModule,...checklistModule,...journalModule,...overviewModule,...stockModule,...dispatchModule,...productionModule,...wasteModule,...core,...presentation,...operations,...access,URLSearchParams,Intl,Date,console,localStorage:{getItem:()=>null,setItem(){}},location:{hash:''},document:{querySelector:node,querySelectorAll:()=>[],documentElement:{},body:{classList:{toggle(){}}}},window:{addEventListener(){}},confirm:()=>true});const source=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/boot\(\);\s*$/,'');vm.runInContext(source+`;user={id:'owner'};profile={role:'owner',active:true,display_name:'Owner'};stores=[{id:'finch',name:'Finch'},{id:'midland',name:'Midland'}];store='finch';quantities={milk:7};dirty=true;note='Unsaved owner note';draft={id:'owner-draft',revision:4};orders=[{id:'owner-order',store_id:'finch'}];receiptOrders=[...orders,{id:'other-order',store_id:'midland'}];catalog=[{id:'milk',name_ko:'우유',name_en:'Milk',category:'원재료·음료',subgroup:'유제품',order_unit:'EA',unit_confirmed:true,active:true}];`,ctx);return {ctx,node};}
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
test('loading a stale saved delivery date keeps products and defaults to Toronto tomorrow',async()=>{
 const {ctx}=fixture();ctx.savedBasket={id:'shared',store_id:'finch',delivery_date:'2020-01-01',items:[{product_id:'milk',quantity:9}],note:'keep',revision:2};
 vm.runInContext(`db={from(table){if(table!=='kream_store_baskets')throw Error(table);const q={select(){return q},eq(){return q},is(){return q},maybeSingle:async()=>({data:savedBasket})};return q;}}`,ctx);
 await vm.runInContext('loadDraft()',ctx);assert.equal(vm.runInContext('date===tomorrowToronto()',ctx),true);assert.equal(vm.runInContext('quantities.milk',ctx),9);
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
 vm.runInContext("date=tomorrowToronto();db={from(){throw Error('History unavailable')}};cartOpen=true;renderOrderArea();",ctx);
 await node('#basketSubmit').onclick();
 assert.equal(submissions,1);assert.equal(vm.runInContext('page',ctx),'orderComplete');assert.equal(vm.runInContext('orderConfirmation.orderId',ctx),'confirmed-from-cart');assert.equal(vm.runInContext('cartOpen',ctx),false);
});
test('a real colleague addition requires another review and does not submit an unreviewed basket',async()=>{
 const {ctx,node}=fixture();let submissions=0;
 ctx.saveDraft=async(_db,_draft,p)=>({id:'shared',revision:23,store_id:p.store_id,delivery_date:p.delivery_date,note:p.note,items:[...p.items,{quantity:2,product_id:'colleague-item'}]});
 ctx.submitDraft=async()=>{submissions++;return 'not-called'};
 vm.runInContext("date=tomorrowToronto();cartOpen=true;renderOrderArea();",ctx);await node('#basketSubmit').onclick();
 assert.equal(submissions,0);assert.equal(vm.runInContext('page',ctx),'order');assert.match(node('#message').textContent,/다른 직원/);assert.equal(vm.runInContext('quantities["colleague-item"]',ctx),2);
});
