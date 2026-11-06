// Order/receipt quantities stay in trays; shop stock counts are shown in pieces.
const tenPieceTrays=new Set(['sheet-39cdeb9512','sheet-04562b9807','sheet-9fbb33a000','sheet-08ea6b9890']);
export const stockDisplayFactor=p=>tenPieceTrays.has(typeof p==='string'?p:p?.id||p?.product_id)?10:1;
export function stockDisplay(p,value){return value==null||value===''?value:Math.round(Number(value)*stockDisplayFactor(p)*1000)/1000;}
export function stockInput(p,value){if(value==null||value==='')return '';const n=Number(value);if(stockDisplayFactor(p)>1&&(!Number.isInteger(n)||n<0))throw Error('STOCK_PIECES_REQUIRED');return n/stockDisplayFactor(p);}
