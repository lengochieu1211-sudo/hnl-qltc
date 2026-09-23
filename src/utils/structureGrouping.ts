import type { CrewRecord, FloorPlan, StructureGroup, StructureGroupingConfig } from '../types';

export const UNGROUPED_STRUCTURE_GROUP_ID = '__ungrouped__';
export const MIXED_STRUCTURE_GROUP_ID = '__mixed__';

export const DEFAULT_STRUCTURE_GROUPING: StructureGroupingConfig = Object.freeze({
  enabled: false,
  label: 'Khu/Khối',
  groups: [],
});

const clean = (value: unknown): string => String(value || '').trim();

export function normalizeStructureGrouping(raw?: Partial<StructureGroupingConfig> | null): StructureGroupingConfig {
  const label = clean(raw?.label).slice(0, 30) || 'Khu/Khối';
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const groups: StructureGroup[] = [];

  for (const item of Array.isArray(raw?.groups) ? raw!.groups! : []) {
    const id = clean(item?.id);
    const name = clean(item?.name).slice(0, 60);
    const nameKey = name.toLocaleLowerCase('vi-VN');
    if (!id || !name || usedIds.has(id) || usedNames.has(nameKey)) continue;
    usedIds.add(id);
    usedNames.add(nameKey);
    groups.push({
      id,
      name,
      order: Number.isFinite(Number(item?.order)) ? Number(item?.order) : groups.length,
    });
  }

  groups.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)
    || a.name.localeCompare(b.name, 'vi-VN', { numeric: true, sensitivity: 'base' }));

  return { enabled: raw?.enabled === true, label, groups };
}

export function structureGroupName(
  groupId: string | undefined,
  config?: StructureGroupingConfig | null,
): string {
  const normalized = normalizeStructureGrouping(config);
  if (!normalized.enabled) return '';
  if (groupId === MIXED_STRUCTURE_GROUP_ID) return `Nhiều ${normalized.label} · cần kiểm tra`;
  if (!groupId || groupId === UNGROUPED_STRUCTURE_GROUP_ID) return `Chưa phân ${normalized.label.toLocaleLowerCase('vi-VN')}`;
  return normalized.groups.find((group) => group.id === groupId)?.name
    || `${normalized.label} không còn tồn tại`;
}

export function structureGroupIdForFloor(
  floor: Pick<FloorPlan, 'structureGroupId'> | null | undefined,
  config?: StructureGroupingConfig | null,
): string {
  const normalized = normalizeStructureGrouping(config);
  if (!normalized.enabled) return '';
  const id = clean(floor?.structureGroupId);
  if (!id) return UNGROUPED_STRUCTURE_GROUP_ID;
  return normalized.groups.some((group) => group.id === id) ? id : MIXED_STRUCTURE_GROUP_ID;
}

export function structureGroupForFloor(
  floor: Pick<FloorPlan, 'structureGroupId'> | null | undefined,
  config?: StructureGroupingConfig | null,
): { id: string; name: string } {
  const id = structureGroupIdForFloor(floor, config);
  return { id, name: structureGroupName(id, config) };
}

export function floorIdsForStructureGroups(
  floorPlans: FloorPlan[],
  config: StructureGroupingConfig | null | undefined,
  groupIds: string[],
): string[] {
  const normalized = normalizeStructureGrouping(config);
  if (!normalized.enabled || groupIds.length === 0) return [];
  const wanted = new Set(groupIds);
  return floorPlans
    .filter((floor) => wanted.has(structureGroupIdForFloor(floor, normalized)))
    .map((floor) => floor.id);
}

export function resolveCrewRecordStructureGroup(
  record: CrewRecord,
  floorPlans: FloorPlan[],
  config?: StructureGroupingConfig | null,
): { id: string; name: string; ambiguous: boolean } {
  const normalized = normalizeStructureGrouping(config);
  if (!normalized.enabled) return { id: '', name: '', ambiguous: false };

  const explicit = clean(record.structureGroupId);
  if (explicit) {
    const exists = normalized.groups.some((group) => group.id === explicit);
    if (exists) return { id: explicit, name: structureGroupName(explicit, normalized), ambiguous: false };
    return {
      id: MIXED_STRUCTURE_GROUP_ID,
      name: structureGroupName(MIXED_STRUCTURE_GROUP_ID, normalized),
      ambiguous: true,
    };
  }

  const floorById = new Map(floorPlans.map((floor) => [floor.id, floor] as const));
  const referencedFloorIds = new Set<string>();
  if (record.floorId) referencedFloorIds.add(record.floorId);
  for (const floorWork of record.floorWorks || []) {
    if (floorWork.floorId) referencedFloorIds.add(floorWork.floorId);
  }

  const resolved = new Set<string>();
  for (const floorId of referencedFloorIds) {
    const floor = floorById.get(floorId);
    if (!floor) {
      resolved.add(MIXED_STRUCTURE_GROUP_ID);
      continue;
    }
    resolved.add(structureGroupIdForFloor(floor, normalized));
  }

  if (resolved.size === 0) {
    return {
      id: UNGROUPED_STRUCTURE_GROUP_ID,
      name: structureGroupName(UNGROUPED_STRUCTURE_GROUP_ID, normalized),
      ambiguous: false,
    };
  }
  if (resolved.size === 1) {
    const id = Array.from(resolved)[0];
    return { id, name: structureGroupName(id, normalized), ambiguous: id === MIXED_STRUCTURE_GROUP_ID };
  }
  return {
    id: MIXED_STRUCTURE_GROUP_ID,
    name: structureGroupName(MIXED_STRUCTURE_GROUP_ID, normalized),
    ambiguous: true,
  };
}

export function orderedStructureGroups(
  config?: StructureGroupingConfig | null,
  options: { includeUngrouped?: boolean; includeMixed?: boolean } = {},
): Array<{ id: string; name: string }> {
  const normalized = normalizeStructureGrouping(config);
  if (!normalized.enabled) return [];
  const rows = normalized.groups.map((group) => ({ id: group.id, name: group.name }));
  if (options.includeUngrouped) rows.push({
    id: UNGROUPED_STRUCTURE_GROUP_ID,
    name: structureGroupName(UNGROUPED_STRUCTURE_GROUP_ID, normalized),
  });
  if (options.includeMixed) rows.push({
    id: MIXED_STRUCTURE_GROUP_ID,
    name: structureGroupName(MIXED_STRUCTURE_GROUP_ID, normalized),
  });
  return rows;
}
