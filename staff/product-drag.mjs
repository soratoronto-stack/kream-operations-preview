import {canArrange,sortCatalog,moved} from './order-layout.mjs?v=20261104-drag-only';
let draft=null;
export const hasProductOrderEdits=()=>!!draft?.changed;
export function clearProductOrder(){draft=null;}
function matches(c){return draft?.store===c.store&&draft.category===c.category&&draft.subgroup===c.subgroup;}
export function mergeProductSubset(all,subset){const selected=new Set(subset);let i=0;return all.map(id=>selected.has(id)?subset[i++]:id);}
export function productOrderView(list,c){
 const eligible=canArrange(c.profile)&&c.category&&c.subgroup&&!c.search&&c.filter==='all'&&list.length>1;
 const editing=!!eligible&&matches(c),rank=new Map((editing?draft.ids:[]).map((id,i)=>[id,i]));
 return {eligible,editing,list:editing?[...list].sort((a,b)=>rank.get(a.id)-rank.get(b.id)):list};
}
export function productOrderTools(v,c){
 if(!v.eligible)return '';
 return '<div class="product-order-tools">'+(v.editing?
 '<span>'+c.t('☰를 끌어 품목 순서를 바꾼 뒤 저장하세요.','Drag ☰ to reorder items, then save.')+'</span><button id="saveProductOrder" '+(!draft.changed||c.preview?'disabled':'')+'>'+c.t('품목 순서 저장','Save item order')+'</button><button id="cancelProductOrder">'+c.t('취소','Cancel')+'</button>':
 '<button id="editProductOrder">↔ '+c.t('이 하위분류 품목 순서 변경','Reorder items in this subcategory')+'</button>')+'</div><span id="productOrderAnnouncement" role="status" class="sr-only"></span>';
}
export function bindProductOrder(host,c){
 host.querySelector('#editProductOrder')?.addEventListener('click',()=>{
  if(hasProductOrderEdits()&&!confirm(c.t('다른 하위분류의 순서 변경을 취소할까요?','Discard ordering edits in the other subcategory?')))return;
  const all=[...new Set([...(c.layout.product_order||[]),...sortCatalog(c.catalog,c.layout).map(p=>p.id)])];
  draft={store:c.store,category:c.category,subgroup:c.subgroup,revision:c.layout.revision||0,categories:[...(c.layout.category_order||[])],groups:[...(c.layout.subgroup_order||[])],all,ids:c.list.map(p=>p.id),changed:false};c.redraw();
 });
 host.querySelector('#cancelProductOrder')?.addEventListener('click',()=>{clearProductOrder();c.redraw();});
 host.querySelector('#saveProductOrder')?.addEventListener('click',()=>c.act(async()=>{
  if(!matches(c)||!draft.changed||c.preview)return;
  const r=await c.db.rpc('kream_save_order_layout',{target_store:draft.store,categories:draft.categories,subgroups:draft.groups,products:mergeProductSubset(draft.all,draft.ids),expected_revision:draft.revision});
  if(r.error)throw r.error;clearProductOrder();await c.reload();c.say(c.t('이 매장의 품목 순서를 저장했어요.','Item order saved for this store.'));c.redraw();
 }));
 const list=host.querySelector('#products');if(!list||!matches(c)||!host.querySelector('#cancelProductOrder'))return;
 const ids=()=>[...list.querySelectorAll('[data-order-id]')].map(el=>el.dataset.orderId);
 const saveDOM=()=>{const next=ids();draft.changed=JSON.stringify(next)!==JSON.stringify(draft.ids)||draft.changed;draft.ids=next;host.querySelector('#saveProductOrder').disabled=!!c.preview||!draft.changed;host.querySelector('#productOrderAnnouncement').textContent=c.t('품목 순서가 변경되었어요. 저장을 눌러 주세요.','Item order changed. Select Save.');};
 const move=(card,target)=>{if(!target||target===card||target.parentElement!==list)return;const nodes=[...list.children];if(nodes.indexOf(card)<nodes.indexOf(target))target.after(card);else target.before(card);};
 list.querySelectorAll('.product-drag-handle').forEach(handle=>{
  const card=handle.closest('[data-order-id]');let moving=false,previous=[];
  handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const id=card.dataset.orderId;draft.ids=moved(draft.ids,id,draft.ids.indexOf(id)+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1));draft.changed=true;c.redraw();[...host.querySelectorAll('[data-order-id]')].find(el=>el.dataset.orderId===id)?.querySelector('.product-drag-handle')?.focus();};
  handle.ondragstart=e=>{moving=true;previous=[...list.children];card.classList.add('dragging');e.dataTransfer.setData('text/plain',card.dataset.orderId);e.dataTransfer.effectAllowed='move';
   list.ondragover=ev=>{ev.preventDefault();move(card,ev.target.closest('[data-order-id]'));};
   list.ondrop=ev=>{ev.preventDefault();moving=false;card.classList.remove('dragging');saveDOM();};
  };
  handle.ondragend=()=>{if(!moving)return;moving=false;card.classList.remove('dragging');saveDOM();};
  card.ondragstart=e=>{if(e.target===handle)return;if(e.target?.closest?.('input,button,select,textarea,a,summary')){e.preventDefault();return;}handle.ondragstart(e);};card.ondragend=handle.ondragend;
  handle.onpointerdown=e=>{if(e.pointerType==='mouse'||e.button!==0)return;e.preventDefault();moving=true;previous=[...list.children];card.classList.add('dragging');list.onpointermove=ev=>{if(moving)move(card,document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-order-id]'));};list.onpointerup=ev=>finish(ev,false);list.onpointercancel=ev=>finish(ev,true);list.onlostpointercapture=ev=>finish(ev,true);list.setPointerCapture(e.pointerId);};
  function finish(e,cancel){if(!moving)return;moving=false;card.classList.remove('dragging');if(list.hasPointerCapture(e.pointerId))list.releasePointerCapture(e.pointerId);if(cancel)previous.forEach(el=>list.append(el));else saveDOM();}
 });
}
