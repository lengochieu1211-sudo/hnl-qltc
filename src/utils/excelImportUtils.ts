export function parseExcelStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    return items.length > 0 ? Array.from(new Set(items)) : undefined;
  }
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const items = parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
        return items.length > 0 ? Array.from(new Set(items)) : undefined;
      }
    } catch (_) {
      // Fall through to delimiter parsing for hand-edited spreadsheets.
    }
  }
  const items = raw.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

export function parseExcelNumberRecord(value: unknown): Record<string, number> | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return undefined;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const result: Record<string, number> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, rawNumber]) => {
    const trimmed = String(key || '').trim();
    const numeric = Number(rawNumber);
    if (trimmed && Number.isFinite(numeric)) result[trimmed] = numeric;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export function sameStringSet(left?: string[], right?: string[]): boolean {
  const a = Array.from(new Set((left || []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
  const b = Array.from(new Set((right || []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
