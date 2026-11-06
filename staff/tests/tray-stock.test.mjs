import test from 'node:test';import assert from 'node:assert/strict';
import {stockDisplay,stockInput} from '../stock-units.mjs';
import {stockFields,bindStock,clearStockEdits} from '../store-stock.mjs';
import {safeMapping} from '../../supabase/functions/kream-clover-sync/mapping.mjs';
const ids=['sheet-39cdeb9512','sheet-04562b9807','sheet-9fbb33a000','sheet-08ea6b9890'];
test('ten-piece trays display and accept pieces without changing receipt/order units',()=>{
 for(const id of ids){assert.equal(stockDisplay(id,1),10);assert.equal(stockDisplay(id,0.9),9);assert.equal(stockInput(id,'9'),0.9);assert.equal(stockDisplay(id,null),null);assert.equal(stockInput(id,''),'');assert.throws(()=>stockInput(id,'1.5'));}
 assert.equal(stockDisplay('chewy',64),64);assert.equal(stockInput('chewy','64'),64);
});
test('confirmed cheesecake slices deduct one tenth tray; whole cakes and bag products are not guessed',()=>{
 const catalog=ids.map(id=>({id,active:true,category:'디저트',order_unit:'Tray'})).concat({id:'sheet-de03fcb009',active:true,category:'디저트',order_unit:'EA'});
 for(const name of ['Fig Cheesecake','Yuzu Cheesecake','Chestnust Cheese Cake','Tiramisu Cheesecake'])assert.equal(safeMapping(name,catalog).stock_per_sale,0.1);
 assert.equal(safeMapping('Rare Cheese Cake · Oreo Rare Cheese Cake',catalog).stock_per_sale,1);
 for(const name of ['Whole Fig Cheesecake','4 inch Fig Cheesecake','Financier · Choco','Mini scone','Dubai Chewy · Over 5'])assert.deepEqual(safeMapping(name,catalog),{});
});
test('shop physical count saves nine pieces as 0.9 tray and preserves revision',async()=>{
 clearStockEdits();const id=ids[0],p={id,unit_confirmed:true,order_unit:'Tray'},t=(ko)=>ko,esc=String;
 const html=stockFields(p,{on_hand:1,minimum:0.5},{t,esc,name:()=>'',rules:[],date:'2026-11-06',profile:{role:'owner'}});
 assert.ok(html.includes('value="10"'));assert.ok(html.includes('value="5"'));assert.ok(html.includes('1트레이 = 10개'));
 const input={dataset:{stockId:id,stockKey:'on_hand'},value:'9',setCustomValidity:()=>{},checkValidity:()=>true};let saved;
 const button={dataset:{stockSave:id}},host={querySelectorAll:selector=>selector==='[data-stock-key]'||selector==='[data-stock-id]'?[input]:selector==='[data-stock-save]'?[button]:[]};
 bindStock(host,{stock:[{product_id:id,on_hand:1,minimum:0.5,revision:3}],rules:[],store:'downtown',t,say:()=>{},act:f=>f(),db:{rpc:async(name,payload)=>{saved=payload;return {}; }},reload:async()=>{},applyRecommendation:()=>{}});
 input.oninput();await button.onclick();assert.equal(saved.new_on_hand,0.9);assert.equal(saved.new_minimum,0.5);assert.equal(saved.expected_stock_revision,3);clearStockEdits();
});
