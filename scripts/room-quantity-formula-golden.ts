import assert from 'node:assert/strict';
import type { FloorPlan, RoomProgressItem } from '../src/types';
import { createFloorMetricCalibration } from '../src/utils/highlightMetricGeometry.ts';
import { measureBasicRoomQuantitySource } from '../src/utils/roomHighlightBasicMetric.ts';
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

const image = {width:1000,height:500};
const floor: FloorPlan = {id:'test-floor',floorName:'Test',imageUrl:'https://example.invalid/test.png',uploadedAt:'2026-11-25'};
const calibration = createFloorMetricCalibration(floor,image,{x:0,y:0},{x:10,y:0},1);
assert.ok(calibration);
floor.highlightMetricCalibration = calibration;
const room: RoomProgressItem = {
  id:'room',floorId:floor.id,roomName:'Test',x:10,y:10,width:40,height:40,
  frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',updatedAt:1
};
const measure = (source: 'area'|'perimeter'|'length'|'linear', candidate = room, sourceFloor = floor) =>
  measureBasicRoomQuantitySource({source,room:candidate,floor:sourceFloor,image});
const expectedMetric = (result: ReturnType<typeof measure>, expected:number) => {
  assert.equal(result.valid,true);
  if(result.valid) assert.ok(Math.abs(result.value-expected)<1e-8);
};
expectedMetric(measure('area'),8);
expectedMetric(measure('perimeter'),12);
assert.equal(measure('length').valid,false);
const line = {...room,isPolyline:true,points:[{x:10,y:10},{x:50,y:10},{x:50,y:50}]};
expectedMetric(measure('length',line),6);
assert.equal(measure('area',line).valid,false);
assert.equal(measure('perimeter',line).valid,false);
assert.equal(measure('length',{...line,positionLocked:true}).valid,false);
assert.equal(measure('length',{...line,inspectionStatus:'Đạt nghiệm thu'}).valid,false);
assert.equal(measure('length',{...line,points:[{x:0,y:0},{x:10,y:10},{x:0,y:0}]}).valid,false);
assert.equal(measure('length',{...line,points:[{x:0,y:0},{x:120,y:10}]}).valid,false);
assert.equal(measure('length',line,{...floor,imageRevision:2}).valid,false);
assert.equal(measure('length',line,{...floor,highlightMetricCalibration:undefined}).valid,false);
expectedMetric(measure('linear'),12);
expectedMetric(measure('linear',line),6);
assert.equal(measure('linear',{...line,positionLocked:true}).valid,false);
assert.equal(measure('linear',line,{...floor,imageRevision:2}).valid,false);
console.log('Explicit basic quantity measurement: PASS (16 cases)');
