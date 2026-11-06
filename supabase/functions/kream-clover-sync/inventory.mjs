import {safeMapping} from './mapping.mjs';
import {collection} from './collect.mjs';
export function saleLines(order,lines,payments){
 if(order.testMode||order.deletedTime||order.deletedTimestamp)return [];
 const valid=payments.filter(p=>p.result==='SUCCESS'&&!p.voided&&p.order?.id===order.id);
 if(!valid.length)return [];
 const paid=valid.reduce((n,p)=>n+(Number.isSafeInteger(p.amount)?p.amount:0),0);
 if(!['PAID','REFUNDED','PARTIALLY_REFUNDED','CREDITED'].includes(order.paymentState)&&!(Number.isSafeInteger(order.total)&&order.total>0&&paid>=order.total))return [];
 const soldAt=Math.max(...valid.map(p=>p.createdTime));
 if(!Number.isSafeInteger(soldAt))throw Error('Missing sale timestamp');
 return lines.filter(l=>!l.voided&&!l.deleted&&l.item?.id).map(l=>{
  // unitQty is a thousandths fixed-point value. Ordinary lines are one unit.
  const quantity=l.unitQty==null?1:l.unitQty/1000;
  if(!l.id||!Number.isFinite(quantity)||quantity<=0||quantity>100000)throw Error('Invalid sold quantity');
  const mods=l.modifications?.elements||[];
  const modifierIds=mods.map(m=>m.modifier?.id||m.id).sort();
  const itemId=l.item.id+(modifierIds.length?':'+modifierIds.join(','):'');
  const name=String(l.name||l.item.name||l.item.id)+(mods.length?' · '+mods.map(m=>m.name||m.modifier?.name||'option').join(' / '):'');
  return {line_id:l.id,order_id:order.id,item_id:itemId,name,sold_at:new Date(soldAt).toISOString(),quantity};
 });
}
export async function collectInventory({connection,state,catalog=[],db,now=Date.now(),fetchImpl=fetch}){
 const get=async(path,params={})=>{
  const u=new URL(`https://api.clover.com/v3/merchants/${connection.merchant_id}/${path}`);
  for(const [k,v] of Object.entries(params))for(const part of Array.isArray(v)?v:[v])u.searchParams.append(k,String(part));
  let r;
  for(let a=0;a<3;a++){
   await new Promise(resolve=>setTimeout(resolve,a?2000*a:650));
   r=await fetchImpl(u,{headers:{Authorization:`Bearer ${connection.token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(r.status!==429)break;await r.text();
  }
  if(!r.ok)throw Error(`Clover inventory read failed (${r.status})`);
  return r.json();
 };
 if(!state.inventory_last_success_at){
  const items=await collection(get,'items');
  // Ignore duplicates so a server refresh can never overwrite owner mappings.
  for(let i=0;i<items.length;i+=100)await db('kream_clover_items?on_conflict=store_id,clover_item_id',items.slice(i,i+100).filter(x=>!x.deleted).map(x=>({store_id:connection.store_id,clover_item_id:x.id,name:String(x.name||x.id),product_id:null,stock_per_sale:1,enabled:false,...safeMapping(x.name,catalog,connection.store_id)})),'POST','resolution=ignore-duplicates,return=minimal');
 }
 const start=state.inventory_cursor?Math.max(Date.parse(state.inventory_started_at),Date.parse(state.inventory_cursor)-600000):now-2*3600000;
 const payments=await collection(get,'payments',{expand:'order',filter:[`createdTime>=${start}`,`createdTime<${now}`]});
 const ids=[...new Set(payments.filter(p=>p.result==='SUCCESS'&&!p.voided).map(p=>p.order?.id).filter(Boolean))];
 if(ids.length>100)throw Error('Inventory backlog requires review; cursor retained');
 let observed=0;const states={};let lineCount=0;
 for(const id of ids){
  const order=await get(`orders/${encodeURIComponent(id)}`,{expand:'payments'});
  const lines=await collection(get,`orders/${encodeURIComponent(id)}/line_items`,{expand:'modifications'});
  states[order.paymentState||'missing']=(states[order.paymentState||'missing']||0)+1;lineCount+=lines.length;
  const allPayments=[...new Map([...payments,...(order.payments?.elements||[]).map(p=>({...p,order:{id}}))].map(p=>[p.id,p])).values()];
  const sales=saleLines(order,lines,allPayments);
  if(sales.length){
   await db('kream_clover_items?on_conflict=store_id,clover_item_id',sales.map(s=>({store_id:connection.store_id,clover_item_id:s.item_id,name:s.name,product_id:null,stock_per_sale:1,enabled:false,...safeMapping(s.name,catalog,connection.store_id)})),'POST','resolution=ignore-duplicates,return=minimal');
   await db('rpc/kream_apply_clover_sales',{target_store:connection.store_id,sales});observed+=sales.length;}
 }
 await db(`kream_clover_connections?store_id=eq.${encodeURIComponent(connection.store_id)}`,{inventory_cursor:new Date(now).toISOString(),inventory_last_success_at:new Date(now).toISOString(),inventory_last_error:null},'PATCH');
 return {observed,payments:payments.length,orders:ids.length,lineCount,states};
}

