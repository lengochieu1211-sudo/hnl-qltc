import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isCountStage,totalCountPoints,validCountPoints,canSaveHighlightCount,applyHighlightCount,MAX_COUNT_MARKERS} from '../src/utils/highlightCountPoints.ts';
const stage={id:'stage-cai',name:'Cửa thăm trần',category:'Trần',status:'Đang làm',inspectionStatus:'Chưa nghiệm thu',volumeUnit:'cai',workVolume:5,highlightCountMode:'manual',highlightVolumeMode:'manual'};
const room={id:'roomA',floorId:'floorA',roomName:'A101',x:10,y:20,width:50,height:40,frameStatus:'Đang làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',updatedAt:10,revision:2,workCategory:'Trần',volumeUnit:'m²',subItems:[stage,{id:'stage-other',name:'Khung',category:'Trần',status:'Đang làm',volumeUnit:'m²',workVolume:45}]};
const m=[{id:'one',x:20,y:20,count:1},{id:'two',x:60,y:60,count:1},{id:'three',x:80,y:30,count:2}];
assert.equal(isCountStage(stage,room),true);
assert.equal(isCountStage(room.subItems[1],room),false);
assert.equal(totalCountPoints(m),4);
assert.equal(validCountPoints(room,m),true);
for(const invalid of [ [{...m[0],x:101}], [{...m[0],x:NaN}], [{...m[0],count:0}], [{...m[0],count:1.5}], [{...m[0]}, {...m[0]}], Array.from({length:MAX_COUNT_MARKERS+1},(_,i)=>({id:`point-${i}`,x:10,y:10})), [{id:'only',x:-1,y:20}] ]) {
 assert.equal(validCountPoints(room,invalid),false,'reject invalid marker');
}
const polygon={...room,points:[{x:10,y:20},{x:60,y:20},{x:10,y:60}]};
assert.equal(validCountPoints(polygon,[{id:'point1',x:85,y:90}]),false,'polygon edge excludes empty bounding-box corner');
const base={roomId:'roomA',stageId:'stage-cai',expectedUpdatedAt:10,expectedRevision:2,points:m,mode:'manual',regionMode:'main',manualVolume:5};
assert.equal(canSaveHighlightCount(room,base),true);
assert.equal(canSaveHighlightCount(room,{...base,mode:'points'}),true);
assert.equal(canSaveHighlightCount(room,{...base,expectedRevision:1}),false);
assert.equal(canSaveHighlightCount(room,{...base,roomId:'wrong'}),false);
assert.equal(canSaveHighlightCount(room,{...base,stageId:'stage-other'}),false);
assert.equal(canSaveHighlightCount(room,{...base,mode:'manual',manualVolume:2.5}),false);
for(const variant of [{positionLocked:true},{inspectionStatus:'Đạt nghiệm thu'},{deletedAt:123},{subItemProgressMigrated:true},{isPolyline:true},{subItems:[{...stage,status:'Đã hoàn thành'}]},{subItems:[{...stage,inspectionStatus:'Đạt nghiệm thu'}]}]){
 assert.equal(canSaveHighlightCount({...room,...variant},base),false,'finalized/migrated/locked room cannot change markers');
}
const initial=structuredClone(room);
const manual=applyHighlightCount(room,base);
assert.equal(manual.subItems[0].workVolume,5,'manual workVolume must survive save');
assert.equal(manual.subItems[0].highlightCountMode,'manual');
assert.equal(manual.subItems[1],room.subItems[1],'other stage untouched');
assert.equal(manual.categoryVolumes,room.categoryVolumes);
assert.equal(manual.updatedAt,10,'helper does not stamp its own version');
const pointApplied=applyHighlightCount(room,{...base,mode:'points'});
assert.equal(pointApplied.subItems[0].workVolume,4);
assert.equal(pointApplied.subItems[0].volumeUnit,'Cái');
assert.equal(pointApplied.subItems[0].highlightVolumeMode,'manual','legacy area mode cannot silently override count');
assert.deepEqual(room,initial,'original room never mutated');
const source={
 types:readFileSync('src/types.ts','utf8'),
 editor:readFileSync('src/components/FloorHighlightCountPoints.tsx','utf8'),
 form:readFileSync('src/components/RoomHighlightModal.tsx','utf8'),
 floor:readFileSync('src/components/FloorPlanDefectTab.tsx','utf8'),
 app:readFileSync('src/App.tsx','utf8'),
};
for(const field of ['highlightCountPoints?:','highlightCountMode?:','highlightCountRegionMode?:'])assert.ok(source.types.includes(field),field);
for(const feature of ['data-hnl-count-point-canvas','data-hnl-count-editor','Tự đếm theo điểm','Nhập tay','onPointerDown','onPointerMove','onSave(request)','setMarkerCount','onReturnToRoom'])assert.ok(source.editor.includes(feature),feature);
for(const feature of ['data-hnl-sub-count-unit','Lưu biểu mẫu & Đánh dấu trên mặt bằng','countStageAfterSaveRef','onStartCountOnMap'])assert.ok(source.form.includes(feature),feature);
for(const feature of ['data-hnl-count-saved-marker','mapLayers.countPoints','onSaveHighlightCount','onStartCountOnMap','pointerEvents="none"'])assert.ok(source.floor.includes(feature),feature);
for(const feature of ['canSaveHighlightCount(existing, request)','applyHighlightCount(existing, request)','onSaveHighlightCount={handleSaveHighlightCount}'])assert.ok(source.app.includes(feature),feature);
console.log('HIGHLIGHT_COUNT_POINTS_GOLDEN PASS: stage unit isolation; 4-point sums; optional legacy data; manual/auto; polygon safety; RBAC/lock/finalized; no mutations; UI wiring');
