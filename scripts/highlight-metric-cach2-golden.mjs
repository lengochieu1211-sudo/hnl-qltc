import assert from 'node:assert/strict';
import {
  floorMetricSourceKey, createFloorMetricCalibration, getValidFloorMetricCalibration,
  measureHighlightAreaM2, measureHighlightLengthM, measureWallAreaM2,
} from '../src/utils/highlightMetricGeometry.ts';
const original = { id:'floor-dev-test', imageRevision:12, imageAssetId:'binary-1', imageUrl:'https://dev.invalid/image.png', uploadedAt:'2026-11-21' };
const size = {width:1000,height:500};
const calib = createFloorMetricCalibration(original,size,{x:0,y:0},{x:10,y:0},10,1000);
assert.ok(calib); assert.equal(calib.metresPerPixel,0.1,'100 pixels represent 10m');
const floor = {...original,highlightMetricCalibration:calib};
assert.equal(getValidFloorMetricCalibration(floor,size).valid,true);
assert.equal(getValidFloorMetricCalibration({...floor,imageRevision:13},size).valid,false,'image change invalidates');
assert.equal(getValidFloorMetricCalibration({...floor,imageUrl:'new'},size).valid,true,'cloud URL refresh for same binary is safe');
assert.equal(getValidFloorMetricCalibration(floor,{width:500,height:500}).valid,false);
assert.equal(createFloorMetricCalibration(original,size,{x:0,y:0},{x:0,y:0},10),null);
assert.equal(createFloorMetricCalibration(original,size,{x:0,y:0},{x:10,y:0},0),null);
assert.notEqual(floorMetricSourceKey(floor),floorMetricSourceKey({...floor,imageAssetId:'other'}));
const rect=(x,y,width,height)=>({x,y,width,height});
const room={x:0,y:0,width:50,height:100};
const area=(shapes,clipToMain)=>measureHighlightAreaM2({floor,image:size,room,shapes,clipToMain});
assert.ok(Math.abs(area([rect(0,0,100,100)]).value-2500)<1e-8,'50m wide x 50m high = 2500m2');
assert.ok(Math.abs(area([rect(0,0,50,100)]).value-1250)<1e-8,'half-room area');
assert.ok(Math.abs(area([rect(0,0,50,100),rect(25,0,50,100)]).value-1875)<1e-8,'polygon overlap union, no double count');
assert.ok(Math.abs(area([rect(0,0,100,100)],[rect(0,0,50,100)]).value-1250)<1e-8,'main intersection');
assert.ok(Math.abs(area([rect(0,0,50,100)],[rect(0,0,100,100)]).value-1250)<1e-8,'independent same region');
assert.equal(area([]).valid,false,'no hidden whole-room auto-quantity');
const path=[{x:10,y:10},{x:30,y:10},{x:30,y:30}];
assert.ok(Math.abs(measureHighlightLengthM({floor,image:size,floorPath:path}).value-30)<1e-8,'20m + 10m');
assert.equal(measureHighlightLengthM({floor,image:size,floorPath:[{x:0,y:0},{x:0,y:0}]}).valid,false);
assert.equal(measureWallAreaM2(30,3,2,10).value,170);
assert.equal(measureWallAreaM2(30,3,2,181).valid,false);
assert.equal(measureWallAreaM2(30,3,1.5,0).valid,false);
const before=JSON.stringify(floor);area([rect(0,0,50,100)]);assert.equal(JSON.stringify(floor),before,'pure read only');
console.log('CÁCH 2 METRIC GOLDEN PASS — calibration, invalidation, exact area union, length and walls');
