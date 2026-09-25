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

export const MAX_EXCEL_IMPORT_BYTES = 12 * 1024 * 1024;

/**
 * Fail closed before handing user-controlled workbook bytes to SheetJS.
 * MIME is intentionally not trusted because Android/Windows file pickers often
 * omit it; the extension + byte-size contract is deterministic across wrappers.
 */
export function assertSafeExcelImportFile(file: Pick<File, 'name' | 'size'>): void {
  const name = String(file?.name || '').trim();
  const size = Number(file?.size || 0);
  if (!name || !/\.(xlsx|xls)$/i.test(name)) {
    throw new Error('Chỉ chấp nhận tệp Excel .xlsx hoặc .xls.');
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Tệp Excel rỗng hoặc không đọc được.');
  }
  if (size > MAX_EXCEL_IMPORT_BYTES) {
    const maxMb = Math.round(MAX_EXCEL_IMPORT_BYTES / (1024 * 1024));
    throw new Error(`Tệp Excel vượt giới hạn ${maxMb} MB. Hãy chia nhỏ dữ liệu trước khi nhập.`);
  }
}
