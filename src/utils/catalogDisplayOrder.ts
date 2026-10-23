import { naturalCompare } from './sortUtils.ts';

/**
 * Presentation-only ordering. Accessories and miscellaneous consumables follow
 * major boards/frames/finishes in the DEFAULT material view. Do not change
 * item identities, Firestore records, procurement or stock calculations.
 */
export function isAccessoryCategory(category: string | undefined | null): boolean {
  const text = String(category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi-VN').trim();
  return /phu kien|vat tu phu|phu tung|oc vit|\bvit\b|\bbulong\b|bu long/.test(text);
}

/** Returns 0 within the same priority group, leaving a caller's stable order intact. */
export function compareMaterialGroupPriority(
  a: string | undefined | null,
  b: string | undefined | null,
): number {
  return Number(isAccessoryCategory(a)) - Number(isAccessoryCategory(b));
}

/**
 * Order planner display order, shared by its sheet, exported report and
 * Warehouse Quick Edit. The accessory-last rule applies to MATERIALS only.
 * This function never changes the stable procurement key or Cloud row data.
 */
export function compareWarehouseOrderDisplayItems(
  a: { kind: 'material' | 'equipment'; category?: string | null; name: string; unit?: string | null },
  b: { kind: 'material' | 'equipment'; category?: string | null; name: string; unit?: string | null },
): number {
  return a.kind.localeCompare(b.kind)
    || (a.kind === 'material' ? compareMaterialGroupPriority(a.category, b.category) : 0)
    || naturalCompare(a.category, b.category)
    || naturalCompare(a.name, b.name)
    || naturalCompare(a.unit, b.unit);
}

/** Cloud-safe ranking: legacy rows have no order and precede ranked new records. */
export function compareWorkVolumeManualOrder(
  a: { id: string; order?: number },
  b: { id: string; order?: number },
): number {
  const rank = (value: number | undefined) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
  return rank(a.order) - rank(b.order)
    || String(a.id).localeCompare(String(b.id), 'vi', { numeric: true, sensitivity: 'base' });
}

/**
 * Move only the visible/filtered subset through the full ordered catalog.
 * Hidden rows keep their positions; no document IDs or business quantities change.
 * Returns null for stale, duplicate or unchanged requests (fail closed).
 */
export function reorderVisibleWorkVolumes<T extends { id: string; order?: number }>(
  items: T[],
  visibleOrderedIds: string[],
): T[] | null {
  if (visibleOrderedIds.length < 2 ||
    new Set(visibleOrderedIds).size !== visibleOrderedIds.length ||
    new Set(items.map(item => item.id)).size !== items.length) return null;
  const sorted = [...items].sort(compareWorkVolumeManualOrder);
  const visible = new Set(visibleOrderedIds);
  const currentVisible = sorted.filter(item => visible.has(item.id));
  if (currentVisible.length !== visibleOrderedIds.length) return null;
  if (currentVisible.every((item, index) => item.id === visibleOrderedIds[index])) return null;
  const byId = new Map(currentVisible.map(item => [item.id, item] as const));
  const desired = visibleOrderedIds.map(id => byId.get(id));
  if (desired.some(item => !item)) return null;
  let offset = 0;
  return sorted.map((item, index) => {
    const next = visible.has(item.id) ? desired[offset++]! : item;
    return next.order === index + 1 ? next : { ...next, order: index + 1 };
  });
}


/**
 * Reorder only the visible subset of a currently ordered catalog. The hidden
 * items keep exactly their original slots. This is presentation metadata only:
 * callers persist ranks, never remap IDs or mutate inventory/norm quantities.
 */
export function reorderVisibleCatalogItems<T extends { id: string }>(
  orderedCatalog: readonly T[],
  visibleOrderedIds: readonly string[],
): T[] | null {
  const allIds = orderedCatalog.map(item => item.id);
  if (visibleOrderedIds.length < 2 || new Set(allIds).size !== allIds.length
    || new Set(visibleOrderedIds).size !== visibleOrderedIds.length) return null;
  const visible = new Set(visibleOrderedIds);
  const present = allIds.filter(id => visible.has(id));
  if (present.length !== visibleOrderedIds.length) return null;
  if (present.every((id, index) => id === visibleOrderedIds[index])) return null;
  const byId = new Map(orderedCatalog.map(item => [item.id, item] as const));
  if (visibleOrderedIds.some(id => !byId.has(id))) return null;
  let offset = 0;
  return orderedCatalog.map(item => visible.has(item.id)
    ? byId.get(visibleOrderedIds[offset++])!
    : item);
}

/** Saved Cloud ranks are positive safe integers; legacy rows remain unranked. */
export function catalogOrderRank(value?: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value : Number.MAX_SAFE_INTEGER;
}
