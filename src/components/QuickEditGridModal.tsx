import React, { useEffect, useMemo, useRef, useState } from 'react';
import { confirmAsync } from '../utils/confirmAsync';

export type QuickGridCellValue = string | number | null | undefined;

export interface QuickGridRow {
  __rowKey: string;
  __new?: boolean;
  [key: string]: unknown;
}

export interface QuickGridColumn {
  key: string;
  label: string;
  editable?: boolean;
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
  createEmptyRow?: (index: number) => QuickGridRow;
  onClose: () => void;
  onSave: (rows: QuickGridRow[], dirtyCellKeys: Set<string>) => boolean | void | Promise<boolean | void>;
  saveLabel?: string;
  emptyText?: string;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (key: string) => void;
}

const normalizeCell = (value: unknown) => value === null || value === undefined ? '' : String(value);
const cellKey = (rowKey: string, columnKey: string) => `${rowKey}::${columnKey}`;

export const QuickEditGridModal: React.FC<QuickEditGridModalProps> = ({
  open,
  title,
  subtitle,
  columns,
  rows,
  canEdit = true,
  canAddRows = false,
  createEmptyRow,
  onClose,
  onSave,
  saveLabel = 'Lưu thay đổi',
  emptyText = 'Chưa có dữ liệu.',
  tabs,
  activeTab,
  onTabChange,
}) => {
  const [draftRows, setDraftRows] = useState<QuickGridRow[]>([]);
  const [dirtyCellKeys, setDirtyCellKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Array<{ rows: QuickGridRow[]; dirty: Set<string> }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ rows: QuickGridRow[]; dirty: Set<string> }>>([]);
  const activeCellRef = useRef<{ rowKey: string; columnKey: string } | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const opening = !wasOpenRef.current;
    wasOpenRef.current = true;
    // Realtime/parent refreshes must never wipe an unsaved local draft.
    // Once the draft is clean again, rebase it on the latest canonical rows.
    if (!opening && dirtyCellKeys.size > 0) return;
    setDraftRows(rows.map((row) => ({ ...row })));
    setDirtyCellKeys(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSearch('');
  }, [open, rows, dirtyCellKeys.size]);

  const pushUndo = () => {
    setUndoStack((prev) => [...prev.slice(-29), {
      rows: draftRows.map((row) => ({ ...row })),
      dirty: new Set(dirtyCellKeys),
    }]);
    setRedoStack([]);
  };

  const setCell = (rowKey: string, column: QuickGridColumn, rawValue: string, recordUndo = true) => {
    if (!canEdit || column.editable === false) return;
    if (recordUndo) pushUndo();
    let nextValue: QuickGridCellValue = rawValue;
    if (column.type === 'number') {
      const normalized = rawValue.trim().replace(',', '.');
      nextValue = normalized === '' ? '' : Number(normalized);
    }
    setDraftRows((prev) => prev.map((row) => row.__rowKey === rowKey ? { ...row, [column.key]: nextValue } : row));
    setDirtyCellKeys((prev) => {
      const next = new Set(prev);
      next.add(cellKey(rowKey, column.key));
      return next;
    });
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
    if (!q) return draftRows;
    return draftRows.filter((row) => columns.some((column) =>
      normalizeCell(row[column.key]).toLocaleLowerCase('vi-VN').includes(q)
    ));
  }, [draftRows, columns, search]);

  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setRedoStack((prev) => [...prev, { rows: draftRows.map((row) => ({ ...row })), dirty: new Set(dirtyCellKeys) }]);
    setDraftRows(previous.rows.map((row) => ({ ...row })));
    setDirtyCellKeys(new Set(previous.dirty));
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const redo = () => {
    const nextState = redoStack[redoStack.length - 1];
    if (!nextState) return;
    setUndoStack((prev) => [...prev, { rows: draftRows.map((row) => ({ ...row })), dirty: new Set(dirtyCellKeys) }]);
    setDraftRows(nextState.rows.map((row) => ({ ...row })));
    setDirtyCellKeys(new Set(nextState.dirty));
    setRedoStack((prev) => prev.slice(0, -1));
  };

  const discard = () => {
    setDraftRows(rows.map((row) => ({ ...row })));
    setDirtyCellKeys(new Set());
    setUndoStack([]);
    setRedoStack([]);
  };

  const handleClose = async () => {
    if (dirtyCellKeys.size > 0) {
      const confirmed = await confirmAsync('Có thay đổi chưa lưu trong Bảng chỉnh nhanh. Bỏ thay đổi và đóng?');
      if (!confirmed) return;
    }
    onClose();
  };

  const handleTabChange = async (key: string) => {
    if (key === activeTab) return;
    if (dirtyCellKeys.size > 0) {
      const confirmed = await confirmAsync('Có thay đổi chưa lưu trong bảng hiện tại. Bỏ thay đổi và chuyển bảng?');
      if (!confirmed) return;
      discard();
    }
    onTabChange?.(key);
  };

  const addRows = (count: number) => {
    if (!canEdit || !canAddRows || !createEmptyRow) return;
    pushUndo();
    setDraftRows((prev) => {
      const additions = Array.from({ length: count }, (_, index) => createEmptyRow(prev.length + index));
      setDirtyCellKeys((dirtyPrev) => {
        const dirty = new Set(dirtyPrev);
        additions.forEach((row) => columns.filter((column) => column.editable !== false).forEach((column) => {
          dirty.add(cellKey(row.__rowKey, column.key));
        }));
        return dirty;
      });
      return [...prev, ...additions];
    });
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
    const nextRows = draftRows.map((row) => ({ ...row }));
    const nextDirty = new Set(dirtyCellKeys);
    matrix.forEach((cells, rowOffset) => {
      const row = nextRows[startRow + rowOffset];
      if (!row) return;
      cells.forEach((rawValue, colOffset) => {
        const column = columns[startColumn + colOffset];
        if (!column || column.editable === false) return;
        let value: QuickGridCellValue = rawValue;
        if (column.type === 'number') {
          const normalized = rawValue.trim().replace(',', '.');
          value = normalized === '' ? '' : Number(normalized);
        }
        row[column.key] = value;
        nextDirty.add(cellKey(row.__rowKey, column.key));
      });
    });
    setDraftRows(nextRows);
    setDirtyCellKeys(nextDirty);
  };

  const handleSave = async () => {
    if (!canEdit || dirtyCellKeys.size === 0 || validation.size > 0) return;
    setSaving(true);
    try {
      const result = await onSave(draftRows, dirtyCellKeys);
      if (result === false) return;
      setDirtyCellKeys(new Set());
      setUndoStack([]);
      setRedoStack([]);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const changedRows = new Set<string>([...dirtyCellKeys].map((key: string) => key.split('::')[0])).size;

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
            <>
              <button type="button" onClick={() => addRows(1)} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold hover:bg-slate-100">+ Thêm dòng</button>
              <button type="button" onClick={() => addRows(10)} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold hover:bg-slate-100">+ 10 dòng</button>
            </>
          )}
          <button type="button" disabled={!undoStack.length} onClick={undo} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Hoàn tác</button>
          <button type="button" disabled={!redoStack.length} onClick={redo} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Làm lại</button>
          <span className="text-[10px] font-bold text-slate-500 ml-auto">{filteredRows.length}/{draftRows.length} dòng</span>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100">
          <table className="min-w-max w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-slate-200 border-r border-b border-slate-300 px-2 py-2 text-center w-12">#</th>
                {columns.map((column) => (
                  <th key={column.key} style={{ minWidth: column.width || 140 }} className="bg-slate-200 border-r border-b border-slate-300 px-2 py-2 text-left font-black text-slate-700 whitespace-nowrap">
                    {column.label}{column.editable === false ? ' 🔒' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIndex) => (
                <tr key={row.__rowKey} className={row.__new ? 'bg-emerald-50/40' : 'bg-white'}>
                  <td className="sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 px-2 py-1.5 text-center font-bold text-slate-400">{rowIndex + 1}</td>
                  {columns.map((column) => {
                    const key = cellKey(row.__rowKey, column.key);
                    const editable = canEdit && column.editable !== false;
                    const changed = dirtyCellKeys.has(key);
                    const error = validation.get(key);
                    const value = row[column.key] as QuickGridCellValue;
                    const baseClass = `w-full h-8 px-2 border-0 outline-none bg-transparent text-[11px] ${editable ? 'text-slate-900' : 'text-slate-500 cursor-default'}`;
                    return (
                      <td
                        key={column.key}
                        className={`border-r border-b border-slate-200 p-0 align-middle ${error ? 'bg-rose-100' : changed ? 'bg-sky-100' : editable ? 'bg-white' : 'bg-slate-100'}`}
                        title={error || (column.editable === false ? 'Chỉ đọc' : '')}
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
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="p-8 text-center text-xs text-slate-400">{emptyText}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-3 sm:px-4 py-2.5 border-t border-slate-200 bg-white flex flex-wrap items-center gap-2">
          <div className="text-[11px] text-slate-600 mr-auto">
            <strong>{dirtyCellKeys.size}</strong> ô · <strong>{changedRows}</strong> dòng thay đổi chưa lưu
            {validation.size > 0 && <span className="ml-2 text-rose-600 font-bold">· {validation.size} lỗi cần sửa</span>}
            <span className="hidden sm:inline ml-2 text-slate-400">· Có thể Ctrl+C / Ctrl+V vùng ô từ Excel</span>
          </div>
          {canEdit && (
            <>
              <button type="button" onClick={discard} disabled={dirtyCellKeys.size === 0} className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold disabled:opacity-40">Bỏ thay đổi</button>
              <button type="button" onClick={handleSave} disabled={saving || dirtyCellKeys.size === 0 || validation.size > 0} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-40">
                {saving ? 'Đang lưu...' : `${saveLabel} (${changedRows})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
