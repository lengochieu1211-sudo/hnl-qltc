import assert from 'node:assert/strict';
import fs from 'node:fs';

const modal = fs.readFileSync('src/components/RoomHighlightModal.tsx', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');

assert.match(modal, /const applyProgressPatch = \(item: RoomSubItem, patch: Partial<RoomSubItem>\)/, 'Room modal must centralize progress/inspection invariant');
assert.match(modal, /next\.inspectionStatus === 'Đạt nghiệm thu' && next\.status !== 'Đã hoàn thành'/, 'Passed inspection must require completed construction');
assert.match(modal, /applyProgressPatch\(s, \{ status: st \}\)/, 'Bulk progress update must use invariant helper');
assert.match(modal, /applyProgressPatch\(s, \{ inspectionStatus: st \}\)/, 'Bulk inspection update must use invariant helper');
assert.match(modal, /contradictorySubItems = subItems\.filter/, 'Save must reject legacy contradictory sub-items');

assert.match(floor, /XLSX\.utils\.book_append_sheet\(wb, issueSheet, 'Kiem_Tra'\)/, 'Excel export must include Kiem_Tra sheet');
assert.match(floor, /Chưa gán đội thi công cho hạng mục/, 'Excel export must flag missing teams');
assert.match(floor, /Nghiệm thu = “Đạt nghiệm thu” nhưng Tiến độ/, 'Excel export must flag contradictory inspection state');
assert.match(floor, /preflightConflictCount/, 'Excel import must preflight contradictory inspection state');
assert.match(floor, /preflightMissingTeamRows/, 'Excel import must preflight rows without teams');
assert.match(floor, /normalizedInspectionCount\+\+/, 'Excel import must normalize contradictory inspection state');
assert.match(floor, /normalizedInspection = 'Chưa nghiệm thu'/, 'Excel import must reopen inspection for unfinished work');
assert.match(floor, /missingTeamWarningCount\+\+/, 'Excel import must report unresolved team rows');

console.log('Room Progress Consistency Golden: PASS');
