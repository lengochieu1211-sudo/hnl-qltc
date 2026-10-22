/** Read-only order planning. Never write to warehouse ledger or Firebase. */
export type WarehouseOrderKind = 'material' | 'equipment';
export type WarehouseOrderItem = {
  key: string;
  kind: WarehouseOrderKind;
  name: string;
  unit: string;
  category: string;
};
/** Values drive calculations; optional input expressions preserve what the operator typed.
 * Legacy drafts with numbers only remain valid and must never be overwritten. */
export type WarehouseOrderValues = {
  quantity: number;
  kgPerUnit: number | null;
  quantityExpression?: string;
  kgPerUnitExpression?: string;
};

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
/** Arithmetic expression evaluator using the order-specific Vietnamese number parsers.
 * It deliberately does not use eval/Function or read fields from other rows.
 * Plain numbers keep their legacy 20,000 vs 0.030 interpretation. */
export function isWarehouseOrderExpression(text: string): boolean {
  return /^\s*=/.test(text) || /[+\-*/xX×:÷()]/.test(text);
}
export function evaluateWarehouseOrderInput(text: string, field: 'quantity' | 'kgPerUnit'): number | null {
  const raw = text.trim();
  if (!raw || raw.length > 160) return null;
  const parseNumber = field === 'quantity' ? parseOrderQuantity : parseOrderWeight;
  if (!isWarehouseOrderExpression(raw)) return parseNumber(raw);
  const normalized = raw.replace(/^=/, '').replace(/[xX×]/g, '*').replace(/[:÷]/g, '/');
  if (!/^[0-9.,+\-*/()\s]+$/.test(normalized)) return null;
  const matches = normalized.match(/\d+(?:[.,]\d+)*|[()+\-*/]/g);
  if (!matches || matches.length > 128 || matches.join('') !== normalized.replace(/\s/g, '')) return null;
  let cursor = 0;
  let depth = 0;
  const factor = (): number => {
    if (++depth > 32) throw new Error('expression too deep');
    try {
      const token = matches[cursor++];
      if (token === '+' || token === '-') {
        const value = factor();
        return token === '-' ? -value : value;
      }
      if (token === '(') {
        const value = expression();
        if (matches[cursor++] !== ')') throw new Error('missing closing parenthesis');
        return value;
      }
      if (!token || !/^\d/.test(token)) throw new Error('expected a number');
      const value = parseNumber(token);
      if (value === null) throw new Error('invalid number');
      return value;
    } finally { depth--; }
  };
  const term = (): number => {
    let value = factor();
    while (matches[cursor] === '*' || matches[cursor] === '/') {
      const op = matches[cursor++];
      const right = factor();
      if (op === '/' && right === 0) throw new Error('division by zero');
      value = op === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) throw new Error('overflow');
    }
    return value;
  };
  const expression = (): number => {
    let value = term();
    while (matches[cursor] === '+' || matches[cursor] === '-') {
      const op = matches[cursor++];
      const right = term();
      value = op === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) throw new Error('overflow');
    }
    return value;
  };
  try {
    const result = expression();
    if (cursor !== matches.length || !Number.isFinite(result) || result < 0 || result > 1e12) return null;
    return result;
  } catch { return null; }
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
      const entry: WarehouseOrderValues = {quantity:q, kgPerUnit:w};
      // Refuse corrupt/stale formulas but keep their corresponding numeric values.
      for (const [sourceKey, outputKey, numericValue, kind] of [
        ['quantityExpression','quantityExpression',q,'quantity'],
        ['kgPerUnitExpression','kgPerUnitExpression',w,'kgPerUnit'],
      ] as const) {
        const expression = row[sourceKey];
        if (typeof expression !== 'string' || !isWarehouseOrderExpression(expression)) continue;
        const calculated = evaluateWarehouseOrderInput(expression, kind);
        if (calculated === null || numericValue === null || Math.abs(calculated - numericValue) > 1e-8 * Math.max(1, Math.abs(numericValue))) continue;
        entry[outputKey] = expression;
      }
      out[key] = entry;
    }
    return out;
  } catch { return {}; }
}
export function saveWarehouseOrderDraft(projectId: string, rows: Record<string, WarehouseOrderValues>): boolean {
  if (!projectId || typeof localStorage === 'undefined') return false;
  try { localStorage.setItem(PREFIX + projectId, JSON.stringify(rows)); return true; }
  catch { return false; }
}
