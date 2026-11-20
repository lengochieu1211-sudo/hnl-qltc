/** DEV-only geometry/UI regression for optional sub-item highlights. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeSubHighlightAreaRatio as ratio, isAreaHighlightUnit, getSubHighlightFloorRect } from '../src/utils/subItemHighlightGeometry.ts';

const base = { x: 10, y: 15, width: 40, height: 30 };
const full = { x: 0, y: 0, width: 100, height: 100 };
const half = { x: 0, y: 0, width: 50, height: 100 };
const q = (room, main, shapes, expected) => {
  const outcome = ratio(room, main, shapes);
  assert.equal(outcome.valid, true, outcome.reason);
  assert.ok(Math.abs(outcome.percent - expected) < 0.01, `expected ${expected}% but got ${outcome.percent}%`);
};
q(base, undefined, [full], 100);
q(base, undefined, [half], 50);
q(base, undefined, [half, { x:25, y:0, width:50, height:100 }], 75); // overlapping: union, no double-count
q(base, undefined, [half, half, half], 50); // duplicate region does not inflate quantity
q(base, half, [full], 100); // main 50% of room, stage covers all main => 100%
q(base, half, [{ x: 50, y:0, width:50,height:100 }], 0); // outside main => zero
q(base, half, [{ x: 25, y:0, width:50,height:100 }], 50); // main intersection only
q(base, undefined, [{x:0,y:0,width:200,height:200}], 100); // clipped to room
q({ ...base, points:[{x:10,y:15},{x:50,y:15},{x:10,y:45}] }, undefined, [half], 75); // triangular room
assert.equal(ratio({ ...base, isPolyline:true }, undefined, [full]).valid, false);
assert.equal(ratio({ ...base, width:0 }, undefined, [full]).valid, false);
assert.deepEqual(getSubHighlightFloorRect(base,half), {x:10,y:15,width:20,height:30});
assert.equal(isAreaHighlightUnit('m²'),true);
assert.equal(isAreaHighlightUnit('m2'),true);
for (const unit of ['m','cái','bộ','kg']) assert.equal(isAreaHighlightUnit(unit),false);
const room = fs.readFileSync(new URL('../src/components/RoomHighlightModal.tsx', import.meta.url), 'utf8');
const floor = fs.readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
assert.match(room, /data-hnl-room-highlight-advanced="true"/);
assert.match(room, /showAdvancedHighlights, setShowAdvancedHighlights/);
assert.match(room, /highlightVolumeMode === 'area'/);
assert.match(room, /structureReadOnly && roomItem/);
assert.match(room, /Đã hoàn thành.*Đạt nghiệm thu/);
assert.match(floor, /subItemRegions: parsed\.subItemRegions === true/); // default OFF
assert.match(floor, /data-hnl-floor-subitem-highlight="true"/);
assert.match(floor, /pointerEvents="none"/);
assert.match(types, /highlightRegions\?: HighlightRegionRect\[\]/);
assert.match(types, /categoryHighlightRegions\?: Record<string, HighlightRegionRect>/);
console.log('PASS: advanced sub-item geometry, union, main intersection, polygon, legacy defaults, UI and optional schema');
