import test from 'node:test';
import assert from 'node:assert/strict';
import {quantityStep} from '../quantity-step.mjs';
test('quantity buttons step by one for counts and measured units',()=>{
  for(const unit of ['EA','Bag','Bag · 20개/봉','Box','Case','Pack','Tray','Bunch · 송이'])assert.equal(quantityStep(unit),'1');
  for(const unit of ['kg','g','ml','L','lb','킬로그램'])assert.equal(quantityStep(unit),'1');
});
