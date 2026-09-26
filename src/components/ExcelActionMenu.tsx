import React, { useRef } from 'react';

interface ExcelActionMenuProps {
  onExportEdit: () => void;
  onImportFile?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate?: () => void;
  exportLabel?: string;
  importLabel?: string;
  templateLabel?: string;
  disabled?: boolean;
}

export const ExcelActionMenu: React.FC<ExcelActionMenuProps> = ({
  onExportEdit,
  onImportFile,
  onDownloadTemplate,
  exportLabel = 'Xuất Excel để chỉnh sửa',
  importLabel = 'Nhập Excel đã chỉnh sửa',
  templateLabel = 'Tải Excel mẫu',
  disabled = false,
}) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className={`list-none cursor-pointer select-none text-xs font-extrabold px-3 py-2 rounded-xl border shadow-2xs inline-flex items-center gap-1.5 transition ${disabled ? 'opacity-50 pointer-events-none bg-slate-100 text-slate-400 border-slate-200' : 'bg-white hover:bg-slate-50 text-emerald-700 border-emerald-200'}`}
      >
        <span aria-hidden="true">▤</span> Excel <span aria-hidden="true">▾</span>
      </summary>
      <div className="fixed left-2 right-2 bottom-2 z-[170] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:bottom-auto sm:top-[calc(100%+6px)] sm:w-72">
        <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Dữ liệu chỉnh sửa hàng loạt</div>
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
        <div className="mt-1 border-t border-slate-100 px-2 pt-2 text-[10px] leading-relaxed text-slate-400">
          Xuất/Nhập ở đây dùng để chỉnh dữ liệu. Báo cáo vẫn nằm ở chức năng Báo Cáo/Thống kê riêng.
        </div>
      </div>
    </details>
  );
};
