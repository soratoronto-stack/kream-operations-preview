import test from 'node:test';
import assert from 'node:assert/strict';
import {availableForStore,storeCatalog} from '../store-availability.mjs';
import {validItems} from '../core.mjs';
test('cream bombs appear only in Midland ordering, including renamed and new products',()=>{
  const products=[{id:'bomb-milk',name_ko:'밀크',active:true,unit_confirmed:true},{id:'new',subgroup:'크림밤'},{id:'new2',name_ko:'새 크림밤'},{id:'milk',active:true,unit_confirmed:true}];
  assert.equal(storeCatalog(products,'midland').length,4);
  for(const store of ['finch','wellesley','richmond','galleria-ktown','galleria-yorkmills',''])assert.deepEqual(storeCatalog(products,store).map(p=>p.id),['milk']);
  assert.equal(products.length,4); // Factory/history data is not mutated.
  assert.equal(availableForStore(products[0],'midland'),true);
  assert.throws(()=>validItems({'bomb-milk':1},storeCatalog(products,'finch')));
  assert.deepEqual(validItems({'bomb-milk':1},storeCatalog(products,'midland')),[{product_id:'bomb-milk',quantity:1}]);
});
