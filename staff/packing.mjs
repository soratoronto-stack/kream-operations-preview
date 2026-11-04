const ids=new Set(['chewy','sheet-70441a15e7','sheet-9ea75322e4','sheet-1f39626328']);
export function halfBoxCount(p){return ids.has(p?.id)&&['ea','개','낱개'].includes(String(p.order_unit||'').toLowerCase())?32:1;}
export function packingHint(p,lang='ko'){return halfBoxCount(p)===32?(lang==='en'?'Half box 32 pcs · Full box 64 pcs':'반 박스 32개 · 한 박스 64개'):'';}
