import {subcategoryStyle,subcategoriesFor} from './category-colors.mjs?v=20261104-pantry-items';
import {ordered,groupKey,canArrange,moved} from './order-layout.mjs?v=20261102-drag';
let draft=null;
export const hasSubcategoryEdits=()=>!!draft?.changed;
export function clearSubcategoryState(){draft=null;}
export function mergeSubgroups(all,subset){const keys=new Set(subset);let i=0;return all.map(k=>keys.has(k)?subset[i++]:k);}
export function subcategoryMarkup(c){
 const {category,catalog,layout,store,t,esc,profile,subgroup}=c;
 if(!category)return '';
 const keys=ordered([...new Set([...catalog.map(groupKey),...subcategoriesFor(catalog,category).map(g=>JSON.stringify([category,g]))])],layout.subgroup_order);
 const groups=keys.filter(k=>JSON.parse(k)[0]===category&&JSON.parse(k)[1]);
 const editing=draft?.store===store&&draft?.category===category;
 const list=editing?draft.groups:groups;
 return `${canArrange(profile)&&groups.length>1?`<div class="subcategory-tools">${editing?`<span>${t('☰를 끌어서 옮기세요. 키보드는 좌우 화살표를 사용하세요.','Drag ☰ to reorder, or use Left/Right arrow keys.')}</span><button id="saveSubcategory" ${c.preview||!draft.changed?'disabled':''}>${t('순서 저장','Save order')}</button><button id="cancelSubcategory">${t('취소','Cancel')}</button>`:`<button id="editSubcategory">↔ ${t('하위 카테고리 순서 변경','Reorder subcategories')}</button>`}</div>`:''}<div class="chips subcategories" ${editing?'data-drag-groups':''}><button data-group="" class="${!subgroup?'active':''}" ${editing?'disabled':''}>${t('전체','All')}</button>${list.map(k=>{const g=JSON.parse(k)[1];return `<span class="subcategory-chip" style="${subcategoryStyle(catalog,category,g)}" data-group-key="${esc(k)}"><button data-group="${esc(g)}" class="${subgroup===g?'active':''}" ${editing?'disabled':''}>${esc(g)}</button>${editing?`<button class="drag-handle" type="button" draggable="true" aria-label="${esc(g)} ${t('순서 이동','reorder')}" title="${esc(t('끌어서 이동 · 좌우 화살표','Drag to move · Left/Right arrows'))}">☰</button>`:''}</span>`;}).join('')}</div><span id="subcategoryAnnouncement" role="status" class="sr-only"></span>`;
}
export function bindSubcategoryDrag(host,c){
 const {catalog,layout,category,store,t,db,act,say,redraw,reload}=c;
 host.querySelector('#editSubcategory')?.addEventListener('click',()=>{
  if(hasSubcategoryEdits()&&!confirm(t('다른 카테고리의 순서 변경을 취소할까요?','Discard changes in the other category?')))return;
  const all=ordered([...new Set([...catalog.map(groupKey),...subcategoriesFor(catalog,category).map(g=>JSON.stringify([category,g]))])],layout.subgroup_order);
  draft={store,category,revision:layout.revision||0,all,groups:all.filter(k=>JSON.parse(k)[0]===category&&JSON.parse(k)[1]),changed:false,categories:layout.category_order||[],products:layout.product_order||[]};redraw();
 });
 host.querySelector('#cancelSubcategory')?.addEventListener('click',()=>{clearSubcategoryState();redraw();});
 host.querySelector('#saveSubcategory')?.addEventListener('click',()=>act(async()=>{
  const r=await db.rpc('kream_save_order_layout',{target_store:store,categories:draft.categories,subgroups:mergeSubgroups(draft.all,draft.groups),products:draft.products,expected_revision:draft.revision});if(r.error)throw r.error;clearSubcategoryState();await reload();say(t('이 매장의 하위 카테고리 순서를 저장했어요.','Subcategory order saved for this store.'));redraw();
 }));
 const list=host.querySelector('[data-drag-groups]');if(!list)return;
 function commitDOM(){draft.groups=[...list.querySelectorAll('[data-group-key]')].map(el=>el.dataset.groupKey);draft.changed=true;host.querySelector('#saveSubcategory').disabled=!!c.preview;}
 list.querySelectorAll('.drag-handle').forEach(handle=>{
  const chip=handle.closest('[data-group-key]');let moving=false,previous=null;
  handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const id=chip.dataset.groupKey,index=draft.groups.indexOf(id),delta=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;draft.groups=moved(draft.groups,id,index+delta);draft.changed=true;redraw();const next=[...host.querySelectorAll('[data-group-key]')].find(el=>el.dataset.groupKey===id);next?.querySelector('.drag-handle')?.focus();};
  handle.onpointerdown=e=>{if(e.pointerType==='mouse'||e.button!==0)return;e.preventDefault();moving=true;previous=[...list.children];list.onpointermove=handle.onpointermove;list.onpointerup=handle.onpointerup;list.onpointercancel=handle.onpointercancel;list.onlostpointercapture=handle.onlostpointercapture;list.setPointerCapture(e.pointerId);chip.classList.add('dragging');};
  handle.onpointermove=e=>{if(!moving)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-group-key]');if(!target||target===chip||target.parentElement!==list)return;const all=[...list.children];if(all.indexOf(chip)<all.indexOf(target))target.after(chip);else target.before(chip);};
  function finish(e,cancelled){if(!moving)return;moving=false;chip.classList.remove('dragging');if(list.hasPointerCapture(e.pointerId))list.releasePointerCapture(e.pointerId);if(cancelled){previous.forEach(el=>list.append(el));return;}const now=[...list.querySelectorAll('[data-group-key]')].map(el=>el.dataset.groupKey);if(JSON.stringify(now)!==JSON.stringify(draft.groups)){commitDOM();host.querySelector('#subcategoryAnnouncement').textContent=t('순서를 변경했어요. 순서 저장을 눌러주세요.','Order changed. Select Save order.');}}
  handle.ondragstart=e=>{moving=true;previous=[...list.children];e.dataTransfer.setData('text/plain',chip.dataset.groupKey);e.dataTransfer.effectAllowed='move';chip.classList.add('dragging');list.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect='move';const target=event.target.closest('[data-group-key]');if(!target||target===chip||target.parentElement!==list)return;const all=[...list.children];if(all.indexOf(chip)<all.indexOf(target))target.after(chip);else target.before(chip);};list.ondrop=event=>{event.preventDefault();moving=false;chip.classList.remove('dragging');commitDOM();};};
  handle.ondragend=()=>{if(!moving)return;moving=false;chip.classList.remove('dragging');commitDOM();};
  handle.onpointerup=e=>finish(e,false);handle.onpointercancel=e=>finish(e,true);handle.onlostpointercapture=e=>finish(e,true);
 });
}
