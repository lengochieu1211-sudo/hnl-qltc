import React, { useEffect, useMemo, useRef, useState } from 'react';
import { confirmAsync } from '../utils/confirmAsync';

export type QuickGridCellValue = string | number | null | undefined;

export interface QuickGridRow {
  __rowKey: string;
  __new?: boolean;
  __groupKey?: string;
  __groupPrimary?: boolean;
  [key: string]: unknown;
}

export interface QuickGridColumn {
  key: string;
  label: string;
  editable?: boolean | ((row: QuickGridRow) => boolean);
  sortable?: boolean;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: Array<string | { value: string; label: string }>;
  width?: number;
  required?: boolean;
  placeholder?: string;
  validate?: (value: QuickGridCellValue, row: QuickGridRow) => string | null;
}

interface QuickEditGridModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  columns: QuickGridColumn[];
  rows: QuickGridRow[];
  canEdit?: boolean;
  canAddRows?: boolean;
  canDeleteRows?: boolean;
  requiresAnchorForInsert?: boolean;
  createEmptyRow?: (index: number, anchorRow?: QuickGridRow) => QuickGridRow | null;
  getRowDeleteBlockReason?: (row: QuickGridRow, currentRows: QuickGridRow[]) => string | null;
  syncGroupColumns?: string[];
  onClose: () => void;
  onSave: (
    rows: QuickGridRow[],
    dirtyCellKeys: Set<string>,
    deletedRows?: QuickGridRow[],
  ) => boolean | void | Promise<boolean | void>;
  saveLabel?: string;
  emptyText?: string;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (key: string) => void;
}

interface DraftSnapshot {
  rows: QuickGridRow[];
  dirty: Set<string>;
  deleted: QuickGridRow[];
}

type SortDirection = 'asc' | 'desc';

const normalizeCell = (value: unknown) => value === null || value === undefined ? '' : String(value);
const cellKey = (rowKey: string, columnKey: string) => `${rowKey}::${columnKey}`;
const cloneRows = (rows: QuickGridRow[]) => rows.map((row) => ({ ...row }));

function isColumnEditable(column: QuickGridColumn, row: QuickGridRow, canEdit: boolean): boolean {
  if (!canEdit) return false;
  if (typeof column.editable === 'function') return column.editable(row);
  return column.editable !== false;
}

function parseSortValue(value: unknown, column: QuickGridColumn): string | number {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
  }
  if (column.type === 'date') {
    const time = new Date(String(value)).getTime();
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }
  return String(value).trim();
}

function compareSortValues(a: unknown, b: unknown, column: QuickGridColumn): number {
  const av = parseSortValue(a, column);
  const bv = parseSortValue(b, column);
  if (av === '' && bv === '') return 0;
  if (av === '') return 1;
  if (bv === '') return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), 'vi-VN', { numeric: true, sensitivity: 'base' });
}

