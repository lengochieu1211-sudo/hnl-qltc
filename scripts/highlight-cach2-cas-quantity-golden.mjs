import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canApplyDirectHighlightQuantity, canApplyDirectHighlightShapes,
  withDirectHighlightQuantity, withDirectHighlightShapes, verifyDirectHighlightMeasurement, measureDirectHighlightArea, getDirectHighlightEffectiveUnit,
} from '../src/utils/floorHighlightDirectShapes.ts';

const rect = { x: 0, y: 0, width: 80, height: 50 };
const stage = { id: 'stageA', name: 'Thi công tấm', category: 'Trần chìm',
  status: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', workVolume: 9, volumeUnit: 'm²',
  highlightVolumeMode: 'manual', highlightShapes: [rect] };
const room = {
  id:'roomA',floorId:'floorA',roomName:'Căn 1',workCategory:'Trần chìm',
  updatedAt:1000,revision:7, x:0,y:0,width:50,height:50,
  categoryVolumeUnits:{'Trần chìm':'m²'}, categoryVolumes:{'Trần chìm':10},
  categoryHighlightAutoMode:{'Trần chìm':false}, categoryHighlightTotalVolumes:{'Trần chìm':88},
  categoryHighlightTotalShapes:{'Trần chìm':[rect]}, categoryHighlightRegions:{'Trần chìm':rect},
  subItems:[stage,{id:'stageB',name:'Nghiệm thu',category:'Trần chìm',status:'Đã hoàn thành',workVolume:3}],
  workVolume:10, inspectionStatus:'Chưa nghiệm thu',
};
const snap = structuredClone(room);
const base = {roomId:room.id,expectedUpdatedAt:room.updatedAt,expectedRevision:room.revision,
  category:'Trần chìm',floorId:'floorA',expectedFloorSourceKey:'floorA:1234:abcd',expectedCalibrationUpdatedAt:444};
const main = {...base,target:'main',measuredQuantity:{value:12.75,unit:'m²'}};
const sub = {...base,target:'stageA',measuredQuantity:{value:6.125,unit:'m²'}};
assert.equal(canApplyDirectHighlightQuantity(room, main),true,'Admin-eligible main');
assert.equal(canApplyDirectHighlightQuantity(room, sub),true,'subItem eligible');
assert.equal(canApplyDirectHighlightQuantity(room, {...main,expectedRevision:6}),false,'CAS rejects stale device B revision');
assert.equal(canApplyDirectHighlightQuantity(room, {...main,expectedUpdatedAt:1001}),false,'CAS rejects stale timestamp');
assert.equal(canApplyDirectHighlightQuantity({...room,revision:8},main),false,'CAS rejects server-changed room A');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,target:'total'}),false,'legacy Cách 1 not writable');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,target:'stageB'}),false,'completed stage blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,measuredQuantity:{value:3,unit:'m'}}),false,'units never convert implicitly');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,measuredQuantity:{value:Infinity,unit:'m²'}}),false,'invalid value blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,measuredQuantity:{value:0,unit:'m²'}}),false,'zero blocked');
assert.equal(canApplyDirectHighlightQuantity({...room,positionLocked:true},main),false,'locked room blocked');
assert.equal(canApplyDirectHighlightQuantity({...room,inspectionStatus:'Đạt nghiệm thu'},main),false,'accepted room blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,floorId:'floorB'}),false,'wrong floor blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,expectedFloorSourceKey:''}),false,'missing calibration blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,shapes:[{...rect,width:0}]}),false,'invalid drawn region blocked');
assert.equal(canApplyDirectHighlightQuantity(room,{...main,shapes:[rect]}),true,'area and valid draft commit atomically');
const changedMain = withDirectHighlightQuantity(room,main);
assert.equal(changedMain.categoryVolumes['Trần chìm'],12.75);
assert.equal(changedMain.workVolume,12.75,'primary-category field used by form kept consistent');
assert.equal(changedMain.categoryHighlightAutoMode['Trần chìm'],false,'manual target retains explicit manual mode');
assert.deepEqual(changedMain.categoryHighlightTotalVolumes,room.categoryHighlightTotalVolumes,'legacy total untouched');
assert.deepEqual(changedMain.categoryHighlightTotalShapes,room.categoryHighlightTotalShapes,'legacy shapes retained');
assert.deepEqual(changedMain.subItems,room.subItems,'sibling stages untouched');
const changedSub = withDirectHighlightQuantity(room,sub);
assert.equal(changedSub.subItems[0].workVolume,6.125);
assert.equal(changedSub.subItems[0].highlightVolumeMode,'manual','manual stage remains manual');
assert.strictEqual(changedSub.subItems[1],room.subItems[1],'sibling remains same reference');
assert.equal(changedSub.categoryVolumes['Trần chìm'],10,'main unchanged when stage committed');
assert.deepEqual(room,snap,'pure functions do not mutate input/history');
// Legacy auto/shared region source is a meaningful ongoing policy: never
// auto-disable it or accept an incompatible quantity that the form will later overwrite.
const legacyAuto = {...room,
  categoryHighlightAutoMode: {'Trần chìm': true},
  categoryHighlightTotalVolumes: {'Trần chìm': 100},
  subItems: [{...stage, highlightVolumeMode: 'area'}, room.subItems[1]],
};
const derivedMain = {...main,measuredQuantity:{value:100,unit:'m²'}};
const derivedSub = {...sub,measuredQuantity:{value:100,unit:'m²'}};
assert.equal(canApplyDirectHighlightQuantity(legacyAuto,derivedMain),true,'matching shared total may be confirmed');
assert.equal(canApplyDirectHighlightQuantity(legacyAuto,derivedSub),true,'matching stage auto source may be confirmed');
assert.equal(canApplyDirectHighlightQuantity(legacyAuto,main),false,'inconsistent main measure must not erase auto linkage');
assert.equal(canApplyDirectHighlightQuantity(legacyAuto,sub),false,'inconsistent stage measure must not erase auto linkage');
assert.equal(withDirectHighlightQuantity(legacyAuto,derivedMain).categoryHighlightAutoMode['Trần chìm'],true,'main auto mode kept');
assert.equal(withDirectHighlightQuantity(legacyAuto,derivedSub).subItems[0].highlightVolumeMode,'area','sub auto mode kept');
assert.deepEqual(legacyAuto.categoryHighlightTotalVolumes,{'Trần chìm':100},'shared source total never rewritten implicitly');
assert.deepEqual(legacyAuto.categoryHighlightTotalShapes,room.categoryHighlightTotalShapes,'legacy shapes retained');
assert.equal(canApplyDirectHighlightQuantity({...legacyAuto,categoryHighlightTotalVolumes:{}},derivedMain),false,'missing source blocks ambiguous auto update');

