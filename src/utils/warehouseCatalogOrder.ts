/** Read-only order planning. Never write to warehouse ledger or Firebase. */
export type WarehouseOrderKind = 'material' | 'equipment';
export type WarehouseOrderItem = {
  key: string;
  kind: WarehouseOrderKind;
  name: string;
  unit: string;
  category: string;
};
export type WarehouseOrderValues = { quantity: number; kgPerUnit: number | null };

export function warehouseOrderKey(kind: WarehouseOrderKind, name: string, unit: string): string {
  // JSON tuple avoids collisions between delimiters or similarly named units.
  return JSON.stringify([kind, name.trim().normalize('NFC').toLocaleLowerCase('vi-VN'), unit.trim().normalize('NFC').toLocaleLowerCase('vi-VN')]);
}
export function parseOrderNumber(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  // Accept plain decimal dot/comma and Vietnamese grouped numbers, never expressions.
  if (!/^[0-9]+(?:[.,][0-9]+)*$/.test(value)) return null;
  const decimal = value.includes(',') && value.includes('.')
    ? value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '')
    : /^\d{1,3}(?:\.\d{3})+$/.test(value)
      ? value.replace(/\./g, '')
      : value.replace(',', '.');
  const n = Number(decimal);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
}
/** Per-unit mass may contain thousandths of a kilogram, e.g. 0.030 kg.
 * Do not interpret a zero-leading fractional mass as 30 kg. Grouped values
 * such as 1.000 still mean 1,000 kg (Vietnamese thousands notation).
 */
export function parseOrderWeight(input: string): number | null {
  const text = input.trim();
  if (/^0[.,]\d+$/.test(text)) {
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
  }
  return parseOrderNumber(text);
}
/** Quantities may be pasted from the supplier sheet with 20,000 = twenty thousand.
 * Keep per-unit kilogram parsing separate so 0,030 still means 0.03 kg.
 */
export function parseOrderQuantity(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(trimmed)) {
    const n = Number(trimmed.replace(/[.,]/g, ''));
    return Number.isFinite(n) && n <= 1e12 ? n : null;
  }
  return parseOrderNumber(input);
}
export function orderWeightSummary(rows: Array<{ quantity: number; kgPerUnit: number | null }>) {
  let kilograms = 0;
  let missing = 0;
  let selected = 0;
  for (const {quantity, kgPerUnit} of rows) {
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    selected++;
    if (kgPerUnit == null || !Number.isFinite(kgPerUnit) || kgPerUnit <= 0) { missing++; continue; }
    kilograms += quantity * kgPerUnit;
  }
  return {kilograms, tonnes: kilograms / 1000, missing, selected, complete: missing === 0};
}
const PREFIX = 'hnl-qltc-order-draft-v1:';
export function loadWarehouseOrderDraft(projectId: string): Record<string, WarehouseOrderValues> {
  if (!projectId || typeof localStorage === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFIX + projectId) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, WarehouseOrderValues> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const q = Number(row.quantity), w = row.kgPerUnit == null ? null : Number(row.kgPerUnit);
      if (!Number.isFinite(q) || q < 0 || q > 1e12 || (w !== null && (!Number.isFinite(w) || w <= 0 || w > 1e12))) continue;
      out[key] = {quantity:q, kgPerUnit:w};
    }
    return out;
  } catch { return {}; }
}
export function saveWarehouseOrderDraft(projectId: string, rows: Record<string, WarehouseOrderValues>): boolean {
  if (!projectId || typeof localStorage === 'undefined') return false;
  try { localStorage.setItem(PREFIX + projectId, JSON.stringify(rows)); return true; }
  catch { return false; }
}
