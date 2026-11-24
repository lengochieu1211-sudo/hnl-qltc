import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADVANCED_HIGHLIGHT_ENABLED, getBasicRoomMetricUnit, measureBasicRoomHighlight } from '../src/utils/roomHighlightBasicMetric.ts';
import { createFloorMetricCalibration } from '../src/utils/highlightMetricGeometry.ts';
const image={width:1000,height:500};
const floor={id:'f1',imageUrl:'https://example.invalid/floor.png',imageRevision:1};
floor.highlightMetricCalibration=createFloorMetricCalibration(floor,image,{x:0,y:0},{x:50,y:0},10,123);
const room={id:'r1',floorId:'f1',x:0,y:0,width:50,height:50,inspectionStatus:'Chưa nghiệm thu',categoryVolumes:{Ceiling:13},categoryHighlightShapes:{Ceiling:[{x:0,y:0,width:10,height:10}]},categoryHighlightAutoMode:{Ceiling:true},subItems:[{id:'s1',workVolume:3,highlightVolumeMode:'area'}]};
const calc=(unit, r=room, f=floor, i=image)=>measureBasicRoomHighlight({floor:f,image:i,room:r,unit});
const approx=(r,n)=>{assert.equal(r.valid,true,JSON.stringify(r));assert.ok(Math.abs(r.value-n)<1e-8,`${r.value} != ${n}`);};
assert.equal(ADVANCED_HIGHLIGHT_ENABLED,false);
const snapshot=JSON.stringify({room,floor});
approx(calc('m²'),50);approx(calc('m2'),50);approx(calc('m'),30);
// L-shaped room 10x5 with a 4x2.5 cutout; exact polygon, not bounding box.
const l={...room,points:[{x:0,y:0},{x:50,y:0},{x:50,y:25},{x:30,y:25},{x:30,y:50},{x:0,y:50}]};
approx(calc('m²',l),40);approx(calc('m',l),30);
approx(calc('m',{...l,points:[...l.points,l.points[0]]}),30);
// Triangle: perimeter is true diagonal and not bbox.
const tri={...room,points:[{x:0,y:0},{x:50,y:0},{x:0,y:50}]};
approx(calc('m²',tri),25);approx(calc('m',tri),15+Math.sqrt(125));
for(const unit of ['', 'Cái','bộ','m³']){assert.equal(getBasicRoomMetricUnit(unit),null);assert.equal(calc(unit).valid,false);}
for(const r of [{...room,isPolyline:true},{...room,positionLocked:true},{...room,inspectionStatus:'Đạt nghiệm thu'},{...room,deletedAt:3},{...room,floorId:'other'},{...room,width:0},{...room,x:99},{...room,points:[{x:0,y:0},{x:50,y:50},{x:0,y:50},{x:50,y:0}]}]){assert.equal(calc('m²',r).valid,false);assert.equal(calc('m',r).valid,false);}
for(const f of [{...floor,highlightMetricCalibration:undefined},{...floor,imageRevision:2}]){assert.equal(calc('m²',room,f).valid,false);assert.equal(calc('m',room,f).valid,false);}
assert.equal(calc('m',room,floor,{width:1000,height:501}).valid,false);
assert.equal(JSON.stringify({room,floor}),snapshot,'read-only geometry and historical data');
const modal=fs.readFileSync('src/components/RoomHighlightModal.tsx','utf8'),tab=fs.readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
assert.match(modal, /!ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && roomItem\?\.id && onMeasureBasicRoom && getBasicMeasureUnit/);
assert.match(modal, /Tính diện tích.*Tính chu vi/);
assert.match(modal, /window\.confirm\(`Dùng/);
assert.match(modal, /basicMeasuredRef\.current\[cat\] =/);
assert.match(modal, /onMeasureBasicRoom\(roomItem, measurement\.unit\)/);
assert.match(modal, /ADVANCED_HIGHLIGHT_ENABLED && mapPickerCategory/);
assert.match(modal, /ADVANCED_HIGHLIGHT_ENABLED && normalizeUnit.*=== 'Cái'/);
assert.match(modal, /if \(!ADVANCED_HIGHLIGHT_ENABLED \|\| !categoryHighlightAutoMode\[cat\]/);
assert.match(modal, /categoryHighlightAutoMode \? \{ categoryHighlightAutoMode \}/);
assert.match(tab, /ADVANCED_HIGHLIGHT_ENABLED && canManageStructure && onSaveDirectHighlightShapes/);
assert.match(tab, /ADVANCED_HIGHLIGHT_ENABLED && canManageStructure && onSaveHighlightCount/);
assert.match(tab, /ADVANCED_HIGHLIGHT_ENABLED && mapLayers\.subItemRegions/);
assert.match(tab, /ADVANCED_HIGHLIGHT_ENABLED && mapLayers\.countPoints/);
assert.match(tab, /<FloorMetricCalibration/);
assert.match(tab, /data-hnl-cach2-calibrate-toolbar="true"/);
assert.match(tab, /liveRoom\.updatedAt !== room\.updatedAt/);
assert.match(tab, /img\.getAttribute\('src'\) !== sourceFloor\.imageUrl/);
assert.doesNotMatch(modal.slice(modal.indexOf('const calculateBasicRoomQuantity'),modal.indexOf('const getHighlightRoom')), /onSaveRoom\(|updateDoc\(|runTransaction\(/);
console.log('PASS Basic room Highlight geometry, perimeter, invalid calibration/geometry/unit, historical data, visibility gates and local draft only.');
