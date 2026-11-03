// Presentation permissions. Actual data access remains enforced by server RLS.
export const previewRoles=[
 ['owner','최종관리자 · 실제 화면','Owner · live workspace'],
 ['employee','매장 직원','Store employee'],
 ['manager','매장 매니저','Store manager'],
 ['general_manager','총괄매니저 · 전 매장','General manager · all stores'],
 ['factory_staff','공장 직원','Factory employee'],
 ['factory_manager','공장 매니저','Factory manager'],
 ['midland_owner','미드랜드 점주','Midland owner']
];
const shared=['sop','manual'];
const store=['manual','receiving','order','history','waste','sop'];
const factory=['production','dispatch','productionlog','inventory','materialreceiving','waste','sop'];
export function visiblePages(role){if(role==='owner')return null;if(role==='employee')return store;if(role==='general_manager')return [...store,'daily'];if(role==='manager')return [...store,'daily'];if(role==='midland_owner')return [...store,'daily','settlement'];if(role==='factory_staff'||role==='factory')return factory;if(role==='factory_manager')return [...factory,'purchases'];return [];}
export function canPreview(profile,role){return profile?.active===true&&profile.role==='owner'&&previewRoles.some(r=>r[0]===role)&&role!=='owner';}
export function isFactoryRole(role){return ['factory','factory_staff','factory_manager'].includes(role);}
export function scopePreview(role,storeId,{orders=[],receipts=[],guides=[]}){const factory=isFactoryRole(role);const scopedOrders=orders.filter(o=>factory||o.store_id===storeId),ids=new Set(scopedOrders.map(o=>o.id));return {orders:scopedOrders,receipts:receipts.filter(r=>(factory||r.store_id===storeId)&&ids.has(r.order_id)),guides:guides.filter(g=>{
 if(g.archived)return false;
 if((role==='manager'||role==='general_manager')&&g.store_id===storeId)return true;
 return g.published&&(g.store_id==null||factory||g.store_id===storeId)&&(!g.audience||g.audience==='all'||g.audience===(factory?'factory':'store'));
 })};}

export function orderedPages(pages,role){if(isFactoryRole(role)){const rank=['production','dispatch','productionlog','inventory','purchases','materialreceiving','waste','sop'];return [...pages].sort((a,b)=>(rank.indexOf(a[0])<0?999:rank.indexOf(a[0]))-(rank.indexOf(b[0])<0?999:rank.indexOf(b[0])));}if(!['employee','manager','general_manager','midland_owner'].includes(role))return pages;const order=['manual','receiving','order','history','waste','daily','sop','settlement'];return [...pages].sort((a,b)=>(order.indexOf(a[0])<0?999:order.indexOf(a[0]))-(order.indexOf(b[0])<0?999:order.indexOf(b[0])));}

export function navigationGroups(pages,role){
 if(role!=='owner')return [{key:'role',ko:'',en:'',pages:orderedPages(pages,role).filter(p=>visiblePages(role)?.includes(p[0]))}];
 const groups=[['overview','','',['overview']],['stores','매장 운영','Store operations',['manual','receiving','order','history','waste','daily','sop','settlement']],['factory','공장 운영','Factory operations',['production','dispatch','productionlog','inventory','purchases','materialreceiving']]];
 return groups.map(([key,ko,en,ids])=>({key,ko,en,pages:ids.map(id=>pages.find(p=>p[0]===id)).filter(Boolean)}));
}
