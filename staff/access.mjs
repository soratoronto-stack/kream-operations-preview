// Presentation permissions. Actual data access remains enforced by server RLS.
export const previewRoles=[
 ['owner','최종관리자 · 실제 화면','Owner · live workspace'],
 ['employee','매장 직원','Store employee'],
 ['manager','매장 매니저','Store manager'],
 ['factory_staff','공장 직원','Factory employee'],
 ['factory_manager','공장 매니저','Factory manager'],
 ['midland_owner','미드랜드 점주','Midland owner']
];
const shared=['sop','manual'];
const store=['order','history','receiving',...shared,'waste'];
const factory=['production','dispatch','inventory','receiving',...shared,'waste'];
export function visiblePages(role){if(role==='owner')return null;if(role==='employee')return store;if(role==='manager')return ['catalog',...store];if(role==='midland_owner')return [...store,'settlement'];if(role==='factory_staff'||role==='factory')return factory;if(role==='factory_manager')return [...factory,'suppliers'];return [];}
export function canPreview(profile,role){return profile?.active===true&&profile.role==='owner'&&previewRoles.some(r=>r[0]===role)&&role!=='owner';}
export function isFactoryRole(role){return ['factory','factory_staff','factory_manager'].includes(role);}
export function scopePreview(role,storeId,{orders=[],receipts=[],guides=[]}){const factory=isFactoryRole(role);const scopedOrders=orders.filter(o=>factory||o.store_id===storeId),ids=new Set(scopedOrders.map(o=>o.id));return {orders:scopedOrders,receipts:receipts.filter(r=>(factory||r.store_id===storeId)&&ids.has(r.order_id)),guides:guides.filter(g=>{
 if(g.archived)return false;
 if(role==='manager'&&g.store_id===storeId)return true;
 return g.published&&(g.store_id==null||factory||g.store_id===storeId);
 })};}
