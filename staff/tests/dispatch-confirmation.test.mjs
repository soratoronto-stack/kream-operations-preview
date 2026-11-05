import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchReview,renderDispatch,clearDispatchState,verifyDispatch} from '../dispatch.mjs';

test('ordered 3, sent 2 retains one unshipped unit and can finalize before its reason is recorded',()=>{
 const rows=[{product_id:'cake',quantity:3,remaining:3}];
 const noReason=dispatchReview(rows,{cake:2});
 assert.equal(noReason.shortages[0].unshipped,1);assert.equal(noReason.reasonRequired,false);assert.equal(noReason.ready,true);
 assert.equal(dispatchReview(rows,{cake:2},'생산 부족').ready,true);
 assert.equal(dispatchReview(rows,{cake:0},'미생산').shortages[0].unshipped,3);
 assert.equal(dispatchReview(rows,{cake:3}).ready,true);
 assert.equal(dispatchReview(rows,{cake:4},'x').invalid.length,1);
});
test('unchecked items are never silently treated as shipped',()=>{
 const rows=Array.from({length:10},(_,i)=>({product_id:i?'other'+i:'cake',remaining:i?1:3}));
 const r=dispatchReview(rows,{cake:2},'부족');
 assert.equal(r.missing.length,9);assert.equal(r.shortages[0].unshipped,1);assert.equal(r.ready,false);
});
test('confirmation shows local missing-item errors before starting the busy action',async()=>{
 clearDispatchState();
 const nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:k==='[name="store"]'?'finch':'',dataset:{},textContent:'',innerHTML:'',hidden:false,focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},setAttribute(){},replaceWith(){},querySelector:node,querySelectorAll:()=>[]});return nodes.get(k);};
 const order={id:'o',store_id:'finch',source_kind:'store',kream_order_items:[{product_id:'cake',name_ko:'테스트 케이크',name_en:'Chewy',order_unit:'EA',quantity:3},{product_id:'cookie',name_ko:'쿠키',name_en:'Cookie',order_unit:'Bag',quantity:1}]};
 const inputs=order.kream_order_items.map(i=>({...node(i.product_id),dataset:{sendOrder:'o',sendProduct:i.product_id}}));
 const send={dataset:{send:'o'}},note={dataset:{sendNote:'o'}};
 const host={innerHTML:'',querySelector:node,querySelectorAll:s=>s==='[data-send-product]'?inputs:s==='[data-send]'?[send]:s==='[data-send-note]'?[note]:[]};
 let actions=0;
 await renderDispatch(host,{db:null,date:'2026-11-04',orders:[order],dispatches:[],receipts:[],stores:[{id:'finch',name:'Finch'}],catalog:order.kream_order_items.map(i=>({...i,unit_confirmed:true,active:true,category:'디저트'})),t:ko=>ko,esc:String,name:p=>p.name_ko,act:async()=>{actions++;},say(){},reload:async()=>{}});
 inputs[0].oninput({target:{value:'2'}});send.onclick();
 assert.equal(actions,0);assert.match(node('[data-send-error="o"]').textContent,/쿠키/);assert.equal(inputs[1].focused,true);
 inputs[1].oninput({target:{value:'1'}});
 assert.equal(dispatchReview([{product_id:'cake',remaining:3},{product_id:'cookie',remaining:1}],{cake:2,cookie:1}).ready,true);
 clearDispatchState();
});
test('dispatch is acknowledged only after actual quantities and closed order are read back',async()=>{
 const payload={request_id:'r',target_order:'o',actual_items:[{product_id:'cake',quantity:2}]};
 let quantity=2,closed=true;
 const db={from(table){return {select(){return this;},eq(){return this;},single:async()=>({data:table==='kream_orders'?{id:'o',status:'dispatched',dispatch_finalized_at:closed?'2026-11-04':null}:{id:'r',order_id:'o',actual_items:[{quantity,product_id:'cake'}]}})}}};
 await verifyDispatch(db,payload);quantity=3;await assert.rejects(verifyDispatch(db,payload),/DISPATCH_NOT_VERIFIED/);quantity=2;closed=false;await assert.rejects(verifyDispatch(db,payload),/DISPATCH_NOT_VERIFIED/);
});

