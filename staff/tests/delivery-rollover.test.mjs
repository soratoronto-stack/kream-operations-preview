import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultReceiptDate,restoredReceiptDate,selectableReceiptDate} from '../delivery-date.mjs';
const noon=new Date('2026-11-27T17:46:00Z');
test('empty old basket rolls to the next delivery date',()=>assert.equal(restoredReceiptDate({delivery_date:'2026-11-27',items:[],note:''},noon),'2026-11-28'));
test('basket with items or a note keeps its date until explicitly corrected',()=>{assert.equal(restoredReceiptDate({delivery_date:'2026-11-27',items:[{product_id:'x',quantity:1}]},noon),'2026-11-27');assert.equal(restoredReceiptDate({delivery_date:'2026-11-27',items:[],note:'Paper clips'},noon),'2026-11-27');});
test('future selections remain and old dates cannot submit',()=>{assert.equal(restoredReceiptDate({delivery_date:'2026-12-01',items:[]},noon),'2026-12-01');assert.equal(selectableReceiptDate('2026-11-27',noon),false);assert.equal(selectableReceiptDate('2026-11-28',noon),true);});
test('3am Toronto boundary works across DST and months',()=>{for(const [at,expected] of [['2026-11-27T07:59:59Z','2026-11-27'],['2026-11-27T08:00:00Z','2026-11-28'],['2026-07-01T06:59:59Z','2026-07-01'],['2026-07-01T07:00:00Z','2026-07-02'],['2026-12-01T07:59:59Z','2026-12-01']])assert.equal(defaultReceiptDate(new Date(at)),expected);});
