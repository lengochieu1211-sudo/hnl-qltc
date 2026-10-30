import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reorderExistingByIds } from '../src/utils/auditDataSafety.ts';
import { fitRoomRectToCanvas, translateRoomGroupToCanvas } from '../src/utils/roomHighlightGeometry.ts';
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log('PASS', label); };
const room = (id,x,y,width,height,points) => ({id,roomName:id,floorId:'F1',x,y,width,height,points,subItems:[],updatedAt:1});
check('stale reorder retains concurrent room',()=>{
  const current=[room('A',1,1,10,10),room('B',20,1,10,10),room('C',40,1,10,10)];
  const result=reorderExistingByIds(current,[{id:'B',roomName:'stale'},{id:'A'}]);
  assert.deepEqual(result.map(x=>x.id),['B','A','C']);assert.equal(result[0],current[1]);
});
check('reorder never resurrects remotely removed ID',()=>{
 assert.deepEqual(reorderExistingByIds([{id:'A'}],[{id:'deleted'},{id:'A'}]).map(x=>x.id),['A']);
});
check('duplicate reorder ID cannot duplicate record',()=>{
 assert.deepEqual(reorderExistingByIds([{id:'A'},{id:'B'}],[{id:'A'},{id:'A'}]).map(x=>x.id),['A','B']);
});
check('rectangle near bottom-right fits 100x100',()=>{
 const b=fitRoomRectToCanvas(99,99,20,15);assert.deepEqual(b,{x:80,y:85,width:20,height:15});
});
check('fractional rectangle dimensions never overflow canvas after rounding',()=>{
 const b=fitRoomRectToCanvas(99.9,99.9,0.15,0.15);
 assert.deepEqual(b,{x:99.8,y:99.8,width:0.2,height:0.2});
 assert.ok(b.x+b.width <= 100 && b.y+b.height <= 100);
});
check('rectangle near top-left fits 100x100',()=>{
 const b=fitRoomRectToCanvas(-9,-9,3,3);assert.deepEqual(b,{x:0,y:0,width:3,height:3});
});
check('rectangle invalid dimensions bounded',()=>{
 const b=fitRoomRectToCanvas(50,50,250,210);assert.deepEqual(b,{x:0,y:0,width:100,height:100});
});
check('group move retains pairwise distances near edge',()=>{
 const moved=translateRoomGroupToCanvas([room('A',5,5,20,20),room('B',70,5,20,20)],20,0);
 assert.ok(moved);assert.equal(moved[0].x,15);assert.equal(moved[1].x,80);
 assert.equal(moved[1].x-moved[0].x,65);
});
check('group move never loses polygon shape near edge',()=>{
 const original=room('P',80,40,20,20,[{x:80,y:40},{x:100,y:40},{x:95,y:60}]);
 const moved=translateRoomGroupToCanvas([original],22,0);assert.ok(moved);
 assert.deepEqual(moved[0].points,original.points);
 assert.equal(moved[0].x+moved[0].width,100);
});
check('group paste translates polygon without vertex clipping',()=>{
 const a=room('P',30,30,20,20,[{x:30,y:30},{x:50,y:30},{x:45,y:50}]);
 const moved=translateRoomGroupToCanvas([a],65,40);assert.ok(moved);
 assert.deepEqual(moved[0].points,[{x:80,y:70},{x:100,y:70},{x:95,y:90}]);
 assert.equal(moved[0].width,20);
});
check('oversize group fails closed',()=>{
 const moved=translateRoomGroupToCanvas([room('A',0,0,60,10),room('B',70,0,50,10)],10,0);
 assert.equal(moved,null);
});
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const floor=readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
const photo=readFileSync(new URL('../src/utils/photoStorage.ts',import.meta.url),'utf8');
check('F11 legacy photo URL retained through migration',()=>{
 const seg=floor.split('  // F-11: Legacy URLs are recovery evidence.')[1].split('  // V6.2.9:')[0];
 assert.ok(seg.includes('savePhotoAttachment'));assert.ok(!seg.includes('onUpdateDefect('));
});
check('F11 failed IndexedDB binary fails before metadata',()=>{
 const a=photo.indexOf('PHOTO_LOCAL_BINARY_PERSIST_FAILED');const b=photo.indexOf('// Add photo metadata to list',a);
 assert.ok(a>=0 && b>a);
});
check('F12 safe reorder helpers in both App entrypoints',()=>{
 assert.ok(app.includes('reorderExistingByIds(latestFloorRooms, requestedIds)'));
 assert.ok(app.includes('reorderExistingByIds(prev.floorPlans, reorderedList)'));
});
check('F7 duplicate Defect ID guarded',()=>{
 assert.ok(app.includes('prev.defects.some((item) => item.id === newId)'));
});
check('F13 draft preserved until App room state accepts',()=>{
 assert.ok(floor.includes('quickSaveDraftIdRef.current'));
 assert.ok(floor.includes('roomProgressList.some((room) => room.id === id)'));
});
check('F15 field patches use latest in App',()=>{
 assert.ok(app.includes('item.id === id ? { ...item, ...safeFields } : item'));
 assert.ok(floor.includes('onPatchDefect(defect.id'));
});
check('F1/F2 floor cleanup + pointer cancellation do not commit',()=>{
 assert.ok(floor.includes('draftFloorRef.current === selectedFloorId'));
 const cancel=floor.split('const handleCancelledDrawPointer = ')[1].split('// Finish Polygon')[0];
 assert.ok(cancel.includes('draggingRoomsPreviewRef.current = null'));
 assert.ok(!cancel.includes('onSaveRoomProgress('));
});
console.log(`P21.85 local audit safety golden PASS ${checks}/${checks}`);
