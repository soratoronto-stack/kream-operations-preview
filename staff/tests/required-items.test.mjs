import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {filterItems,kindOf} from '../supplies-order.mjs';
const app=fs.readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
const src=app.slice(app.indexOf('const REQUIRED_NAMES'),app.indexOf('function skipCount'));
const ctx={};vm.createContext(ctx);vm.runInContext(src+';this.requiredItem=requiredItem;',ctx);
const P=(name_ko,category,subgroup)=>({name_ko,category,subgroup});
test('필수 확인 품목 목록', () => {
  const yes=[P('우유 2%','원재료·음료','유제품'),P('스패너 크림','원재료·음료','유제품'),P('아몬드 밀크','원재료·음료','유제품'),P('오트 밀크','원재료·음료','유제품'),
    P('화채 캔','원재료·음료','캔 음료'),P('리얼 망고 프루티 캔','원재료·음료','캔 음료'),P('미숫가루 캔','원재료·음료','캔 음료'),
    P('딸기 레어 치즈케이크','디저트','레어 치즈케이크'),P('망고 치아시드 푸딩','디저트','푸딩'),P('마차 티라미수','디저트','티라미수'),
    P('스윗 크로와상 쿠키','디저트','미니 크루아상'),P('두바이쫀득쿠키','디저트','쿠키'),P('딸기 4인치 홀케이크 (워크인)','디저트','홀케이크'),P('청포도 요거트케이크','디저트','요거트 쇼트케이크'),P('바나나 푸딩','디저트','푸딩'),P('밀크 폼','원재료·음료','유제품'),P('티라미수 크림 ( 음료제조용 )','원재료·음료','유제품'),P('플레인 사워도우','빵류','사워도우')];
  const no=[P('예약 케이크','디저트','홀케이크'),P('바나나 푸딩','원재료·음료','기타 음료재료'),P('소세지빵','빵류','기타빵류'),P('미니 크루아상 봉투','포장·소모품','봉투·박스류'),P('말차 두바이 쫀득 쿠키','디저트','쿠키'),
    P('티라미수 크림밤','빵류','크림밤'),P('녹차 캔','원재료·음료','캔 음료'),P('콜드브루','원재료·음료','티백&콜드브루'),P('12oz 핫컵','포장·소모품','컵류'),P('연유 밀크','원재료·음료','유제품')];
  yes.forEach(p=>assert.equal(ctx.requiredItem(p),true,p.name_ko));
  no.forEach(p=>assert.equal(ctx.requiredItem(p),false,p.name_ko));
});
test('추가 주문 필터', () => {
  const items=[P('콜드브루','원재료·음료','티백&콜드브루'),P('12oz 핫컵','포장·소모품','컵류'),P('피칸쿠키','디저트','쿠키')];
  assert.equal(kindOf(items[1]),'supplies');assert.equal(kindOf(items[0]),'food');
  assert.deepEqual(filterItems(items,{kind:'food'}).map(p=>p.name_ko),['콜드브루','피칸쿠키']);
  assert.deepEqual(filterItems(items,{kind:'all',q:'핫 컵'}).map(p=>p.name_ko),['12oz 핫컵']);
  assert.deepEqual(filterItems(items,{kind:'all',cat:'디저트'}).map(p=>p.name_ko),['피칸쿠키']);
});
test('키친 발주는 목록 + 수량 입력 (전체 목록은 예전 카드)', () => {
  assert.match(app,/category==='키친 발주'\)\{document\.body\.classList\.toggle\('steps-mode',true\)/);
  assert.match(app,/renderSupplies\(host,\{mode:'kitchen'/);
  const so=fs.readFileSync(new URL('../supplies-order.mjs',import.meta.url),'utf8');
  assert.match(so,/data-qty=/);
});
test('4호점 이름 "티라미수 크림"도 필수 · 추가 주문은 종류별로 묶어요', async () => {
  assert.equal(ctx.requiredItem(P('티라미수 크림','원재료·음료','유제품')),true);
  assert.equal(ctx.requiredItem(P('티라미수 크림밤','빵류','크림밤')),false);
  const {groupIcon,groupOf}=await import('../supplies-order.mjs');
  assert.equal(groupIcon('쿠키'),'🍪');assert.equal(groupIcon('휘낭시에'),'🧈');assert.equal(groupIcon('캔 음료'),'🥫');assert.equal(groupIcon('컵류'),'🥤');
  assert.equal(groupOf(P('피칸쿠키','디저트','쿠키')),'쿠키');
});
