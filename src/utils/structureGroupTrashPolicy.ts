import type { FloorPlan } from '../types';
import { normalizeStructureGroupConfig, resolveFloorStructureGroupId, type ProjectStructureConfig, type StructureGroupInfo } from './structureGroupUtils';

/** Structures are settings metadata, not a tenth business collection. Never
 * remove a group with any floor reference, including deleted/tombstone floors. */
export function planEmptyStructureGroupDelete(
  raw: ProjectStructureConfig, groupId: string, floors: Array<Pick<FloorPlan, 'structureGroupId'>>,
): { deleted: StructureGroupInfo; next: ProjectStructureConfig } {
  const config = normalizeStructureGroupConfig(raw);
  if (!config.enabled) throw new Error('STRUCTURE_TRASH_GROUPING_DISABLED');
  if (!groupId || groupId.includes('/')) throw new Error('STRUCTURE_TRASH_INVALID_GROUP');
  const deleted = config.groups.find((group) => group.id === groupId);
  if (!deleted) throw new Error('STRUCTURE_TRASH_GROUP_NOT_FOUND');
  if (config.groups.length <= 1) throw new Error('STRUCTURE_TRASH_LAST_GROUP');
  if (floors.some((floor) => resolveFloorStructureGroupId(floor, config) === groupId)) {
    throw new Error('STRUCTURE_TRASH_GROUP_HAS_FLOOR_REFERENCES');
  }
  const remaining = config.groups.filter((group) => group.id !== groupId)
    .map((group, index) => ({ ...group, order: index }));
  return {
    deleted,
    next: normalizeStructureGroupConfig({
      ...config, groups: remaining,
      defaultGroupId: config.defaultGroupId === groupId ? remaining[0].id : config.defaultGroupId,
    }),
  };
}

export function planRestoreStructureGroup(
  raw: ProjectStructureConfig, snapshot: StructureGroupInfo,
): ProjectStructureConfig {
  const config = normalizeStructureGroupConfig(raw);
  const id = String(snapshot?.id || '').trim();
  const name = String(snapshot?.name || '').trim();
  if (!id || id.includes('/') || !name || name.length > 80) throw new Error('STRUCTURE_TRASH_INVALID_SNAPSHOT');
  if (config.groups.some((group) => group.id === id)) throw new Error('STRUCTURE_TRASH_GROUP_ID_ALREADY_EXISTS');
  if (config.groups.some((group) => group.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
    throw new Error('STRUCTURE_TRASH_GROUP_NAME_ALREADY_EXISTS');
  }
  const index = Number.isFinite(Number(snapshot.order))
    ? Math.max(0, Math.min(config.groups.length, Math.floor(Number(snapshot.order)))) : config.groups.length;
  const nextGroups = [...config.groups];
  nextGroups.splice(index, 0, { id, name, order: index });
  // Other groups preserve their relative order. Restored group retains its ID.
  return normalizeStructureGroupConfig({
    ...config, groups: nextGroups.map((group, i) => ({ ...group, order: i })),
  });
}
