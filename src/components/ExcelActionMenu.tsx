import React, { useRef } from 'react';
import { ChevronDown, Database, FileSpreadsheet } from 'lucide-react';

interface ExcelActionMenuProps {
  onExportEdit: () => void;
  onImportFile?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate?: () => void;
  onExportReport?: () => void;
  onQuickEdit?: () => void;
  exportLabel?: string;
  importLabel?: string;
  templateLabel?: string;
  reportLabel?: string;
  quickEditLabel?: string;
  triggerLabel?: string;
  disabled?: boolean;
  fillMobile?: boolean;
  fillWidth?: boolean;
}

export const ExcelActionMenu: React.FC<ExcelActionMenuProps> = ({
  onExportEdit,
  onImportFile,
  onDownloadTemplate,
  onExportReport,
  onQuickEdit,
  exportLabel = 'Xuất Excel để chỉnh sửa',
  importLabel = 'Nhập Excel đã chỉnh sửa',
  templateLabel = 'Tải Excel mẫu',
  reportLabel = 'Xuất báo cáo Excel',
  quickEditLabel = 'Bảng chỉnh nhanh',
  triggerLabel,
  disabled = false,
  fillMobile = false,
  fillWidth = false,
}) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');
  const dataMenu = Boolean(onQuickEdit);
  const resolvedTriggerLabel = triggerLabel || (dataMenu ? 'Quản lý dữ liệu' : 'Excel');
  const TriggerIcon = dataMenu ? Database : FileSpreadsheet;

  return (
    <details ref={detailsRef} className={`relative shrink-0 ${fillWidth ? 'w-full' : fillMobile ? 'w-full sm:w-auto' : ''}`}>
      <summary
        className={`list-none cursor-pointer select-none whitespace-nowrap text-[11px] sm:text-xs font-extrabold h-9 px-2.5 sm:px-3 rounded-xl border shadow-2xs inline-flex items-center gap-1 transition ${fillWidth ? 'w-full justify-center' : fillMobile ? 'w-full justify-center sm:w-auto' : ''} ${disabled ? 'opacity-50 pointer-events-none bg-slate-100 text-slate-400 border-slate-200' : dataMenu ? 'bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white hover:bg-slate-50 text-emerald-700 border-emerald-200'}`}
      >
        <TriggerIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{resolvedTriggerLabel}</span>
        <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />
      </summary>
      <div className="fixed left-2 right-2 bottom-2 z-[170] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:bottom-auto sm:top-[calc(100%+6px)] sm:w-72">
        <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
          {dataMenu ? 'Quản lý dữ liệu' : 'Dữ liệu chỉnh sửa hàng loạt'}
        </div>
        {onQuickEdit && (
          <>
            <button type="button" onClick={() => { close(); onQuickEdit(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-50">
              ▦ {quickEditLabel}
            </button>
            <div className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Excel</div>
          </>
        )}
        <button type="button" onClick={() => { close(); onExportEdit(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">
          📤 {exportLabel}
        </button>
        {onImportFile && (
          <label className="block w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
            📥 {importLabel}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onClick={() => close()}
              onChange={onImportFile}
            />
          </label>
        )}
        {onDownloadTemplate && (
          <button type="button" onClick={() => { close(); onDownloadTemplate(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">
            📄 {templateLabel}
          </button>
        )}
        {onExportReport && (
          <>
            <div className="mt-1 border-t border-slate-100 px-2 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Báo cáo</div>
            <button type="button" onClick={() => { close(); onExportReport(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">
              📊 {reportLabel}
            </button>
          </>
        )}
        <div className="mt-1 border-t border-slate-100 px-2 pt-2 text-[10px] leading-relaxed text-slate-400">
          {dataMenu
            ? 'Bảng chỉnh nhanh sửa trực tiếp; Excel dùng để xuất, nhập hoặc tải mẫu dữ liệu.'
            : 'Xuất/Nhập dùng để chỉnh dữ liệu; mục Báo cáo chỉ xuất file thống kê và không dùng để nhập ngược.'}
        </div>
      </div>
    </details>
  );
};
