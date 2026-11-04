export const channels=['store','uber','fantuan'];
export const labels={store:['매장','In-store'],uber:['Uber Eats','Uber Eats'],fantuan:['Fantuan','Fantuan']};
export function latestReports(rows){const m=new Map();for(const r of rows){const k=`${r.store_id}:${r.channel}`;if(!m.has(k)||Number(m.get(k).sequence)<Number(r.sequence))m.set(k,r);}return [...m.values()];}
export const money=v=>v==null?'—':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(v/100);
export function cents(v){if(v.trim()==='')return null;if(!/^-?\d+(\.\d{1,2})?$/.test(v.trim()))throw Error('INVALID_MONEY');const neg=v.trim().startsWith('-');const [a,b='']=v.trim().replace('-','').split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n>100000000000)throw Error('INVALID_MONEY');return neg?-n:n;}
const observed=r=>r&&['provisional','final'].includes(r.status)&&Number.isSafeInteger(r.sales_cents);
const comparable=r=>observed(r)&&r.metric_basis==='net_before_tax_after_refunds';
export function includedSales(rows){
 const current=latestReports(rows),store=current.find(r=>r.channel==='store');
 // A Clover figure with unknown delivery coverage can stand alone, never alongside platform sales.
 if(comparable(store?.report)&&store.report.sales_scope!=='exclusive')return [store];
 return current.filter(r=>channels.includes(r.channel)&&comparable(r.report)&&r.report.sales_scope==='exclusive');
}
export function totalForStore(rows){const included=includedSales(rows);return included.length?included.reduce((n,r)=>n+r.report.sales_cents,0):null;}
export function summary(rows,storeIds){
 const current=latestReports(rows).filter(r=>storeIds.includes(r.store_id)&&channels.includes(r.channel));
 const groups=storeIds.map(id=>current.filter(r=>r.store_id===id)),totals=groups.map(totalForStore),included=groups.flatMap(includedSales);
 const channelCounts={},byChannel=Object.fromEntries(channels.map(k=>{const rs=current.filter(r=>r.channel===k&&observed(r.report));channelCounts[k]=rs.length;return [k,rs.length?rs.reduce((n,r)=>n+r.report.sales_cents,0):null];}));
 const completeStores=groups.filter(rs=>channels.every(k=>{const r=rs.find(r=>r.channel===k)?.report;return r?.status==='not_applicable'||(comparable(r)&&r.sales_scope==='exclusive');})).length;
 return {current,total:included.length?included.reduce((n,r)=>n+r.report.sales_cents,0):null,byChannel,channelCounts,completeStores,includedCount:included.length,excludedCount:current.filter(r=>observed(r.report)&&!included.includes(r)).length,availableStores:totals.filter(n=>n!=null).length};
}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export async function saveVerifiedReport(db,payload){const saved=await db.rpc('kream_save_sales_report',payload);if(saved.error)throw saved.error;const read=await db.from('kream_sales_reports').select('*').eq('id',payload.request_id).single();if(read.error)throw read.error;const r=read.data;if(r.id!==payload.request_id||r.store_id!==payload.target_store||r.business_date!==payload.record_date||r.channel!==payload.source_channel||new Date(r.observed_at).getTime()!==new Date(payload.observed_time).getTime()||canonical(r.report)!==canonical(payload.report_data))throw Error('SAVE_NOT_VERIFIED');return r;}

