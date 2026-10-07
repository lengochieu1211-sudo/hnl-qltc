import { parseLegacyTimestamp } from './dateFormatter';
import { smartMergeProjectData } from './dataNormalizer';

const BACKUP_LIST_ID_FIELDS: Record<string, string[]> = {
  materialNorms: ['id', 'name'],
  inventory: ['id', 'itemName'],
  workVolumes: ['id', 'taskName'],
  floorPlans: ['id', 'floorName'],
  defects: ['id'],
  roomProgressList: ['id', 'roomId'],
  checklist: ['id'],
  crewRecords: ['id'],
  teams: ['id', 'name'],
};

const getStableItemId = (item: any, idFields: string[]): string => {
  for (const field of idFields) {
    const value = item?.[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return '';
};

const getMergedTombstoneTime = (
  cloud: Record<string, any>,
  local: Record<string, any>,
  keyName: string,
  id: string,
): number => {
  const cloudTombstones =
    cloud.tombstones && typeof cloud.tombstones === 'object' && !Array.isArray(cloud.tombstones)
      ? cloud.tombstones
      : {};
  const localTombstones =
    local.tombstones && typeof local.tombstones === 'object' && !Array.isArray(local.tombstones)
      ? local.tombstones
      : {};

  return Math.max(
    parseLegacyTimestamp(cloudTombstones[`${keyName}_${id}`] ?? cloudTombstones[id], 0),
    parseLegacyTimestamp(localTombstones[`${keyName}_${id}`] ?? localTombstones[id], 0),
  );
};

/**
 * Cloud-only active rows are ambiguous during backup.
 *
 * They can mean either:
 *  - the local device is stale and has not received a legitimate newer row yet, or
 *  - Firestore still contains a historical/orphan row that the current live UI no longer
 *    considers active.
 *
 * A backup must not guess between those cases. Automatically unioning Cloud-only rows can
 * resurrect historical Defects (or other business rows) into JSON. Instead, fail closed and
 * require the live state to converge first. A newer tombstone is explicit deletion evidence
 * and is therefore safe.
 */
const assertNoAmbiguousCloudOnlyRows = (
  cloud: Record<string, any>,
  local: Record<string, any>,
): void => {
  const conflicts: Array<{ keyName: string; ids: string[] }> = [];

  for (const [keyName, idFields] of Object.entries(BACKUP_LIST_ID_FIELDS)) {
    const cloudList = Array.isArray(cloud[keyName]) ? cloud[keyName] : [];
    const localList = Array.isArray(local[keyName]) ? local[keyName] : [];

    const localIds = new Set(
      localList
        .map((item: any) => getStableItemId(item, idFields))
        .filter(Boolean),
    );

    const ambiguousIds: string[] = [];

    for (const item of cloudList) {
      if (!item || item.deleted || item.isDeleted) continue;

      const id = getStableItemId(item, idFields);
      if (!id || localIds.has(id)) continue;

      const itemTime = parseLegacyTimestamp(item.deletedAt || item.updatedAt || item.date, 0);
      const tombstoneTime = getMergedTombstoneTime(cloud, local, keyName, id);

      if (tombstoneTime > itemTime) continue;
      ambiguousIds.push(id);
    }

    if (ambiguousIds.length > 0) {
      conflicts.push({ keyName, ids: ambiguousIds });
    }
  }

  if (conflicts.length === 0) return;

  const details = conflicts
    .map(({ keyName, ids }) => {
      const sample = ids.slice(0, 3).join(', ');
      return `${keyName}: ${ids.length} bản ghi${sample ? ` (${sample}${ids.length > 3 ? ', …' : ''})` : ''}`;
    })
    .join('; ');

  throw new Error(
    `Bản sao lưu Cloud/cục bộ chưa đồng bộ an toàn: ${details} chỉ có trên Firestore nhưng không có trong trạng thái trực tiếp hiện tại. ` +
      'Hệ thống từ chối tự phục hồi các bản ghi mơ hồ để tránh hồi sinh dữ liệu lịch sử. Hãy chờ đồng bộ/tải lại dự án rồi tạo bản sao lưu lại.',
  );
};

/**
 * Build a data-loss-safe backup snapshot from the verified Cloud payload plus
 * the current live React state.
 *
 * The server snapshot is used to verify completeness and reconcile rows that exist on
 * both sides, but Cloud-only active rows are never silently injected into a backup.
 * Newer local edits remain eligible to win, while tombstones prevent intentional deletes
 * from being resurrected.
 *
 * smartMergeProjectData() intentionally advances top-level updatedAt for a live merge.
 * A backup must not do that: export time is not business-data time, otherwise importing
 * an older backup later could look newer than the records it actually contains.
 */
export function reconcileBackupSnapshot(
  cloudPayload: Record<string, any> | null | undefined,
  localSnapshot: Record<string, any> | null | undefined,
): Record<string, any> {
  const cloud = cloudPayload && typeof cloudPayload === 'object' ? cloudPayload : {};
  const local = localSnapshot && typeof localSnapshot === 'object' ? localSnapshot : {};

  assertNoAmbiguousCloudOnlyRows(cloud, local);

  const merged = smartMergeProjectData(cloud, local);

  merged.updatedAt = Math.max(
    parseLegacyTimestamp(cloud.updatedAt, 0),
    parseLegacyTimestamp(local.updatedAt, 0),
  );

  return merged;
}
