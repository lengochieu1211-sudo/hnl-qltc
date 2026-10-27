import type { RoomProgressItem, RoomSubItem } from '../types';

/** P9: opt-in migration sidecar. No Cloud calls or implicit migrations here. */
export type RoomSidecarProgress = Pick<RoomSubItem, 'id' | 'status'> &
  Partial<Pick<RoomSubItem, 'inspectionStatus' | 'targetDate' | 'assignedTeam' | 'teamId'>> & {
    projectId: string;
    roomId: string;
    revision?: number;
    updatedAt?: number;
    updatedByUid?: string;
  };

/** ADMIN-owned structural source for a migrated room. Never copy progress from this doc. */
export type RoomSidecarDefinition = Pick<RoomSubItem, 'id' | 'name'> &
  Partial<Pick<RoomSubItem, 'category' | 'workCategoryId' | 'workVolume' | 'volumeUnit' | 'progressWeight'>> & {
    projectId: string;
    roomId: string;
    order: number;
  };

const ROOM_DEFINITION_FIELDS = [
  'name', 'category', 'workCategoryId', 'workVolume', 'volumeUnit', 'progressWeight',
] as const;

export const ROOM_PROGRESS_FIELDS = [
  'status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId',
] as const;

const WORK_STATUSES = new Set(['Chưa làm', 'Đang làm', 'Đã hoàn thành']);
const INSPECTION_STATUSES = new Set(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)']);

/** All-or-nothing parity; never silently fall back to stale embedded progress. */
export function overlayMigratedRoomSubItems(
  room: RoomProgressItem & { subItemProgressMigrated?: boolean },
  projectId: string,
  cloudProgress: readonly RoomSidecarProgress[],
  cloudDefinitions?: readonly RoomSidecarDefinition[],
): RoomProgressItem {
  if (room.subItemProgressMigrated !== true) return room;
  if (!projectId || !room.id || !Array.isArray(room.subItems) || !Array.isArray(cloudProgress)) {
    throw new Error('ROOM_SIDECAR_PARITY_MISSING');
  }
  const base = room.subItems;
  const keys = new Set<string>();
  for (const item of base) {
    if (!item || typeof item.id !== 'string' || !item.id || keys.has(item.id)) {
      throw new Error('ROOM_SIDECAR_DUPLICATE_DEFINITION');
    }
    keys.add(item.id);
  }
  const byId = new Map<string, RoomSidecarProgress>();
  for (const item of cloudProgress) {
    if (!item || item.projectId !== projectId || item.roomId !== room.id ||
        !keys.has(item.id) || byId.has(item.id) || !WORK_STATUSES.has(item.status) ||
        (item.inspectionStatus !== undefined && !INSPECTION_STATUSES.has(item.inspectionStatus))) {
      throw new Error('ROOM_SIDECAR_PARITY_INVALID');
    }
    byId.set(item.id, item);
  }
  if (byId.size !== base.length) throw new Error('ROOM_SIDECAR_PARITY_INCOMPLETE');
  // The structural sidecar is authoritative whenever provided. Never blend an
  // incomplete ADMIN definition snapshot with historical embedded subItems.
  const definitions = new Map<string, RoomSidecarDefinition>();
  const orders = new Set<number>();
  if (cloudDefinitions !== undefined) {
    if (!Array.isArray(cloudDefinitions) || cloudDefinitions.length !== base.length) {
      throw new Error('ROOM_SIDECAR_DEFINITION_PARITY_INCOMPLETE');
    }
    for (const definition of cloudDefinitions) {
      if (!definition || definition.projectId !== projectId || definition.roomId !== room.id ||
          !keys.has(definition.id) || definitions.has(definition.id) ||
          typeof definition.name !== 'string' || !definition.name.trim() ||
          !Number.isSafeInteger(definition.order) || definition.order < 0 ||
          definition.order >= base.length || orders.has(definition.order) ||
          (definition.workVolume !== undefined && (!Number.isFinite(definition.workVolume) || definition.workVolume < 0)) ||
          (definition.progressWeight !== undefined && (!Number.isFinite(definition.progressWeight) || definition.progressWeight < 0))) {
        throw new Error('ROOM_SIDECAR_DEFINITION_PARITY_INVALID');
      }
      definitions.set(definition.id, definition);
      orders.add(definition.order);
    }
  }
  return {
    ...room,
    subItems: base.map((original) => {
      const progress = byId.get(original.id)!;
      const updated: RoomSubItem = { ...original };
      const definition = definitions.get(original.id);
      if (cloudDefinitions !== undefined) {
        if (!definition) throw new Error('ROOM_SIDECAR_DEFINITION_PARITY_MISSING');
        for (const field of ROOM_DEFINITION_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(definition, field)) {
            (updated as any)[field] = definition[field];
          } else {
            delete (updated as any)[field];
          }
        }
      }
      for (const field of ROOM_PROGRESS_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(progress, field)) {
          (updated as any)[field] = progress[field];
        } else if (field !== 'status') {
          // For migrated rooms the sidecar is authoritative: never inherit a
          // deleted/cleared operational field from the legacy embedded array.
          delete (updated as any)[field];
        }
      }
      return updated;
    }).sort((a, b) => cloudDefinitions === undefined ? 0 :
      (definitions.get(a.id)!.order - definitions.get(b.id)!.order)),
  };
}

