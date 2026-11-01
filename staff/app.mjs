import {tomorrowToronto,validItems,saveDraft,submitDraft,aggregate} from './core.mjs';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lang=localStorage.getItem('kream-staff-language')==='en'?'en':'ko';
const t=(ko,en)=>lang==='ko'?ko:en;
let db,user,profile,stores=[],catalog=[],draft=null,quantities={},orders=[],store='',date=tomorrowToronto(),note='',dirty=false,busy=false,uncertain=false,category='',search='',mode='login',generation=0;
let recovery=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
function say(message,error=false){$('#message').textContent=message;$('#message').classList.toggle('error',error);}
function failure(e){console.error('Kream request failed',e?.code||e?.message);const conflict=e?.message==='DRAFT_CONFLICT'||e?.code==='40001';say(conflict?t('다른 기기에서 초안이 변경되었습니다. 입력 내용은 유지했어요. 최신 초안을 불러온 뒤 확인해 주세요.','Draft changed on another device. Your edits remain here. Reload the cloud draft to review.'):t('처리하지 못했어요. 연결 상태와 권한을 확인하고 다시 시도해 주세요.','Unable to complete. Check connection and access, then retry.'),true);}
async function result(query){const r=await query;if(r.error)throw r.error;return r.data;}
function name(p){return lang==='ko'?p.name_ko:p.name_en;}
function setBusy(value){busy=value;document.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value);if(!value)render();}
function render(){document.documentElement.lang=lang;$('#language').textContent=lang==='ko'?'English':'한국어';$('#logout').textContent=t('로그아웃','Sign out');$('#logout').hidden=!user;$('#auth').hidden=!!(user&&profile?.active&&!recovery);$('#portal').hidden=!(user&&profile?.active&&!recovery);if(!$('#auth').hidden)renderAuth();else renderPortal();}
function renderAuth(){
 if(user&&!profile?.active&&!recovery){$('#auth').innerHTML=`<div class="auth"><h1>${t('매장 배정을 기다리고 있어요','Waiting for access')}</h1><p>${t('계정은 로그인되어 있어요. 관리자가 직원 권한과 매장을 배정하면 발주할 수 있습니다.','You are signed in. An administrator must assign your role and store before you can order.')}</p><button id="checkAccess">${t('배정 확인','Check access')}</button></div>`;$('#checkAccess').onclick=()=>run(loadIdentity);return;}
 const title=recovery?t('새 비밀번호 설정','Set a new password'):mode==='signup'?t('직원 계정 만들기','Create a staff account'):mode==='reset'?t('비밀번호 찾기','Reset password'):t('직원 로그인','Staff sign in');
 $('#auth').innerHTML=`<div class="auth"><h1>${title}</h1><p class="muted">${t('매장과 공장을 잇는 크림 운영 공간','The workspace connecting Kream stores and factory')}</p><form id="authForm">${recovery?'':`<label>${t('이메일','Email')}<input name="email" type="email" autocomplete="email" required></label>`}${mode==='reset'&&!recovery?'':`<label>${t('비밀번호','Password')}<input name="password" type="password" minlength="8" autocomplete="${mode==='login'&&!recovery?'current-password':'new-password'}" required></label>`}<button class="primary">${title}</button></form>${recovery?'':`<div class="links"><button data-mode="login">${t('로그인','Sign in')}</button><button data-mode="signup">${t('계정 만들기','Sign up')}</button><button data-mode="reset">${t('비밀번호 찾기','Reset password')}</button></div>`}<p class="muted">${t('신규 가입만으로 매장 자료에 접근할 수 없어요. 관리자 배정이 필요합니다.','Signing up does not grant access to store data. Administrator assignment is required.')}</p></div>`;
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});
 $('#authForm').onsubmit=e=>{e.preventDefault();const form=new FormData(e.target);run(async()=>{
 const email=String(form.get('email')||'').trim(),password=String(form.get('password')||'');
 const redirect=location.origin+location.pathname;
 if(recovery){await result(db.auth.updateUser({password}));recovery=false;await loadIdentity();say(t('비밀번호를 변경했어요.','Password updated.'));}
 else if(mode==='signup'){await result(db.auth.signUp({email,password,options:{emailRedirectTo:redirect}}));say(t('가입 요청을 처리했어요. 이메일을 확인하고 관리자에게 매장 배정을 요청해 주세요.','Sign-up request processed. Check your email and ask an administrator for store access.'));await loadIdentity();}
 else if(mode==='reset'){await result(db.auth.resetPasswordForEmail(email,{redirectTo:redirect}));say(t('이메일을 확인해 주세요. 비밀번호 설정 링크를 요청했어요.','Check your email for the password reset link.'));}
 else{await result(db.auth.signInWithPassword({email,password}));await loadIdentity();say(t('로그인했어요.','Signed in.'));}
 });};
}
async function run(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){failure(e);}finally{setBusy(false);}}
async function loadIdentity(){
 const epoch=++generation;const {data,error}=await db.auth.getUser();if(epoch!==generation)return;
 if(error||!data.user){user=null;profile=null;stores=[];catalog=[];draft=null;orders=[];quantities={};dirty=false;uncertain=false;return;}
 const freshUser=data.user;
 const freshProfile=await result(db.from('kream_profiles').select('user_id,display_name,role,active').eq('user_id',freshUser.id).maybeSingle());
 if(epoch!==generation)return;user=freshUser;profile=freshProfile;
 if(!profile?.active){stores=[];catalog=[];orders=[];return;}
 const [s,c]=await Promise.all([result(db.from('kream_stores').select('id,name').eq('active',true).order('name')),result(db.from('kream_catalog').select('id,name_ko,name_en,category,subgroup,order_unit,unit_confirmed,active').eq('active',true).order('name_ko').limit(1000))]);
 if(epoch!==generation)return;stores=s;catalog=c;store=stores.some(s=>s.id===store)?store:(stores[0]?.id||'');
 await loadOrders();if(profile.role!=='factory'&&store)await loadDraft();
}
async function loadDraft(){draft=await result(db.from('kream_drafts').select('id,store_id,delivery_date,items,note,revision,submitted_order_id,updated_at').eq('user_id',user.id).eq('store_id',store).maybeSingle());quantities=Object.fromEntries((draft?.items||[]).map(i=>[i.product_id,i.quantity]));date=draft?.delivery_date||tomorrowToronto();note=draft?.note||'';dirty=false;uncertain=false;}
async function loadOrders(){let q=db.from('kream_orders').select('id,store_id,delivery_date,note,status,created_at,kream_order_items(product_id,name_ko,name_en,order_unit,quantity)').order('created_at',{ascending:false}).limit(100);if(profile.role!=='factory'&&store)q=q.eq('store_id',store);orders=await result(q);}
function renderPortal(){
 const factory=profile.role==='factory';
 $('#portal').innerHTML=`<h1>${esc(profile.display_name)} · ${factory?t('생산 확인','Production overview'):t('매장 발주','Store order')}</h1><p class="muted">${t('실제 계정과 연결된 공유 자료입니다.','Live shared data for your assigned account.')}</p>${!stores.length?`<p class="empty">${t('배정된 활성 매장이 없어요. 관리자에게 문의해 주세요.','No active store assigned. Contact your administrator.')}</p>`:''}<div class="toolbar">${factory?'':`<label>${t('내 매장','My store')}<select id="store">${stores.map(s=>`<option value="${esc(s.id)}" ${store===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`}<label>${t('납품일','Delivery date')}<input id="date" type="date" min="${tomorrowToronto()}" value="${esc(date)}"></label><button id="refresh">${t('최신 자료 불러오기','Reload cloud data')}</button></div><div id="orderArea"></div><section class="panel"><h2>${factory?t('생산 합계','Product totals'):t('발주 내역','Order history')}</h2><div id="history"></div><p class="muted">${t('최근 발주 최대 100건 · 새로 불러오기를 눌러 다른 기기의 변경을 확인하세요.','Up to 100 recent orders. Reload to see changes from other devices.')}</p></section>`;
 $('#date').onchange=e=>{date=e.target.value;if(!factory)dirty=true;else renderHistory();};
 $('#refresh').onclick=()=>{if(dirty&&!confirm(t('저장하지 않은 변경을 버리고 최신 자료를 불러올까요?','Discard unsaved changes and reload cloud data?')))return;run(async()=>{await loadOrders();if(!factory&&store)await loadDraft();say(t('최신 자료를 불러왔어요.','Cloud data reloaded.'));});};
 if(!factory){$('#store').onchange=e=>{const chosen=e.target.value;if((dirty||uncertain)&&!confirm(t('현재 변경 또는 전송 확인을 중단하고 매장을 바꿀까요?','Leave current changes or pending submission and switch stores?'))){e.target.value=store;return;}run(async()=>{store=chosen;await loadDraft();await loadOrders();});};renderOrderArea();}
 renderHistory();
}
function renderOrderArea(){
 if(!store)return;
 const locked=!!draft?.submitted_order_id||uncertain;
 $('#orderArea').innerHTML=`${draft?.submitted_order_id?`<p class="panel">${t('이 초안은 발주 완료되었습니다. 내역에서 확인할 수 있어요.','This draft has been submitted. Find it in order history.')} <button id="newOrder">${t('새 발주 시작','Start new order')}</button></p>`:''}<div class="toolbar"><label>${t('제품 찾기','Find a product')}<input id="search" type="search" value="${esc(search)}" placeholder="${t('제품명 검색','Search products')}"></label><label>${t('카테고리','Category')}<select id="category"><option value="">${t('전체','All')}</option>${[...new Set(catalog.map(p=>p.category))].map(c=>`<option ${category===c?'selected':''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label></div><div class="grid" id="products"></div><p class="muted">${t('단위 확인 전인 품목은 발주할 수 없어요. 입력 내용은 ‘초안 저장’을 눌러 다른 기기와 공유하세요.','Products awaiting unit confirmation cannot be ordered. Use Save draft to share edits across devices.')}</p><label>${t('전달 사항','Note')}<textarea id="note" maxlength="2000" ${locked?'disabled':''}>${esc(note)}</textarea></label><div class="actions bar"><button id="save">${t('초안 저장','Save draft')}</button><button class="primary" id="submit">${uncertain?t('같은 발주 전송 재확인','Retry same submission'):t('발주 완료','Submit order')}</button><span id="draftState" class="muted"></span></div>`;
 $('#search').oninput=e=>{search=e.target.value;renderProducts();};$('#category').onchange=e=>{category=e.target.value;renderProducts();};$('#note').oninput=e=>{note=e.target.value;dirty=true;draftStatus();};
 $('#save').disabled=locked;$('#submit').disabled=!!draft?.submitted_order_id;$('#save').onclick=()=>run(async()=>{await persistDraft();say(t('초안을 저장했어요.','Draft saved.'));});
 $('#submit').onclick=()=>run(async()=>{
   if(!uncertain){const items=validItems(quantities,catalog);if(!items.length)throw new Error('EMPTY_ORDER');if(date<tomorrowToronto())throw new Error('DATE_PAST');if(!confirm(t('발주를 완료할까요? 완료 후에는 이 화면에서 수정할 수 없어요.','Submit this order? It cannot be edited here after submission.')))return;await persistDraft();}
   uncertain=true;const id=await submitDraft(db,draft);draft.submitted_order_id=id;uncertain=false;dirty=false;await loadOrders();say(t('발주를 완료했어요.','Order submitted.'));
 });
 if($('#newOrder'))$('#newOrder').onclick=()=>run(async()=>{await result(db.from('kream_drafts').delete().eq('id',draft.id).eq('user_id',user.id).not('submitted_order_id','is',null));await loadDraft();say(t('새 발주를 시작합니다.','New order started.'));});
 renderProducts();draftStatus();
}
function draftStatus(){if($('#draftState'))$('#draftState').textContent=uncertain?t('전송 결과 확인 필요 · 같은 발주만 재시도하세요.','Submission not confirmed. Retry the same draft.'):dirty?t('저장하지 않은 변경','Unsaved changes'):draft?t(`공유 초안 · 버전 ${draft.revision}`,`Cloud draft · revision ${draft.revision}`):t('새 초안','New draft');}
function renderProducts(){const locked=!!draft?.submitted_order_id||uncertain;const list=catalog.filter(p=>(!category||p.category===category)&&`${p.name_ko} ${p.name_en}`.toLowerCase().includes(search.toLowerCase()));$('#products').innerHTML=list.length?list.map(p=>`<article class="card ${p.unit_confirmed?'':'unconfirmed'}"><div class="symbol" aria-hidden="true">${esc(name(p).slice(0,2))}</div><strong>${esc(name(p))}</strong><small>${esc(p.order_unit)}${p.unit_confirmed?'':` · ${t('단위 확인 중','Unit pending')}`}</small><input aria-label="${esc(name(p))} ${t('수량','quantity')}" data-product="${esc(p.id)}" type="number" min="0" max="100000" step="0.001" inputmode="decimal" value="${esc(quantities[p.id]??0)}" ${locked||!p.unit_confirmed?'disabled':''}></article>`).join(''):`<p class="empty">${t('표시할 품목이 없어요.','No products to display.')}</p>`;document.querySelectorAll('[data-product]').forEach(input=>input.oninput=()=>{quantities[input.dataset.product]=input.value;dirty=true;draftStatus();});}
async function persistDraft(){if(date<tomorrowToronto())throw new Error('DATE_PAST');const items=validItems(quantities,catalog);draft=await saveDraft(db,draft,{user_id:user.id,store_id:store,delivery_date:date,items,note});dirty=false;}
function renderHistory(){const factory=profile.role==='factory';const selected=factory?orders.filter(o=>o.delivery_date===date):orders;const host=$('#history');if(factory){const rows=aggregate(selected);host.innerHTML=`<p>${esc(date)} · ${selected.length} ${t('건','orders')}</p>`+rows.map(p=>`<div class="line"><span>${esc(name(p))}</span><strong>${esc(p.quantity)} ${esc(p.order_unit)}</strong></div>`).join('');if(!rows.length)host.innerHTML+=`<p>${t('해당 날짜 발주가 없어요.','No orders on this date.')}</p>`;}else host.innerHTML=selected.length?selected.map(o=>`<details><summary>${esc(o.delivery_date)} · ${esc(o.status)} · ${esc(o.id.slice(0,8))}</summary>${(o.kream_order_items||[]).map(p=>`<div class="line"><span>${esc(name(p))}</span><strong>${esc(p.quantity)} ${esc(p.order_unit)}</strong></div>`).join('')}<p>${esc(o.note)}</p></details>`).join(''):`<p>${t('아직 발주 내역이 없어요.','No orders yet.')}</p>`;}
$('#language').onclick=()=>{lang=lang==='ko'?'en':'ko';localStorage.setItem('kream-staff-language',lang);render();};
$('#logout').onclick=()=>{if(dirty&&!confirm(t('저장하지 않은 변경을 두고 로그아웃할까요?','Sign out with unsaved changes?')))return;run(async()=>{await result(db.auth.signOut());++generation;user=null;profile=null;catalog=[];orders=[];draft=null;quantities={};note='';dirty=false;uncertain=false;recovery=false;say(t('로그아웃했어요.','Signed out.'));});};
window.addEventListener('beforeunload',e=>{if(dirty||uncertain){e.preventDefault();e.returnValue='';}});
async function boot(){
 render();say(t('연결 중…','Connecting…'));try{
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.78.0/+esm');
 db=createClient('https://imkhosgnkgwchoyrqczw.supabase.co','sb_publishable_ISqCCHUBASP2sKEqEM04Lg_Jnft4D-y',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'kream-staff-auth-v1'}});
 db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;setTimeout(render,0);}if(event==='SIGNED_OUT'){++generation;user=null;profile=null;catalog=[];stores=[];orders=[];draft=null;quantities={};dirty=false;uncertain=false;setTimeout(render,0);}});
 await loadIdentity();say('');render();
 }catch(e){failure(e);$('#auth').innerHTML=`<p class="empty">${t('연결에 실패했어요. 잠시 후 페이지를 다시 열어 주세요.','Connection failed. Please reopen this page shortly.')}</p>`;}
}
boot();
