import {stockDisplayFactor} from './stock-units.mjs?v=20261106-all-cheesecake-trays';
const ids=new Set(['chewy','sheet-70441a15e7','sheet-9ea75322e4','sheet-1f39626328']);
export function halfBoxCount(p){return ids.has(p?.id??p?.product_id)&&['ea','개','낱개'].includes(String(p.order_unit||'').toLowerCase())?32:1;}
export function packingHint(p,lang='ko'){return halfBoxCount(p)===32?(lang==='en'?'Half box (32 pcs)':'반박스(32개)'):'';}

export function unitLabel(p){return halfBoxCount(p)===32?'64개/box':stockDisplayFactor(p)>1?'Tray · 10조각/트레이':String(p?.order_unit||'');}
export function quantityLabel(p,value){const n=Number(value);return halfBoxCount(p)===32?(n%32===0?String(n/64)+' box ('+n+'개)':String(n)+'개'):String(value)+' '+String(p?.order_unit||'');}
export function boxAmount(p,raw,measure='half'){const n=Number(raw),factor=halfBoxCount(p)===32?(measure==='box'?64:measure==='half'?32:NaN):1;const amount=n*factor;if(raw===''||!Number.isFinite(n)||n<0||(factor===64?!Number.isInteger(n*2):!Number.isInteger(n))||!Number.isInteger(amount)||amount>100000)throw Error('INVALID_QUANTITY');return amount;}

export function displayQuantity(p,value){return Number(value||0)/(halfBoxCount(p)===32?64:1);}
export function inputQuantity(p,value){const n=Number(value),factor=halfBoxCount(p)===32?64:1;if(value===''||!Number.isFinite(n)||n<0||n*factor>100000||(factor===64?!Number.isInteger(n*2):!Number.isInteger(n)))throw Error('INVALID_QUANTITY');return n*factor;}
