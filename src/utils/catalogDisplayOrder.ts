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
