import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findRoomObjectSnap } from '../src/utils/roomHighlightObjectSnap.ts';

const rooms = [
  { id: 'rect', x: 10, y: 20, width: 30, height: 20 },
  { id: 'line', x: 0, y: 0, width: 0, height: 0, points: [{ x: 60, y: 40 }, { x: 80, y: 45 }], isPolyline: true },
];
const before = JSON.stringify(rooms);
const view = { width: 800, height: 400 };
assert.deepEqual(findRoomObjectSnap({ x: 10.7, y: 21 }, rooms, view, { tolerancePx: 10 })?.point, { x: 10, y: 20 }, 'snap saved rectangle corner');
assert.equal(findRoomObjectSnap({ x: 12, y: 23 }, rooms, view, { tolerancePx: 10 }), null, 'no attraction beyond tolerance');
assert.equal(findRoomObjectSnap({ x: 25, y: 20 }, rooms, view, { tolerancePx: 8 }), null, 'midpoint off by default');
assert.deepEqual(findRoomObjectSnap({ x: 25, y: 20 }, rooms, view, { tolerancePx: 8, midpoints: true })?.point, { x: 25, y: 20 });
assert.deepEqual(findRoomObjectSnap({ x: 80, y: 45 }, rooms, view, { tolerancePx: 8 })?.point, { x: 80, y: 45 }, 'polyline endpoint');
assert.equal(JSON.stringify(rooms), before, 'never mutate saved rooms');
const src = readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
assert.match(src, /isRoomCreationDrawing && \(drawTool === 'freehand' \|\| drawTool === '2point'\)/, 'touch-action disables page scrolling for drawing in BOTH map modes');
assert.match(src, /onPointerCancel=\{handleCancelledDrawPointer\}/, 'cancel must not finalize a shape');
assert.match(src, /data-hnl-fullscreen-display-popover/, 'fullscreen settings must float above map rather than expand toolbar');
assert.match(src, /findRoomObjectSnap\(/, 'point snap must use saved room geometry');
console.log('PASS DEV BACKUP touch+OSNAP source and pure-function regression');
