import assert from 'node:assert/strict';
import type { CrewRecord, DefectItem, FloorPlan, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';
import type { AiQueryContext } from '../src/ai/core/contracts';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';
import { executeHnlAiTool, HnlAiToolError, isAllowedHnlAiToolName } from '../src/ai/tools/toolRegistry';

const projectId = 'project-ai-tools';
const context: AiQueryContext = { projectId, role: 'ADMIN', accessVerified: true, timeZone: 'Asia/Ho_Chi_Minh' };
const teams: TeamInfo[] = [
  { id: 'team-nguyen', name: 'Đội Nguyên', leader: 'Nguyên', defaultCount: 10 },
  { id: 'team-nguyen-2', name: 'Đội Nguyên 2', leader: 'N2', defaultCount: 8 },
];
const floors: FloorPlan[] = [
  { id: 'f1', floorName: 'Tầng 1', imageUrl: '', uploadedAt: '2026-09-05' },
];
const rooms: RoomProgressItem[] = [
  {
    id: 'room-101', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn 101',
    workCategory: 'Trần thạch cao', workCategoryId: 'wc-tran', workVolume: 100, volumeUnit: 'm2',
    x: 0, y: 0, width: 40, height: 40,
    frameStatus: 'Đã hoàn thành', boardStatus: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu',
    assignedTeam: 'Đội Nguyên', teamId: 'team-nguyen', updatedAt: 1,
  },
];
const defects: DefectItem[] = [
  {
    id: 'd1', floorId: 'f1', floorName: 'Tầng 1', roomId: 'room-101', teamId: 'team-nguyen',
    x: 10, y: 10, category: 'Tấm thạch cao', description: 'Test', severity: 'Thấp', assignedTo: 'Đội Nguyên',
    status: 'Mới phát hiện', createdAt: '2026-09-05T00:00:00.000Z',
  },
];
const crewRecords: CrewRecord[] = [
  {
    id: 'c1', teamId: 'team-nguyen', date: '2026-09-05', teamName: 'Đội Nguyên', leaderName: 'Nguyên',
    workerCount: 10, morningCount: 10, afternoonCount: 10, eveningCount: 0, taskDescription: 'Trần',
  },
];
const workVolumes: WorkVolume[] = [
  {
    id: 'wv-1', workCategoryId: 'wc-tran', title: 'Trần thạch cao', floor: 'Tầng 1', floorId: 'f1',
    category: 'Trần', unit: 'm2', planned: 100, actual: 80, unitPrice: 0, status: 'Đang thi công',
  },
];
const snapshot = createHnlAiProjectSnapshot({
  projectId,
  projectName: 'AI Golden',
  rooms,
  defects,
  crewRecords,
  teams,
  floors,
  workVolumes,
  inventory: [],
  materialNorms: [],
  checklist: [],
  asOf: 1757044800000,
  freshness: 'fixture',
});

// Whitelist is explicit and arbitrary model-generated tool names are rejected.
assert.equal(isAllowedHnlAiToolName('getTeamSummary'), true);
assert.equal(isAllowedHnlAiToolName('auditQuantityData'), true);
assert.equal(isAllowedHnlAiToolName('auditCrewData'), true);
assert.equal(isAllowedHnlAiToolName('auditProjectIntegrity'), true);
assert.equal(isAllowedHnlAiToolName('db.collection'), false);
for (const writeLikeName of [
  'createDefect',
  'updateDefect',
  'deleteDefect',
  'setDoc',
  'addDoc',
  'updateDoc',
  'deleteDoc',
  'writeBatch',
  'commitBatch',
  'createRoom',
  'updateCrew',
  'deleteProject',
]) {
  assert.equal(isAllowedHnlAiToolName(writeLikeName), false, `${writeLikeName} must remain outside HNL AI whitelist`);
  assert.throws(
    () => executeHnlAiTool({ name: writeLikeName, args: {} } as any, { context, snapshot }),
    (error: unknown) => error instanceof HnlAiToolError && error.code === 'AI_TOOL_NOT_ALLOWED',
  );
}
assert.throws(
  () => executeHnlAiTool({ name: 'dropDatabase', args: {} } as any, { context, snapshot }),
  (error: unknown) => error instanceof HnlAiToolError && error.code === 'AI_TOOL_NOT_ALLOWED',
);

// Entity resolution is deterministic. Exact match may resolve; near names stay ambiguous.
const resolved = executeHnlAiTool({ name: 'resolveTeam', args: { query: 'Nguyên' } }, { context, snapshot });
assert.equal((resolved.data as any)?.status, 'resolved');
assert.equal((resolved.data as any)?.team?.id, 'team-nguyen');
const ambiguousSnapshot = createHnlAiProjectSnapshot({ ...snapshot, teams: [
  { id: 'n1', name: 'Đội Nguyên 1', leader: 'N1', defaultCount: 5 },
  { id: 'n2', name: 'Đội Nguyên 2', leader: 'N2', defaultCount: 5 },
] });
const ambiguous = executeHnlAiTool({ name: 'resolveTeam', args: { query: 'Nguyên' } }, { context, snapshot: ambiguousSnapshot });
assert.equal((ambiguous.data as any)?.status, 'ambiguous');

// Historical team summary uses real dated CrewRecord data but refuses to invent a past
// quantity ledger from current room/work-volume snapshots.
const periodSummary = executeHnlAiTool({
  name: 'getTeamSummary',
  args: { teamRef: 'team-nguyen', dateRange: { from: '2026-09-01', to: '2026-09-05' } },
}, { context, snapshot });
assert.equal(periodSummary.status, 'partial');
assert.equal((periodSummary.data as any)?.totalManDays, 10);
assert.equal((periodSummary.data as any)?.quantityRecordCount, 0);
assert.ok(periodSummary.warnings.some((warning) => warning.includes('Không đủ dữ liệu lịch sử khối lượng')));

// Current progress may use current RoomProgress snapshot, but it must expose quantities by
// unit rather than a dimensionally-invalid totalTeamVol across mixed units.
const currentProgress = executeHnlAiTool({ name: 'getCurrentTeamProgress', args: { teamRef: 'team-nguyen' } }, { context, snapshot });
assert.equal(currentProgress.status, 'ok');
assert.equal((currentProgress.data as any)?.inspectedVolumeByUnit['m²'], 100);
assert.equal('totalTeamVol' in ((currentProgress.data as any) || {}), false);
assert.equal((currentProgress.data as any)?.historicalQuantityAvailable, false);

// Audit tools are read-only, project-scoped and use only the supplied snapshot.
const snapshotBefore = JSON.stringify(snapshot);
const defectAudit = executeHnlAiTool({ name: 'auditDefectLinks', args: {} }, { context, snapshot });
assert.equal((defectAudit.data as any)?.errorCount, 0);
const quantityAudit = executeHnlAiTool({ name: 'auditQuantityData', args: {} }, { context, snapshot });
assert.equal((quantityAudit.data as any)?.errorCount, 0);
const crewAudit = executeHnlAiTool({ name: 'auditCrewData', args: {} }, { context, snapshot });
assert.equal((crewAudit.data as any)?.errorCount, 0);
const projectAudit = executeHnlAiTool({ name: 'auditProjectIntegrity', args: {} }, { context, snapshot });
assert.equal((projectAudit.data as any)?.errorCount, 0);
assert.equal(JSON.stringify(snapshot), snapshotBefore, 'AI tools must not mutate the project snapshot');
assert.equal(defects[0].roomId, 'room-101');
assert.equal(defects[0].teamId, 'team-nguyen');
assert.equal(workVolumes[0].actual, 80);

// A verified role for Project A must never be used with a snapshot from Project B.
const wrongContext: AiQueryContext = { ...context, projectId: 'project-other' };
assert.throws(
  () => executeHnlAiTool({ name: 'auditProjectIntegrity', args: {} }, { context: wrongContext, snapshot }),
  (error: unknown) => error instanceof HnlAiToolError && error.code === 'AI_PROJECT_SCOPE_MISMATCH',
);

console.log('HNL AI Tool Registry Golden Phase 2: PASS');
