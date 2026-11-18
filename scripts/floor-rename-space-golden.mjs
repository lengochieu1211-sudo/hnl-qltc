#!/usr/bin/env node
/** DEV Golden: floor card must not consume Space/Enter from nested rename input. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const modal = source.indexOf('MANAGE FLOORS MODAL (Tùy Chỉnh, Đổi Tên');
assert(modal >= 0, 'floor manager missing');
const card = source.indexOf('role="button"', modal);
const end = source.indexOf('className="min-w-0 flex flex-1 items-center gap-3 text-left"', card);
assert(card > modal && end > card, 'floor card or keyboard handler missing');
const match = source.slice(card, end).match(/onKeyDown=\{\(event\) => \{([\s\S]*?)\n\s*\}\}/);
assert(match, 'floor card keyboard handler missing');
const handler = new Function('event', 'isEditingThis', 'setSelectedFloorId', 'setShowManageFloorsModal', 'fp', match[1]);
let assertions = 0;
function press(key, kind, editing = false) {
  const cardElement = { tagName: 'DIV' };
  const target = kind === 'card' ? cardElement : { tagName: kind.toUpperCase() };
  const state = { prevented: false, chosen: [], closed: [] };
  handler({key, target, currentTarget:cardElement, preventDefault:()=>{state.prevented=true;}},editing,
    id=>state.chosen.push(id), value=>state.closed.push(value), {id:'floor-A'});
  return state;
}
for (const key of [' ', 'Enter', 'a']) {
  for (const kind of ['input', 'button', 'checkbox']) {
    const result=press(key,kind,true);
    assert.equal(result.prevented,false,kind+' Space/Enter must not be blocked');
    assert.deepEqual(result.chosen,[]);
    assert.deepEqual(result.closed,[]);
    assertions+=3;
  }
}
for (const key of [' ', 'Enter']) {
  const result=press(key,'card');
  assert.equal(result.prevented,true);
  assert.deepEqual(result.chosen,['floor-A']);
  assert.deepEqual(result.closed,[false]);
  assertions+=3;
}
const unrelated=press('a','card');
assert.equal(unrelated.prevented,false);
assert.deepEqual(unrelated.chosen,[]);
assertions+=2;
const editing=press(' ','card',true);
assert.equal(editing.prevented,true);
assert.deepEqual(editing.chosen,[]);
assert.deepEqual(editing.closed,[]);
assertions+=3;
assert.match(source,/value=\{editingFloorName\}[\s\S]{0,180}onChange=\{\(e\) => setEditingFloorName\(e\.target\.value\)\}/);
assertions++;
console.log('PASS floor rename Space golden ('+assertions+' assertions): nested typing preserved, card shortcuts work');
