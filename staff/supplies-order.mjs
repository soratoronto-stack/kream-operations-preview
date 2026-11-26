// 📦 추가 주문: 발주게임 '필수 확인'에 없는 품목은 재고를 세지 않아요. 필요한 것만 '더 필요해요!'를 누르면 발주함에 1단위씩 들어가요.
// 폰 폭(375px)에서도 옆으로 밀리지 않게: 한 줄 = 사진 · 이름/단위 · 버튼, 고르면 −/수량/+ 로 바뀌어요.
// c: {items, t, esc, name, unitLabel, picture, getQty(p), setQty(p,q), qtyStep(p), qtyDisplay(p,q), onTheWay(p) → {date}|null, back(), locked, preview, openBasket()}
const STYLE_ID = 'supplies-order-style-v2';
const CSS = `
.so{grid-column:1/-1;width:100%;max-width:760px;min-width:0;box-sizing:border-box}
.so-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 12px}
.so-tabs button{min-width:0;border:0;border-radius:12px;padding:10px 6px;background:#fff;box-shadow:0 1px 4px #0001;font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.so-tabs button[aria-pressed="true"]{background:#3e4b33;color:#fff}
.so h3{margin:0 0 4px;font-size:18px}
.so-help{margin:0 0 10px;color:#6b6555;font-size:13px}
.so-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.so-chips button{border:1px solid #ddd5c4;border-radius:999px;padding:7px 12px;background:#fff;font-size:13px;font-weight:700}
.so-chips button[aria-pressed="true"]{background:#3e4b33;border-color:#3e4b33;color:#fff}
.so-find{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:minmax(0,1fr);gap:6px;margin:0 0 8px;padding:8px;border-radius:16px;background:#fff8e8;border:2px solid #e9c46a;box-shadow:0 2px 8px rgba(0,0,0,.06)}.so-find .so-q{position:relative}.so-find .so-q::before{content:'🔍';position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:18px;pointer-events:none}.so-find .so-q input{padding-left:40px;height:48px;font-size:17px;font-weight:600;border:2px solid #d4a72c}
.so-find input,.so-find select{width:100%;min-width:0;height:42px;border:1px solid #ddd5c4;border-radius:12px;padding:0 10px;font-size:16px;background:#fff}
.so-sec{margin:8px 0}
.so-group{display:flex;justify-content:space-between;align-items:center;gap:8px;list-style:none;cursor:pointer;margin:0;padding:12px 14px;border-radius:14px;background:#efe9dc;font-weight:800;font-size:15px}
.so-group::-webkit-details-marker{display:none}
.so-group::after{content:'▾';margin-left:6px;transition:transform .15s}
.so-sec:not([open]) .so-group::after{transform:rotate(-90deg)}
.so-group .so-count{margin-left:auto;font-size:13px;color:#6b6555;font-weight:700}
.so-group .so-count b{color:#e8583a}
.so-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:10px;align-items:center;background:#fff;border-radius:14px;padding:8px 10px;margin:6px 0;box-shadow:0 1px 3px #0001}
.so-row.on{outline:2px solid #e8583a;background:#fff6f2}
.so-pic{width:40px;height:40px;border-radius:10px;overflow:hidden;background:#efe9dc;display:grid;place-items:center;font-size:18px}
.so-pic img{width:100%;height:100%;object-fit:cover}
.so-name{min-width:0;font-weight:800;font-size:15px;overflow-wrap:anywhere}
.so-name small{display:block;font-weight:600;color:#6b6555;font-size:12px}
.so-act{display:flex;align-items:center;gap:4px}
.so-act .need{border:0;border-radius:12px;padding:10px 10px;background:#e8583a;color:#fff;font-weight:800;font-size:14px;white-space:nowrap}
.so-act .step{border:0;border-radius:10px;width:36px;height:36px;background:#efe9dc;font-size:18px;font-weight:800}
.so-act .step.plus{background:#e8583a;color:#fff}
.so-act b{min-width:44px;text-align:center;font-size:14px;white-space:nowrap}
.so-act input.qty{width:56px;height:36px;border:1.5px solid #8fb0e8;border-radius:10px;background:#eef4ff;text-align:center;font-size:16px;font-weight:800;color:#1d3f7a;-webkit-appearance:none;appearance:none;padding:0}
.so-act input.qty::-webkit-inner-spin-button{display:none}
.so-empty{padding:16px;text-align:center;color:#6b6555}
.so-basket{position:sticky;bottom:8px;margin-top:12px;width:100%;height:48px;border:0;border-radius:14px;background:#3e4b33;color:#fff;font-size:16px;font-weight:800;box-shadow:0 4px 12px #0003}
`;
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = CSS; document.head.appendChild(el);
}
const GROUP_ICONS = [[/쿠키|두쫀쿠|두바이/, '🍪'], [/휘낭시에/, '🧈'], [/홀케이크|생일/, '🎂'], [/치즈케이크|요거트|케이크/, '🍰'], [/티라미수/, '☕'], [/푸딩/, '🍮'], [/아이스크림|소프트/, '🍦'],
  [/시루|크럼블|떡/, '🍡'], [/베이글|크림치즈/, '🥯'], [/스콘|크루아상|크로와상/, '🥐'], [/크림밤/, '🥖'], [/사워도우|빵/, '🍞'], [/티백|콜드브루|커피/, '☕'], [/캔/, '🥫'], [/빙수/, '🍧'],
  [/파우더/, '🥄'], [/가니쉬/, '🍋'], [/리테일/, '🛍️'], [/베이스|음료|에이드|주스|시럽|청/, '🧃'], [/유제품|우유|밀크|크림/, '🥛'], [/당류|감미료|설탕/, '🍬'], [/재료/, '🍫'], [/소스/, '🫙'],
  [/컵/, '🥤'], [/봉투|박스/, '📦'], [/식기|빨대|스푼|포크/, '🥢'], [/뚜껑/, '🧢'], [/청소/, '🧽'], [/위생|장갑/, '🧤'], [/조리|작업/, '🍳'], [/스티커|라벨/, '🏷️'], [/용기/, '🥡'], [/영수증/, '🧾'], [/홀더|캐리어/, '🛍️']];
