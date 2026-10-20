import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { listDeletedWarehouseVouchers, restoreWarehouseTransactionAtomic, type DeletedWarehouseVoucher } from '../lib/warehouseTransactions';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal } from '../utils/numberUtils';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';

/** Isolated ADMIN-only recovery. Never restore warehouse ledger through generic Trash. */
export const WarehouseDeletedVoucherRecovery: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<DeletedWarehouseVoucher[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A project switch and an async list/restore request are separate invalidation events.
  // Do not compare an operation counter after incrementing it to a pre-confirm value.
  const requestRef = useRef(0);
  const projectEpochRef = useRef(0);
  const restorePendingRef = useRef(false);
  useEffect(() => {
    projectEpochRef.current += 1;
    requestRef.current += 1;
    restorePendingRef.current = false;
    setExpanded(false); setRows([]); setError(''); setBusy(false);
    return () => {
      projectEpochRef.current += 1;
      requestRef.current += 1;
      restorePendingRef.current = false;
    };
  }, [projectId]);
  const refresh = async () => {
    if (!projectId || busy) return;
    const request = ++requestRef.current;
    setBusy(true); setError('');
    try {
      const result = await listDeletedWarehouseVouchers(projectId);
      if (request === requestRef.current) setRows(result);
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (request === requestRef.current) setBusy(false); }
  };
  const restore = async (row: DeletedWarehouseVoucher) => {
    if (!projectId || busy || restorePendingRef.current) return;
    const projectEpoch = projectEpochRef.current;
    // Set the guard before awaiting confirmation to prevent duplicate dialogs/writes.
    restorePendingRef.current = true;
    setBusy(true); setError('');
    let request = 0;
    try {
      if (!(await confirmAsync(`Khôi phục phiếu ${row.type === 'in' ? 'Nhập' : 'Xuất'} ${row.materialName} (${formatDecimal(row.quantity)} ${row.unit})? Tồn kho được điều chỉnh nguyên tử trên Cloud.`))) return;
      // A project change while the confirmation dialog was open must abort safely.
      if (projectEpoch !== projectEpochRef.current) return;
      request = ++requestRef.current;
      await restoreWarehouseTransactionAtomic(projectId, row.id);
      if (projectEpoch === projectEpochRef.current && request === requestRef.current) {
        setRows((prev) => prev.filter((item) => item.id !== row.id));
      }
    } catch (e) {
      if (projectEpoch === projectEpochRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (projectEpoch === projectEpochRef.current) {
        restorePendingRef.current = false;
        setBusy(false);
      }
    }
  };
  return <div className="rounded-xl border border-slate-200 bg-white p-3" data-hnl-warehouse-deleted-recovery="true">
    <button type="button" aria-expanded={expanded} className="flex min-h-10 items-center gap-2 text-xs font-extrabold text-indigo-800"
      onClick={() => { setExpanded((value) => !value); if (!expanded) void refresh(); }}>
      <RotateCcw className="h-4 w-4" /> Phiếu Nhập/Xuất đã xóa · Khôi phục
    </button>
    {expanded && <div className="mt-2 space-y-2" data-hnl-deleted-voucher-list="true">
      <p className="text-[10px] text-amber-800">Chỉ ADMIN. Khôi phục bằng giao dịch Firestore riêng, kiểm tra tồn kho trước khi khôi phục phiếu Xuất. Ảnh vẫn giữ theo mã phiếu; không tự xóa ảnh vĩnh viễn.</p>
      <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-indigo-700 disabled:opacity-50">Kiểm tra lại</button>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>}
      {busy && <p className="text-xs text-slate-500">Đang xác minh Cloud…</p>}
      {!busy && rows.length === 0 && !error && <p className="text-xs text-slate-500">Không có phiếu đã xóa trong phạm vi truy vấn (tối đa 100).</p>}
      <div className="max-h-60 space-y-2 overflow-y-auto">
        {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs">
          <div className="min-w-0 flex-1"><b>{row.type === 'in' ? 'Nhập' : 'Xuất'} · {row.materialName}</b> · {formatDecimal(row.quantity)} {row.unit}<div className="text-[10px] text-slate-500">{formatDateDDMMYYYY(row.date)} · {row.id}</div></div>
          <button type="button" disabled={busy} onClick={() => void restore(row)} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50">Khôi phục</button>
        </div>)}
      </div>
    </div>}
  </div>;
};
