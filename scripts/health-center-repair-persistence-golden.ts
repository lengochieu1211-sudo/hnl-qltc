import assert from 'node:assert/strict';
import { buildHealthCenterRepairPersistencePlan } from '../src/healthCenter/healthCenterRepairPersistence';
import type { HealthCenterRepairPreview } from '../src/healthCenter/healthCenterRepair';

const preview: HealthCenterRepairPreview = {
  auditSnapshotId: 'audit-1',
  generatedAt: 1,
  sourceIssueCount: 2,
  requiresBackup: true,
  requiresConfirmation: true,
  canApply: true,
  blocked: [],
  operations: [
    {
      id: 'op-def', issueId: 'i1', ruleId: 'DEFECT_TEAM_ID_MISSING', target: 'defects', entityId: 'DEF-1', kind: 'SET_FIELD', path: 'teamId', before: '', after: 'TEAM-1', reason: 'golden', confidence: 'deterministic-unique', requiresBackup: true,
    },
    {
      id: 'op-crew', issueId: 'i2', ruleId: 'CREW_TEAM_ID_MISSING', target: 'crewRecords', entityId: 'CREW-1', kind: 'SET_FIELD', path: 'teamId', before: '', after: 'TEAM-1', reason: 'golden', confidence: 'deterministic-unique', requiresBackup: true,
    },
  ],
};

const before = {
  projectName: 'P', contractorName: 'C', inspectorName: 'I',
  defects: [{ id: 'DEF-1', description: 'x', teamId: '', revision: 4, updatedAt: 100 }],
  crewRecords: [{ id: 'CREW-1', teamName: 'Đội A', teamId: '', revision: 2, updatedAt: 100 }],
};
const applied = {
  ...before,
  defects: [{ ...before.defects[0], teamId: 'TEAM-1' }],
  crewRecords: [{ ...before.crewRecords[0], teamId: 'TEAM-1' }],
};

const plan = buildHealthCenterRepairPersistencePlan({ beforeData: before, appliedData: applied, preview, now: 500, actorUid: 'uid-admin' });
assert.equal(plan.changedRecordCount, 2);
assert.equal(plan.deletedIds && Object.keys(plan.deletedIds).length, 0);
assert.equal(plan.addedOrModified.defects.length, 1);
assert.equal(plan.addedOrModified.crew_records.length, 1);
assert.equal(plan.addedOrModified.defects[0].revision, 5);
assert.equal(plan.addedOrModified.crew_records[0].revision, 3);
assert.equal(plan.addedOrModified.defects[0].updatedAt, 500);
assert.equal(plan.addedOrModified.defects[0].updatedByUid, 'uid-admin');
assert.equal(plan.nextData.projectName, 'P');

assert.throws(() => buildHealthCenterRepairPersistencePlan({
  beforeData: before,
  appliedData: { ...applied, defects: [...applied.defects, { id: 'DEF-NEW' }] },
  preview,
}), /SCOPE_VIOLATION/);

assert.throws(() => buildHealthCenterRepairPersistencePlan({
  beforeData: before,
  appliedData: applied,
  preview: { ...preview, canApply: false },
}), /REPAIR_BLOCKED/);

console.log('health-center-repair-persistence-golden: PASS');