export function groupIcon(name) { const hit = GROUP_ICONS.find(([re]) => re.test(String(name || ''))); return hit ? hit[1] : '•'; }
export function groupOf(p) { return String(p.subgroup || p.category || '기타').trim(); }
export function kindOf(p) { return /포장|소모품/.test(String(p.category || '') + String(p.subgroup || '')) ? 'supplies' : 'food'; }
export function filterItems(items, {kind = 'all', cat = '', q = ''}, name = p => p.name_ko) {
  const s = String(q || '').trim().toLowerCase().replace(/\s/g, '');
  return items.filter(p => (kind === 'all' || kindOf(p) === kind) && (!cat || p.category === cat)
    && (!s || String(name(p) || '').toLowerCase().replace(/\s/g, '').includes(s) || String(p.name_en || '').toLowerCase().replace(/\s/g, '').includes(s)));
}
const view = {kind: 'all', cat: '', q: '', open: new Set()};
export function renderSupplies(host, c) {
  ensureStyle();
  const {t, esc} = c, kitchen = c.mode === 'kitchen', embedded = c.mode === 'embedded';
  const cats = [...new Set(c.items.map(p => p.category).filter(Boolean))];
  if (view.cat && !cats.includes(view.cat)) view.cat = '';
  const rows = () => {
    const list = kitchen ? filterItems(c.items, {q: view.q}, c.name) : filterItems(c.items, view, c.name), groups = [];
    // 비슷한 것끼리 묶기: 🍪 쿠키 · 🧈 휘낭시에 · 🍰 케이크 · 🥫 캔 음료 … (누르면 펼쳐져요, 검색하면 다 펼쳐요)
    list.forEach(p => { const k = groupOf(p); let g = groups.find(x => x.k === k); if (!g) groups.push(g = {k, list: []}); g.list.push(p); });
    const dis = c.locked || c.preview ? 'disabled' : '', searching = !!String(view.q || '').trim(), oneGroup = groups.length === 1;
    return list.length ? groups.map(g => { const n = g.list.filter(p => c.getQty(p) > 0).length, open = searching || oneGroup || view.open.has(g.k);
      return `<details class="so-sec" data-sec="${esc(g.k)}" ${open ? 'open' : ''}><summary class="so-group"><span>${groupIcon(g.k)} ${esc(g.k)}</span><span class="so-count">${n ? `<b>${n}</b> / ` : ''}${g.list.length}</span></summary>${g.list.map(p => {
      const q = c.getQty(p), way = c.onTheWay?.(p);
      return `<div class="so-row ${q > 0 ? 'on' : ''}"><div class="so-pic">${kindOf(p) === 'supplies' && !/img/.test(c.picture(p)) ? '📦' : c.picture(p)}</div>
        <div class="so-name">${esc(c.name(p))}<small>${esc(c.unitLabel(p))}${way ? ' · ' + esc(t(`${way.date} 도착 예정`, `arriving ${way.date}`)) : ''}</small></div>
        <div class="so-act">${q > 0
          ? `<button class="step" data-so="less" data-id="${esc(p.id)}" ${dis} aria-label="${t('하나 빼기', 'one less')}">−</button>${kitchen ? `<input class="qty" type="number" inputmode="decimal" min="0" step="any" data-qty="${esc(p.id)}" value="${esc(q)}" ${dis} aria-label="${t('수량', 'Quantity')}">` : `<b>${esc(c.qtyDisplay(p, q))}</b>`}<button class="step plus" data-so="need" data-id="${esc(p.id)}" ${dis} aria-label="${t('하나 더', 'one more')}">+</button>`
          : `<button class="need" data-so="need" data-id="${esc(p.id)}" ${dis}>${t('더 필요해요!', 'Need more!')}</button>`}</div></div>`;
    }).join('')}</details>`; }).join('') : `<p class="so-empty">${t('찾는 품목이 없어요', 'No matching items')}</p>`;
  };
  const basketLabel = () => { const n = c.items.filter(p => c.getQty(p) > 0).length; return '🛒 ' + t(`발주함 보기${n ? ` · 추가 ${n}개` : ''}`, `Open basket${n ? ` · ${n} extra` : ''}`); };
  host.innerHTML = kitchen ? `<div class="so">
    <h3>🍳 ${t('키친 발주', 'Kitchen order')}</h3>
    <p class="so-help">${t('필요한 것만 "더 필요해요!"를 누르고, 숫자 칸에 수량을 바로 적어도 돼요.', 'Tap "Need more!" for what you need, or type the quantity.')}</p>
    <div class="so-find"><div class="so-q"><input type="search" id="soSearch" placeholder="${t('품목 이름으로 찾기 (예: 우유, 컵)', 'Find an item (e.g. milk, cup)')}" value="${esc(view.q)}"></div></div>
    <div id="soRows">${rows()}</div>
    <button class="so-basket" data-so="basket">${basketLabel()}</button></div>` : `<div class="so">
    ${embedded ? '' : `<div class="so-tabs"><button data-so="back">✅ ${t('필수 확인', 'Must check')}</button><button aria-pressed="true">📦 ${t('추가 주문', 'Extra order')}</button><button data-so="basket">🛒 ${t('발주함', 'Basket')}</button></div>`}
    <h3>📦 ${t('추가 주문', 'Extra order')}</h3>
    <p class="so-help">${embedded ? t('세지 않는 품목이에요. 필요한 것만 "더 필요해요!"', 'No counting. Tap "Need more!" for what you need.') + '<span hidden>' : ''}${t('필수 확인에 없는 품목이에요. 세지 않아도 돼요. 필요한 것만 "더 필요해요!"를 누르면 발주 단위로 하나씩 담겨요.', 'Items not in Must check. No counting. Tap "Need more!" to add one order unit at a time.')}${embedded ? '</span>' : ''}</p>
    <div class="so-chips">${[['all', t('전체', 'All')], ['food', t('식재료·메뉴', 'Food & menu')], ['supplies', t('소모품·포장', 'Supplies')]].map(([k, l]) => `<button data-kind="${k}" aria-pressed="${view.kind === k}">${l}</button>`).join('')}</div>
    <div class="so-find"><div class="so-q"><input type="search" id="soSearch" placeholder="${t('품목 이름으로 찾기 (예: 우유, 컵)', 'Find an item (e.g. milk, cup)')}" value="${esc(view.q)}"></div><select id="soCat"><option value="">${t('전체 카테고리', 'All categories')}</option>${cats.map(k => `<option ${view.cat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
    <div id="soRows">${rows()}</div>
    <button class="so-basket" data-so="basket">${basketLabel()}</button></div>`;
  const redraw = () => { host.querySelector('#soRows').innerHTML = rows(); host.querySelectorAll('.so-basket').forEach(b => { b.textContent = basketLabel(); }); };
  host.querySelector('#soSearch').oninput = e => { view.q = e.target.value; redraw(); };
  const catSel = host.querySelector('#soCat'); if (catSel) catSel.onchange = e => { view.cat = e.target.value; redraw(); };
  if (!host.__soToggle) host.__soToggle = 1, host.addEventListener?.('toggle', e => { const d = e.target; if (!d?.dataset?.sec || String(view.q || '').trim()) return; if (d.open) view.open.add(d.dataset.sec); else view.open.delete(d.dataset.sec); }, true);
  host.onchange = e => {
    const el = e.target.closest('input[data-qty]'); if (!el || el.disabled) return;
    const p = c.items.find(x => x.id === el.dataset.qty); if (!p) return;
    const n = Number(el.value); if (!Number.isFinite(n) || n < 0) { el.value = c.getQty(p); return; }
    c.setQty(p, Math.round(n * 1000) / 1000); redraw();
  };
  host.onclick = e => {
    const k = e.target.closest('button[data-kind]');
    if (k) { view.kind = k.dataset.kind; host.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b === k))); return redraw(); }
    const b = e.target.closest('button[data-so]'); if (!b || b.disabled) return;
    if (b.dataset.so === 'back') return c.back();
    if (b.dataset.so === 'basket') return c.openBasket();
    const p = c.items.find(x => x.id === b.dataset.id); if (!p) return;
    const step = c.qtyStep(p) || 1, q = c.getQty(p);
    c.setQty(p, Math.max(0, Math.round((q + (b.dataset.so === 'need' ? step : -step)) * 1000) / 1000));
    redraw();
  };
}
