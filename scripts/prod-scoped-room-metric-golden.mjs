import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  floorMetricSourceKey,createFloorMetricCalibration,getValidFloorMetricCalibration,
  measureRoomHighlightAreaM2,measureRoomHighlightLengthM,
} from '../src/utils/floorMetricGeometry.ts';

const source = {id:'floor-test',floorName:'Tầng 1',imageUrl:'https://example.invalid/immutable.png',imageAssetId:'asset-1',imageRevision:42,uploadedAt:'2026-11-23'};
const image={width:1000,height:500};
const c=createFloorMetricCalibration(source,image,{x:0,y:0},{x:10,y:0},10,1234);
assert.ok(c);assert.equal(c.metresPerPixel,0.1);
const floor={...source,highlightMetricCalibration:c};
assert.equal(floorMetricSourceKey(source),c.sourceKey);
assert.deepEqual(getValidFloorMetricCalibration(floor,image),{valid:true,value:c});
for(const changed of [{...floor,imageAssetId:'replaced'},{...floor,imageRevision:43},{...floor,id:'other'}]) {
  assert.equal(getValidFloorMetricCalibration(changed,image).valid,false,'source change must fail closed');
}
assert.equal(getValidFloorMetricCalibration(floor,{width:500,height:500}).valid,false,'image dimension changes fail closed');
assert.equal(getValidFloorMetricCalibration({...floor,highlightMetricCalibration:{...c,metresPerPixel:9}},image).valid,false,'tamper check');
assert.equal(createFloorMetricCalibration(source,image,{x:0,y:0},{x:0,y:0},100),null);
assert.equal(createFloorMetricCalibration(source,image,{x:0,y:0},{x:10,y:0},0),null);
assert.equal(createFloorMetricCalibration(source,image,{x:0,y:0},{x:10,y:0},NaN),null);
assert.equal(measureRoomHighlightAreaM2(source,{x:0,y:0,width:50,height:100},image).valid,false,'legacy room without calibration not auto-mapped');
const room={x:0,y:0,width:50,height:100};
const area=measureRoomHighlightAreaM2(floor,room,image),len=measureRoomHighlightLengthM(floor,room,image);
assert.equal(area.valid,true);assert.equal(len.valid,true);
assert.ok(Math.abs(area.value-2500)<1e-8,'50m x 50m = 2500m2');
assert.ok(Math.abs(len.value-200)<1e-8,'room closed perimeter 200m, NOT an open wall length');
assert.equal(len.label,'Chu vi vùng kín');
const tri={x:10,y:10,width:40,height:40,points:[{x:10,y:10},{x:50,y:10},{x:10,y:50}],isPolyline:false};
assert.ok(Math.abs(measureRoomHighlightAreaM2(floor,tri,image).value-400)<1e-8,'40m * 20m /2');
const path={x:10,y:10,width:0,height:40,points:[{x:10,y:10},{x:10,y:50}],isPolyline:true};
assert.equal(measureRoomHighlightAreaM2(floor,path,image).valid,false,'open paths must not have area');
assert.ok(Math.abs(measureRoomHighlightLengthM(floor,path,image).value-20)<1e-8,'vertical wall line with zero width works');
assert.equal(measureRoomHighlightLengthM(floor,path,image).label,'Chiều dài tuyến hở');
const overlapping={x:0,y:0,width:100,height:100,points:[{x:10,y:10},{x:80,y:80},{x:80,y:10},{x:10,y:80}]};
assert.equal(measureRoomHighlightAreaM2(floor,overlapping,image).valid,false,'reject self-intersecting shape');
// PR492 follow-up: preserve the last segment of explicitly drawn returning paths,
// and reject collapsed polygons and legacy lines lacking a vertex list.
const returningPath={x:10,y:20,width:10,height:0,isPolyline:true,points:[{x:10,y:20},{x:20,y:20},{x:10,y:20}]};
assert.ok(Math.abs(measureRoomHighlightLengthM(floor,returningPath,image).value-20)<1e-8,'returning path must count both segments');
const collapsedPolygon={x:0,y:0,width:20,height:20,points:[{x:0,y:0},{x:10,y:10},{x:20,y:20}]};
assert.equal(measureRoomHighlightAreaM2(floor,collapsedPolygon,image).valid,false,'collapsed polygon has no area');
assert.equal(measureRoomHighlightLengthM(floor,collapsedPolygon,image).valid,false,'collapsed polygon must not give perimeter');
const legacyPath={x:10,y:20,width:10,height:20,isPolyline:true};
assert.equal(measureRoomHighlightLengthM(floor,legacyPath,image).valid,false,'legacy line with no vertices must not infer length');
const before=JSON.stringify(floor),beforeRoom=JSON.stringify(room);
measureRoomHighlightAreaM2(floor,room,image);measureRoomHighlightLengthM(floor,room,image);
assert.equal(JSON.stringify(floor),before);assert.equal(JSON.stringify(room),beforeRoom,'pure read only');

