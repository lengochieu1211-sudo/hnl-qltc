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
      .map((col) => selected.has(quickGridCellKey(row.__rowKey, col.key))
        ? displayValue(row[col.key], col.key).replace(/[\t\r\n]+/g, ' ') : '')
      .join('\t')).join('\n');
}

export function parseGridTSV(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}
