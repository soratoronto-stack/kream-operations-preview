import test from 'node:test';import assert from 'node:assert/strict';import {validDeliveryDate,fullDeliveryDate,confirmDeliveryDate} from '../delivery-date.mjs';
test('past and present delivery dates are accepted without tomorrow restriction',()=>{for(const value of ['2026-11-04','2026-11-05','2026-11-06','2024-02-29'])assert.equal(validDeliveryDate(value),true);for(const value of ['',undefined,'2026-02-30','2026-13-01','2026-1-1'])assert.equal(validDeliveryDate(value),false);});
test('confirmation labels show year and weekday',()=>{assert.match(fullDeliveryDate('2026-11-05'),/2026.*11.*5.*목/);assert.match(fullDeliveryDate('2026-11-05','en'),/2026/);});
test('invalid date cannot be confirmed',async()=>assert.equal(await confirmDeliveryDate('2026-02-30'),false));
