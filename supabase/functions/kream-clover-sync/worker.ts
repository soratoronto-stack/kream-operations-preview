import {collectInventory} from './inventory.mjs';
import {collectDaily} from './daily.mjs';
import {torontoDate} from './collect.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string,body?:unknown,method='POST',prefer='resolution=merge-duplicates,return=minimal'){
 const r=await fetch(`${base}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`Storage request failed (${r.status})`);
 const text=await r.text();return text?JSON.parse(text):null;
}
async function equalSecret(a:string,b:string){
 const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{
  // API keys are read only inside this server, never returned or logged.
  const cfg=await db('rpc/kream_clover_worker_config',{});
  if(!cfg?.job_secret||!await equalSecret(req.headers.get('x-kream-job-secret')||'',cfg.job_secret))return new Response('Unauthorized',{status:401});
  const input=await req.json().catch(()=>({}));
  const now=Date.now();const day=torontoDate(now);
  const defaults=[1,2].map(n=>new Date(Date.parse(day+'T12:00Z')-n*86400000).toISOString().slice(0,10));
  const dates=input.dates??defaults;
  if(!Array.isArray(dates)||!dates.length||dates.length>7||dates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>day||Date.parse(day)-Date.parse(d)>80*86400000))return new Response('Invalid dates',{status:400});
  const results=[];
  const catalog=await db('kream_catalog?select=id,name_ko,name_en,category,order_unit,active,archived',undefined,'GET');
  await Promise.all(cfg.connections.map(async(c:any)=>{
   if(input.store_id&&input.store_id!==c.store_id)return;
   try {
    const [state]=await db(`kream_clover_connections?store_id=eq.${encodeURIComponent(c.store_id)}&select=inventory_started_at,inventory_cursor,inventory_last_success_at`,undefined,'GET');
    const count=await collectInventory({connection:c,state:input.inspect_recent?{...state,inventory_cursor:null}:state,catalog,db,now});
    results.push({store_id:c.store_id,inventory:'saved',lines:count});
   }catch(e){
    const message=e instanceof Error?e.message:'Inventory collection failed';
    await db(`kream_clover_connections?store_id=eq.${encodeURIComponent(c.store_id)}`,{inventory_last_error:message.slice(0,200)},'PATCH');
    results.push({store_id:c.store_id,inventory:'failed'});
   }
   for(const date of [...new Set(dates)]){
    try{
     const row=await collectDaily({merchantId:c.merchant_id,date,accessToken:c.token,now});
     await db('kream_clover_daily?on_conflict=store_id,business_date',{store_id:c.store_id,business_date:date,captured_at:row.captured_at,result:row});
     await db(`kream_clover_connections?store_id=eq.${encodeURIComponent(c.store_id)}`,{last_success_at:row.captured_at,last_error:null},'PATCH');
     results.push({store_id:c.store_id,date,status:'saved'});
    }catch(e){
     const message=e instanceof Error?e.message:'Collection failed';
     await db(`kream_clover_connections?store_id=eq.${encodeURIComponent(c.store_id)}`,{last_error:message.slice(0,200)},'PATCH');
     results.push({store_id:c.store_id,date,status:'failed'});
    }
   }
  }));
  return Response.json({results},{status:results.some(r=>r.status==='failed'||r.inventory==='failed')?207:200});
 }catch{return Response.json({error:'Collector unavailable; previous observations retained'},{status:500});}
});

