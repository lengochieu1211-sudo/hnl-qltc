import assert from 'node:assert/strict';
import fs from 'node:fs';
const component = fs.readFileSync('src/components/FloorMetricCalibration.tsx', 'utf8');
const parent = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const checks = [
  ['zoom prop', /zoomScale: number;/],
  ['inverse zoom', /const pointDisplayScale = 1 \/ Math\.max\(1, zoomScale\)/],
  ['smaller polygon-style markers', /r=\{0\.45 \* pointDisplayScale\}/],
  ['stroke scales', /strokeWidth=\{0\.16 \* pointDisplayScale\}/],
  ['small-points identifier', /data-hnl-metric-small-points="true"/],
  ['event input remains full canvas', /onPointerDown=\{clickPoint\}/],
  ['preserve two point calibration', /createFloorMetricCalibration\(floor, dimensions, points\[0\], points\[1\], actualDistance\)/],
  ['save still only existing callback', /onSave\(floor\.id,draft\)/],
];
for (const [label,re] of checks) assert.match(component,re,label);
assert.match(parent,/rotation=\{rotation\} zoomScale=\{zoomScale\} (?:launch=\{metricCalibrationLaunch\} )?rooms=\{floorRooms\}/);
assert.doesNotMatch(component,/r="0\.7"/);
assert.doesNotMatch(component,/setWorkVolume|updateDoc|writeBatch|transaction|firebase\//);
assert.match(component,/pointerEvents="none"/);
console.log('PASS CÁCH 2: visually compact polygon-style markers, inverse zoom, full-canvas pointer, no data writes');
