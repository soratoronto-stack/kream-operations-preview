import {collection,torontoDate} from './collect.mjs';
const cents=n=>Number.isSafeInteger(n)&&n>=0;
export function reconcilePayments(payments,refunds){
 const paid=payments.filter(p=>p.result==='SUCCESS'&&p.voided!==true);
 const returned=refunds.filter(r=>r.voided!==true);
 if([...paid,...returned].some(p=>!cents(p.amount)||!cents(p.taxAmount)||p.taxAmount>p.amount))throw Error('Incomplete amount/tax fields');
 // Clover Payment.amount includes tax and excludes tips. Refund.amount also
 // includes refund.taxAmount. Observe refunds on their refund business date.
 const payment_amount_cents=paid.reduce((n,p)=>n+p.amount,0);
 const refunds_cents=returned.reduce((n,r)=>n+r.amount-r.taxAmount,0);
 const net_receipts_cents=paid.reduce((n,p)=>n+p.amount-p.taxAmount,0)-refunds_cents;
 if(![payment_amount_cents,refunds_cents,net_receipts_cents].every(Number.isSafeInteger))throw Error('Amount overflow');
 return {payment_amount_cents,net_receipts_cents,refunds_cents,payment_count:paid.length,refund_count:returned.length,
  order_count:new Set(paid.map(p=>p.order?.id).filter(Boolean)).size,
  reconciliation_required:true};
}
export async function collectDaily({merchantId,date,accessToken,now=Date.now(),fetchImpl=fetch}){
 if(!/^[A-Z0-9]{13}$/.test(merchantId)||!accessToken||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Verified connection required');
 const center=Date.parse(date+'T12:00:00Z');
 if(!Number.isFinite(center)||new Date(center).toISOString().slice(0,10)!==date||date>torontoDate(now))throw Error('Invalid business date');
 const get=async(path,params)=>{
  const u=new URL(`https://api.clover.com/v3/merchants/${merchantId}/${path}`);
  for(const [k,v] of Object.entries(params))for(const x of Array.isArray(v)?v:[v])u.searchParams.append(k,x);
  let r;
  for(let attempt=0;attempt<3;attempt++){
   await new Promise(resolve=>setTimeout(resolve,attempt?2000*attempt:650));
   r=await fetchImpl(u,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json','User-Agent':'KreamOperations/1.0'},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(r.status!==429||attempt===2)break;
   await r.text();
  }
  if(!r.ok)throw Error(`Clover ${path} request failed (${r.status})`);
  return r.json();
 };
 const range={filter:[`createdTime>=${center-86400000}`,`createdTime<${center+86400000}`]};
 const payments=await collection(get,'payments',range);
 const refunds=await collection(get,'refunds',range);
 if([...payments,...refunds].some(p=>!Number.isSafeInteger(p.createdTime)))throw Error('Missing transaction time');
 return {business_date:date,captured_at:new Date(now).toISOString(),...reconcilePayments(
  payments.filter(p=>torontoDate(p.createdTime)===date),refunds.filter(p=>torontoDate(p.createdTime)===date))};
}