const drawRequest={roomId:room.id,expectedUpdatedAt:room.updatedAt,expectedRevision:room.revision,
  category:'Trần chìm',target:'stageA',shapes:[rect]};
assert.equal(canApplyDirectHighlightShapes(room,drawRequest),true);
const changedShapes=withDirectHighlightShapes(room,drawRequest.category,drawRequest.target,drawRequest.shapes);
assert.equal(changedShapes.subItems[0].workVolume,9,'geometry-only does not change quantities');
assert.equal(changedShapes.categoryVolumes['Trần chìm'],10);
const ui=readFileSync('src/components/FloorHighlightDirectDraw.tsx','utf8');
const app=readFileSync('src/App.tsx','utf8');
const backend=readFileSync('src/lib/firebaseBase.ts','utf8');
const tab=readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
const modal=readFileSync('src/components/RoomHighlightModal.tsx','utf8');
for(const expected of ["data-hnl-cach2-confirm-area-quantity", "data-hnl-cach2-confirm-line-quantity", "window.confirm(`XÁC NHẬN", "await onSaveShapes(request)", "await onSaveShapes({", "if (saving)", "Bản nháp vẫn còn"]){
  assert.ok(ui.includes(expected),`UI confirmation ${expected}`);
}
for(const expected of ["runTransaction(db, async", "await transaction.get(roomRef)", "await transaction.get(floorRef)", "transaction.update(roomRef", "canApplyDirectHighlightQuantity(current, request)", "floorMetricSourceKey(latestFloor)", "fetchProjectUserRoleFromCloud(projectId, user)"]){
  assert.ok(backend.includes(expected),`server CAS ${expected}`);
}
assert.ok(app.includes('await commitDirectHighlightCas(projectId, request)'), 'on-save waits for Firestore ack');
assert.ok(backend.includes('canApplyDirectHighlightQuantity(current, request)'), 'server transaction repeats shared auto source guard');
assert.ok(app.includes('Number(localDirtyRevisionRef.current.roomProgressList || 0) > 0'), 'queued general autosave must settle');
assert.ok(!ui.includes('setCategoryVolumes('),'drawing never silently modifies state');
assert.ok(tab.includes('setSelectedRoomForEdit(null)'), 'form draft not reused when returning from map');
assert.ok(modal.includes('legacyHighlightEditorVisible = false'),'legacy UI hidden but data retained');
assert.equal(Object.keys(room.categoryHighlightTotalShapes).length,1,'historic main shape retained');
console.log('CACH2_CAS_QUANTITY_GOLDEN PASS: 30+ cases — stale two-account model, unit/acceptance/lock, form/map, legacy-preservation and server transaction source guard');

