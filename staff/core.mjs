export function tomorrowToronto(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const day = new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day+1));
  return day.toISOString().slice(0,10);
}
export function validItems(quantities, catalog) {
  return Object.entries(quantities).filter(([,q])=>q !== '' && +q !== 0).map(([id,q])=>{
    const p=catalog.find(p=>p.id===id), n=Number(q);
    if(!p?.active || !p.unit_confirmed || !Number.isFinite(n) || n<=0 || n>100000 || Math.abs(n*1000-Math.round(n*1000))>1e-7) throw new Error('INVALID_QUANTITY');
    return {product_id:id,quantity:n};
  });
}
export async function saveDraft(db, previous, payload) {
  let query;
  if(previous) {
    if(previous.submitted_order_id) throw new Error('ALREADY_SUBMITTED');
    const {delivery_date,items,note}=payload;
    query=db.from('kream_drafts').update({delivery_date,items,note}).eq('id',previous.id).eq('revision',previous.revision).is('submitted_order_id',null).select();
  } else query=db.from('kream_drafts').insert(payload).select();
  const {data,error}=await query;
  if(error) { if(error.code==='23505') throw new Error('DRAFT_CONFLICT'); throw error; }
  if(!data || data.length!==1) throw new Error('DRAFT_CONFLICT');
  return data[0];
}
// Same draft ID is retained for a retry after a lost network response.
export async function submitDraft(db, draft) {
  const {data,error}=await db.rpc('kream_submit_order',{draft_id:draft.id,expected_revision:draft.revision});
  if(error) throw error;
  if(!data) throw new Error('EMPTY_SUBMIT_RESPONSE');
  return data;
}
export function aggregate(orders) {
  const map=new Map();
  for(const order of orders.filter(o=>o.status!=='cancelled')) for(const item of order.kream_order_items||[]) {
    const key=JSON.stringify([item.product_id,item.order_unit]);
    const row=map.get(key)||{...item,quantity:0}; row.quantity=Math.round((row.quantity+Number(item.quantity))*1000)/1000; map.set(key,row);
  }
  return [...map.values()];
}

export async function saveSharedBasket(db,previous,payload){
 const {data,error}=await db.rpc('kream_save_store_basket',{target_store:payload.store_id,basket_id:previous?.id||null,previous_items:previous?.items||[],new_items:payload.items,previous_note:previous?.note||'',new_note:payload.note,previous_date:previous?.delivery_date||payload.delivery_date,new_date:payload.delivery_date});
 if(error)throw error;if(!data?.id)throw new Error('EMPTY_BASKET_RESPONSE');return data;
}
export async function submitSharedBasket(db,draft){
 const {data,error}=await db.rpc('kream_submit_store_basket',{draft_id:draft.id,expected_revision:draft.revision});
 if(error)throw error;if(!data)throw new Error('EMPTY_SUBMIT_RESPONSE');return data;
}
