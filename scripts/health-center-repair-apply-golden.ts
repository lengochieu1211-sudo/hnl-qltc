import assert from 'node:assert/strict';
import { applyHealthCenterRepairPreview, buildHealthCenterRepairBackupPayload } from '../src/healthCenter/healthCenterRepairApply';
import type { HealthCenterRepairPreview } from '../src/healthCenter/healthCenterRepair';

const preview: HealthCenterRepairPreview = {
  auditSnapshotId: 'hc-1',
  generatedAt: 1,
  sourceIssueCount: 4,
  operations: [
    { id: 'op1', issueId: 'i1', ruleId: 'DEFECT_ROOM_ID_MISSING', target: 'defects', entityId: 'd1', kind: 'SET_FIELD', path: 'roomId', before: '', after: 'r1', reason: 'unique room', confidence: 'deterministic-unique', requiresBackup: true },
    { id: 'op2', issueId: 'i2', ruleId: 'DEFECT_TEAM_ID_MISSING', target: 'defects', entityId: 'd1', kind: 'SET_FIELD', path: 'teamId', before: '', after: 't1', reason: 'unique team', confidence: 'deterministic-unique', requiresBackup: true },
    { id: 'op3', issueId: 'i3', ruleId: 'CREW_FLOOR_ID_NAME_MISMATCH', target: 'crewRecords', entityId: 'c1', kind: 'SET_FIELD', path: 'floorName', before: 'Tang 1', after: 'Tầng 1', reason: 'canonical floor name', confidence: 'deterministic-unique', requiresBackup: true },
    { id: 'op4', issueId: 'i4', ruleId: 'CREW_FLOOR_WORK_NAME_MISMATCH', target: 'crewRecords', entityId: 'c1', kind: 'SET_NESTED_FIELD', path: 'floorWorks.0.floorName', before: 'Tang 1', after: 'Tầng 1', reason: 'canonical floor work name', confidence: 'deterministic-unique', requiresBackup: true },
  ],
  blocked: [],
  requiresBackup: true,
  requiresConfirmation: true,
  canApply: true,
};

const source = {
  defects: [{ id: 'd1', description: 'D1' }],
  crewRecords: [{ id: 'c1', floorName: 'Tang 1', floorWorks: [{ floorId: 'f1', floorName: 'Tang 1' }] }],
  untouched: [{ id: 'x1', value: 7 }],
};

const backup = buildHealthCenterRepairBackupPayload({ projectId: 'p1', preview, fullAppData: source, createdAt: 99 });
assert.equal(backup.format, 'HNL-QLTC-HEALTH-CENTER-REPAIR-BACKUP');
assert.equal(backup.auditSnapshotId, 'hc-1');
assert.equal(backup.createdAt, 99);
assert.equal(backup.records.defects?.length, 1);
assert.equal(backup.records.crewRecords?.length, 1);
assert.notEqual(backup.records.defects?.[0], source.defects[0], 'backup must hold cloned before-image records');

const result = applyHealthCenterRepairPreview(source, preview);
assert.equal(result.ok, true);
assert.equal(result.failures.length, 0);
assert.equal(result.appliedOperationIds.length, 4);
assert.equal(result.data.defects[0].roomId, 'r1');
assert.equal(result.data.defects[0].teamId, 't1');
assert.equal(result.data.crewRecords[0].floorName, 'Tầng 1');
assert.equal(result.data.crewRecords[0].floorWorks[0].floorName, 'Tầng 1');
assert.equal(result.data.untouched[0].value, 7);
assert.equal((source.defects[0] as any).roomId, undefined, 'pure apply must not mutate source data');
assert.equal(source.crewRecords[0].floorName, 'Tang 1', 'pure apply must not mutate source nested records');

const concurrentlyEdited = {
  ...source,
  crewRecords: [{ ...source.crewRecords[0], floorName: 'Tầng 01 - user edited' }],
};
const conflict = applyHealthCenterRepairPreview(concurrentlyEdited, preview);
assert.equal(conflict.ok, false);
assert.equal(conflict.appliedOperationIds.length, 0, 'conflict must make whole batch atomic/fail-closed');
assert.ok(conflict.failures.some((f) => f.reason === 'BEFORE_VALUE_CHANGED'));
assert.equal((conflict.data.defects[0] as any).roomId, undefined, 'no earlier operation may leak through after later conflict');

const missingRecord = applyHealthCenterRepairPreview({ ...source, defects: [] }, preview);
assert.equal(missingRecord.ok, false);
assert.ok(missingRecord.failures.some((f) => f.reason === 'RECORD_NOT_FOUND'));

const blocked: HealthCenterRepairPreview = { ...preview, canApply: false, blocked: [{ issueId: 'x', ruleId: 'ROOM_FLOOR_NOT_FOUND', entityId: 'r1', reason: 'manual' }] };
const blockedResult = applyHealthCenterRepairPreview(source, blocked);
assert.equal(blockedResult.ok, false);
assert.ok(blockedResult.failures.every((f) => f.reason === 'BATCH_BLOCKED'));

const invalidNested: HealthCenterRepairPreview = {
  ...preview,
  operations: [{ ...preview.operations[3], path: 'floorWorks.9.floorName' }],
  blocked: [],
  canApply: true,
};
const invalidResult = applyHealthCenterRepairPreview(source, invalidNested);
assert.equal(invalidResult.ok, false);
assert.equal(invalidResult.failures[0].reason, 'PATH_INVALID');

console.log('Health Center Repair Apply Golden: PASS');