export const QuickEditGridModal: React.FC<QuickEditGridModalProps> = ({
  open,
  title,
  subtitle,
  columns,
  rows,
  canEdit = true,
  canAddRows = false,
  canDeleteRows = false,
  requiresAnchorForInsert = false,
  createEmptyRow,
  getRowDeleteBlockReason,
  syncGroupColumns = [],
  onClose,
  onSave,
  saveLabel = 'Lưu thay đổi',
  emptyText = 'Chưa có dữ liệu.',
  tabs,
  activeTab,
  onTabChange,
}) => {
  const [draftRows, setDraftRows] = useState<QuickGridRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<QuickGridRow[]>([]);
  const [dirtyCellKeys, setDirtyCellKeys] = useState<Set<string>>(new Set());
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [insertCount, setInsertCount] = useState(1);
  const [sortState, setSortState] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<DraftSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DraftSnapshot[]>([]);
  const activeCellRef = useRef<{ rowKey: string; columnKey: string } | null>(null);
  const wasOpenRef = useRef(false);

  const hasChanges = dirtyCellKeys.size > 0 || deletedRows.length > 0;
  const rowOperationsEnabled = canEdit && ((canAddRows && Boolean(createEmptyRow)) || canDeleteRows);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const opening = !wasOpenRef.current;
    wasOpenRef.current = true;
    // Realtime/parent refreshes must never wipe an unsaved local draft.
    // Once the draft is clean again, rebase it on the latest canonical rows.
    if (!opening && hasChanges) return;
    setDraftRows(cloneRows(rows));
    setDeletedRows([]);
    setDirtyCellKeys(new Set());
    setSelectedRowKeys(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSearch('');
    setSortState(null);
    setInsertCount(1);
  }, [open, rows, hasChanges]);

  const snapshot = (): DraftSnapshot => ({
    rows: cloneRows(draftRows),
    dirty: new Set(dirtyCellKeys),
    deleted: cloneRows(deletedRows),
  });

  const pushUndo = () => {
    const current = snapshot();
    setUndoStack((prev) => [...prev.slice(-29), current]);
    setRedoStack([]);
  };

  const coerceValue = (column: QuickGridColumn, rawValue: string): QuickGridCellValue => {
    if (column.type !== 'number') return rawValue;
    const normalized = rawValue.trim().replace(',', '.');
    return normalized === '' ? '' : Number(normalized);
  };

  const applyCellChange = (
    sourceRows: QuickGridRow[],
    sourceDirty: Set<string>,
    rowKey: string,
    column: QuickGridColumn,
    value: QuickGridCellValue,
  ): { rows: QuickGridRow[]; dirty: Set<string> } => {
    const target = sourceRows.find((row) => row.__rowKey === rowKey);
    if (!target || !isColumnEditable(column, target, canEdit)) return { rows: sourceRows, dirty: sourceDirty };

    const nextRows = cloneRows(sourceRows);
    const nextDirty = new Set(sourceDirty);
    const groupKey = String(target.__groupKey || '').trim();
    const syncGroup = Boolean(groupKey && syncGroupColumns.includes(column.key));

    nextRows.forEach((row) => {
      if (row.__rowKey !== rowKey && (!syncGroup || String(row.__groupKey || '').trim() !== groupKey)) return;
      row[column.key] = value;
      nextDirty.add(cellKey(row.__rowKey, column.key));
    });
    return { rows: nextRows, dirty: nextDirty };
  };

  const setCell = (rowKey: string, column: QuickGridColumn, rawValue: string, recordUndo = true) => {
    const target = draftRows.find((row) => row.__rowKey === rowKey);
    if (!target || !isColumnEditable(column, target, canEdit)) return;
    if (recordUndo) pushUndo();
    const nextValue = coerceValue(column, rawValue);
    const result = applyCellChange(draftRows, dirtyCellKeys, rowKey, column, nextValue);
    setDraftRows(result.rows);
    setDirtyCellKeys(result.dirty);
  };

  const validation = useMemo(() => {
    const errors = new Map<string, string>();
    draftRows.forEach((row) => {
      columns.forEach((column) => {
        const value = row[column.key] as QuickGridCellValue;
        const normalized = normalizeCell(value).trim();
        if (column.required && !normalized) {
          errors.set(cellKey(row.__rowKey, column.key), 'Bắt buộc');
          return;
        }
        if (column.type === 'number' && normalized && !Number.isFinite(Number(value))) {
          errors.set(cellKey(row.__rowKey, column.key), 'Phải là số hợp lệ');
          return;
        }
        const custom = column.validate?.(value, row);
        if (custom) errors.set(cellKey(row.__rowKey, column.key), custom);
      });
    });
    return errors;
  }, [draftRows, columns]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('vi-VN');
    const indexed = draftRows.map((row, index) => ({ row, index }));
    const filtered = q
      ? indexed.filter(({ row }) => columns.some((column) =>
          normalizeCell(row[column.key]).toLocaleLowerCase('vi-VN').includes(q)
        ))
      : indexed;

    if (!sortState) return filtered.map(({ row }) => row);
    const column = columns.find((candidate) => candidate.key === sortState.key);
    if (!column) return filtered.map(({ row }) => row);
    const factor = sortState.direction === 'asc' ? 1 : -1;
    return [...filtered]
      .sort((a, b) => {
        const compared = compareSortValues(a.row[column.key], b.row[column.key], column) * factor;
        return compared || a.index - b.index;
      })
      .map(({ row }) => row);
  }, [draftRows, columns, search, sortState]);

  const restoreSnapshot = (state: DraftSnapshot) => {
    setDraftRows(cloneRows(state.rows));
    setDirtyCellKeys(new Set(state.dirty));
    setDeletedRows(cloneRows(state.deleted));
    setSelectedRowKeys(new Set());
  };

  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setRedoStack((prev) => [...prev, snapshot()]);
    restoreSnapshot(previous);
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const redo = () => {
    const nextState = redoStack[redoStack.length - 1];
    if (!nextState) return;
    setUndoStack((prev) => [...prev, snapshot()]);
    restoreSnapshot(nextState);
    setRedoStack((prev) => prev.slice(0, -1));
  };

  const discard = () => {
    setDraftRows(cloneRows(rows));
    setDeletedRows([]);
    setDirtyCellKeys(new Set());
    setSelectedRowKeys(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSortState(null);
    activeCellRef.current = null;
  };

  const handleClose = async () => {
    if (hasChanges) {
      const confirmed = await confirmAsync('Có thay đổi chưa lưu trong Bảng chỉnh nhanh. Bỏ thay đổi và đóng?');
      if (!confirmed) return;
    }
    onClose();
  };

  const handleTabChange = async (key: string) => {
    if (key === activeTab) return;
    if (hasChanges) {
      const confirmed = await confirmAsync('Có thay đổi chưa lưu trong bảng hiện tại. Bỏ thay đổi và chuyển bảng?');
      if (!confirmed) return;
      discard();
    }
    onTabChange?.(key);
  };

  const resolveAnchorRow = (): QuickGridRow | undefined => {
    const selectedKey = Array.from(selectedRowKeys)[0];
    const activeKey = activeCellRef.current?.rowKey;
    const anchorKey = selectedKey || activeKey;
    return anchorKey ? draftRows.find((row) => row.__rowKey === anchorKey) : undefined;
  };

  const addRows = (placement: 'above' | 'below') => {
    if (!canEdit || !canAddRows || !createEmptyRow) return;
    const anchor = resolveAnchorRow();
    if (requiresAnchorForInsert && !anchor) {
      alert('Hãy chọn một dòng làm vị trí chèn.');
      return;
    }
    const count = Math.min(50, Math.max(1, Math.trunc(Number(insertCount) || 1)));
    const anchorIndex = anchor ? draftRows.findIndex((row) => row.__rowKey === anchor.__rowKey) : -1;
    const insertAt = anchorIndex >= 0
      ? (placement === 'above' ? anchorIndex : anchorIndex + 1)
      : (placement === 'above' ? 0 : draftRows.length);

    const additions = Array.from({ length: count }, (_, offset) => createEmptyRow(insertAt + offset, anchor)).filter((row): row is QuickGridRow => Boolean(row));
    if (!additions.length) return;
    pushUndo();
    const nextRows = [...draftRows.slice(0, insertAt), ...additions, ...draftRows.slice(insertAt)];
    const nextDirty = new Set(dirtyCellKeys);
    additions.forEach((row) => columns.forEach((column) => {
      if (isColumnEditable(column, row, canEdit)) nextDirty.add(cellKey(row.__rowKey, column.key));
    }));
    setDraftRows(nextRows);
    setDirtyCellKeys(nextDirty);
    setSelectedRowKeys(new Set(additions.map((row) => row.__rowKey)));
    setSortState(null);
  };

  const deleteSelectedRows = async () => {
    if (!canEdit || !canDeleteRows) return;
    const keys = selectedRowKeys.size > 0
      ? Array.from(selectedRowKeys)
      : (activeCellRef.current?.rowKey ? [activeCellRef.current.rowKey] : []);
    if (!keys.length) {
      alert('Hãy chọn ít nhất một dòng cần xóa.');
      return;
    }
    const targets = keys.map((key) => draftRows.find((row) => row.__rowKey === key)).filter((row): row is QuickGridRow => Boolean(row));
    const blocks = targets.map((row) => getRowDeleteBlockReason?.(row, draftRows)).filter((reason): reason is string => Boolean(reason));
    if (blocks.length > 0) {
      alert(Array.from(new Set(blocks)).join('\n'));
      return;
    }
    const confirmed = await confirmAsync(`Đánh dấu xóa ${targets.length} dòng? Thay đổi chỉ được ghi khi bấm Lưu.`);
    if (!confirmed) return;

    pushUndo();
    const deleteKeys = new Set(targets.map((row) => row.__rowKey));
    const existingDeletes = targets.filter((row) => !row.__new);
    setDraftRows((prev) => prev.filter((row) => !deleteKeys.has(row.__rowKey)));
    setDeletedRows((prev) => {
      const byKey = new Map(prev.map((row) => [row.__rowKey, row] as const));
      existingDeletes.forEach((row) => byKey.set(row.__rowKey, { ...row }));
      return Array.from(byKey.values());
    });
    setDirtyCellKeys((prev) => new Set(Array.from(prev).filter((key) => !deleteKeys.has(key.split('::')[0]))));
    setSelectedRowKeys(new Set());
    activeCellRef.current = null;
  };

  const handlePaste = (event: React.ClipboardEvent, rowKey: string, columnKey: string) => {
    if (!canEdit) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    event.preventDefault();
    const matrix = text.replace(/\r/g, '').split('\n').filter((line, index, arr) => line.length > 0 || index < arr.length - 1).map((line) => line.split('\t'));
    const startRow = draftRows.findIndex((row) => row.__rowKey === rowKey);
    const startColumn = columns.findIndex((column) => column.key === columnKey);
    if (startRow < 0 || startColumn < 0) return;

    pushUndo();
    let nextRows = cloneRows(draftRows);
    let nextDirty = new Set(dirtyCellKeys);
    matrix.forEach((cells, rowOffset) => {
      const row = nextRows[startRow + rowOffset];
      if (!row) return;
      cells.forEach((rawValue, colOffset) => {
        const column = columns[startColumn + colOffset];
        if (!column || !isColumnEditable(column, row, canEdit)) return;
        const result = applyCellChange(nextRows, nextDirty, row.__rowKey, column, coerceValue(column, rawValue));
        nextRows = result.rows;
        nextDirty = result.dirty;
      });
    });
    setDraftRows(nextRows);
    setDirtyCellKeys(nextDirty);
  };

  const handleSort = (column: QuickGridColumn) => {
    if (column.sortable === false) return;
    setSortState((prev) => {
      if (!prev || prev.key !== column.key) return { key: column.key, direction: 'asc' };
      if (prev.direction === 'asc') return { key: column.key, direction: 'desc' };
      return null;
    });
  };

  const handleSave = async () => {
    if (!canEdit || !hasChanges || validation.size > 0) return;
    setSaving(true);
    try {
      const result = await onSave(draftRows, dirtyCellKeys, deletedRows);
      if (result === false) return;
      setDeletedRows([]);
      setDirtyCellKeys(new Set());
      setSelectedRowKeys(new Set());
      setUndoStack([]);
      setRedoStack([]);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const changedRows = new Set<string>([
    ...Array.from(dirtyCellKeys).map((key) => key.split('::')[0]),
    ...deletedRows.map((row) => row.__rowKey),
  ]).size;
  const selectableVisibleRows = filteredRows.filter((row) => !getRowDeleteBlockReason?.(row, draftRows));
  const allVisibleSelected = selectableVisibleRows.length > 0 && selectableVisibleRows.every((row) => selectedRowKeys.has(row.__rowKey));

  return (
    <div className="fixed inset-0 z-[180] bg-slate-950/55 backdrop-blur-[1px] flex items-stretch sm:p-3">
      <div className="bg-white w-full h-full sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200">
        <div className="px-3 sm:px-4 py-3 border-b border-slate-200 bg-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-slate-900 text-sm sm:text-base">▦ {title}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{subtitle || 'Chỉnh trực tiếp theo dạng bảng. Thay đổi chỉ được ghi khi bấm Lưu.'}</p>
          </div>
          <button type="button" onClick={() => { void handleClose(); }} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Đóng</button>
        </div>

        {tabs && tabs.length > 0 && (
          <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-white flex gap-1.5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => { void handleTabChange(tab.key); }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-extrabold border transition ${activeTab === tab.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm trong bảng..."
            className="h-9 min-w-[180px] flex-1 sm:flex-none sm:w-64 rounded-lg border border-slate-300 bg-white px-3 text-xs"
          />
          {canEdit && canAddRows && createEmptyRow && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1">
              <span className="px-1 text-[10px] font-bold text-slate-500">Số dòng</span>
              <input
                type="number"
                min={1}
                max={50}
                value={insertCount}
                onChange={(event) => setInsertCount(Math.min(50, Math.max(1, Math.trunc(Number(event.target.value) || 1))))}
                className="h-7 w-14 rounded border border-slate-200 px-1.5 text-center text-xs font-bold"
              />
              <button type="button" onClick={() => addRows('above')} className="h-7 px-2 rounded border border-slate-200 bg-white text-[10px] font-bold hover:bg-slate-100">+ Trên</button>
              <button type="button" onClick={() => addRows('below')} className="h-7 px-2 rounded border border-slate-200 bg-white text-[10px] font-bold hover:bg-slate-100">+ Dưới</button>
            </div>
          )}
          {canEdit && canDeleteRows && (
            <button type="button" onClick={() => { void deleteSelectedRows(); }} disabled={selectedRowKeys.size === 0 && !activeCellRef.current?.rowKey} className="h-9 px-3 rounded-lg border border-rose-200 bg-white text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
              Xóa dòng{selectedRowKeys.size > 0 ? ` (${selectedRowKeys.size})` : ''}
            </button>
          )}
          <button type="button" disabled={!undoStack.length} onClick={undo} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Hoàn tác</button>
          <button type="button" disabled={!redoStack.length} onClick={redo} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Làm lại</button>
          <span className="text-[10px] font-bold text-slate-500 ml-auto">{filteredRows.length}/{draftRows.length} dòng</span>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100">
          <table className="min-w-max w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-20">
              <tr>
                {rowOperationsEnabled && (
                  <th className="sticky left-0 z-40 bg-slate-200 border-r border-b border-slate-300 px-2 py-2 text-center w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        const next = new Set(selectedRowKeys);
                        selectableVisibleRows.forEach((row) => event.target.checked ? next.add(row.__rowKey) : next.delete(row.__rowKey));
                        setSelectedRowKeys(next);
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                      title="Chọn tất cả dòng đang hiển thị"
                    />
                  </th>
                )}
                <th className={`${rowOperationsEnabled ? 'sticky left-10' : 'sticky left-0'} z-30 bg-slate-200 border-r border-b border-slate-300 px-2 py-2 text-center w-12`}>#</th>
                {columns.map((column) => {
                  const sortable = column.sortable !== false;
                  const activeSort = sortState?.key === column.key ? sortState.direction : null;
                  return (
                    <th key={column.key} style={{ minWidth: column.width || 140 }} className="bg-slate-200 border-r border-b border-slate-300 p-0 text-left font-black text-slate-700 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!sortable}
                        onClick={() => handleSort(column)}
                        className={`w-full px-2 py-2 text-left ${sortable ? 'hover:bg-slate-300/70 cursor-pointer' : 'cursor-default'}`}
                        title={sortable ? 'Bấm: tăng dần → giảm dần → thứ tự ban đầu' : undefined}
                      >
                        <span className="inline-flex items-center gap-1">
                          {column.label}
                          {column.editable === false ? ' 🔒' : ''}
                          {activeSort === 'asc' && <span className="text-indigo-700">↑</span>}
                          {activeSort === 'desc' && <span className="text-indigo-700">↓</span>}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIndex) => {
                const deleteBlockReason = getRowDeleteBlockReason?.(row, draftRows) || '';
                const selected = selectedRowKeys.has(row.__rowKey);
                return (
                  <tr key={row.__rowKey} className={`${row.__new ? 'bg-emerald-50/40' : 'bg-white'} ${row.__groupPrimary ? 'border-t-2 border-indigo-200' : ''} ${selected ? 'outline outline-1 outline-inset outline-indigo-300' : ''}`}>
                    {rowOperationsEnabled && (
                      <td className="sticky left-0 z-20 bg-slate-50 border-r border-b border-slate-200 px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={Boolean(deleteBlockReason) && canDeleteRows && !canAddRows}
                          title={deleteBlockReason || 'Chọn dòng'}
                          onChange={(event) => {
                            const next = new Set(selectedRowKeys);
                            if (event.target.checked) next.add(row.__rowKey);
                            else next.delete(row.__rowKey);
                            setSelectedRowKeys(next);
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 disabled:opacity-35"
                        />
                      </td>
                    )}
                    <td className={`${rowOperationsEnabled ? 'sticky left-10' : 'sticky left-0'} z-10 bg-slate-50 border-r border-b border-slate-200 px-2 py-1.5 text-center font-bold text-slate-400`}>
                      {row.__groupKey && !row.__groupPrimary ? '↳ ' : ''}{rowIndex + 1}
                    </td>
                    {columns.map((column) => {
                      const key = cellKey(row.__rowKey, column.key);
                      const editable = isColumnEditable(column, row, canEdit);
                      const changed = dirtyCellKeys.has(key);
                      const error = validation.get(key);
                      const value = row[column.key] as QuickGridCellValue;
                      const baseClass = `w-full h-8 px-2 border-0 outline-none bg-transparent text-[11px] ${editable ? 'text-slate-900' : 'text-slate-500 cursor-default'}`;
                      return (
                        <td
                          key={column.key}
                          className={`border-r border-b border-slate-200 p-0 align-middle ${error ? 'bg-rose-100' : changed ? 'bg-sky-100' : editable ? 'bg-white' : 'bg-slate-100'}`}
                          title={error || (!editable ? 'Chỉ đọc ở dòng này' : '')}
                          onFocus={() => { activeCellRef.current = { rowKey: row.__rowKey, columnKey: column.key }; }}
                        >
                          {column.type === 'select' && editable ? (
                            <select
                              value={normalizeCell(value)}
                              onChange={(event) => setCell(row.__rowKey, column, event.target.value)}
                              onPaste={(event) => handlePaste(event, row.__rowKey, column.key)}
                              className={baseClass}
                            >
                              <option value="">-- Chọn --</option>
                              {(column.options || []).map((option) => {
                                const valueOption = typeof option === 'string' ? option : option.value;
                                const label = typeof option === 'string' ? option : option.label;
                                return <option key={valueOption} value={valueOption}>{label}</option>;
                              })}
                            </select>
                          ) : (
                            <input
                              type={column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'}
                              value={normalizeCell(value)}
                              readOnly={!editable}
                              placeholder={column.placeholder}
                              onChange={(event) => setCell(row.__rowKey, column, event.target.value)}
                              onPaste={(event) => handlePaste(event, row.__rowKey, column.key)}
                              className={baseClass}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={columns.length + (rowOperationsEnabled ? 2 : 1)} className="p-8 text-center text-xs text-slate-400">{emptyText}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3 sm:px-4 py-2.5 border-t border-slate-200 bg-white flex flex-wrap items-center gap-2">
          <div className="text-[11px] text-slate-600 mr-auto">
            <strong>{dirtyCellKeys.size}</strong> ô · <strong>{changedRows}</strong> dòng thay đổi chưa lưu
            {deletedRows.length > 0 && <span className="ml-2 text-rose-600 font-bold">· {deletedRows.length} dòng chờ xóa</span>}
            {validation.size > 0 && <span className="ml-2 text-rose-600 font-bold">· {validation.size} lỗi cần sửa</span>}
            {sortState && <span className="ml-2 text-indigo-600 font-bold">· đang sắp xếp hiển thị</span>}
            <span className="hidden sm:inline ml-2 text-slate-400">· Có thể Ctrl+C / Ctrl+V vùng ô từ Excel</span>
          </div>
          {canEdit && (
            <>
              <button type="button" onClick={discard} disabled={!hasChanges} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Bỏ thay đổi</button>
              <button type="button" onClick={handleSave} disabled={saving || !hasChanges || validation.size > 0} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-40">
                {saving ? 'Đang lưu...' : `${saveLabel} (${changedRows})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
