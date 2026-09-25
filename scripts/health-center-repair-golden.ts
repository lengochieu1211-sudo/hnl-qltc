import assert from 'node:assert/strict';
import { buildHealthCenterRepairPreview, assertHealthCenterRepairPreviewFresh } from '../src/healthCenter/healthCenterRepair';
import type { HealthCenterIssue, HealthCenterSummary } from '../src/healthCenter/healthCenterEngine';
import { getHealthCenterRepairBlockReason } from '../src/healthCenter/healthCenterRepairPreflight';

function issue(input: Partial<HealthCenterIssue> & Pick<HealthCenterIssue, 'id' | 'ruleId' | 'entityType' | 'entityId' | 'actionClass'>): HealthCenterIssue {
  return {
    severity: 'WARNING',
    module: 'links',
    message: input.ruleId,
    evidenceIds: [],
    location: {},
    details: {},
    ...input,
  } as HealthCenterIssue;
}

const issues: HealthCenterIssue[] = [
  issue({
    id: 'i-defect-room', ruleId: 'DEFECT_ROOM_ID_MISSING', entityType: 'defect', entityId: 'd1', actionClass: 'SAFE_REPAIR_CANDIDATE',
    details: { candidateRoomId: 'room-101' },
  }),
  issue({
    id: 'i-defect-team', ruleId: 'DEFECT_TEAM_ID_MISSING', entityType: 'defect', entityId: 'd1', actionClass: 'SAFE_REPAIR_CANDIDATE',
    details: { assignedTo: 'Đội Nguyên', candidateTeamId: 'team-nguyen' },
  }),
  issue({
    id: 'i-crew-team', ruleId: 'CREW_TEAM_ID_MISSING', entityType: 'crew', entityId: 'c1', actionClass: 'SAFE_REPAIR_CANDIDATE',
    details: { teamName: 'Đội Nguyên', candidateTeamId: 'team-nguyen' },
  }),
  issue({
    id: 'i-crew-floor-name', ruleId: 'CREW_FLOOR_ID_NAME_MISMATCH', entityType: 'crew', entityId: 'c1', actionClass: 'SAFE_REPAIR_CANDIDATE',
    details: { floorId: 'f1', savedFloorName: 'Tang 01', currentFloorName: 'Tầng 01' },
  }),
  issue({
    id: 'i-floor-work-name', ruleId: 'CREW_FLOOR_WORK_NAME_MISMATCH', entityType: 'crew', entityId: 'c2:0', actionClass: 'SAFE_REPAIR_CANDIDATE',
    details: { recordId: 'c2', floorWorkIndex: 0, savedFloorName: 'Tang 02', currentFloorName: 'Tầng 02' },
  }),
  issue({
    id: 'i-orphan', ruleId: 'ROOM_FLOOR_NOT_FOUND', entityType: 'room', entityId: 'r-orphan', actionClass: 'MANUAL_REPAIR', severity: 'ERROR',
    details: { floorId: 'missing-floor' },
  }),
  issue({
    id: 'i-ambiguous', ruleId: 'DEFECT_ROOM_AMBIGUOUS', entityType: 'defect', entityId: 'd2', actionClass: 'NEEDS_CONFIRMATION', severity: 'REVIEW',
    details: { candidateRoomIds: ['r1', 'r2'] },
  }),
];

const report: HealthCenterSummary = {
  auditSnapshotId: 'hc-project-123',
  projectId: 'project',
  generatedAt: 123,
  freshness: 'fixture',
  recordsScanned: 10,
  errorCount: 1,
  warningCount: 5,
  reviewCount: 1,
  suggestionCount: 0,
  safeRepairCount: 5,
  needsConfirmationCount: 1,
  manualRepairCount: 1,
  technicalIssueCount: 0,
  businessIssueCount: 7,
  issues,
};

