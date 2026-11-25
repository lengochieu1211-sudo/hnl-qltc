import assert from 'node:assert/strict';
import type { FloorPlan, RoomProgressItem, WorkVolume } from '../src/types';
import { createFloorMetricCalibration } from '../src/utils/highlightMetricGeometry.ts';
import { measureBasicRoomQuantitySource } from '../src/utils/roomHighlightBasicMetric.ts';
import { evaluateRoomQuantityFormula } from '../src/utils/roomQuantityFormula.ts';
import { recalculateLinkedRoomQuantities } from '../src/utils/roomQuantityAutoUpdate';
import fs from 'node:fs';

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

const catalog = [{id:'work1',workCategoryId:'cat1',title:'Trần',floorId:floor.id,unit:'m²'}] as WorkVolume[];
const linked:RoomProgressItem={...room,workCategory:'Trần',workCategoryId:'cat1',workVolume:8,volumeUnit:'m²',categoryVolumes:{'Trần':8},categoryVolumeUnits:{'Trần':'m²'},
 subItems:[
  {id:'sub1',name:'Tấm',category:'Trần',status:'Chưa làm',workVolume:16},
  {id:'sub2',name:'Khung',category:'Trần',status:'Đã hoàn thành',workVolume:8},
  {id:'sub3',name:'Nhập tay',category:'Trần',status:'Chưa làm',workVolume:7},
 ],
 quantityFormulaSettings:{
  'main:id:cat1':{expression:'S',auto:true,categoryKey:'id:cat1',unit:'m²',value:8},
  'sub:sub1':{expression:'KL*2',auto:true,categoryKey:'id:cat1',unit:'m²',value:16},
  'sub:sub2':{expression:'KL',auto:true,categoryKey:'id:cat1',unit:'m²',value:8},
  'sub:sub3':{expression:'S',auto:false,categoryKey:'id:cat1',unit:'m²',value:7},
 }};
const resized={...linked,width:60};
const recalculated=recalculateLinkedRoomQuantities(resized,floor,catalog);
assert.equal(recalculated.categoryVolumes?.['Trần'],12);
assert.equal(recalculated.workVolume,12);
assert.equal(recalculated.subItems?.[0].workVolume,24);
assert.equal(recalculated.subItems?.[1].workVolume,8);
assert.equal(recalculated.subItems?.[2].workVolume,7);
assert.equal(recalculated.quantityFormulaSettings?.['main:id:cat1'].value,12);
assert.equal(recalculated.quantityFormulaSettings?.['sub:sub1'].value,24);
assert.equal(linked.workVolume,8);
assert.equal(linked.subItems?.[0].workVolume,16);
assert.equal(recalculateLinkedRoomQuantities(recalculated,floor,catalog),recalculated);
const locked={...resized,positionLocked:true};
assert.equal(recalculateLinkedRoomQuantities(locked,floor,catalog),locked);
const accepted={...resized,inspectionStatus:'Đạt nghiệm thu' as const};
assert.equal(recalculateLinkedRoomQuantities(accepted,floor,catalog),accepted);
assert.equal(recalculateLinkedRoomQuantities(resized,{...floor,imageRevision:5},catalog),resized);
const manualOverride={...resized,categoryVolumes:{'Trần':99},workVolume:99};
assert.equal(recalculateLinkedRoomQuantities(manualOverride,floor,catalog),manualOverride);
const duplicate={...resized,categoryVolumes:{'Trần':8,cat1:8}};
assert.equal(recalculateLinkedRoomQuantities(duplicate,floor,catalog),duplicate);
assert.equal(recalculateLinkedRoomQuantities(resized,floor,[...catalog,{...catalog[0],id:'work2',workCategoryId:'cat2'}]),resized);
const newCalibration=createFloorMetricCalibration(floor,image,{x:0,y:0},{x:10,y:0},2);
assert.ok(newCalibration);
const recalibrated=recalculateLinkedRoomQuantities(linked,{...floor,highlightMetricCalibration:newCalibration},catalog);
assert.equal(recalibrated.workVolume,32);
assert.equal(recalibrated.subItems?.[0].workVolume,64);
const ui=fs.readFileSync('src/components/RoomQuantityCalculator.tsx','utf8');
const modal=fs.readFileSync('src/components/RoomHighlightModal.tsx','utf8');
assert.match(ui,/ExpressionDisplayInput/);
assert.doesNotMatch(ui,/<select/);
assert.match(ui,/resolvedValue=/);
assert.match(modal,/quantityFormulaSettings/);
assert.match(modal,/data-hnl-sub-quantity-group/);
assert.match(modal,/data-hnl-sub-team-group/);
assert.match(ui,/title=\{help\}/);
assert.match(ui,/KL: Khối lượng hạng mục chính/);
assert.doesNotMatch(ui,/Nhấn vào KL để sửa công thức/);
assert.doesNotMatch(modal,/📐 \{getBasicMeasureUnit\(catName\)/u);
assert.match(ui,/aria-expanded=\{showHelp\}/);
assert.match(ui,/\{showHelp && <span role="note"/);
assert.doesNotMatch(ui,/<span className="basis-full text-slate-500">S:/);
assert.match(ui,/\{unit && <span/);
assert.match(modal,/\(ADVANCED_HIGHLIGHT_ENABLED \|\| structureReadOnly\) && <div/);
assert.match(modal,/!ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && <div data-hnl-subitem-editable-quantity/);
assert.match(modal,/unit=\{getBasicMeasureUnit\(catName\) \|\| getCategorySourceUnit\(catName\)\}/);

console.log('Room linked quantity auto-update and UI source Golden PASS');

const highlightCss=fs.readFileSync('src/index.css','utf8');
const floorUi=fs.readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
assert.match(highlightCss,/html :is\(\[data-hnl-workspace-module="floorplan"\], \[data-hnl-pc-v32-window="room-editor"\]\) select/);
assert.match(highlightCss,/data-hnl-map-tools-collapsible[^\n]*summary::-webkit-details-marker/);
for(const state of ['showColorPicker','showAdvancedHighlights','showMaterialEstimates','showDimensionSettings']) {
  assert.ok(modal.includes('data-open={'+state+'}'));
  assert.ok(modal.includes('aria-expanded={'+state+'}'));
}
for(const state of ['showFloorProgressPanel','roomExpanded','showHighlightColorLegend','showFullscreenDisplaySettings','!isCurrentGroupCollapsed']) {
  assert.ok(floorUi.includes('data-open={'+state+'}'));
  assert.ok(floorUi.includes('aria-expanded={'+state+'}'));
}
console.log('Scoped Highlight compact and nested disclosure Golden PASS');