const {createFloorMetricCalibration,floorMetricSourceKey}=await import('../src/utils/highlightMetricGeometry.ts');
const f={id:'floorA',imageUrl:'fixture.png',floorName:'Tầng 1',uploadedAt:'2026-11-26'};
const size={width:1000,height:1000};
const calibration=createFloorMetricCalibration(f,size,{x:0,y:0},{x:10,y:0},1,444);
const floor={...f,highlightMetricCalibration:calibration};
const full={x:0,y:0,width:100,height:100};
const half={x:0,y:0,width:50,height:100};
const measuredRoom={...room,width:40,height:20,categoryHighlightShapes:{'Trần chìm':[full]}};
const evidence={...base,expectedFloorSourceKey:floorMetricSourceKey(f),target:'main',measurement:{kind:'area'},measuredQuantity:{value:8,unit:'m²'}};
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,floor,evidence),true);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,floor,{...evidence,measuredQuantity:{value:9999,unit:'m²'}}),false);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,floor,{...evidence,measurement:undefined}),false);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,{...floor,imageOfflineStale:true},evidence),false);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,{...floor,deletedAt:1},evidence),false);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,{...floor,highlightMetricCalibration:{...calibration,metresPerPixel:999}},evidence),false);
const childRoom={...measuredRoom,categoryHighlightShapes:{'Trần chìm':[half]},subItems:[{...stage,highlightShapes:[full]}]};
const child={...evidence,target:'stageA',measuredQuantity:{value:4,unit:'m²'}};
assert.equal(measureDirectHighlightArea(floor,size,childRoom,'Trần chìm','stageA',[full]).value,4);
assert.equal(verifyDirectHighlightMeasurement(childRoom,floor,child),true);
assert.equal(verifyDirectHighlightMeasurement(childRoom,floor,{...child,measuredQuantity:{value:8,unit:'m²'}}),false);
const {getCalibratedHighlightRows}=await import('../src/utils/highlightMetricCategorySummary.ts');
assert.equal(getCalibratedHighlightRows(childRoom,floor,size).find(x=>x.target==='stageA').areaM2,4);
const lengthRoom={...measuredRoom,categoryVolumeUnits:{'Trần chìm':'md'}};
const line={...evidence,measurement:{kind:'length',path:[{x:0,y:0},{x:10,y:0}]},measuredQuantity:{value:1,unit:'m'}};
assert.equal(verifyDirectHighlightMeasurement(lengthRoom,floor,line),true);
assert.equal(verifyDirectHighlightMeasurement(lengthRoom,floor,{...line,measuredQuantity:{value:2,unit:'m'}}),false);
const wall={...evidence,measurement:{kind:'wall',path:line.measurement.path,height:3,faces:2,openingsM2:1},measuredQuantity:{value:5,unit:'m²'}};
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,floor,wall),true);
assert.equal(verifyDirectHighlightMeasurement(measuredRoom,floor,{...wall,measurement:{...wall.measurement,openingsM2:7}}),false);
assert.equal(canApplyDirectHighlightQuantity({...room,quantityFormulaSettings:{'main:id:cat1':{auto:true,expression:'S',value:10,unit:'m²',categoryKey:'id:cat1'}}},main),false);
assert.equal(canApplyDirectHighlightQuantity({...room,quantityFormulaSettings:{'sub:stageA':{auto:true,expression:'KL*2',value:9,unit:'m²',categoryKey:'id:cat1'}}},main),false);
assert.equal(canApplyDirectHighlightQuantity({...room,quantityFormulaSettings:{'sub:stageA':{auto:false,expression:'3*3',value:9,unit:'m²',categoryKey:'id:cat1'}}},sub),false);
assert.equal(canApplyDirectHighlightQuantity({...room,workCategoryId:'cat1',subItems:[{...stage,workCategoryId:'other'}]},sub),false);
const idRoom={...room,workCategoryId:'cat1',categoryVolumes:{cat1:10},categoryVolumeUnits:{cat1:'m²'}};
assert.equal(withDirectHighlightQuantity(idRoom,{...main,category:'cat1'}).workVolume,12.75);
assert.equal(getDirectHighlightEffectiveUnit({...room,categoryVolumeUnits:{},volumeUnit:undefined},'Trần chìm','main'),'');
assert.ok(backend.includes('verifyDirectHighlightMeasurement(current,latestFloor,quantityRequest)'));
console.log('PR516 MEASUREMENT EVIDENCE GOLDEN PASS');
