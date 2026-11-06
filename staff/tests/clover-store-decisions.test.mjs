import test from 'node:test';import assert from 'node:assert/strict';
import {safeMapping} from '../../supabase/functions/kream-clover-sync/mapping.mjs';
import {availableForStore} from '../store-availability.mjs';
const catalog=[['pantry-cookie-set','Set'],['sheet-84dd8c64a5','EA'],['sheet-48cab960c4','EA']].map(([id,order_unit])=>({id,order_unit,active:true,category:'디저트'}));
test('confirmed store menus map a cookie set or siru to one inventory unit',()=>{
 assert.deepEqual(safeMapping('Cookie · Cookie Set',catalog,'finch'),{product_id:'pantry-cookie-set',stock_per_sale:1,enabled:true});
 assert.equal(safeMapping('Crumble Rice Cake · Injeolmi',catalog,'finch').product_id,'sheet-84dd8c64a5');
 assert.equal(safeMapping('Chestnut Crumble · Mugwort',catalog,'richmond-hill').product_id,'sheet-48cab960c4');
 assert.deepEqual(safeMapping('Chestnut Crumble · Mugwort',catalog,'finch'),{});
 assert.deepEqual(safeMapping('Cookie · Cookie Set',catalog,'midland'),{});
});
test('manually counted and unconfirmed menus cannot auto-match even identical catalog names',()=>{
 const excluded={finch:['Financiers · 2ea','Financiers · 2ea / 2ea','Mini Croissant · Sweet','Mini Croissant · Spicy','Garlic Bagel'],midland:['Croissant Cookie · Sweet'],'richmond-hill':['Bagel · Basil Tomato','Bagel · Blueberry','Bagel · Strawberry','Scones · Plain','Short Cake'],downtown:['Financier · Choco','Mini scone']};
 for(const [store,names] of Object.entries(excluded))for(const name of names)assert.deepEqual(safeMapping(name,[{id:'same',active:true,category:'디저트',order_unit:'EA',name_en:name}],store),{});
 for(const store of ['finch','downtown','midland','richmond-hill'])assert.deepEqual(safeMapping('Milk Kream Bomb',[{id:'same',active:true,category:'디저트',order_unit:'EA',name_en:'Milk Kream Bomb'}],store),{});
});
test('cookie set is available in Pantry ordering only; shared history remains unchanged',()=>{
 const p=catalog[0];assert.equal(availableForStore(p,'finch'),true);for(const store of ['downtown','midland','richmond-hill','galleria-ktown'])assert.equal(availableForStore(p,store),false);
});
