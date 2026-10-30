import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8');
const floor=read('src/components/FloorPlanDefectTab.tsx');
const crew=read('src/components/CrewTabBase.tsx');
const order=read('src/components/WarehouseOrderSheet.tsx');
const geo=read('src/utils/roomHighlightGeometry.ts');
const types=read('src/types.ts');
assert(crew.includes('inline-flex w-full sm:w-auto sm:max-w-full'), 'Team statistics button stays over-wide on PC');
assert(crew.includes('sm:flex sm:flex-wrap sm:justify-end'), 'Team form action buttons do not shrink on PC');
assert(order.includes('flex min-w-0 flex-row items-center'), 'Expected-date inline label missing');
assert(order.includes('formatAdaptiveDecimal(n)'), 'Order number format not tied to preferences');
assert(order.includes('formatPreset=getNumberFormatPreset()'), 'Number fields not refreshed on number-format changes');
assert(geo.includes('export function resizeRoomHighlightSide('), 'No side-only polygon transformation');
assert(floor.includes("resizeRoomHighlightSide(initRoom, activeDragHandle as 'n' | 's' | 'e' | 'w'"), 'Side-only geometry not wired to UI');
assert(floor.includes('data-hnl-defect-created-at="true"'), 'Defect creation date not visible in detail');
assert(floor.includes('formatDateDDMMYYYY(activeDefectDetail.createdAt)'), 'Defect creation date not formatted');
assert(types.includes('positionLocked?: boolean;'), 'Cloud lock optional field missing');
assert(floor.includes("await onCommitPositionLocks('defect', [{ id: defectId") &&
  floor.includes("await onCommitPositionLocks('room', entries, locked)"),
  'Defect and Room lock must await the server-confirmed write');
assert(floor.includes('room.positionLocked === true') && floor.includes('defect.positionLocked === true'), 'Cloud lock subscription not reflected in UI');
assert(floor.includes('positionLocked === undefined && legacy.has') &&
  floor.includes("legacyOnlyLock && !window.confirm(") &&
  !floor.includes("localStorage.setItem(getDraftKey('construction_floorplan_locked_rooms')"),
  'Legacy-only locks protect old data without silent Cloud migration or new local writes');
console.log('DEV BACKUP FOUR ISSUES UI SOURCE REGRESSION PASS (cloud lock reconciliation included; runtime multiuser gate pending)');
