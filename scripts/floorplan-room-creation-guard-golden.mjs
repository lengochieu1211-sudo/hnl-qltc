#!/usr/bin/env node
/** Explicit room creation regression; pure source-contract checks, no Firestore writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
const handler=ui.slice(ui.indexOf('const handleImageClick = '),ui.indexOf('  // Quick action to cycle Frame Status'));
assert(handler.includes('if (!canManageStructure) {'), 'EDITOR/VIEWER must fail closed for structural edits');
const explicit=handler.slice(handler.indexOf('if (isRoomPinPlacementMode) {'),handler.indexOf('// Defect pin placement is explicit'));
assert(explicit.includes('setIsRoomPinPlacementMode(false)'), 'Placement is one-shot');
assert(explicit.includes('setNewRoomClickPos({ x, y })')&&explicit.includes('setIsRoomModalOpen(true)'), 'Armed room tool opens creation at user-picked coordinates');
assert(handler.includes('if (isDefectPinPlacementMode || relocatingDefectId) {')&&handler.includes('commitDefectMapPlacement(x, y)'), 'Defect pin/move stays independent');
const none=handler.slice(handler.indexOf("if (drawTool === 'none') {"));
assert(!none.includes('setIsRoomModalOpen(true)'), 'Normal empty tap must never create/open room in any view');
assert(none.includes('setSelectedRoomForDragId(null)')&&none.includes('setSelectedRoomIds([])'), 'Blank tap may clear selection');
assert(!handler.includes("if (viewMode === 'highlight') {\n        setSelectedRoomForEdit(null)"), 'Legacy implicit highlight creation must stay removed');
assert((ui.match(/'Hủy đặt căn' : 'Tạo căn mới'/g)||[]).length===2, 'Both normal and fullscreen toolbars must show explicit Tạo căn mới');
assert(ui.includes('}, [selectedFloorId, currentProjectId, viewMode, isActive]);'), 'Pending placement must cancel when floor/project/mode/tab changes');
assert(ui.includes('setIsRoomPinPlacementMode(false);')&&ui.includes('if (!canManageStructure) return;'), 'Role downgrade must disarm placement');
assert(ui.includes("setDrawTool(drawTool === 'polygon' ? 'none' : 'polygon')"), 'Polygon drawing mode remains available');
assert(ui.includes("onClick={handleImageClick}"), 'Shared mobile/desktop canvas handler must remain active');
console.log('Floor-plan room creation golden: PASS — no implicit tap creation; explicit room/Defect/draw paths and role/floor/tab guards preserved');
