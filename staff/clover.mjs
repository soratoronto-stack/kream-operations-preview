import {stockDisplay,stockDisplayFactor} from './stock-units.mjs?v=20261106-all-cheesecake-trays';
import {todayToronto} from './waste.mjs?v=20261102-whole-quantity';
export function cad(cents){return cents==null?'—':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(cents/100);}
export async function readClover(db,storeId,date){const r=await db.from('kream_clover_daily').select('*').eq('store_id',storeId).eq('business_date',date).maybeSingle();if(r.error)throw r.error;return r.data;}
export function renderClover(host,c){
 const {t,esc,stores,db}=c;
 if(c.profile?.role!=='owner'||c.preview){host.innerHTML=`<p>${t('최종관리자 실제 화면에서 확인해 주세요.','Open the owner’s live workspace.')}</p>`;return;}
 const catalog=(c.catalogAll||[]).filter(p=>p.active&&!p.archived);
 let request=0,items=[],sales=[];
 host.innerHTML=`<section class="panel"><h2>${t('Clover 판매 · 재고 연결','Clover sales → stock')}</h2><p>${t('판매된 수량만 약 5분마다 우리 사이트 재고에서 차감합니다. 입고량이나 재고를 Clover로 보내지 않습니다.','Sold quantities reduce OPS stock about every 5 minutes. Nothing is written back to Clover.')}</p><div class="controls"><label>${t('매장','Store')}<select id="cloverStore">${stores.filter(s=>s.id!=='factory').map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>${t('매출 날짜','Sales date')}<input id="cloverDate" type="date" value="${todayToronto()}"></label><button id="cloverReload">${t('최신 자료','Refresh')}</button></div><p id="cloverStatus" role="status"></p><p>${t('맛·포장 단위가 맞는 품목만 연결하세요. 우유·음료 원재료, 세트 구성품은 직접 확인합니다. 환불은 재고에 자동으로 돌려놓지 않습니다.','Match exact flavours and units. Ingredients and sets need separate review. Refunds do not automatically restore stock.')}</p></section><div id="cloverData"></div><section class="panel"><h3>${t('품목 연결','Item mappings')}</h3><p>${t('연결 후 새로 판매된 수량부터 반영됩니다. 차감 수량은 우리 사이트 재고 단위 기준입니다. 예: 낱개 쿠키 1개 판매 → 20개/봉 재고 0.05봉 차감. 두쫀쿠는 낱개 재고 1개 차감. 10개입 치즈케이크는 판매 1개당 0.1트레이 차감하며 재고는 낱개로 표시합니다.','Mappings apply to new sales only. The multiplier uses OPS stock units: one cookie from a 20-piece bag = 0.05 bag; one Dubai cookie = one piece. Ten-piece cheesecake trays deduct 0.1 tray per slice; shop stock is displayed in pieces.')}</p><div class="controls"><input id="cloverSearch" type="search" placeholder="${t('Clover 메뉴 또는 제품명 검색','Search Clover / OPS item')}"><select id="cloverFilter"><option value="relevant">${t('연결된 품목·판매된 품목','Mapped / sold items')}</option><option value="all">${t('전체 Clover 메뉴','All Clover items')}</option><option value="pending">${t('판매됐지만 연결 필요','Sold, mapping needed')}</option></select></div><p id="cloverCount"></p><div class="table-scroll"><table><thead><tr><th>Clover</th><th>${t('우리 품목','OPS item')}</th><th>${t('1개 판매 시 차감','Deduct per sale')}</th><th>${t('자동 차감','Enabled')}</th><th></th></tr></thead><tbody id="cloverMappings"></tbody></table></div></section><section class="panel"><h3>${t('최근 판매 차감 기록','Recent stock deductions')}</h3><p>${t('재고가 모자라면 0 아래로 차감하지 않고 확인 필요로 표시합니다. 실제 수량을 확인해 현재재고를 수정해 주세요.','Insufficient stock is flagged, never reduced below zero. Count and correct the stock.')}</p><div id="cloverLedger"></div></section>`;
 const q=s=>host.querySelector(s),output=q('#cloverData');
 function draw(){
  const search=q('#cloverSearch').value.trim().toLowerCase(),filter=q('#cloverFilter').value,seen=new Set(sales.map(s=>s.clover_item_id));
  const rows=items.filter(i=>(filter==='all'||filter==='pending'?filter==='all'||seen.has(i.clover_item_id)&&!i.enabled:i.enabled||seen.has(i.clover_item_id))&&`${i.name} ${catalog.find(p=>p.id===i.product_id)?.name_ko||''}`.toLowerCase().includes(search));
  q('#cloverCount').textContent=`${rows.length} ${t('품목','items')}`;
  q('#cloverMappings').innerHTML=rows.slice(0,150).map(i=>`<tr data-item="${esc(i.clover_item_id)}"><td>${esc(i.name)}</td><td><select data-product><option value="">${t('직접 관리 · 미연결','Manual / unmatched')}</option>${catalog.map(p=>`<option value="${esc(p.id)}" ${p.id===i.product_id?'selected':''}>${esc(p.name_ko)} · ${esc(p.order_unit)}</option>`).join('')}</select></td><td><input data-factor type="number" min="0.001" max="100000" step="0.001" value="${i.stock_per_sale}" style="width:90px"></td><td><input data-enabled type="checkbox" ${i.enabled?'checked':''}></td><td><button data-save>${t('저장','Save')}</button></td></tr>`).join('');
 }
 async function load(){
  const token=++request,store=q('#cloverStore').value,date=q('#cloverDate').value;
  q('#cloverStatus').textContent=t('불러오는 중…','Loading…');
  try{
   const results=await Promise.all([db.from('kream_clover_connections').select('inventory_last_success_at,inventory_last_error,last_success_at').eq('store_id',store).maybeSingle(),db.from('kream_clover_items').select('*').eq('store_id',store).order('name').limit(1000),db.from('kream_clover_stock_sales').select('name,product_id,clover_item_id,quantity,deducted,shortage,status,sold_at').eq('store_id',store).order('sold_at',{ascending:false}).limit(100),readClover(db,store,date)]);
   if(token!==request||!host.isConnected)return;
   for(const r of results.slice(0,3))if(r.error)throw r.error;
   const state=results[0].data;items=results[1].data||[];sales=results[2].data||[];
   q('#cloverStatus').textContent=state?`${t('판매수량 수집','Sales quantity sync')}: ${state.inventory_last_error|| (state.inventory_last_success_at?new Date(state.inventory_last_success_at).toLocaleString('ko-KR',{timeZone:'America/Toronto'}):t('첫 수집 대기','Awaiting first sync'))}`:t('연결되지 않은 지점입니다.','Store not connected.');
   const row=results[3]?.result;
   output.innerHTML=`<section class="panel"><h3>${esc(date)} · ${t('세금 제외 확인 매출','Verified receipts excluding tax')}</h3><strong>${esc(cad(row?.net_receipts_cents))}</strong></section>`;
   const status={waiting:t('품목 연결 필요','Mapping needed'),applied:t('차감 완료','Deducted'),baseline:t('재고 기준 이전 · 차감 제외','Before stock baseline'),review:t('확인 필요','Review needed')};
   q('#cloverLedger').innerHTML=sales.length?`<div class="table-scroll"><table><thead><tr><th>${t('품목','Item')}</th><th>${t('판매','Sold')}</th><th>${t('재고 차감','Deducted')}</th><th>${t('상태','Status')}</th></tr></thead><tbody>${sales.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.quantity)}</td><td>${esc(stockDisplay(s.product_id,s.deducted))+(stockDisplayFactor(s.product_id)>1?' '+t('개','pcs'):'')}</td><td>${esc(status[s.status]||s.status)}${s.shortage>0?' · '+t('재고 부족 ','Stock short ')+esc(stockDisplay(s.product_id,s.shortage)):''}</td></tr>`).join('')}</tbody></table></div>`:t('아직 수집된 판매가 없습니다.','No sales collected yet.');draw();
  }catch{q('#cloverStatus').textContent=t('자료를 불러오지 못했어요. 다시 시도해 주세요.','Could not load data. Please retry.');}
 }
 q('#cloverMappings').onclick=async e=>{
  const button=e.target.closest('[data-save]');if(!button)return;
  const row=button.closest('[data-item]'),product=row.querySelector('[data-product]').value,factor=Number(row.querySelector('[data-factor]').value),enabled=row.querySelector('[data-enabled]').checked;
  if(!Number.isFinite(factor)||factor<=0||factor>100000||enabled&&!product){c.say(t('품목과 차감 수량을 확인해 주세요.','Check the item and multiplier.'));return;}
  button.disabled=true;
  const r=await db.from('kream_clover_items').update({product_id:product||null,stock_per_sale:factor,enabled,updated_at:new Date().toISOString()}).eq('store_id',q('#cloverStore').value).eq('clover_item_id',row.dataset.item).select('clover_item_id');
  button.disabled=false;if(r.error||!r.data?.length){c.say(t('저장하지 못했어요. 권한과 연결을 확인해 주세요.','Could not save. Check access and connection.'));return;}
  Object.assign(items.find(i=>i.clover_item_id===row.dataset.item),{product_id:product||null,stock_per_sale:factor,enabled});c.say(t('저장했어요. 다음 새 판매부터 반영됩니다.','Saved. Applies to new sales.'));
 };
 q('#cloverSearch').oninput=draw;q('#cloverFilter').onchange=draw;q('#cloverStore').onchange=load;q('#cloverDate').onchange=load;q('#cloverReload').onclick=load;load();
}

