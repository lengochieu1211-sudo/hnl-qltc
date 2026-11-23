import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFloorMetricCalibration} from '../src/utils/highlightMetricGeometry.ts';
import {getCalibratedHighlightRows} from '../src/utils/highlightMetricCategorySummary.ts';

const floorTool = readFileSync('src/components/FloorPlanDefectTab.tsx','utf8');
const drawUI = readFileSync('src/components/FloorHighlightDirectDraw.tsx','utf8');
const count = (text, expr) => [...text.matchAll(expr)].length;
// Exact same order and operation in ordinary and fullscreen toolbars;
// direct Cách 2 must not swap freehand and rectangle any longer.
assert.equal(count(floorTool,/if \(isShapeDrawing\) \{ selectCach2ToolbarTool\('freehand'\); return; \}/g),2);
assert.equal(count(floorTool,/if \(isShapeDrawing\) \{ selectCach2ToolbarTool\('polygon'\); return; \}/g),2);
assert.equal(count(floorTool,/if \(isShapeDrawing\) \{ selectCach2ToolbarTool\('2point'\); return; \}/g),2);
assert.equal(count(floorTool,/aria-pressed=\{isShapeDrawing \? cach2DrawTool === 'freehand' : drawTool === 'freehand'\}/g),2);
assert.equal(count(floorTool,/aria-pressed=\{isShapeDrawing \? cach2DrawTool === 'polygon' : drawTool === 'polygon'\}/g),2);
assert.equal(count(floorTool,/aria-pressed=\{isShapeDrawing \? cach2DrawTool === '2point' : drawTool === '2point'\}/g),2);
for(const label of ['Vẽ tự do','Vẽ đa giác','Vẽ chữ nhật']) {
  assert.equal(count(floorTool,new RegExp(`<span>${label}</span>`,'g')),2,`${label} must be stable on both toolbars`);
}
assert.doesNotMatch(floorTool,/<span>\{isShapeDrawing \? '(?:2 điểm|Đa giác|Tự do)'/,
  'Cách 2 must not silently relabel another drawing mode');
assert.match(drawUI,/data-hnl-calibrated-main-sub-quantities="true"/);
assert.match(drawUI,/tool === '2point' \? 'Vẽ chữ nhật' : tool === 'polygon' \? 'Vẽ đa giác' : 'Vẽ tự do'/, 'Cách 2 info line uses same labels as toolbar');
assert.match(drawUI,/getCalibratedHighlightRows\(room, floor, imageDimensions, workVolumes\)/);
assert.match(drawUI,/onClick=\{\(\) => void confirmMeasuredQuantity\('area'\)\}/,
  'Authoritative quantity still requires explicit server-confirmed save');
assert.match(drawUI,/await onSaveShapes\(request\)/);

const floor={id:'f',imageUrl:'https://example.invalid/current-floor.png',uploadedAt:'2026-11-23',floorName:'Test'};
const image={width:1000,height:1000};
const calibration=createFloorMetricCalibration(floor,image,{x:0,y:0},{x:50,y:0},50,123456);
assert.ok(calibration);
const source={...floor,highlightMetricCalibration:calibration};
const mainShape={x:0,y:0,width:50,height:100};
const childShape={x:0,y:0,width:25,height:100};
const room={id:'r',floorId:'f',roomName:'Căn thử',x:10,y:10,width:10,height:10,
  workCategory:'Trần nổi',volumeUnit:'m²',workVolume:88,
  categoryVolumes:{'Trần nổi':88},categoryVolumeUnits:{'Trần nổi':'m²'},
  categoryHighlightShapes:{'Trần nổi':[mainShape]},categoryHighlightAutoMode:{'Trần nổi':false},
  subItems:[
    {id:'stage1',name:'Thi công khung',category:'Trần nổi',volumeUnit:'m²',workVolume:40,highlightVolumeMode:'area',highlightShapes:[childShape],status:'Đang thi công'},
    {id:'stage2',name:'Thi công tấm',category:'Trần nổi',volumeUnit:'m²',workVolume:50,highlightVolumeMode:'manual',status:'Đang thi công'},
    {id:'stage3',name:'Số bộ',category:'Trần nổi',volumeUnit:'cái',workVolume:12,highlightVolumeMode:'manual',status:'Đang thi công'},
  ]};
const snap=JSON.stringify(room);
const rows=getCalibratedHighlightRows(room,source,image);
assert.equal(rows.length,4);
const get=(t)=>rows.find(r=>r.target===t);
assert.equal(get('main').areaM2,50);assert.equal(get('main').source,'own');
assert.equal(get('main').savedQuantity,88,'manual quantity must NOT be overwritten by measured area');
assert.equal(get('stage1').areaM2,25);assert.equal(get('stage1').source,'own');
assert.equal(get('stage1').autoPolicy,true);
assert.equal(get('stage2').areaM2,50);assert.equal(get('stage2').source,'main');
assert.equal(get('stage2').savedQuantity,50);
assert.equal(get('stage3').areaM2,50);assert.match(get('stage3').warning,/không tự quy đổi/);
assert.equal(JSON.stringify(room),snap,'pure preview may not alter persisted room data');
const fallback=getCalibratedHighlightRows({...room,categoryHighlightShapes:{}},source,image);
assert.equal(fallback.find(r=>r.target==='main').source,'room');
assert.equal(fallback.find(r=>r.target==='main').areaM2,100,'full room bounds are a read-only fallback');
const invalid=getCalibratedHighlightRows(room,{...source,imageRevision:123},image);
assert.deepEqual(invalid,[],'never show a calibrated area using a changed floor image');
console.log('HIGHLIGHT_TOOLBAR_METRIC_SUMMARY_GOLDEN PASS: stable tool mapping both modes, actual m² per main/stage, inherited areas, unit guards, no data writes');
