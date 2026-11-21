import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getSavedDirectHighlightShapes, getDirectHighlightCategoryNames,
  withDirectHighlightShapes, getDirectStageCategory, canApplyDirectHighlightShapes, mapDirectHighlightPointerToFloor, getDirectHighlightDrawPoint,
} from '../src/utils/floorHighlightDirectShapes.ts';
import { calculateHighlightTotalRatio } from '../src/utils/highlightTotalGeometry.ts';

const R=(x,y,width,height)=>({x,y,width,height});
const old=R(0,0,40,100);
const room={
  id:'room1',floorId:'floor1',roomName:'Khu 1',x:10,y:20,width:50,height:60,
  workCategory:'Ty+Sắt hộp', frameStatus:'Đang làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',
  updatedAt:1234, revision:3,
  categoryHighlightRegions:{'Ty+Sắt hộp':old}, categoryHighlightTotalVolumes:{'Ty+Sắt hộp':200},
  categoryVolumes:{'Ty+Sắt hộp':80},
  subItems:[
    {id:'sub1', name:'Đánh dấu ty',category:'Ty+Sắt hộp',status:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',highlightRegions:[R(0,0,20,100)]},
    {id:'sub2', name:'Cắt ty',category:'Ty+Sắt hộp',status:'Đã hoàn thành',inspectionStatus:'Đạt nghiệm thu'},
    {id:'sub3', name:'Bắn tấm',category:'Tấm',status:'Chưa làm'},
  ]
};
const snapshot=structuredClone(room);
assert.deepEqual(getDirectHighlightCategoryNames(room),['Ty+Sắt hộp','Tấm']);
assert.equal(getDirectStageCategory(room.subItems[2],room),'Tấm');
assert.deepEqual(getSavedDirectHighlightShapes(room,'Ty+Sắt hộp','main'),[old]);
assert.deepEqual(getSavedDirectHighlightShapes(room,'Ty+Sắt hộp','sub1'),[R(0,0,20,100)]);
assert.deepEqual(getSavedDirectHighlightShapes(room,'Tấm','sub1'),[]);
assert.deepEqual(getSavedDirectHighlightShapes(room,'Ty+Sắt hộp','total'),[]);
const total = withDirectHighlightShapes(room,'Ty+Sắt hộp','total',[R(0,0,100,100)]);
assert.deepEqual(total.categoryHighlightTotalShapes['Ty+Sắt hộp'],[R(0,0,100,100)]);
assert.deepEqual(total.subItems,room.subItems);
assert.equal(total.categoryVolumes['Ty+Sắt hộp'],80);
const main = withDirectHighlightShapes(room,'Ty+Sắt hộp','main',[old,R(50,0,20,100)]);
assert.deepEqual(main.categoryHighlightShapes['Ty+Sắt hộp'],[old,R(50,0,20,100)]);
assert.deepEqual(main.categoryHighlightRegions,room.categoryHighlightRegions);
assert.equal(main.inspectionStatus,room.inspectionStatus);
const sub=withDirectHighlightShapes(room,'Ty+Sắt hộp','sub1',[R(0,0,20,100),R(30,0,20,100)]);
assert.deepEqual(sub.subItems[0].highlightShapes,[R(0,0,20,100),R(30,0,20,100)]);
assert.strictEqual(sub.subItems[1],room.subItems[1]);
assert.strictEqual(sub.subItems[2],room.subItems[2]);
assert.deepEqual(sub.subItems[0].highlightRegions,room.subItems[0].highlightRegions);
assert.equal(sub.revision,3);
assert.equal(sub.updatedAt,1234);
assert.deepEqual(room,snapshot,'source room not mutated');
const request={roomId:'room1',expectedUpdatedAt:1234,expectedRevision:3,category:'Ty+Sắt hộp',target:'sub1',shapes:[old]};
assert.equal(canApplyDirectHighlightShapes(room,request),true);
assert.equal(canApplyDirectHighlightShapes(room,{...request,expectedUpdatedAt:2}),false);
assert.equal(canApplyDirectHighlightShapes(room,{...request,target:'sub2'}),false);
assert.equal(canApplyDirectHighlightShapes({...room,positionLocked:true},request),false);
assert.equal(canApplyDirectHighlightShapes({...room,inspectionStatus:'Đạt nghiệm thu'},request),false);
assert.equal(canApplyDirectHighlightShapes(room,{...request,category:'Sai tên'}),false);
assert.equal(canApplyDirectHighlightShapes(room,{...request,shapes:[R(0,0,0,0)]}),false);
assert.equal(canApplyDirectHighlightShapes(room,{...request,shapes:Array.from({length:25},()=>old)}),false);
assert.equal(canApplyDirectHighlightShapes(room,{...request,target:'missing'}),false);

const bounds={left:100,top:50,width:400,height:200};
assert.deepEqual(mapDirectHighlightPointerToFloor(200,100,bounds,0),{x:25,y:25});
assert.deepEqual(mapDirectHighlightPointerToFloor(200,100,bounds,90),{x:25,y:75});
assert.deepEqual(mapDirectHighlightPointerToFloor(200,100,bounds,180),{x:75,y:75});
assert.deepEqual(mapDirectHighlightPointerToFloor(200,100,bounds,270),{x:75,y:25});
// Direct highlight must reuse the normal floor map CAD/OSNAP, not invent a second engine.
const snapFlags = { room, viewport: {width:400,height:200}, rotation:0,
  pointerType:'mouse', tool:'polygon', anchor:null,
  objectSnapEnabled:true, objectSnapMidpoints:false,
  cadGridSnap:false, cadOrtho:false, cadPolar:false };
const snapVertex=getDirectHighlightDrawPoint({x:10.8,y:20.8},snapFlags);
assert.deepEqual(snapVertex,{point:{x:10,y:20},snapKind:'vertex'},'reuse saved room OSNAP vertex');
assert.deepEqual(getDirectHighlightDrawPoint({x:35.8,y:20.8},{...snapFlags,objectSnapMidpoints:true}),
  {point:{x:35,y:20},snapKind:'midpoint'},'midpoint snap must respect existing toggle');
assert.equal(getDirectHighlightDrawPoint({x:35.8,y:20.8},snapFlags).snapKind,null,'midpoint off');
assert.equal(getDirectHighlightDrawPoint({x:14,y:20},snapFlags).snapKind,null,'mouse beyond 12px tolerance');
assert.deepEqual(getDirectHighlightDrawPoint({x:14,y:20},{...snapFlags,pointerType:'touch'}),
  {point:{x:10,y:20},snapKind:'vertex'},'touch reuses 20px tolerance');

assert.deepEqual(getDirectHighlightDrawPoint({x:17,y:36},{...snapFlags,objectSnapEnabled:false,cadGridSnap:true}),
  {point:{x:20,y:40},snapKind:null},'existing CAD grid');
assert.deepEqual(getDirectHighlightDrawPoint({x:29,y:31},{...snapFlags,objectSnapEnabled:false,cadOrtho:true,anchor:{x:20,y:30}}),
  {point:{x:29,y:30},snapKind:null},'existing CAD orthogonal guide');
const freeRaw={x:10.8,y:20.8};
assert.deepEqual(getDirectHighlightDrawPoint(freeRaw,{...snapFlags,tool:'freehand',cadGridSnap:true}),
  {point:freeRaw,snapKind:null},'freehand should not distort continuous stroke');
assert.deepEqual(getDirectHighlightDrawPoint({x:10.8,y:20.8},{...snapFlags,rotation:90}).point,
  {x:10,y:20},'rotated map uses same vertex OSNAP');
const polarPoint=getDirectHighlightDrawPoint({x:31,y:49},{...snapFlags,objectSnapEnabled:false,cadPolar:true,anchor:{x:20,y:30}}).point;
assert.ok(Math.abs((polarPoint.x-20)*400-(polarPoint.y-30)*200)<0.0001,'polar guide aligns angle to existing CAD 45deg');

const ratio=calculateHighlightTotalRatio({room,total:[R(0,0,100,100)],main:[R(0,0,70,100)],sub:[R(0,0,40,100)]});
assert.equal(ratio.valid,true);
assert.equal(ratio.percent,40,'all proportions share total denominator');
const component=readFileSync('src/components/FloorHighlightDirectDraw.tsx','utf8');
const floor=readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
for(const required of ['data-hnl-direct-highlight-canvas','data-hnl-direct-highlight-toolbar',"onShowLayer(currentTarget",'baselineRef.current.revision !== room.revision','validateHighlightShape(shape)','onSaveShapes({','room.inspectionStatus === \'Đạt nghiệm thu\'']){
  assert.ok(component.includes(required),required);
}
assert.ok(floor.includes("import { FloorHighlightDirectDraw }"));
assert.ok(floor.includes('!isDefectPinPlacementMode && !relocatingDefectId'));
for (const prop of ['objectSnapEnabled','objectSnapMidpoints','cadGridSnap','cadOrtho','cadPolar']) {
  assert.ok(component.includes(`  ${prop}: boolean;`), `direct editor reads existing ${prop}`);
  assert.ok(floor.includes(`                ${prop}={${prop}}`), `map passes existing ${prop}`);
}
assert.ok(component.includes('data-hnl-direct-highlight-snap-marker'), 'visible snap target');
const app=readFileSync('src/App.tsx','utf8');
assert.ok(app.includes('canApplyDirectHighlightShapes(existing, request)'));
assert.ok(app.includes('onSaveDirectHighlightShapes={handleSaveDirectHighlightShapes}'));
assert.ok(!component.includes('setCategoryVolumes('));
console.log('FLOOR_HIGHLIGHT_DIRECT_GOLDEN PASS: 25+ read-only, geometry, persistence, UX and role guards');
