/**
 * Project Trash restoration policy. No warehouse delta is ever applied here:
 * warehouse vouchers have a separate stock-locked restore transaction.
 * Other stand-alone catalogs / chat / project root have their own lifecycles.
 */
export const TRASH_RECOVERY_CLOUD_COLLECTIONS = {
  materialNorms: 'material_norms',
  workVolumes: 'work_volumes',
  floorPlans: 'floor_plans',
  defects: 'defects',
  roomProgressList: 'rooms',
  checklist: 'checklist',
  crewRecords: 'crew_records',
  teams: 'teams',
} as const;

export type GenericTrashRecoverableCollection = keyof typeof TRASH_RECOVERY_CLOUD_COLLECTIONS;

/** Only references detached by room/floor deletion, never entire stale rows. */
export const TRASH_RELATED_LINK_FIELDS: Partial<Record<GenericTrashRecoverableCollection, readonly string[]>> = {
  defects: ['roomId', 'floorId', 'archivedAt', 'archivedFloorId', 'archivedFloorName', 'positionDetail'],
  checklist: ['roomId', 'floorId', 'archivedAt', 'archivedFloorId', 'archivedFloorName', 'notes'],
  workVolumes: ['floorId', 'floorIds', 'floor'],
  crewRecords: ['floorId', 'floorName', 'floorWorks'],
  floorPlans: ['order'],
};

export function isGenericTrashRecoverableCollection(key: string): key is GenericTrashRecoverableCollection {
  return Object.prototype.hasOwnProperty.call(TRASH_RECOVERY_CLOUD_COLLECTIONS, key);
}

export function planTrashRestore(
  operation: { projectId?: string; deletedAt?: number; expiresAt?: number; deletedItems?: Array<{ collection: string; entityId: string; snapshot?: any }>; relatedBefore?: Partial<Record<string, any[]>> },
  projectId: string,
  now = Date.now(),
): { targets: Array<{ collection: GenericTrashRecoverableCollection; entityId: string }>; related: Array<{ collection: GenericTrashRecoverableCollection; entityId: string; before: any }> } {
  if (!projectId || operation.projectId !== projectId) throw new Error('TRASH_RECOVERY_PROJECT_MISMATCH');
  if (!Number.isFinite(Number(operation.expiresAt)) || Number(operation.expiresAt) <= now) throw new Error('TRASH_RECOVERY_EXPIRED');
  if (!Array.isArray(operation.deletedItems) || operation.deletedItems.length === 0) throw new Error('TRASH_RECOVERY_EMPTY_OPERATION');

  const targets: Array<{ collection: GenericTrashRecoverableCollection; entityId: string }> = [];
  const seen = new Set<string>();
  for (const item of operation.deletedItems) {
    if (item.collection === 'inventory') throw new Error('TRASH_RECOVERY_WAREHOUSE_REQUIRES_ATOMIC_LEDGER');
    if (!isGenericTrashRecoverableCollection(item.collection)) throw new Error(`TRASH_RECOVERY_UNSUPPORTED_COLLECTION:${item.collection}`);
    if (!item.entityId || typeof item.entityId !== 'string' || item.entityId.includes('/')) throw new Error('TRASH_RECOVERY_INVALID_ID');
    const key = `${item.collection}:${item.entityId}`;
    if (seen.has(key)) throw new Error('TRASH_RECOVERY_DUPLICATE_ID');
    seen.add(key);
    targets.push({ collection: item.collection, entityId: item.entityId });
  }

  const related: Array<{ collection: GenericTrashRecoverableCollection; entityId: string; before: any }> = [];
  for (const [collection, rows] of Object.entries(operation.relatedBefore || {})) {
    if (!isGenericTrashRecoverableCollection(collection)) throw new Error(`TRASH_RECOVERY_UNSUPPORTED_RELATED:${collection}`);
    if (!Array.isArray(rows)) throw new Error('TRASH_RECOVERY_INVALID_RELATED');
    for (const before of rows) {
      const id = String(before?.id || '');
      if (!id || id.includes('/')) throw new Error('TRASH_RECOVERY_INVALID_RELATED_ID');
      const key = `${collection}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      related.push({ collection, entityId: id, before });
    }
  }
  // Defensive upper bound for transaction limits, nested large floor-deletion operations.
  if (seen.size > 150) throw new Error('TRASH_RECOVERY_TOO_MANY_RECORDS_FOR_ONE_TRANSACTION');
  return { targets, related };
}
