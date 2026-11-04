import test from 'node:test';import assert from 'node:assert/strict';
import {mergeProductSubset,productOrderView,productOrderTools,bindProductOrder,hasProductOrderEdits,clearProductOrder} from '../product-drag.mjs';
const catalog=[{id:'a',category:'음료',subgroup:'유제품'},{id:'b',category:'음료',subgroup:'유제품'},{id:'c',category:'포장',subgroup:'컵'}];
const c={catalog,list:catalog.slice(0,2),category:'음료',subgroup:'유제품',filter:'all',search:'',store:'finch',profile:{role:'manager'},layout:{revision:8,category_order:['포장','음료'],subgroup_order:['컵','유제품'],product_order:['a','c','b']},t:k=>k,esc:s=>s,redraw(){},reload:async()=>{},say(){},act:fn=>fn()};
test('reordering selected products preserves unrelated and hidden product slots',()=>{assert.deepEqual(mergeProductSubset(['a','hidden','c','b'],['b','a']),['b','hidden','c','a']);});
test('employee and filtered/search results do not expose drag editing',()=>{clearProductOrder();for(const patch of [{profile:{role:'employee'}},{search:'우유'},{filter:'frequent'}])assert.equal(!!productOrderView(c.list,{...c,...patch}).eligible,false);assert.equal(!!productOrderView(c.list,c).eligible,true);});
test('keyboard reorder saves store and revision once, preserves other groups and cancellation restores order',async()=>{
 clearProductOrder();const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(e,fn){this[e]=fn;},querySelectorAll(){return [];},focus(){}});return nodes.get(id);};
 const handle=node('handle'),card={dataset:{orderId:'a'},querySelector(){return handle;}};handle.closest=()=>card;
 const host={querySelector:node,querySelectorAll:()=>[card]};node('#products').querySelectorAll=()=>[handle];let payload,calls=0;
 const ctx={...c,db:{async rpc(n,p){calls++;payload=p;return {data:9};}}};bindProductOrder(host,ctx);node('#editProductOrder').click();bindProductOrder(host,ctx);handle.onkeydown({key:'ArrowRight',preventDefault(){}});
 assert.equal(hasProductOrderEdits(),true);assert.deepEqual(productOrderView(c.list,ctx).list.map(p=>p.id),['b','a']);await node('#saveProductOrder').click();assert.equal(calls,1);assert.equal(payload.expected_revision,8);assert.equal(payload.target_store,'finch');assert.deepEqual(payload.products,['b','c','a']);assert.deepEqual(payload.categories,c.layout.category_order);assert.deepEqual(payload.subgroups,c.layout.subgroup_order);assert.equal(hasProductOrderEdits(),false);
 node('#editProductOrder').click();bindProductOrder(host,ctx);handle.onkeydown({key:'ArrowRight',preventDefault(){}});node('#cancelProductOrder').click();assert.deepEqual(productOrderView(c.list,ctx).list.map(p=>p.id),['a','b']);
});

test('category-wide ordering works for Midland and Richmond without selecting a subcategory',()=>{for(const store of ['midland','richmond-hill'])assert.equal(!!productOrderView(c.list,{...c,store,subgroup:''}).eligible,true);});
