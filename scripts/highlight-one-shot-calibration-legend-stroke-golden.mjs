import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const f=(x)=>readFileSync(x,'utf8');
const floor=f('src/components/FloorPlanDefectTab.tsx');
const metric=f('src/components/FloorMetricCalibration.tsx');
const direct=f('src/components/FloorHighlightDirectDraw.tsx');
// Repro: previously launched calibration => drawing mode mounted/unmounted calibration
// => two clicks (on/off) remounted calibration and replayed old launch token.
assert.match(metric,/onLaunchHandled\?\.\(launch\.token\);\s*open\(\);/,
  'Calibration launch must be acknowledged immediately, not retained across a remount');
assert.match(floor,/onLaunchHandled=\{\(token\) => setMetricCalibrationLaunch\(\(launch\) => launch\?\.token === token \? null : launch\)\}/);
assert.match(floor,/if \(!active\) setMetricCalibrationLaunch\(null\)/);
assert.equal((floor.match(/setMetricCalibrationLaunch\(null\); \/\/ Changing drawing tools must not replay a stale calibration launch/g)||[]).length,6,
  'All 3 ordinary and 3 fullscreen drawing tools must clear stale calibration launch');
assert.equal((floor.match(/onClick=\{\(\) => activeFloor && setMetricCalibrationLaunch/g)||[]).length,2,
  'Only the two explicit calibration toolbar buttons can start a new launch');
let pending=null;
const launch=()=>pending={floorId:'f',token:123};
const acknowledge=token=>{if(pending?.token===token)pending=null;};
launch();acknowledge(123);
assert.equal(pending,null,'One-shot token consumed by calibration');
assert.equal(pending,null,'Switching a drawing tool, then clicking it again, must not re-open calibration');
assert.match(floor,/const \[showHighlightColorLegend, setShowHighlightColorLegend\] = useState\(false\)/);
assert.match(floor,/data-hnl-highlight-color-legend-trigger="true"/);
assert.match(floor,/onClick=\{\(\) => \{ setShowLayerPanel\(false\); setShowHighlightColorLegend/);
assert.match(floor,/onClick=\{\(\) => \{ setShowHighlightColorLegend\(false\); setShowLayerPanel/);
const start=floor.indexOf('{/* Live Draft Highlight Pending Pulsing Shape */}');
const stop=floor.indexOf('{/* Saved room strokes use screen-pixel widths:');
assert.ok(start>0&&stop>start);
const live=floor.slice(start,stop);
assert.equal((live.match(/strokeDasharray="3 2"/g)||[]).length,6,
 'Draft rectangle, freehand, polygon and preview share thin dashed strokes');
assert.equal((live.match(/strokeWidth=\{1\.5 \* savedRoomStrokeScale\}/g)||[]).length,6);
assert.equal((live.match(/vectorEffect="non-scaling-stroke"/g)||[]).length,6);
assert.match(direct,/strokeWidth="1\.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke"/);
assert.match(direct,/visibleShapes\.map/);
console.log('HIGHLIGHT ONE-SHOT CALIBRATION, COMPACT LEGEND & THIN DASH GOLDEN PASS');
