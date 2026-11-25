import assert from 'node:assert/strict';
import { evaluateRoomQuantityFormula } from '../src/utils/roomQuantityFormula.ts';

const vars = { S: 20, P: 18, L: 12, KL: 100 };
const cases: [string, number][] = [
  ['S*1.05',21], ['P*2,8',50.4], ['L*2.8',33.6], ['KL*2',200],
  ['S+P*0.3',25.4], ['(S+P)*2',76], ['s × 2',40], ['KL÷4',25],
  ['2+3*4',14], ['20-5-2',13], ['20/5/2',2], ['2*(-3+5)',4],
  ['S-S',0], ['.5*KL',50], ['+S',20],
];
for (const [expression, expected] of cases) {
  const result = evaluateRoomQuantityFormula(expression, vars);
  assert.equal(result.valid, true, expression);
  if (result.valid) assert.ok(Math.abs(result.value - expected) < 1e-9, expression);
}
for (const expression of ['', ' ', 'S/0', 'S-100', 'S*', 'S1.05', '2(3)', '(S', 'S)', '1,2.3', '1 2', 'P**2', 'S;alert(1)', 'Infinity', 'NaN', 'A+1', '('.repeat(33)+'1'+')'.repeat(33), '1'.repeat(257)]) {
  assert.equal(evaluateRoomQuantityFormula(expression, vars).valid,false,expression);
}
assert.equal(evaluateRoomQuantityFormula('KL*2', {S:20}).valid,false);
assert.equal(evaluateRoomQuantityFormula('S', {S:NaN}).valid,false);
assert.equal(evaluateRoomQuantityFormula('S', {S:Infinity}).valid,false);
assert.equal(evaluateRoomQuantityFormula('L', {L:-1}).valid,false);
assert.equal(evaluateRoomQuantityFormula('S*2', {S:Number.MAX_VALUE}).valid,false);
assert.deepEqual(evaluateRoomQuantityFormula('KL', {KL:0}),{valid:true,value:0});
console.log('Room quantity formula: PASS (' + (cases.length + 24) + ' cases)');
