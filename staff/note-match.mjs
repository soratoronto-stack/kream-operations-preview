// Compatibility for the original PR helper; runtime uses the multiple-choice memo editor.
import {memoMatches,memoRequest} from './memo-products.mjs?v=20261126-memo-products';
export function matchNoteLines(text,products){return String(text||'').split('\n').flatMap(line=>{const product=memoMatches(products,line)[0];return product?[{line,product,qty:memoRequest(line).amount||1}]:[];});}
export function removeLine(text,line){const lines=String(text||'').split('\n'),i=lines.indexOf(line);if(i>=0)lines.splice(i,1);return lines.join('\n').replace(/^\n+|\n+$/g,'');}
