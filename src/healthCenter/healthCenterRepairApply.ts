import type { HealthCenterRepairOperation, HealthCenterRepairPreview, HealthCenterRepairTarget } from './healthCenterRepair';

export interface HealthCenterRepairBackupPayload {
  format: 'HNL-QLTC-HEALTH-CENTER-REPAIR-BACKUP';
  schemaVersion: 1;
  projectId: string;
  auditSnapshotId: string;
  createdAt: number;
  operations: HealthCenterRepairOperation[];
  records: Partial<Record<HealthCenterRepairTarget, unknown[]>>;
}

export interface HealthCenterRepairApplyFailure {
  operationId: string;
  ruleId: string;
  target: HealthCenterRepairTarget;
  entityId: string;
  path: string;
  reason: 'RECORD_NOT_FOUND' | 'BEFORE_VALUE_CHANGED' | 'PATH_INVALID' | 'BATCH_BLOCKED';
  expectedBefore?: unknown;
  actualBefore?: unknown;
}

export interface HealthCenterRepairApplyResult<TData = any> {
  ok: boolean;
  data: TData;
  appliedOperationIds: string[];
  failures: HealthCenterRepairApplyFailure[];
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function getPathValue(record: any, path: string): { valid: boolean; value: unknown } {
  const parts = path.split('.').filter(Boolean);
  let current = record;
  for (const part of parts) {
    if (current === null || current === undefined) return { valid: false, value: undefined };
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { valid: false, value: undefined };
      current = current[index];
      continue;
    }
    if (typeof current !== 'object' || !(part in current)) {
      // Top-level missing durable fields are valid repair targets; nested missing paths are not.
      if (parts.length === 1 && current && typeof current === 'object') return { valid: true, value: undefined };
      return { valid: false, value: undefined };
    }
    current = current[part];
  }
  return { valid: true, value: current };
}

function setPathValue(record: any, path: string, nextValue: unknown): boolean {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return false;
  let current = record;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object' || !(part in current)) return false;
    current = current[part];
  }
  const finalPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const index = Number(finalPart);
    if (!Number.isInteger(index) || index < 0 || index >= current.length) return false;
    current[index] = nextValue;
    return true;
  }
  if (!current || typeof current !== 'object') return false;
  current[finalPart] = nextValue;
  return true;
}

function recordsForTarget(data: any, target: HealthCenterRepairTarget): any[] {
  const value = data?.[target];
  return Array.isArray(value) ? value : [];
}

export function buildHealthCenterRepairBackupPayload(input: {
  projectId: string;
  preview: HealthCenterRepairPreview;
  fullAppData: any;
  createdAt?: number;
}): HealthCenterRepairBackupPayload {
  const { projectId, preview, fullAppData } = input;
  const records: Partial<Record<HealthCenterRepairTarget, unknown[]>> = {};
  const targets = Array.from(new Set(preview.operations.map((op) => op.target)));
  targets.forEach((target) => {
    const ids = new Set(preview.operations.filter((op) => op.target === target).map((op) => op.entityId));
    records[target] = recordsForTarget(fullAppData, target)
      .filter((record) => ids.has(String(record?.id || '')))
      .map((record) => cloneValue(record));
  });
  return {
    format: 'HNL-QLTC-HEALTH-CENTER-REPAIR-BACKUP',
    schemaVersion: 1,
    projectId,
    auditSnapshotId: preview.auditSnapshotId,
    createdAt: input.createdAt || Date.now(),
    operations: preview.operations.map((op) => cloneValue(op)),
    records,
  };
}

/**
 * Pure in-memory repair application. It NEVER persists data and NEVER partially applies a batch.
 * Every operation first verifies the source record and its expected `before` value. If any check
 * fails, the original data object is returned untouched so the caller can re-audit instead of
 * overwriting concurrent edits from another device/account.
 */
export function applyHealthCenterRepairPreview<TData extends Record<string, any>>(
  fullAppData: TData,
  preview: HealthCenterRepairPreview,
): HealthCenterRepairApplyResult<TData> {
  if (!preview.canApply || preview.blocked.length > 0 || preview.operations.length === 0) {
    return {
      ok: false,
      data: fullAppData,
      appliedOperationIds: [],
      failures: preview.operations.map((op) => ({
        operationId: op.id,
        ruleId: op.ruleId,
        target: op.target,
        entityId: op.entityId,
        path: op.path,
        reason: 'BATCH_BLOCKED' as const,
      })),
    };
  }

  const failures: HealthCenterRepairApplyFailure[] = [];
  preview.operations.forEach((op) => {
    const record = recordsForTarget(fullAppData, op.target).find((item) => String(item?.id || '') === op.entityId);
    if (!record) {
      failures.push({ operationId: op.id, ruleId: op.ruleId, target: op.target, entityId: op.entityId, path: op.path, reason: 'RECORD_NOT_FOUND' });
      return;
    }
    const current = getPathValue(record, op.path);
    if (!current.valid) {
      failures.push({ operationId: op.id, ruleId: op.ruleId, target: op.target, entityId: op.entityId, path: op.path, reason: 'PATH_INVALID' });
      return;
    }
    const normalizedExpectedBefore = op.before === '' && current.value === undefined ? undefined : op.before;
    if (!valuesEqual(current.value, normalizedExpectedBefore)) {
      failures.push({
        operationId: op.id,
        ruleId: op.ruleId,
        target: op.target,
        entityId: op.entityId,
        path: op.path,
        reason: 'BEFORE_VALUE_CHANGED',
        expectedBefore: normalizedExpectedBefore,
        actualBefore: current.value,
      });
    }
  });

  if (failures.length > 0) {
    return { ok: false, data: fullAppData, appliedOperationIds: [], failures };
  }

  const next = cloneValue(fullAppData);
  for (const op of preview.operations) {
    const record = recordsForTarget(next, op.target).find((item) => String(item?.id || '') === op.entityId);
    if (!record || !setPathValue(record, op.path, cloneValue(op.after))) {
      return {
        ok: false,
        data: fullAppData,
        appliedOperationIds: [],
        failures: [{ operationId: op.id, ruleId: op.ruleId, target: op.target, entityId: op.entityId, path: op.path, reason: 'PATH_INVALID' }],
      };
    }
  }

  return { ok: true, data: next, appliedOperationIds: preview.operations.map((op) => op.id), failures: [] };
}
