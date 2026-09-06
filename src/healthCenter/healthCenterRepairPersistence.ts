import { STATE_KEY_TO_CLOUD_NAME } from '../config/realtimeCollections';
import type { HealthCenterRepairPreview, HealthCenterRepairTarget } from './healthCenterRepair';

export interface HealthCenterRepairPersistencePlan<TData = any> {
  nextData: TData;
  addedOrModified: Record<string, any[]>;
  deletedIds: Record<string, Array<{ id: string; deletedAt: number; revision: number }>>;
  changedRecordCount: number;
}

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const listFor = (data: any, target: HealthCenterRepairTarget): any[] => Array.isArray(data?.[target]) ? data[target] : [];

function assertSameIdentitySet(before: any[], after: any[], target: HealthCenterRepairTarget): void {
  const beforeIds = before.map((item) => String(item?.id || '')).filter(Boolean).sort();
  const afterIds = after.map((item) => String(item?.id || '')).filter(Boolean).sort();
  if (beforeIds.length !== before.length || afterIds.length !== after.length || JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
    throw new Error(`HEALTH_CENTER_REPAIR_SCOPE_VIOLATION: Repair ${target} không được thêm/xóa/đổi ID bản ghi.`);
  }
}

/**
 * Builds the only cloud diff Health Center may persist. It is intentionally narrow:
 * - targets are limited by HealthCenterRepairTarget (defects / crewRecords),
 * - no deletes and no project metadata writes,
 * - only entity IDs present in the preview are emitted,
 * - each emitted record gets a fresh revision/timestamp so normal Firestore conflict
 *   protection can reject a stale repair instead of silently overwriting newer data.
 */
export function buildHealthCenterRepairPersistencePlan<TData extends Record<string, any>>(input: {
  beforeData: TData;
  appliedData: TData;
  preview: HealthCenterRepairPreview;
  now?: number;
  actorUid?: string;
}): HealthCenterRepairPersistencePlan<TData> {
  const { beforeData, appliedData, preview } = input;
  if (!preview.canApply || preview.blocked.length > 0 || preview.operations.length === 0) {
    throw new Error('HEALTH_CENTER_REPAIR_BLOCKED: Preview không đủ điều kiện ghi.');
  }

  const now = Number(input.now || Date.now());
  const actorUid = String(input.actorUid || '').trim();
  const nextData = clone(appliedData);
  const addedOrModified: Record<string, any[]> = {};
  const touchedTargets = Array.from(new Set(preview.operations.map((op) => op.target)));

  for (const target of touchedTargets) {
    const beforeList = listFor(beforeData, target);
    const nextList = listFor(nextData, target);
    assertSameIdentitySet(beforeList, nextList, target);

    const ids = new Set(preview.operations.filter((op) => op.target === target).map((op) => op.entityId));
    const beforeById = new Map(beforeList.map((item) => [String(item.id), item]));
    const changed: any[] = [];

    for (let index = 0; index < nextList.length; index += 1) {
      const item = nextList[index];
      const id = String(item?.id || '');
      if (!ids.has(id)) continue;
      const before = beforeById.get(id);
      if (!before) throw new Error(`HEALTH_CENTER_REPAIR_SCOPE_VIOLATION: Không tìm thấy ${target}:${id} trong snapshot trước sửa.`);
      const stamped = {
        ...item,
        updatedAt: now,
        revision: Math.max(Number(before.revision || 0), Number(item.revision || 0), 0) + 1,
        ...(actorUid ? { updatedByUid: actorUid } : {}),
        deleted: false,
        deletedAt: null,
        deletedByUid: null,
        deletedBy: null,
      };
      nextList[index] = stamped;
      changed.push(stamped);
    }

    if (changed.length !== ids.size) {
      throw new Error(`HEALTH_CENTER_REPAIR_SCOPE_VIOLATION: Preview ${target} tham chiếu bản ghi không tồn tại.`);
    }
    const cloudName = STATE_KEY_TO_CLOUD_NAME[target as keyof typeof STATE_KEY_TO_CLOUD_NAME];
    if (!cloudName) throw new Error(`HEALTH_CENTER_REPAIR_SCOPE_VIOLATION: Không có cloud collection cho ${target}.`);
    addedOrModified[cloudName] = changed;
  }

  return {
    nextData,
    addedOrModified,
    deletedIds: {},
    changedRecordCount: Object.values(addedOrModified).reduce((sum, rows) => sum + rows.length, 0),
  };
}
