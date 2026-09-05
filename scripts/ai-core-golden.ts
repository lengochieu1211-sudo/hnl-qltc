import assert from 'node:assert/strict';
import type { CrewRecord, DefectItem, FloorPlan, RoomProgressItem, TeamInfo } from '../src/types';
import type { AiQuantityObservation, AiQueryContext } from '../src/ai/core/contracts';
import { resolveTeamReference } from '../src/ai/core/entityResolver';
import { calculateAiTeamSummary } from '../src/ai/calculations/teamSummary';
import { auditDefectLinks } from '../src/ai/audit/defectAudit';
import { createAiPermissionScope, sanitizeRecordForAi } from '../src/ai/security/aiPermissionGuard';

const projectId = 'project-ai-golden';
const adminContext: AiQueryContext = { projectId, role: 'ADMIN', accessVerified: true, timeZone: 'Asia/Ho_Chi_Minh' };
const viewerContext: AiQueryContext = { projectId, role: 'VIEWER', accessVerified: true, timeZone: 'Asia/Ho_Chi_Minh' };

const teams: TeamInfo[] = [
  { id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 10 },
  { id: 'team-nguyen-1', name: 'Đội Nguyên 1', leader: 'N1', defaultCount: 8 },
  { id: 'team-nguyen-2', name: 'Đội Nguyên 2', leader: 'N2', defaultCount: 8 },
  { id: 'team-thanh', name: 'Đội Thành', leader: 'Thành', defaultCount: 8 },
];

// TEST 1 — deterministic Team Summary. Duplicate floor rows on the same shift must not
// double-count manpower, and quantities with different units must never be merged.
const crewRecords: CrewRecord[] = [
  {
    id: 'crew-01-a', teamId: 'team-nguyen', date: '2026-08-01', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 10, morningCount: 10, afternoonCount: 10, eveningCount: 0,
    floorId: 'f1', floorName: 'Tầng 1', taskDescription: 'Trần',
  },
  {
    id: 'crew-01-b', teamId: 'team-nguyen', date: '2026-08-01', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 9, morningCount: 8, afternoonCount: 9, eveningCount: 0,
    floorId: 'f2', floorName: 'Tầng 2', taskDescription: 'Vách',
  },
  {
    id: 'crew-02', teamId: 'team-nguyen', date: '2026-08-02', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 8, morningCount: 8, afternoonCount: 6, eveningCount: 2,
    floorId: 'f1', floorName: 'Tầng 1', taskDescription: 'Trần + vách',
  },
  {
    id: 'crew-outside-range', teamId: 'team-nguyen', date: '2026-07-31', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 99, morningCount: 99, afternoonCount: 99, eveningCount: 99,
    taskDescription: 'Outside range',
  },
];

const quantityObservations: AiQuantityObservation[] = [
  { recordId: 'q1', date: '2026-08-01', teamId: 'team-nguyen', workItemId: 'w1', workItem: 'Trần khung chìm', unit: 'm2', quantity: 100, basis: 'inspected' },
  { recordId: 'q2', date: '2026-08-02', teamId: 'team-nguyen', workItemId: 'w1', workItem: 'Trần khung chìm', unit: 'm²', quantity: 80, basis: 'inspected' },
  { recordId: 'q3', date: '2026-08-02', teamId: 'team-nguyen', workItemId: 'w2', workItem: 'Vách thạch cao', unit: 'm²', quantity: 90, basis: 'inspected' },
  { recordId: 'q4', date: '2026-08-02', teamId: 'team-nguyen', workItemId: 'w3', workItem: 'Phụ kiện', unit: 'kg', quantity: 25, basis: 'inspected' },
  { recordId: 'q-ignore-basis', date: '2026-08-02', teamId: 'team-nguyen', workItemId: 'w1', workItem: 'Trần khung chìm', unit: 'm²', quantity: 999, basis: 'completed' },
];

const teamSummary = calculateAiTeamSummary({
  context: adminContext,
  team: teams[0],
  dateRange: { from: '2026-08-01', to: '2026-08-15' },
  crewRecords,
  quantityObservations,
  quantityBasis: 'inspected',
  freshness: 'fixture',
  asOf: 1,
});
assert.equal(teamSummary.status, 'ok');
assert.equal(teamSummary.data?.totalManDays, 18, '10 công ngày 01 + 8 công ngày 02; duplicate floor row must not multiply manpower');
assert.equal(teamSummary.data?.workDays, 2);
assert.equal(teamSummary.data?.quantityRecordCount, 4, 'completed-basis record must not leak into inspected query');
assert.deepEqual(
  teamSummary.data?.quantities.map((item) => [item.workItem, item.unit, item.quantity]),
  [
    ['Phụ kiện', 'kg', 25],
    ['Trần khung chìm', 'm²', 180],
    ['Vách thạch cao', 'm²', 90],
  ],
  'quantities must stay grouped by work item + unit',
);
const productivityM2 = teamSummary.data?.productivityByUnit.find((item) => item.unit === 'm²');
const productivityKg = teamSummary.data?.productivityByUnit.find((item) => item.unit === 'kg');
assert.equal(productivityM2?.quantity, 270);
assert.equal(productivityM2?.quantityPerManDay, 15);
assert.equal(productivityKg?.quantity, 25);
assert.equal(productivityKg?.quantityPerManDay, 1.3889);
assert.equal(teamSummary.metadata.freshness, 'fixture');