const safeOnly = buildHealthCenterRepairPreview(report, ['i-defect-room', 'i-defect-team', 'i-crew-team', 'i-crew-floor-name', 'i-floor-work-name']);
assert.equal(safeOnly.operations.length, 5, 'all certified deterministic safe repairs must produce operations');
assert.equal(safeOnly.blocked.length, 0, 'certified safe repairs must not be blocked');
assert.equal(safeOnly.canApply, true, 'safe-only preview must be eligible for apply after backup + confirmation');
assert.equal(safeOnly.requiresBackup, true);
assert.equal(safeOnly.requiresConfirmation, true);
assert.ok(safeOnly.operations.every((op) => op.requiresBackup && op.confidence === 'deterministic-unique'));
assert.deepEqual(safeOnly.operations.map((op) => [op.target, op.entityId, op.path, op.after]), [
  ['defects', 'd1', 'roomId', 'room-101'],
  ['defects', 'd1', 'teamId', 'team-nguyen'],
  ['crewRecords', 'c1', 'teamId', 'team-nguyen'],
  ['crewRecords', 'c1', 'floorName', 'Tầng 01'],
  ['crewRecords', 'c2', 'floorWorks.0.floorName', 'Tầng 02'],
]);

const mixed = buildHealthCenterRepairPreview(report);
assert.equal(mixed.operations.length, 5, 'orphan/ambiguous issues must never create write operations');
assert.equal(mixed.blocked.length, 2, 'manual and confirmation-required issues must be explicitly blocked');
assert.equal(mixed.canApply, false, 'mixed preview cannot be applied as a batch while blocked issues are selected');
assert.ok(mixed.blocked.some((x) => x.ruleId === 'ROOM_FLOOR_NOT_FOUND'));
assert.ok(mixed.blocked.some((x) => x.ruleId === 'DEFECT_ROOM_AMBIGUOUS'));

assert.doesNotThrow(() => assertHealthCenterRepairPreviewFresh(safeOnly, report));
assert.throws(
  () => assertHealthCenterRepairPreviewFresh(safeOnly, { ...report, auditSnapshotId: 'hc-project-new' }),
  /HEALTH_CENTER_REPAIR_STALE/,
  'stale preview must fail closed',
);

const unknownSafe = buildHealthCenterRepairPreview({
  ...report,
  issues: [issue({
    id: 'i-unknown-safe', ruleId: 'SOME_FUTURE_SAFE_RULE', entityType: 'project', entityId: 'x1', actionClass: 'SAFE_REPAIR_CANDIDATE',
  })],
}, ['i-unknown-safe']);
assert.equal(unknownSafe.operations.length, 0, 'future safe class alone must not grant write behavior');
assert.equal(unknownSafe.blocked.length, 1, 'future rule without certified repair strategy must fail closed');
assert.equal(unknownSafe.canApply, false);

const safeSync = { online: true, dataCloudPhase: 'synced', pendingData: 0, cloudInitialReady: true, snapshotReadyCount: 9 };
assert.equal(getHealthCenterRepairBlockReason(safeSync), null, 'synced 9/9 with no pending data must allow repair preflight');
assert.equal(getHealthCenterRepairBlockReason({ ...safeSync, dataCloudPhase: 'idle' }), null, 'idle after live snapshot is allowed when all safety signals are clear');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, dataCloudPhase: 'conflict' }) || '', /xung đột revision\/Rules/, 'conflict must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, dataCloudPhase: 'error' }) || '', /lỗi đồng bộ/, 'sync error must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, dataCloudPhase: 'syncing' }) || '', /đang đồng bộ/, 'syncing must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, pendingData: 2 }) || '', /2 thay đổi dữ liệu/, 'pending writes must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, online: false }) || '', /offline/, 'offline must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, cloudInitialReady: false }) || '', /chưa sẵn sàng/, 'cloud snapshot not ready must fail closed');
assert.match(getHealthCenterRepairBlockReason({ ...safeSync, snapshotReadyCount: 8 }) || '', /8\/9/, 'partial realtime snapshot must fail closed');

console.log('Health Center Repair Preview Golden: PASS');