const modal=readFileSync('src/components/RoomHighlightModal.tsx','utf8');
const plan=readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
const ui=readFileSync('src/components/FloorMetricCalibrator.tsx','utf8');
const app=readFileSync('src/App.tsx','utf8');
const rules=readFileSync('firestore.rules','utf8');
assert.match(modal,/data-hnl-prod-take-metric-volume="true"/);
assert.match(modal,/if\(structureReadOnly \|\| roomItem\?\.positionLocked/);
assert.match(modal,/resolved.warning \|\| !areSameUnit\(resolved.unit,unit\)/);
assert.match(modal,/const isWallArea = unit==='m²'/);
assert.match(modal,/roomDraftDirtyRef\.current=true/);
assert.ok(modal.includes('setMetricDraftStamp(currentMetricDraftStamp)'));
assert.ok(modal.includes('metricDraftStamp !== null && metricDraftStamp !== currentMetricDraftStamp'));
assert.ok(modal.includes('if (metricDraftStale) { alert(metricDraftStaleMessage); return; }'));
assert.ok(modal.includes('if (metricDraftStamp !== null) {'));
assert.ok(modal.includes('disabled={!roomItem?.id || isAutoIssuing || metricDraftStamp !== null}'));
assert.ok(modal.includes('data-hnl-prod-metric-stale-draft="true"'));
assert.match(modal,/const hasLegacyMetricVolumeKey =/);
assert.match(modal,/Object\.prototype\.hasOwnProperty\.call\(categoryVolumes, id\)/);
assert.match(modal,/hasLegacyMetricVolumeKey\(catName\) \|\| resolved\.warning/);
assert.match(modal,/const enabled = !legacyIdKeyed/);
assert.match(modal,/isPolyline\?'Lấy chiều dài':'Lấy chu vi'/);
assert.match(modal,/setCategoryVolumes\(prev=>\(\{\.\.\.prev,\[catName\]:rounded\}\)\)/);
assert.match(plan,/data-hnl-prod-metric-toolbar="true"/);
assert.match(plan,/data-hnl-prod-metric-fullscreen="true"/);
assert.match(plan,/canSave=\{canManageStructure && Boolean\(onUpdateFloorPlan\)\}/);
assert.match(ui,/onSave\(floor.id,draft\)/);
// Source replacement must remount the calibration session before new points can be saved.
assert.ok(plan.includes('key={JSON.stringify([floorMetricSourceKey(activeFloor), activeFloor.imageUrl])}'));
assert.ok(ui.includes("image.getAttribute('src') === floor.imageUrl"));
assert.ok(ui.includes('if(!canSave || !draft || !imageStillReady())'));
assert.ok(ui.includes('if(event.button>0 || !imageStillReady())return;'));
assert.ok(ui.includes("image.addEventListener('error',clear)"));
assert.notEqual(floorMetricSourceKey({...source,imageRevision:43}),floorMetricSourceKey(source));
assert.notEqual(floorMetricSourceKey({...source,imageAssetId:'other'}),floorMetricSourceKey(source));
assert.match(app,/c\.sourceKey!==floorMetricSourceKey\(fp\)/);
assert.ok(!rules.includes('highlightMetricCalibration'),'No firestore rules edits needed');
console.log('PASS: PROD metric scope, image invalidation, area/perimeter/polyline, read-only draft, UI/RBAC guards');
