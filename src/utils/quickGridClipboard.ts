/** Clipboard selection helpers for staged Quick Edit. No persistence or external side effects. */
export type GridSelectionRow = { __rowKey: string; [key: string]: unknown };
export type GridSelectionColumn = { key: string };
export const quickGridCellKey = (rowKey: string, columnKey: string): string => `${rowKey}::${columnKey}`;

export function gridRectKeys(
  rows: GridSelectionRow[], columns: GridSelectionColumn[],
  anchor: { rowKey: string; columnKey: string },
  end: { rowKey: string; columnKey: string },
): Set<string> {
  const ra = rows.findIndex((r) => r.__rowKey === anchor.rowKey);
  const rb = rows.findIndex((r) => r.__rowKey === end.rowKey);
  const ca = columns.findIndex((c) => c.key === anchor.columnKey);
  const cb = columns.findIndex((c) => c.key === end.columnKey);
  if ([ra, rb, ca, cb].some((index) => index < 0)) return new Set();
  const result = new Set<string>();
  for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) {
    for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) {
      result.add(quickGridCellKey(rows[r].__rowKey, columns[c].key));
    }
  }
  return result;
}

export function gridSelectionTSV(
  rows: GridSelectionRow[], columns: GridSelectionColumn[], selected: ReadonlySet<string>,
  displayValue: (value: unknown, columnKey: string) => string,
): string {
  const rowIndices = rows.flatMap((row, index) => columns.some((col) => selected.has(quickGridCellKey(row.__rowKey, col.key))) ? [index] : []);
  const colIndices = columns.flatMap((col, index) => rows.some((row) => selected.has(quickGridCellKey(row.__rowKey, col.key))) ? [index] : []);
  if (!rowIndices.length || !colIndices.length) return '';
  return rows.slice(rowIndices[0], rowIndices[rowIndices.length - 1] + 1)
    .map((row) => columns.slice(colIndices[0], colIndices[colIndices.length - 1] + 1)
      .map((col) => {
        if (!selected.has(quickGridCellKey(row.__rowKey, col.key))) return '';
        const value = displayValue(row[col.key], col.key);
        // Excel/Sheets TSV: quote values containing separators, line breaks or quotes.
        return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      })
      .join('\t')).join('\n');
}

/** Parse Excel/Sheets-style TSV without splitting quoted tabs or multi-line cells.
 * Invalid quoting must fail the whole paste, never silently shift columns/rows.
 */
export function parseGridTSV(text: string): string[][] {
  if (!text) return [];
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  let atCellStart = true;

  const finishCell = () => {
    row.push(cell);
    cell = '';
    atCellStart = true;
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (quoted) {
      if (char === '"') {
        if (normalized[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '\t') { finishCell(); continue; }
    if (char === '\n') { finishRow(); continue; }
    if (closedQuote) throw new Error('Dữ liệu Excel chứa ký tự sau dấu ngoặc kép đóng.');
    if (char === '"' && atCellStart) { quoted = true; atCellStart = false; continue; }
    cell += char;
    atCellStart = false;
  }
  if (quoted) throw new Error('Dữ liệu Excel có ô chứa dấu ngoặc kép chưa đóng.');
  if (normalized[normalized.length - 1] !== '\n') finishRow();
  return rows;
}
