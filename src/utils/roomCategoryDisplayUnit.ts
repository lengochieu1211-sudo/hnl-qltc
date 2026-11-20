import type { WorkVolume } from '../types';

type UnitCatalogItem = Pick<WorkVolume, 'id' | 'workCategoryId' | 'title' | 'unit' | 'floorId' | 'floorIds' | 'floor' | 'deletedAt'>;

export interface RoomCategoryDisplayUnitInput {
  category: string;
  workVolumes: UnitCatalogItem[];
  floorId?: string;
  floorName?: string;
  /** Durable category ID, if available; never guess by a duplicate title. */
  workCategoryId?: string;
  /** Unit already saved in this room/category. The display must never mutate it. */
  storedUnit?: string;
  fallbackUnit?: string;
}

export interface RoomCategoryDisplayUnitResult {
  unit: string;
  catalogMatched: boolean;
  savedUnitDiffers: boolean;
}

const key = (s?: string): string => String(s || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
const unitKey = (s?: string): string => key(s).replace(/²/g, '2').replace(/\s+/g, '');
const allFloors = new Set(['tất cả', 'toàn nhà', 'toàn công trình', 'công trình', 'all']);

function unitCategoryAppliesToFloor(item: UnitCatalogItem, floorId?: string, floorName?: string): boolean {
  const ids = [item.floorId, ...(item.floorIds || [])].map(v => String(v || '').trim()).filter(Boolean);
  if (ids.length) return Boolean(floorId && ids.includes(floorId));
  const scope = key(item.floor);
  if (!scope || allFloors.has(scope)) return true;
  return Boolean(floorName && scope.split(/[,;\n]+/).some(v => key(v) === key(floorName)));
}

function categorySpecificallyOnFloor(item: UnitCatalogItem, floorId?: string, floorName?: string): boolean {
  const ids = [item.floorId, ...(item.floorIds || [])].map(v => String(v || '').trim()).filter(Boolean);
  if (ids.length) return Boolean(floorId && ids.includes(floorId));
  const scope = key(item.floor);
  return Boolean(scope && !allFloors.has(scope) && floorName && scope.split(/[,;\n]+/).some(v => key(v) === key(floorName)));
}

/** Resolve the read-only UI label; NO quantity conversion, updates or Firestore writes. */
export function resolveRoomCategoryDisplayUnit(input: RoomCategoryDisplayUnitInput): RoomCategoryDisplayUnitResult {
  const stored = String(input.storedUnit || '').trim();
  const fallback = stored || String(input.fallbackUnit || '').trim() || 'm²';
  const none = { unit: fallback, catalogMatched: false, savedUnitDiffers: false };
  const text = String(input.category || '').trim();
  const exactId = String(input.workCategoryId || '').trim();
  if (!text && !exactId) return none;

  const active = input.workVolumes.filter(item => item.deletedAt == null);
  const matches = active.filter(item => exactId
    ? item.id === exactId || item.workCategoryId === exactId
    : item.id === text || item.workCategoryId === text || key(item.title) === key(text));
  if (!matches.length) return none;

  const scoped = matches.filter(item => unitCategoryAppliesToFloor(item, input.floorId, input.floorName));
  if (!scoped.length) return none;
  const specific = scoped.filter(item => categorySpecificallyOnFloor(item, input.floorId, input.floorName));
  const candidates = specific.length ? specific : scoped;
  const identities = new Set(candidates.map(item => String(item.workCategoryId || item.id || '').trim()).filter(Boolean));
  const units = new Set(candidates.map(item => String(item.unit || '').trim()).filter(Boolean));
  if (identities.size !== 1 || units.size !== 1) return none;
  const unit = [...units][0];
  return { unit, catalogMatched: true, savedUnitDiffers: Boolean(stored && unitKey(stored) !== unitKey(unit)) };
}
