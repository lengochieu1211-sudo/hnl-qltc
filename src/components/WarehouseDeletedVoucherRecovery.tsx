import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { listDeletedWarehouseVouchers, restoreWarehouseTransactionAtomic, discardWarehouseVoucherTrashAtomic, type DeletedWarehouseVoucher } from '../lib/warehouseTransactions';
import { getWarehouseTrashExpiry } from '../utils/warehouseTrashPolicy';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal } from '../utils/numberUtils';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';

/** In the common Trash card; warehouse-only atomic ledger transaction stays separate. */
export const WarehouseDeletedVoucherRecovery: React.FC<{
  projectId: string;
  onCountChange?: (count: number) => void;
  purgeAllToken?: number;
}> = ({ projectId, onCountChange, purgeAllToken = 0 }) => {
  const [rows, setRows] = useState<DeletedWarehouseVoucher[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const projectEpochRef = useRef(0);
  const restorePendingRef = useRef(false);
  const seenPurgeAllTokenRef = useRef(purgeAllToken);
  const busyRef = useRef(false);

  const refresh = async () => {
    if (!projectId || busyRef.current) return;
    const request = ++requestRef.current;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      const result = await listDeletedWarehouseVouchers(projectId);
      if (request === requestRef.current) setRows(result);
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestRef.current) { busyRef.current = false; setBusy(false); }
    }
  };

  useEffect(() => {
    projectEpochRef.current += 1;
    requestRef.current += 1;
    restorePendingRef.current = false;
    busyRef.current = false;
    setRows([]); setError(''); setBusy(false);
    void refresh();
    return () => {
      projectEpochRef.current += 1;
      requestRef.current += 1;
      restorePendingRef.current = false;
      busyRef.current = false;
    };
  }, [projectId]);

  useEffect(() => { onCountChange?.(rows.length); }, [rows, onCountChange]);

  const restore = async (row: DeletedWarehouseVoucher) => {
    if (!projectId || busyRef.current || restorePendingRef.current) return;
    const projectEpoch = projectEpochRef.current;
    restorePendingRef.current = true; busyRef.current = true;
    setBusy(true); setError('');
    let request = 0;
    try {
      if (!(await confirmAsync(`Khôi phục phiếu ${row.type === 'in' ? 'Nhập' : 'Xuất'} ${row.materialName} (${formatDecimal(row.quantity)} ${row.unit})? Tồn kho được điều chỉnh nguyên tử trên Cloud.`))) return;
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
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const discard = async (row: DeletedWarehouseVoucher) => {
    if (!projectId || busyRef.current || restorePendingRef.current) return;
    const projectEpoch = projectEpochRef.current;
    restorePendingRef.current = true; busyRef.current = true;
    setBusy(true); setError('');
    try {
      if (!(await confirmAsync('Bỏ phiếu kho này khỏi Thùng rác? Không thể khôi phục qua giao diện. Chứng từ đã xóa và ảnh vẫn giữ trên Cloud để bảo vệ sổ kho.'))) return;
      if (projectEpoch !== projectEpochRef.current) return;
      const request = ++requestRef.current;
      await discardWarehouseVoucherTrashAtomic(projectId, row.id);
      if (projectEpoch === projectEpochRef.current && request === requestRef.current) {
        setRows((prev) => prev.filter((item) => item.id !== row.id));
      }
    } catch (e) {
      if (projectEpoch === projectEpochRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (projectEpoch === projectEpochRef.current) {
        restorePendingRef.current = false; busyRef.current = false; setBusy(false);
      }
    }
  };

  // Parent's common "Dọn sạch" includes this warehouse recovery section.
  // Re-query the server instead of trusting a possibly stale/partial visible list.
  useEffect(() => {
    if (purgeAllToken === seenPurgeAllTokenRef.current) return;
    seenPurgeAllTokenRef.current = purgeAllToken;
    const epoch = projectEpochRef.current;
    void (async () => {
      if (busyRef.current || restorePendingRef.current || !projectId) {
        setError('Đang có thao tác khác. Hãy bấm Dọn sạch lại sau khi hoàn tất.');
        return;
      }
      busyRef.current = true; restorePendingRef.current = true;
      setBusy(true); setError('');
      try {
        const currentRows = await listDeletedWarehouseVouchers(projectId);
        for (const row of currentRows) {
          if (epoch !== projectEpochRef.current) return;
          await discardWarehouseVoucherTrashAtomic(projectId, row.id);
        }
        if (epoch === projectEpochRef.current) setRows([]);
      } catch (e) {
        if (epoch === projectEpochRef.current) setError('Chưa dọn hết phiếu kho: ' + (e instanceof Error ? e.message : String(e)) + '. Bấm Kiểm tra lại để đối chiếu.');
      } finally {
        if (epoch === projectEpochRef.current) {
          busyRef.current = false; restorePendingRef.current = false; setBusy(false);
        }
      }
    })();
  }, [purgeAllToken]);

  return <div className="space-y-2 border-t border-slate-200 pt-3" data-hnl-warehouse-deleted-recovery="true">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-extrabold text-indigo-800">Phiếu Nhập/Xuất kho · {rows.length} mục trong Thùng rác</p>
      <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold text-indigo-700 disabled:opacity-50">Kiểm tra lại</button>
    </div>
    <p className="text-[10px] text-amber-800">Chỉ ADMIN. Dùng chung thời hạn Thùng rác; phiếu cũ chưa có thời hạn sử dụng mặc định 7 ngày từ lúc xóa. Khôi phục phiếu xuất phải đủ tồn kho. Dọn sạch chỉ bỏ quyền khôi phục, không xóa sổ kho hoặc ảnh R2.</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>}
    {busy && <p className="text-xs text-slate-500">Đang xác minh Cloud…</p>}
    {!busy && rows.length === 0 && !error && <p className="text-xs text-slate-500">Không có phiếu kho còn thời hạn khôi phục.</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto" data-hnl-deleted-voucher-list="true">
      {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
        <div className="min-w-0 flex-1">
          <b>{row.type === 'in' ? 'Nhập' : 'Xuất'} · {row.materialName}</b> · {formatDecimal(row.quantity)} {row.unit}
          <div className="text-[10px] text-slate-500">{formatDateDDMMYYYY(row.date)} · {row.id} · còn {Math.max(0, Math.ceil((getWarehouseTrashExpiry(row) - Date.now()) / 86400000))} ngày</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void restore(row)} className="min-h-10 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50"><RotateCcw className="mr-1 inline h-3.5 w-3.5"/>Khôi phục</button>
          <button type="button" disabled={busy} onClick={() => void discard(row)} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-50"><Trash2 className="mr-1 inline h-3.5 w-3.5"/>Bỏ khỏi Thùng rác</button>
        </div>
      </div>)}
    </div>
  </div>;
};
