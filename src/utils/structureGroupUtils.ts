import type { FloorPlan } from '../types';

export const DEFAULT_STRUCTURE_GROUP_LABEL = 'Khu / Khối';
export const DEFAULT_STRUCTURE_GROUP_ID = 'structure-default';

export interface StructureGroupInfo {
  id: string;
  name: string;
  order?: number;
}

export interface ProjectStructureConfig {
  enabled: boolean;
  label: string;
  groups: StructureGroupInfo[];
  defaultGroupId: string;
}

const cleanText = (value: unknown) => String(value || '').trim();

export function normalizeStructureGroupLabel(value: unknown): string {
  const text = cleanText(value).slice(0, 32);
  return text || DEFAULT_STRUCTURE_GROUP_LABEL;
}

export function normalizeStructureGroupConfig(raw: unknown): ProjectStructureConfig {
  const source = raw && typeof raw === 'object' ? raw as any : {};
  const label = normalizeStructureGroupLabel(source.label);
  const seen = new Set<string>();
  const groups: StructureGroupInfo[] = Array.isArray(source.groups)
    ? source.groups
        .map((item: any, index: number) => ({
          id: cleanText(item?.id),
          name: cleanText(item?.name).slice(0, 80),
          order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
        }))
        .filter((item: StructureGroupInfo) => {
          if (!item.id || !item.name || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .sort((a: StructureGroupInfo, b: StructureGroupInfo) => Number(a.order || 0) - Number(b.order || 0))
    : [];

  const defaultCandidate = cleanText(source.defaultGroupId);
  const defaultGroupId = groups.some((item) => item.id === defaultCandidate)
    ? defaultCandidate
    : (groups[0]?.id || DEFAULT_STRUCTURE_GROUP_ID);

  const normalizedGroups = groups.length > 0
    ? groups
    : [{ id: DEFAULT_STRUCTURE_GROUP_ID, name: 'Khu mặc định', order: 0 }];

  return {
    enabled: source.enabled === true,
    label,
    groups: normalizedGroups,
    defaultGroupId: normalizedGroups.some((item) => item.id === defaultGroupId)
      ? defaultGroupId
      : normalizedGroups[0].id,
  };
}

export const DEFAULT_STRUCTURE_CONFIG: ProjectStructureConfig = normalizeStructureGroupConfig(null);

export function createStructureGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sg-${crypto.randomUUID()}`;
  }
  return `sg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function resolveFloorStructureGroupId(
  floor: Pick<FloorPlan, 'structureGroupId'> | null | undefined,
  config: ProjectStructureConfig,
): string {
  const normalized = normalizeStructureGroupConfig(config);
  const explicitId = cleanText(floor?.structureGroupId);
  if (explicitId && normalized.groups.some((item) => item.id === explicitId)) return explicitId;
  return normalized.defaultGroupId;
}

export function getStructureGroupName(
  groupId: string | null | undefined,
  config: ProjectStructureConfig,
): string {
  const normalized = normalizeStructureGroupConfig(config);
  const resolvedId = cleanText(groupId) || normalized.defaultGroupId;
  return normalized.groups.find((item) => item.id === resolvedId)?.name
    || normalized.groups.find((item) => item.id === normalized.defaultGroupId)?.name
    || 'Khu mặc định';
}

export function getFloorStructureGroupName(
  floor: Pick<FloorPlan, 'structureGroupId'> | null | undefined,
  config: ProjectStructureConfig,
): string {
  return getStructureGroupName(resolveFloorStructureGroupId(floor, config), config);
}

export function floorBelongsToStructureGroup(
  floor: Pick<FloorPlan, 'structureGroupId'> | null | undefined,
  groupId: string | null | undefined,
  config: ProjectStructureConfig,
): boolean {
  if (!groupId) return true;
  return resolveFloorStructureGroupId(floor, config) === groupId;
}

export function getStructureGroupByFloorId(
  floorId: string | null | undefined,
  floorPlans: FloorPlan[],
  config: ProjectStructureConfig,
): StructureGroupInfo | null {
  if (!floorId) return null;
  const floor = floorPlans.find((item) => item.id === floorId);
  if (!floor) return null;
  const id = resolveFloorStructureGroupId(floor, config);
  return normalizeStructureGroupConfig(config).groups.find((item) => item.id === id) || null;
}
