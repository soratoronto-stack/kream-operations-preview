import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saleLines} from '../../supabase/functions/kream-clover-sync/inventory.mjs';
import {safeMapping} from '../../supabase/functions/kream-clover-sync/mapping.mjs';
import {needsOrder,filterProducts} from '../presentation.mjs';
const paid=[{id:'payment1',order:{id:'o'},result:'SUCCESS',amount:1000,createdTime:1800000000000}];
const order={id:'o',paymentState:'OPEN',total:1000,state:'locked'};
const line={id:'l',name:'Cookie',isRevenue:true,item:{id:'i'},modifications:{elements:[{id:'m',name:'Matcha'}]}};
test('successful full payment overrides stale OPEN state; preserves modifiers and only quantity data',()=>{
 const [row]=saleLines(order,[{...line,customer:{email:'private'}}],paid);
 assert.equal(row.quantity,1);assert.equal(row.item_id,'i:m');assert.equal(row.name,'Cookie · Matcha');assert.ok(!JSON.stringify(row).includes('private'));
});
test('unpaid, partial, voided and test transactions never consume stock',()=>{
 assert.deepEqual(saleLines({...order,total:2000},[line],paid),[]);
 assert.deepEqual(saleLines(order,[line],[{...paid[0],voided:true}]),[]);
 assert.deepEqual(saleLines({...order,testMode:true},[line],paid),[]);
 assert.deepEqual(saleLines(order,[{...line,voided:true}],paid),[]);
});
test('fixed-point quantity and refund policy: refund does not put food back',()=>{
 assert.equal(saleLines({...order,paymentState:'REFUNDED'},[{...line,unitQty:2500,refunded:true}],paid)[0].quantity,2.5);
 assert.throws(()=>saleLines(order,[{...line,unitQty:0}],paid));
});
test('exact flavour mapping never guesses mixed sets or unidentified packs',()=>{
 const cat=[{id:'sheet-c42f92202d',active:true,category:'디저트',order_unit:'EA',name_en:'Mango Tiramisu'}];
 assert.equal(safeMapping('Tiramisu · Mango',cat).product_id,'sheet-c42f92202d');
 for(const name of ['Classic Tiramisu · Classic / Mango','Dubai Chewy · Dubai 3pc','Cookie Set','Tiramisu','Milk'])assert.deepEqual(safeMapping(name,cat),{});
});
test('minimum threshold includes equality and zero, excludes unknown or invalid stock',()=>{
 assert.equal(needsOrder({on_hand:6,minimum:6}),true);assert.equal(needsOrder({on_hand:0,minimum:0}),true);
 assert.equal(needsOrder({on_hand:7,minimum:6}),false);
 for(const s of [{on_hand:null,minimum:6},{on_hand:0,minimum:null},{on_hand:'',minimum:0},{on_hand:'invalid',minimum:3},undefined])assert.equal(needsOrder(s),false);
 assert.equal(filterProducts([{id:'a',category:'A',name_ko:'a',name_en:'a'}],{filter:'need',category:'B',stock:[{product_id:'a',on_hand:6,minimum:6}]}).length,1);
});
test('collector sends uniform mapped/unmapped rows, uses only GET against Clover and keeps its key server-side',async()=>{
 const {collectInventory}=await import('../../supabase/functions/kream-clover-sync/inventory.mjs');
 const requests=[],writes=[];const now=1800000001000;
 const catalog=[{id:'sausage-bread',active:true,category:'디저트',order_unit:'개',name_en:'Sausage Bread'}];
 await collectInventory({connection:{merchant_id:'ABCDEFGHIJKLM',store_id:'finch',token:'server-test-secret'},state:{inventory_started_at:new Date(now-60000).toISOString(),inventory_cursor:new Date(now-1000).toISOString(),inventory_last_success_at:new Date(now-1000).toISOString()},catalog,now,db:async(...args)=>writes.push(args),fetchImpl:async(url,opts)=>{
 requests.push([String(url),opts]);const path=new URL(url).pathname;
 const data=path.endsWith('/payments')?{elements:paid}:path.endsWith('/line_items')?{elements:[{id:'a',item:{id:'sausage'},name:'Sausage Bread'},{id:'b',item:{id:'coffee'},name:'Coffee'}]}:{...order,paymentState:'PAID',payments:{elements:paid}};
 return {ok:true,status:200,json:async()=>data};
 }});
 assert.ok(requests.every(([u,o])=>u.startsWith('https://api.clover.com/')&&!o.method));
 const rows=writes.find(([path])=>path.startsWith('kream_clover_items'))[1];
 assert.deepEqual(Object.keys(rows[0]).sort(),Object.keys(rows[1]).sort());assert.equal(rows[0].enabled,true);assert.equal(rows[1].enabled,false);
 assert.ok(!JSON.stringify(writes).includes('server-test-secret'));
});
