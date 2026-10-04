import React from 'react';
import { ArrowUpDown, RotateCcw } from 'lucide-react';

export const DEFAULT_QUICK_SORT_MIN_ITEMS = 6;

export type UnifiedSortOrder = 'asc' | 'desc';
export type UnifiedSortKind = 'date' | 'deadline' | 'alpha' | 'number' | 'floor' | 'status' | 'generic';

export interface QuickSortOption<K extends string = string> {
  key: K;
  label: string;
  kind?: UnifiedSortKind;
  defaultOrder?: UnifiedSortOrder;
  title?: string;
}

interface QuickSortBarProps<K extends string = string> {
  options: QuickSortOption<K>[];
  activeKey: K | null;
  order: UnifiedSortOrder;
  onChange: (key: K, order: UnifiedSortOrder) => void;
  onToggleOrder?: () => void;
  onReset?: () => void;
  resetLabel?: string;
  summary?: React.ReactNode;
  className?: string;
  /** Hide the bar while the current list is still short. */
  itemCount?: number;
  /** Default: 6 items. Set 0 to always show. */
  minItems?: number;
}

const getDirectionLabel = (kind: UnifiedSortKind, order: UnifiedSortOrder) => {
  switch (kind) {
    case 'date':
      return order === 'desc' ? 'Mới nhất' : 'Cũ nhất';
    case 'deadline':
      return order === 'asc' ? 'Gần nhất' : 'Xa nhất';
    case 'alpha':
      return order === 'asc' ? 'A → Z' : 'Z → A';
    case 'floor':
      return order === 'asc' ? 'Thấp → cao' : 'Cao → thấp';
    case 'status':
      return order === 'asc' ? 'Lỗi → đạt' : 'Đạt → lỗi';
    case 'number':
    case 'generic':
    default:
      return order === 'asc' ? 'Tăng dần' : 'Giảm dần';
  }
};

export function QuickSortBar<K extends string>({
  options,
  activeKey,
  order,
  onChange,
  onToggleOrder,
  onReset,
  resetLabel = 'Mặc định',
  summary,
  className = '',
  itemCount,
  minItems = DEFAULT_QUICK_SORT_MIN_ITEMS,
}: QuickSortBarProps<K>) {
  if (typeof itemCount === 'number' && itemCount < minItems) return null;
  const activeOption = options.find((option) => option.key === activeKey) || null;
  const toggleDirection = () => {
    if (!activeOption) return;
    if (onToggleOrder) {
      onToggleOrder();
      return;
    }
    onChange(activeOption.key, order === 'asc' ? 'desc' : 'asc');
  };

  const handleMobileSelect = (value: string) => {
    if (!value) {
      onReset?.();
      return;
    }
    const option = options.find((item) => String(item.key) === value);
    if (!option) return;
    onChange(option.key, option.key === activeKey ? order : (option.defaultOrder || 'asc'));
  };

  return (
    <>
      {/* Mobile: one compact row instead of a tall chip block. */}
      <div className={`sm:hidden rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 ${className}`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 font-bold text-[11px] text-slate-600">
            <ArrowUpDown className="h-3.5 w-3.5 text-blue-600" />
            Sắp xếp:
          </span>
          <select
            value={activeKey ? String(activeKey) : ''}
            onChange={(event) => handleMobileSelect(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            aria-label="Chọn tiêu chí sắp xếp"
          >
            {onReset && <option value="">{resetLabel}</option>}
            {!onReset && !activeKey && <option value="">Chọn tiêu chí</option>}
            {options.map((option) => (
              <option key={option.key} value={String(option.key)}>{option.label}</option>
            ))}
          </select>

          {activeOption && (
            <button
              type="button"
              onClick={toggleDirection}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-[10px] font-extrabold text-blue-700 active:scale-95"
              title="Đổi chiều sắp xếp"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {getDirectionLabel(activeOption.kind || 'generic', order)}
            </button>
          )}
        </div>
        {summary && <div className="mt-1.5 truncate text-[10px] font-semibold text-slate-500">{summary}</div>}
      </div>

      {/* Tablet/desktop: keep fast visible chips. */}
      <div className={`hidden sm:block bg-indigo-50/60 border border-indigo-100 rounded-xl px-3 py-2 text-xs text-slate-700 ${className}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 font-bold text-[11px] text-indigo-800">
            <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" />
            Sắp xếp nhanh:
          </span>

          {options.map((option) => {
            const active = option.key === activeKey;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onChange(option.key, active ? order : (option.defaultOrder || 'asc'))}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all active:scale-95 ${
                  active
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                }`}
                title={option.title || `Sắp xếp theo ${option.label.toLocaleLowerCase('vi-VN')}`}
              >
                {option.label}
              </button>
            );
          })}

          {activeOption && (
            <button
              type="button"
              onClick={toggleDirection}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-200 bg-white text-[11px] font-extrabold text-indigo-700 hover:bg-indigo-100 active:scale-95 transition-all"
              title="Đổi chiều sắp xếp"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {getDirectionLabel(activeOption.kind || 'generic', order)}
            </button>
          )}

          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-100 active:scale-95 transition-all"
              title="Trở về sắp xếp mặc định"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {resetLabel}
            </button>
          )}

          {summary && (
            <span className="text-[11px] text-slate-500 font-semibold sm:ml-auto">
              {summary}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
