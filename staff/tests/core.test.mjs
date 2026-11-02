import test from 'node:test';
import assert from 'node:assert/strict';
import {tomorrowToronto,validItems,saveDraft,submitDraft,aggregate} from '../core.mjs';

function mockDatabase() {
 let row=null, orders=new Map(), failResponse=false, counter=0;
 const db={from(table){assert.equal(table,'kream_drafts');let payload,insert=false,filters={};const q={
 update(p){payload=p;return q;},insert(p){insert=true;payload=p;return q;},eq(k,v){filters[k]=v;return q;},is(k,v){filters[k]=v;return q;},async select(){
 if(insert){if(row)return {error:{code:'23505'}};row={...structuredClone(payload),id:'draft-1',revision:1,submitted_order_id:null};return {data:[structuredClone(row)]};}
 if(!row||Object.entries(filters).some(([k,v])=>row[k]!==v))return {data:[]};
 assert.deepEqual(Object.keys(payload).sort(),['delivery_date','items','note']);row={...row,...structuredClone(payload),revision:row.revision+1};return {data:[structuredClone(row)]};}
 };return q;},async rpc(fn,{draft_id,expected_revision}){
 assert.equal(fn,'kream_submit_order');if(orders.has(draft_id))return {data:orders.get(draft_id)};
 if(row.revision!==expected_revision)return {error:{code:'40001'}};
 const id=`order-${++counter}`;orders.set(draft_id,id);row.submitted_order_id=id;
 if(failResponse){failResponse=false;return {error:{message:'Network response lost'}};}return {data:id};
 },loseNextResponse(){failResponse=true;},count(){return orders.size;}};return db;
}
const payload={user_id:'staff',store_id:'finch',delivery_date:'2026-11-02',items:[{product_id:'milk',quantity:2}],note:''};
test('Toronto tomorrow respects local midnight, year rollover and DST',()=>{
 assert.equal(tomorrowToronto(new Date('2026-11-02T04:30:00Z')),'2026-11-02');
 assert.equal(tomorrowToronto(new Date('2027-01-01T04:59:00Z')),'2027-01-01');
 assert.equal(tomorrowToronto(new Date('2026-03-08T07:30:00Z')),'2026-03-09');
});
test('stale device cannot overwrite newer cloud draft; local payload stays intact',async()=>{
 const db=mockDatabase(),first=await saveDraft(db,null,payload),deviceB=structuredClone(first);
 await saveDraft(db,first,{...payload,note:'newer'});
 const edits={...payload,note:'my unsaved edit'};
 await assert.rejects(saveDraft(db,deviceB,edits),/DRAFT_CONFLICT/);
 assert.equal(edits.note,'my unsaved edit');
});
test('concurrent first save does not silently upsert another draft',async()=>{
 const db=mockDatabase();await saveDraft(db,null,payload);await assert.rejects(saveDraft(db,null,payload),/DRAFT_CONFLICT/);
});
test('lost submit response retries same draft ID and gets same order',async()=>{
 const db=mockDatabase(),draft=await saveDraft(db,null,payload);db.loseNextResponse();
 await assert.rejects(submitDraft(db,draft));const id=await submitDraft(db,draft);
 assert.equal(id,'order-1');assert.equal(db.count(),1);assert.equal(await submitDraft(db,draft),id);
});
test('submitted draft cannot be edited',async()=>{
 await assert.rejects(saveDraft(mockDatabase(),{id:'x',submitted_order_id:'order'},payload),/ALREADY_SUBMITTED/);
});
test('invalid quantities and unconfirmed units rejected before submit',()=>{
 const catalog=[{id:'milk',active:true,unit_confirmed:true},{id:'unknown',active:true,unit_confirmed:false}];
 for(const q of [Infinity,-1,100001,'abc',0.0001])assert.throws(()=>validItems({milk:q},catalog));
 assert.throws(()=>validItems({unknown:1},catalog));assert.deepEqual(validItems({milk:'2.125'},catalog),[{product_id:'milk',quantity:2.125}]);
});
test('factory totals omit cancelled orders and never mix unlike units',()=>{
 const item={product_id:'milk',name_ko:'우유',order_unit:'Pack',quantity:2};
 const rows=aggregate([{status:'submitted',kream_order_items:[item,{...item,order_unit:'Box',quantity:1}]},{status:'cancelled',kream_order_items:[item]}]);
 assert.deepEqual(rows.map(r=>[r.order_unit,r.quantity]),[['Pack',2],['Box',1]]);
});
