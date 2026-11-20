/** DEV-only geometry/UI regression for optional sub-item highlights. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getRoomWorkCategoryUnit } from '../src/utils/roomCategoryUnit.ts';
import { computeSubHighlightAreaRatio as ratio, isAreaHighlightUnit, getSubHighlightFloorRect, getEffectiveStageHighlightRegions } from '../src/utils/subItemHighlightGeometry.ts';

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
q(base, undefined, getEffectiveStageHighlightRegions({ highlightVolumeMode: 'area' }), 100); // cleared subregion = full MAIN
q(base, half, getEffectiveStageHighlightRegions({ highlightVolumeMode: 'area', highlightRegions: [] }), 100); // custom main preserved
q(base, undefined, getEffectiveStageHighlightRegions({ highlightVolumeMode: 'area', highlightRegions: [half] }), 50);
q(base, undefined, getEffectiveStageHighlightRegions({ highlightVolumeMode: 'manual' }), 0); // legacy manual unchanged
assert.deepEqual(getEffectiveStageHighlightRegions({ highlightVolumeMode: 'manual' }), []);
q(base, undefined, [{x:0,y:0,width:200,height:200}], 100); // clipped to room
q({ ...base, points:[{x:10,y:15},{x:50,y:15},{x:10,y:45}] }, undefined, [half], 75); // triangular room
assert.equal(ratio({ ...base, isPolyline:true }, undefined, [full]).valid, false);
assert.equal(ratio({ ...base, width:0 }, undefined, [full]).valid, false);
assert.deepEqual(getSubHighlightFloorRect(base,half), {x:10,y:15,width:20,height:30});
const catalog = [
  { id: 'ceiling', title: 'Trần', unit: 'm2', floorId: 'F1' },
  { id: 'skirting', title: 'Len', unit: 'm', floorId: 'F1' },
  { id: 'door', title: 'Cửa thăm', unit: 'Bộ', floorId: 'F1' },
  { id: 'ceiling-upper', title: 'Trần', unit: 'm3', floorId: 'F2' },
];
assert.equal(getRoomWorkCategoryUnit('Trần', catalog, 'F1'), 'm2');
assert.equal(getRoomWorkCategoryUnit('Trần', catalog, 'F2'), 'm3');
assert.equal(getRoomWorkCategoryUnit('Len', catalog, 'F1'), 'm');
assert.equal(getRoomWorkCategoryUnit('Cửa thăm', catalog, 'F1'), 'Bộ');
assert.equal(getRoomWorkCategoryUnit('Xóa lâu rồi', catalog, 'F1'), '');
assert.equal(isAreaHighlightUnit('m²'),true);
assert.equal(isAreaHighlightUnit('m2'),true);
for (const unit of ['m','cái','bộ','kg']) assert.equal(isAreaHighlightUnit(unit),false);
const room = fs.readFileSync(new URL('../src/components/RoomHighlightModal.tsx', import.meta.url), 'utf8');
const floor = fs.readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
assert.match(room, /data-hnl-room-highlight-advanced="true"/);
assert.match(room, /getCategorySourceUnit\(catName\)/);
assert.match(room, /volumeUnit: getCategorySourceUnit\(effectiveWorkCategory\)/);
assert.match(room, /showAdvancedHighlights, setShowAdvancedHighlights/);
assert.match(room, /highlightVolumeMode === 'area'/);
assert.match(room, /data-hnl-subitem-quantity/);
assert.match(room, /data-hnl-room-team-contact-row="true"/);
assert.match(room, /data-hnl-room-category-inline-actions="true"/);
assert.match(room, /data-hnl-room-category-title-row="true"/);
assert.match(room, /xl:flex-row xl:items-center/);
assert.match(room, /xl:w-auto xl:flex-1 xl:min-w-0/);
assert.match(room, /data-hnl-room-preset-inline-row="true"/);
assert.match(room, /lg:flex-row lg:items-end/);
assert.match(room, /data-hnl-room-add-subitem-inline="true"/);
assert.ok(room.indexOf('data-hnl-room-add-subitem-inline="true"') < room.indexOf('Interactive Input Volume directly in the list'));
assert.equal(room.split('onClick={() => handleAddSubItem(catName)}').length - 1, 2); // mutually exclusive viewport actions
assert.match(room, /data-hnl-room-add-subitem-mobile="true"/);
assert.match(room, /hidden xl:inline-flex px-3 py-1.5/);
assert.match(room, /xl:hidden w-full lg:w-auto/);
assert.match(room, /data-hnl-room-name-color-row="true"/);
assert.match(room, /lg:flex-row lg:items-end/);
assert.match(room, /data-hnl-room-color-option="true"/);
assert.match(room, /lg:w-\[250px\] lg:shrink-0/);
assert.match(room, /order-1 w-full min-w-0 xl:flex-1/); // team selector on left on PC and first on mobile
assert.match(room, /order-2 flex justify-end xl:shrink-0/); // ContactMenu on right on PC and below on mobile
assert.match(room, /data-hnl-room-pc-status-column="true"/);
assert.equal(room.split('xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)]').length - 1, 2);
assert.match(room, /Tiến độ · Nghiệm thu · Hạn hoàn thành/);
assert.match(room, /\['Chưa làm', 'Đang làm', 'Đã hoàn thành'\]/);
assert.ok(room.includes("(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'] as RoomInspectionResult[])"));
assert.doesNotMatch(room, /KL hiện có:|KL dự kiến khi lưu:/);
assert.match(room, /getEffectiveStageHighlightRegions\(stage\)/);
assert.match(room, /Preserve auto mode: no sub-region means 100%/);
assert.match(room, /structureReadOnly && roomItem/);
assert.match(room, /Đã hoàn thành.*Đạt nghiệm thu/);
// An unconfigured project displays persisted stage regions by default, while an explicit
// per-project user preference of false must still keep the layer hidden.
assert.equal((floor.match(/subItemRegions: parsed\.subItemRegions !== false/g) || []).length, 2);
assert.equal((floor.match(/subItemRegions: true, roomLabels: true/g) || []).length, 2);
assert.match(floor, /data-hnl-floor-subitem-highlight="true"/);
assert.match(floor, /pointerEvents="none"/);
assert.match(types, /highlightRegions\?: HighlightRegionRect\[\]/);
assert.match(types, /categoryHighlightRegions\?: Record<string, HighlightRegionRect>/);
console.log('PASS: advanced sub-item geometry, union, main intersection, polygon, legacy defaults, UI and optional schema');
