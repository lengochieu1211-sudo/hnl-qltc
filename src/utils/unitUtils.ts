/**
 * Canonicalizes measurement/unit labels so equivalent inputs do not split totals.
 * This does NOT perform unit conversion; it only normalizes spelling/symbol variants.
 */
export function normalizeUnit(unit?: string | null): string {
  const raw = String(unit || '').trim();
  if (!raw) return '';

  const compact = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\^/g, '');

  if (['m2', 'métvuông', 'metvuong', 'sqm'].includes(compact)) return 'm²';
  if (['m3', 'métkhối', 'metkhoi', 'cbm'].includes(compact)) return 'm³';
  if (['m', 'mét', 'met', 'meter', 'metre'].includes(compact)) return 'm';
  if (['kg', 'kilogram', 'kilograms'].includes(compact)) return 'kg';
  if (['tấm', 'tam'].includes(compact)) return 'Tấm';
  if (['thanh'].includes(compact)) return 'Thanh';
  if (['bộ', 'bo'].includes(compact)) return 'Bộ';
  if (['cái', 'cai'].includes(compact)) return 'Cái';
  if (['hộp', 'hop'].includes(compact)) return 'Hộp';
  if (['bao'].includes(compact)) return 'Bao';
  if (['cuộn', 'cuon'].includes(compact)) return 'Cuộn';

  return raw;
}

/** Stable key used for grouping/comparison. */
export function unitKey(unit?: string | null): string {
  return normalizeUnit(unit).trim().toLocaleLowerCase('vi-VN');
}

export function areSameUnit(a?: string | null, b?: string | null): boolean {
  return unitKey(a) === unitKey(b);
}
