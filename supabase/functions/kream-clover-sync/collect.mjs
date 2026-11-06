// Server-side only. Never import into the staff browser app.
// OAuth access token is supplied by a future authorized server token store.
export async function collection(get,path,params={}){
 const rows=[];
 for(let offset=0;;offset+=100){
  if(offset>=100000)throw Error('Collection safety limit reached; snapshot not saved');
  const page=await get(path,{...params,limit:'100',offset:String(offset)});
  if(!Array.isArray(page.elements))throw Error('Invalid Clover response');
  rows.push(...page.elements);if(page.elements.length<100)return rows;
 }
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function normalizeItem(i){return {
 id:String(i.id),name:String(i.name??''),price_type:String(i.priceType??''),
 price_cents:Number.isSafeInteger(i.price)&&i.price>=0?i.price:null,
 categories:(i.categories?.elements??[]).map(c=>String(c.name??'')),
 stock_quantity:finite(i.itemStock?.quantity)
};}
export function successfulPayments(payments){
 const rows=payments.filter(p=>p.result==='SUCCESS'&&p.voided!==true);
 if(rows.some(p=>!Number.isSafeInteger(p.amount)||p.amount<0))throw Error('Invalid payment amount');
 const cents=rows.reduce((n,p)=>n+p.amount,0);
 if(!Number.isSafeInteger(cents))throw Error('Payment total overflow');
 return {payment_amount_cents:cents,payment_count:rows.length};
}
export function torontoDate(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
export async function collectSnapshot({merchantId,storeId,date,accessToken,fetchImpl=fetch,now=Date.now()}){
 if(!/^[A-Z0-9]{13}$/.test(merchantId)||!storeId||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Verified store mapping and date required');
 const center=Date.parse(`${date}T12:00:00Z`);
 if(!Number.isFinite(center)||new Date(center).toISOString().slice(0,10)!==date||date>torontoDate(now))throw Error('Invalid business date');
 if(!accessToken)throw Error('Clover OAuth authorization required');
 const get=async(path,params)=>{
  const url=new URL(`https://api.clover.com/v3/merchants/${merchantId}/${path}`);
  for(const [key,value] of Object.entries(params)){
   for(const part of Array.isArray(value)?value:[value])url.searchParams.append(key,part);
  }
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json','User-Agent':'KreamOperations/0.1'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Clover request failed (${response.status}); snapshot not saved`);
  return response.json();
 };
 // Broad UTC range, then exact Toronto-date filtering handles DST transitions.
 const [payments,items]=await Promise.all([
  collection(get,'payments',{filter:[`createdTime>=${center-86400000}`,`createdTime<${center+86400000}`]}),
  collection(get,'items',{expand:'categories,itemStock'})
 ]);
 const dayPayments=payments.filter(p=>typeof p.createdTime==='number'&&torontoDate(p.createdTime)===date);
 if(payments.some(p=>typeof p.createdTime!=='number'))throw Error('Payment timestamp missing');
 return {store_id:storeId,merchant_id:merchantId,business_date:date,captured_at:new Date(now).toISOString(),currency:'CAD',...successfulPayments(dayPayments),items:items.filter(i=>!i.deleted).map(normalizeItem)};
}

