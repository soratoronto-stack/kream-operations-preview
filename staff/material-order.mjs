export function materialOrderLines(materials,quantities,suppliers){
 const byId=new Map(materials.map(m=>[m.id,m]));
 return Object.entries(quantities).filter(([,v])=>v!==''&&Number(v)!==0).map(([id,value])=>{
  const m=byId.get(id),quantity=Number(value);
  if(!m||!m.active||!m.unit_confirmed||!suppliers.some(s=>s.id===m.supplier_id&&s.active)||!Number.isInteger(quantity)||quantity<1||quantity>100000)throw Error('INVALID_MATERIAL_ORDER');
  return {material_id:id,quantity};
 }).sort((a,b)=>a.material_id.localeCompare(b.material_id));
}
export function materialRecommendation(m,current=m.on_hand){if(current===''||current==null||m.base_stock==null)return null;const n=Number(current),base=Number(m.base_stock);if(!Number.isFinite(n)||n<0||!Number.isFinite(base))return null;return Math.min(100000,Math.max(0,Math.ceil(base-n)));}
export async function submitMaterialOrder(db,items){const r=await db.rpc('kream_request_material_order',{request_items:items});if(r.error)throw r.error;const ids=r.data;if(!Array.isArray(ids)||ids.length!==items.length||!ids.every((id,i)=>id===items[i].request_id))throw Error('MATERIAL_ORDER_NOT_VERIFIED');return ids;}
