// Merge server Clover observations without double-counting existing reports.
export function mergeCloverReports(reports,daily){
 const rows=[...reports];
 for(const d of daily){
  const v=d.result;
  if(!v||!Number.isSafeInteger(v.net_receipts_cents)||!Number.isSafeInteger(v.refunds_cents)||!Number.isFinite(Date.parse(d.captured_at)))continue;
  const old=reports.filter(r=>r.store_id===d.store_id&&r.business_date===d.business_date&&r.channel==='store').sort((a,b)=>Number(b.sequence)-Number(a.sequence))[0];
  if(old&&(old.report.status==='final'||Date.parse(old.observed_at)>=Date.parse(d.captured_at)))continue;
  rows.push({id:'clover-api:'+d.store_id+':'+d.business_date,sequence:Math.max(0,...reports.map(r=>Number(r.sequence)||0))+1,store_id:d.store_id,business_date:d.business_date,channel:'store',observed_at:d.captured_at,created_at:d.captured_at,report:{
   status:'provisional',sales_scope:old?.report.sales_scope==='includes_delivery'?'includes_delivery':'exclusive',metric_basis:'net_before_tax_after_refunds',
   sales_cents:v.net_receipts_cents,refunds_cents:v.refunds_cents,refund_count:v.refund_count??null,orders:v.order_count??null,fees_cents:null,payout_cents:null,top_items:[],bottom_items:[],ranking_basis:'quantity',
   source_url:'https://www.clover.com/reporting',
   note:'Clover API 자동 수집 · 성공 결제액에서 세금을 제외하고 해당일 환불의 세전 금액을 차감한 잠정액입니다. 팁은 합산하지 않습니다. 결제·환불 발생일(토론토) 기준이며 보고서 조정액에 따라 차이가 있을 수 있습니다. 품목 순위·음료 매출·재고 차감은 아직 연결되지 않았습니다.'
  }});
 }
 return rows;
}

export async function readCloverPeriod(db,start,end){
 const rows=[];
 for(let offset=0;;offset+=500){
  const r=await db.from('kream_clover_daily').select('store_id,business_date,captured_at,result').gte('business_date',start).lte('business_date',end).order('business_date').order('store_id').range(offset,offset+499);
  if(r.error)throw r.error;
  rows.push(...r.data);if(r.data.length<500)return rows;
 }
}
