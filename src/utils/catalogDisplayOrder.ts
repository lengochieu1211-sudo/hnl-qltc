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