test('confirming 3 ordered and 2 sent reloads a closed order with one unshipped unit and no pending confirm button',async()=>{
 clearDispatchState();
 const nodes=new Map();const node=k=>{if(!nodes.has(k))nodes.set(k,{value:k==='[name="store"]'?'finch':'',dataset:{},innerHTML:'',textContent:'',focus(){},scrollIntoView(){},setAttribute(){},replaceWith(){},querySelector:node,querySelectorAll:()=>[]});return nodes.get(k);};
 const order={id:'test-order',store_id:'finch',status:'submitted',source_kind:'store',kream_dispatches:[],kream_order_items:[{product_id:'cake',name_ko:'테스트 케이크',name_en:'Chewy',order_unit:'EA',quantity:3}]};
 const input={value:'',dataset:{sendOrder:order.id,sendProduct:'cake'}},note={dataset:{sendNote:order.id}},send={dataset:{send:order.id}};
 const host={innerHTML:'',querySelector:node,querySelectorAll:s=>s==='[data-send-product]'?[input]:s==='[data-send-note]'?[note]:s==='[data-send]'?[send]:[]};
 let payload,reloads=0,message='';
 const db={from(table){return {select(){return this;},eq(){return this;},in(){return this;},neq(){return this;},order(){return this;},range:async()=>({data:table==='kream_orders'?[order]:[]}),single:async()=>({data:table==='kream_orders'?order:{id:payload.request_id,order_id:order.id,actual_items:payload.actual_items}})};},async rpc(name,p){assert.equal(name,'kream_finalize_dispatch');assert.deepEqual(p.expected_items,[{product_id:'cake',quantity:3}]);assert.deepEqual(p.actual_items,[{product_id:'cake',quantity:2}]);assert.equal(p.dispatch_note,'');payload=p;order.status='dispatched';order.dispatch_finalized_at='2026-11-04T02:00:00Z';order.kream_dispatches=[{id:p.request_id,order_id:order.id,created_at:order.dispatch_finalized_at,note:p.dispatch_note,kream_dispatch_items:p.actual_items}];return {error:null};}};
 const c={confirmDispatch:async()=>true,db,date:'2026-11-04',stores:[{id:'finch',name:'Finch'}],catalog:[],t:ko=>ko,esc:String,name:p=>p.name_ko,act:fn=>fn(),say:m=>{message=m;},reload:async()=>{reloads++;await renderDispatch(host,c);}};
 const originalConfirm=globalThis.confirm;globalThis.confirm=()=>true;
 try{await renderDispatch(host,c);input.oninput({target:{value:'2'}});await send.onclick();
 assert.equal(reloads,1);assert.equal(order.status,'dispatched');assert.match(message,/저장하고 다시 확인/);
 const html=node('#dispatchBody').innerHTML;assert.doesNotMatch(html,/data-send="test-order"/);assert.match(html,/미출고 기록/);assert.match(html,/테스트 케이크<\/strong><b>1 EA<\/b>/);assert.match(html,/출고 확정 이력/);assert.match(html,/미출고 사유 저장/);assert.match(html,/사유 미작성 · 출고 확정은 완료됐습니다/);
 }finally{globalThis.confirm=originalConfirm;clearDispatchState();}
});

import fs from 'node:fs';
test('ordered-quantity action is below the items and immediately before final confirmation',()=>{const s=fs.readFileSync(new URL('../dispatch.mjs',import.meta.url),'utf8');const bulk=s.indexOf('data-send-all=');assert.ok(bulk>s.indexOf('</tbody></table>'));assert.ok(bulk<s.indexOf('data-send="${o.id}"'));assert.match(s,/발주량대로 출고확인/);assert.doesNotMatch(s,/미선택 품목을 발주량대로 출고 선택/);});
