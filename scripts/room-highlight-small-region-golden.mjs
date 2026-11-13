/** Regression gate for tiny room regions, shared by PC Web/EXE and mobile Web/APK.
 * Run: node --experimental-strip-types scripts/room-highlight-small-region-golden.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_ROOM_HIGHLIGHT_PERCENT,
  getPreciseRoomHighlightRect,
  getRoomHighlightBounds,
  resizeRoomHighlightToBounds,
} from '../src/utils/roomHighlightGeometry.ts';

assert.equal(MIN_ROOM_HIGHLIGHT_PERCENT, 0.1);
const cases = [
  [{ x: 10, y: 20 }, { x: 10.1, y: 20.1 }, { x: 10, y: 20, width: 0.1, height: 0.1 }],
  [{ x: 10.5, y: 20.5 }, { x: 10, y: 20 }, { x: 10, y: 20, width: 0.5, height: 0.5 }],
  [{ x: 99.9, y: 99.9 }, { x: 100, y: 100 }, { x: 99.9, y: 99.9, width: 0.1, height: 0.1 }],
  [{ x: 40, y: 60 }, { x: 43, y: 61 }, { x: 40, y: 60, width: 3, height: 1 }],
  [{ x: 20, y: 25 }, { x: 30, y: 42 }, { x: 20, y: 25, width: 10, height: 17 }],
];
for (const [a, b, want] of cases) {
  const actual = getPreciseRoomHighlightRect(a, b);
  assert.ok(actual, 'Legitimate tiny shapes should not be discarded');
  for (const field of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(actual[field] - want[field]) < 1e-8, `Wrong ${field} for ${JSON.stringify([a, b])}: ${JSON.stringify(actual)}`);
}
assert.equal(getPreciseRoomHighlightRect({ x: 1, y: 1 }, { x: 1, y: 2 }), null, 'Zero-width region must not be persisted');
assert.equal(getPreciseRoomHighlightRect({ x: 1, y: 1 }, { x: 2, y: 1 }), null, 'Zero-height region must not be persisted');
assert.equal(getPreciseRoomHighlightRect({ x: 1, y: 1 }, { x: 1, y: 1 }), null, 'Accidental tap must not create a default giant region');

const polygon = {
  id: 'ROOM-TEST', floorId: 'FLOOR-TEST', roomName: 'Tiny room', x: 40, y: 30,
  width: 3, height: 2, points: [
    { x: 40, y: 30 }, { x: 43, y: 30 }, { x: 43, y: 32 }, { x: 40, y: 32 },
  ],
};
const shrunk = resizeRoomHighlightToBounds(polygon, { x: 55, y: 65, width: 0.2, height: 0.1 });
const bounds = getRoomHighlightBounds(shrunk);
assert.equal(shrunk.id, polygon.id, 'Resize must not reassign ID');
assert.equal(shrunk.floorId, polygon.floorId, 'Resize must not reassign floor');
assert.equal(shrunk.roomName, polygon.roomName, 'Resize must not reassign room');
assert.equal(shrunk.points.length, polygon.points.length, 'Polygon vertex count must be preserved');
assert.ok(Math.abs(bounds.width - 0.2) < 1e-8 && Math.abs(bounds.height - 0.1) < 1e-8, 'Polygon must shrink to tiny requested size, not 2–4%');
assert.deepEqual(polygon.points[0], { x: 40, y: 30 }, 'Original geometry must not be mutated');

const ui = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const drag = ui.split('// Handle Active Drag-and-Resize on Highlight Region')[1]?.split('if (isFreehandDrawing)')[0];
assert.ok(drag && drag.includes('MIN_ROOM_HIGHLIGHT_PERCENT'), 'Resize handler must use precise minimum');
assert.ok(!/Math\.max\(2,\s*Math\.min/.test(drag), 'Old hard 2%-minimum must not return in dragging');
assert.ok(!/initRoom\.(?:x\s*\+\s*initRoom\.width|y\s*\+\s*initRoom\.height)\s*-\s*2\b/.test(drag), 'Corner drag must not enforce old 2%-minimum');
assert.ok(ui.includes('getPreciseRoomHighlightRect({ x: x1, y: y1 }, { x: x2, y: y2 })'), 'Both two-point modes must use exact small rectangle');
assert.ok(!ui.includes('if (finalW < 2) finalW = 20'), 'Old 20% fallback must be removed');
assert.ok(!ui.includes('if (finalH < 2) finalH = 15'), 'Old 15% fallback must be removed');
assert.ok(!ui.includes('const w = Math.max(4, maxX - minX)'), 'Freehand region must not be inflated');
assert.ok(ui.includes('dx * dx + dy * dy >= MIN_ROOM_HIGHLIGHT_PERCENT * MIN_ROOM_HIGHLIGHT_PERCENT'), 'Freehand point sampling must retain tiny shapes');
console.log('ROOM HIGHLIGHT SMALL REGION GOLDEN PASS — 0.1%, reversed corners, border, no fake fallback, polygon ID/points, resize gate');
