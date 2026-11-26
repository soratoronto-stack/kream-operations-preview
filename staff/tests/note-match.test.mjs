import test from 'node:test';import assert from 'node:assert/strict';
import {matchNoteLines,removeLine} from '../note-match.mjs';
const P=(id,name_ko,name_en)=>({id,name_ko,name_en});
const cat=[P('byc','블루베리 요거트케이크','Blueberry Yogurt Short Cake'),P('ccc','치즈 크로와상 쿠키','Cheese Croissant Cookie'),P('tc','티라미수 크림','Tiramisu Cream'),P('tcb','티라미수 크림밤','Tiramisu Cream Bun'),P('oat','오트 밀크','Oat Milk'),P('alm','아몬드 밀크','Almond Mik'),P('grape','포도 주스','Grape Juice')];
test('직원이 메모에 친 품목을 목록에서 찾아요', () => {
  const text='Blueberry yogurt short cake 3 ea\nCheese mini croissant 1 bag\nApple juice 1 box\nTiramisu cream for drink 1\nOat milk 2 ea\nalmond milk 2';
  const m=matchNoteLines(text,cat).map(h=>[h.product.id,h.qty]);
  assert.deepEqual(m,[['byc',3],['ccc',1],['tc',1],['oat',2],['alm',2]]);   // 이 테스트 목록에 없는 품목은 메모로 남아요
  assert.equal(removeLine(text,'Oat milk 2 ea').includes('Oat milk'),false);
});