// TEST 2 — near team names. No fuzzy/prefix candidate may be auto-selected.
const ambiguousTeam = resolveTeamReference('Nguyên', [teams[1], teams[2]]);
assert.equal(ambiguousTeam.status, 'ambiguous');
assert.deepEqual(ambiguousTeam.candidates.map((team) => team.id).sort(), ['team-nguyen-1', 'team-nguyen-2']);
const exactTeam = resolveTeamReference('Nguyên', [teams[0], teams[1], teams[2]]);
assert.equal(exactTeam.status, 'resolved');
assert.equal(exactTeam.team?.id, 'team-nguyen');

// TEST 3 + 4 — Defect room geometry mismatch and orphan teamId must be detected without mutation.
const floors: FloorPlan[] = [
  { id: 'f1', floorName: 'Tầng 1', imageUrl: '', uploadedAt: '2026-08-01' },
  { id: 'f2', floorName: 'Tầng 2', imageUrl: '', uploadedAt: '2026-08-01' },
];
const rooms: RoomProgressItem[] = [
  {
    id: 'room-a', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn A', x: 0, y: 0, width: 40, height: 40,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', assignedTeam: 'Đội Nguyên', teamId: 'team-nguyen', updatedAt: 1,
  },
  {
    id: 'room-b', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn B', x: 50, y: 0, width: 40, height: 40,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', assignedTeam: 'Đội Thành', teamId: 'team-thanh', updatedAt: 1,
  },
];
const defects: DefectItem[] = [
  {
    id: 'defect-bad-link', floorId: 'f1', floorName: 'Tầng 1', roomId: 'room-a', teamId: 'team-missing',
    x: 60, y: 10, category: 'Tấm thạch cao', description: 'Pin nằm ở căn B nhưng lưu room A', severity: 'Trung bình',
    assignedTo: 'Đội Nguyên', status: 'Mới phát hiện', createdAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'defect-floor-mismatch', floorId: 'f2', floorName: 'Tầng 2', roomId: 'room-a', teamId: 'team-nguyen',
    x: 10, y: 10, category: 'Khung trần', description: 'Sai floorId', severity: 'Thấp',
    assignedTo: 'Đội Nguyên', status: 'Mới phát hiện', createdAt: '2026-08-02T00:00:00.000Z',
  },
];
const defectAudit = auditDefectLinks({ context: adminContext, defects, rooms, floors, teams, freshness: 'fixture', asOf: 1 });
const ruleIds = defectAudit.data?.issues.map((issue) => issue.ruleId) || [];
assert.ok(ruleIds.includes('DEFECT_PIN_OUTSIDE_LINKED_ROOM'), 'pin outside linked room must be detected');
assert.ok(ruleIds.includes('DEFECT_TEAM_NOT_FOUND'), 'orphan teamId must be detected');
assert.ok(ruleIds.includes('DEFECT_ROOM_FLOOR_MISMATCH'), 'room/floor mismatch must be detected');
assert.equal(defects[0].roomId, 'room-a', 'audit must be read-only and never reconcile the record');
assert.equal(defects[0].teamId, 'team-missing', 'audit must never repair teamId automatically');

// TEST 5 + 6 — financial fields must be removed for VIEWER and preserved for ADMIN.
const financialRecord = {
  id: 'wv-1',
  title: 'Trần',
  planned: 100,
  actual: 50,
  unitPrice: 250000,
  nested: { amount: 12500000, safeNote: 'visible' },
};
const viewerSanitized = sanitizeRecordForAi(financialRecord, createAiPermissionScope(projectId, viewerContext.role, true)) as any;
assert.equal('unitPrice' in viewerSanitized, false, 'VIEWER must not receive unitPrice in AI payload');
assert.equal('amount' in viewerSanitized.nested, false, 'nested financial fields must also be removed');
assert.equal(viewerSanitized.nested.safeNote, 'visible');
const adminSanitized = sanitizeRecordForAi(financialRecord, createAiPermissionScope(projectId, adminContext.role, true)) as any;
assert.equal(adminSanitized.unitPrice, 250000, 'ADMIN may receive financial fields');
assert.equal(adminSanitized.nested.amount, 12500000);

// TEST 7 + 9 — offline/cache deterministic calculations remain available; missing quantity
// must return a partial/insufficient status rather than inventing a number.
const offlineSummary = calculateAiTeamSummary({
  context: viewerContext,
  team: teams[0],
  dateRange: { from: '2026-08-01', to: '2026-08-15' },
  crewRecords,
  quantityObservations: [],
  quantityBasis: 'inspected',
  freshness: 'cache',
  asOf: 123,
});
assert.equal(offlineSummary.status, 'partial');
assert.equal(offlineSummary.metadata.freshness, 'cache');
assert.equal(offlineSummary.data?.quantities.length, 0);
assert.ok(offlineSummary.warnings.some((warning) => warning.includes('Không tìm thấy record khối lượng')));
assert.equal(offlineSummary.data?.productivityByUnit.length, 0, 'no quantity data means no fabricated productivity');

console.log('HNL AI Core Golden Phase 1A: PASS');