/** Server request whitelist; unknown or undefined keys are refused, never dropped. */
export function validateRoomSidecarProgressPatch(
  changes: Readonly<Record<string, unknown>>,
): Partial<Pick<RoomSubItem, typeof ROOM_PROGRESS_FIELDS[number]>> {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('ROOM_SIDECAR_INVALID_PATCH');
  }
  const entries = Object.entries(changes);
  if (!entries.length) throw new Error('ROOM_SIDECAR_EMPTY_PATCH');
  const allowed = new Set<string>(ROOM_PROGRESS_FIELDS);
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key) || value === undefined || value === null || typeof value !== 'string') {
      throw new Error('ROOM_SIDECAR_FORBIDDEN_FIELD');
    }
    if (key === 'status' && !WORK_STATUSES.has(value)) throw new Error('ROOM_SIDECAR_INVALID_STATUS');
    if (key === 'inspectionStatus' && !INSPECTION_STATUSES.has(value)) {
      throw new Error('ROOM_SIDECAR_INVALID_INSPECTION');
    }
    if (key === 'targetDate' && value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('ROOM_SIDECAR_INVALID_DATE');
    }
    if (value.length > 1000) throw new Error('ROOM_SIDECAR_FIELD_TOO_LONG');
    result[key] = value;
  }
  return result;
}

/** Compare an EDITOR's room form with the authoritative sidecar overlay.
 * Never turn a structural change, removed subitem or malformed value into a partial progress write.
 */
export function planMigratedRoomProgressEdits(
  authoritative: readonly RoomSubItem[],
  edited: readonly RoomSubItem[],
): Array<{ id: string; changes: ReturnType<typeof validateRoomSidecarProgressPatch> }> {
  if (!Array.isArray(authoritative) || !Array.isArray(edited) || authoritative.length !== edited.length) {
    throw new Error('ROOM_SIDECAR_STRUCTURE_CHANGED');
  }
  const seen = new Set<string>();
  const byId = new Map(edited.map(item => [item?.id, item] as const));
  if (byId.size !== authoritative.length) throw new Error('ROOM_SIDECAR_STRUCTURE_CHANGED');
  const operational = new Set<string>(ROOM_PROGRESS_FIELDS);
  const stable = (value: unknown): string => JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return child;
    return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
  });
  return authoritative.flatMap(original => {
    if (!original?.id || seen.has(original.id)) throw new Error('ROOM_SIDECAR_STRUCTURE_CHANGED');
    seen.add(original.id);
    const next = byId.get(original.id);
    if (!next) throw new Error('ROOM_SIDECAR_STRUCTURE_CHANGED');
    const keys = new Set([...Object.keys(original), ...Object.keys(next)]);
    const changes: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === 'id') continue;
      const oldValue = (original as unknown as Record<string, unknown>)[key];
      const newValue = (next as unknown as Record<string, unknown>)[key];
      if (stable(oldValue) === stable(newValue)) continue;
      if (!operational.has(key)) throw new Error('ROOM_SIDECAR_STRUCTURE_CHANGED');
      changes[key] = newValue;
    }
    return Object.keys(changes).length
      ? [{ id: original.id, changes: validateRoomSidecarProgressPatch(changes) }]
      : [];
  });
}
