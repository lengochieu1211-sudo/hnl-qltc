import assert from 'node:assert/strict';
import type { HealthCenterRepairPreview } from '../src/healthCenter/healthCenterRepair';
import { commitHealthCenterRepair } from '../src/healthCenter/healthCenterRepairCommit';

const preview: HealthCenterRepairPreview = {
  auditSnapshotId: 'audit-1',
  generatedAt: 1,
  sourceIssueCount: 1,
  operations: [{
    id: 'op-1',
    issueId: 'issue-1',
    ruleId: 'DEFECT_TEAM_ID_MISSING',
    target: 'defects',
    entityId: 'd1',
    kind: 'SET_FIELD',
    path: 'teamId',
    before: '',
    after: 'team-1',
    reason: 'deterministic fixture',
    confidence: 'deterministic-unique',
    requiresBackup: true,
  }],
  blocked: [],
  requiresBackup: true,
  requiresConfirmation: true,
  canApply: true,
};

const report = { auditSnapshotId: 'audit-1' } as any;
const source = { defects: [{ id: 'd1', teamId: '', description: 'keep-me' }], crewRecords: [] };

// Non-admin must fail before backup/confirm/persist.
{
  const calls: string[] = [];
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'EDITOR', accessVerified: true, currentReport: report, preview, fullAppData: source,
    saveBackup: async () => { calls.push('backup'); },
    confirmApply: () => { calls.push('confirm'); return true; },
    persist: async () => { calls.push('persist'); },
  });
  assert.equal(result.status, 'denied');
  assert.deepEqual(calls, []);
}

// Stale audit snapshot must fail closed before backup.
{
  const calls: string[] = [];
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'ADMIN', accessVerified: true,
    currentReport: { auditSnapshotId: 'audit-new' } as any,
    preview, fullAppData: source,
    saveBackup: async () => { calls.push('backup'); },
    confirmApply: () => true,
    persist: async () => { calls.push('persist'); },
  });
  assert.equal(result.status, 'stale');
  assert.deepEqual(calls, []);
}

// Backup is mandatory. A failed backup must prevent confirmation and persistence.
{
  const calls: string[] = [];
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'ADMIN', accessVerified: true, currentReport: report, preview, fullAppData: source,
    saveBackup: async () => { calls.push('backup'); throw new Error('disk denied'); },
    confirmApply: () => { calls.push('confirm'); return true; },
    persist: async () => { calls.push('persist'); },
  });
  assert.equal(result.status, 'backup-failed');
  assert.deepEqual(calls, ['backup']);
}

// ADMIN cancellation after backup must leave data untouched and skip persistence.
{
  const calls: string[] = [];
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'ADMIN', accessVerified: true, currentReport: report, preview, fullAppData: source,
    saveBackup: async (backup) => {
      calls.push('backup');
      assert.equal((backup.records.defects?.[0] as any)?.teamId, '');
    },
    confirmApply: () => { calls.push('confirm'); return false; },
    persist: async () => { calls.push('persist'); },
  });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(calls, ['backup', 'confirm']);
  assert.equal(source.defects[0].teamId, '');
}

// Concurrent/stale before-value change must cancel the whole batch with no partial mutation/persist.
{
  const calls: string[] = [];
  const changed = { defects: [{ id: 'd1', teamId: 'team-other', description: 'keep-me' }], crewRecords: [] };
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'ADMIN', accessVerified: true, currentReport: report, preview, fullAppData: changed,
    saveBackup: async () => { calls.push('backup'); },
    confirmApply: () => { calls.push('confirm'); return true; },
    persist: async () => { calls.push('persist'); },
  });
  assert.equal(result.status, 'validation-failed');
  assert.equal(result.failures[0]?.reason, 'BEFORE_VALUE_CHANGED');
  assert.deepEqual(calls, ['backup', 'confirm']);
  assert.equal(changed.defects[0].teamId, 'team-other');
}

// Happy path: backup -> confirm -> immutable apply -> canonical persistence callback.
{
  const calls: string[] = [];
  let persisted: any = null;
  const result = await commitHealthCenterRepair({
    projectId: 'p1', userRole: 'ADMIN', accessVerified: true, currentReport: report, preview, fullAppData: source,
    saveBackup: async (backup) => {
      calls.push('backup');
      assert.equal(backup.auditSnapshotId, 'audit-1');
      assert.equal((backup.records.defects?.[0] as any)?.teamId, '');
      assert.equal((backup.records.defects?.[0] as any)?.description, 'keep-me');
    },
    confirmApply: () => { calls.push('confirm'); return true; },
    persist: async (next) => { calls.push('persist'); persisted = next; },
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['backup', 'confirm', 'persist']);
  assert.equal(source.defects[0].teamId, '', 'source must stay immutable');
  assert.equal(persisted.defects[0].teamId, 'team-1');
  assert.equal(persisted.defects[0].description, 'keep-me');
  assert.deepEqual(result.appliedOperationIds, ['op-1']);
}

console.log('HNL Health Center Repair Commit Golden: PASS');
