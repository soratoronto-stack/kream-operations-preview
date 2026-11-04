import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cents,summary,saveVerifiedReport} from '../sales-core.mjs';
const row=(channel,sales,status='final',scope='exclusive',sequence=1)=>({id:`${channel}-${sequence}`,sequence,store_id:'midland',channel,report:{status,sales_cents:sales,sales_scope:scope,metric_basis:'net_before_tax_after_refunds'}});
test('available records subtotal without treating missing channels as zero or double counting delivery',()=>{
 assert.equal(summary([row('store',10000)],['midland']).total,10000);
 assert.equal(summary([row('store',10000,'final','includes_delivery'),row('uber',2000),row('fantuan',3000)],['midland']).total,10000);
 assert.equal(summary([],['midland']).byChannel.store,null);
});
test('latest observation replaces earlier amounts, preserving zero and explicit nonoperating channels',()=>{
 const s=summary([row('store',10000),row('store',15000,'provisional','exclusive',2),row('uber',0),row('fantuan',null,'not_applicable')],['midland']);
 assert.equal(s.total,15000);assert.equal(s.current.length,3);assert.equal(s.byChannel.uber,0);
 assert.equal(summary([row('store',10000),row('uber',2000),row('fantuan',3000)],['midland','finch']).total,15000);
});
test('money parsing uses exact decimal cents and distinguishes blank from zero',()=>{
 assert.equal(cents(''),null);assert.equal(cents('0'),0);assert.equal(cents('12.34'),1234);assert.equal(cents('-1.25'),-125);
 for(const x of ['NaN','1.234','1e3','1,000','--2'])assert.throws(()=>cents(x));
});
test('read-back mismatch does not acknowledge a save; JSON property order is irrelevant',async()=>{
 const payload={request_id:'x',target_store:'midland',record_date:'2026-11-03',source_channel:'store',observed_time:'2026-11-04T01:00:00Z',report_data:{status:'provisional',sales_cents:1234}};
 const result={id:'x',store_id:'midland',business_date:'2026-11-03',channel:'store',observed_at:'2026-11-04T01:00:00+00:00',report:{sales_cents:1234,status:'provisional'}};
 const db={rpc:async()=>({data:'x'}),from(){return {select(){return this},eq(){return this},single:async()=>({data:result})}}};
 assert.equal((await saveVerifiedReport(db,payload)).id,'x');result.report.sales_cents=999;
 await assert.rejects(saveVerifiedReport(db,payload),/SAVE_NOT_VERIFIED/);
});


test('separately operated Clover and Uber are included with provisional source basis',()=>{
 const uber=row('uber',19631,'provisional');uber.report.metric_basis='other';
 const store=row('store',110237,'provisional','unknown');
 const s=summary([store,uber],['midland','finch']);
 assert.equal(s.byChannel.uber,19631);assert.equal(s.channelCounts.uber,1);
 assert.equal(s.total,129868);assert.equal(s.availableStores,1);assert.equal(s.excludedCount,0);
});
test('a newer unavailable report suppresses an old number; zero is still an observation',()=>{
 const s=summary([row('uber',2000),row('uber',null,'unavailable','exclusive',2),row('store',0,'provisional')],['midland','finch']);
 assert.equal(s.byChannel.uber,null);assert.equal(s.byChannel.store,0);assert.equal(s.total,0);
 assert.equal(s.channelCounts.store,1);assert.equal(s.channelCounts.uber,0);
});

test('monthly reports retain each day and exclude superseded daily observations',()=>{const a={...row('store',1000),business_date:'2026-11-01'},b={...row('store',2000),business_date:'2026-11-02'},newer={...a,sequence:2,report:{...a.report,sales_cents:1500}};assert.equal(summary([a,b,newer],['midland']).total,3500);});
