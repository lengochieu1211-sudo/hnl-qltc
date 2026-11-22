import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFloorHighlightColorLegend, mainHighlightColorKey, childHighlightColorKey } from '../src/utils/highlightCategoryColors.ts';
const R = (x,y,width,height) => ({x,y,width,height});
const room1 = {
 id:'room-a', floorId:'f1',roomName:'P1', x:0,y:0,width:20,height:30, workCategory:'TRẦN',
 categoryHighlightShapes: {'TRẦN':[R(0,0,70,100)], 'VÁCH':[R(0,0,40,100)]},
 subItems: [
   {id:'a1',name:'Khung chìm',category:'TRẦN',highlightShapes:[R(0,0,40,100)]},
   {id:'a2',name:'Tấm chống ẩm',category:'TRẦN',highlightShapes:[R(40,0,30,100)],highlightColor:'#e11d48'},
   {id:'a3',name:'Khung vách',category:'VÁCH',highlightShapes:[R(0,0,40,100)]}
 ]};
const room2 = {...room1,id:'room-b',roomName:'P2',subItems: [...room1.subItems, {id:'b1',name:'Băng keo',category:'TRẦN',highlightShapes:[R(10,10,30,60)]}]};
const before = structuredClone([room1,room2]);
const a = buildFloorHighlightColorLegend([room1,room2]), b = buildFloorHighlightColorLegend([room2,room1]);
assert.deepEqual(a,b,'colors and legend do not depend on room ordering');
assert.deepEqual([room1,room2],before,'pure display function cannot mutate saved rooms');
const mainA=mainHighlightColorKey('TRẦN'),mainB=mainHighlightColorKey('VÁCH');
const childA=childHighlightColorKey('TRẦN','Khung chì'),childB=childHighlightColorKey('TRẦN','Tấm chống ẩm'),childC=childHighlightColorKey('VÁCH','Khung vách');
for(const key of [mainA,mainB,childA,childB,childC]) assert.ok(a.colors[key],key);
assert.equal(a.colors[childB],'#e11d48','preserve explicit saved color if not duplicated');
assert.equal(new Set(a.entries.map(e=>e.color.toLowerCase())).size,a.entries.length,'different main and child labels have distinct colors');
assert.equal(a.entries.find(e=>e.key===childA).hasGeometry,true);
assert.equal(a.entries.find(e=>e.key===mainB).hasGeometry,true);
const duplicate = structuredClone(room1);
duplicate.subItems[0].highlightColor='#e11d48';
const collision = buildFloorHighlightColorLegend([duplicate]);
assert.notEqual(collision.colors[childHighlightColorKey('TRẦN','Khung chì')], collision.colors[childB], 'colliding custom overrides resolved for display only');
const many = {id:'bulk',workCategory:'M0',subItems:Array.from({length:36},(_,i)=>({id:`stage${i}`,name:`stage_${i}`,category:'M0'}))};
const lots = buildFloorHighlightColorLegend([many]);
assert.equal(new Set(lots.entries.map(e=>e.color.toLowerCase())).size,lots.entries.length,'many categories are still distinguishable');
const floor = readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
const draw = readFileSync('src/components/FloorHighlightDirectDraw.tsx','utf8');
assert.match(floor,/data-hnl-highlight-color-legend="true"/);
assert.match(floor,/Chú giải màu Highlight/);
assert.match(floor,/Con của: \{parentName\}/);
assert.match(floor,/mainHighlightColorKey\(cat\)/);
assert.match(floor,/childHighlightColorKey\(cat, stage.name\?\.trim\(\) \|\| stage.id\)/);
assert.match(floor,/highlightColors=\{highlightColorLegend.colors\}/);
assert.match(draw,/data-hnl-highlight-active-color="true"/);
assert.match(draw,/currentHighlightColor/);
const drawings = floor.slice(floor.indexOf('{/* Live Draft Highlight Pending Pulsing Shape */}'),floor.indexOf('{/* Saved room strokes use screen-pixel widths:'));
for(const token of ['Live 2-Point Drawing Rectangle Preview','Live Freehand Drawing Line Preview','Live Polygon Point-by-Point Drawing Preview'])
  assert.ok(drawings.includes(token),token);
const dashCount=(drawings.match(/strokeDasharray="6 3"/g)||[]).length;
const vectorCount=(drawings.match(/vectorEffect="non-scaling-stroke"/g)||[]).length;
assert.ok(dashCount>=5 && vectorCount>=5,`all live drawing modes must use fixed pixel dash style: ${dashCount}/${vectorCount}`);
assert.match(draw,/strokeDasharray="6 3" vectorEffect="non-scaling-stroke"/, 'map direct draw preview scales correctly');
assert.match(floor,/strokeDasharray="5 3" vectorEffect="non-scaling-stroke"/, 'child saved area style distinct from solid main');
console.log('HIGHLIGHT COLORS & FIXED ZOOM DASH GOLDEN PASS: unique main+child, saved overrides, deterministic legend, 2point/polygon/freehand fixed-size dashes');