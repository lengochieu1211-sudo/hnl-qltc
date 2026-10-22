import React from 'react';
import {RefreshCw,AlertTriangle} from 'lucide-react';
import type {WarehouseOrderSync} from '../hooks/useWarehouseOrderSync';

/** Inline inside the existing Health Center > System & Sync status; no extra sync surface. */
export const WarehouseOrderSyncPanel:React.FC<{sync:WarehouseOrderSync;canEdit:boolean}>=({sync,canEdit})=>{
  const {cloudState,pendingCount,conflicts,cloudError,saveError,eligibleLegacyCount}=sync;
  // A failed local queue write is never reported as synced, even if Firestore is online.
  const phase=saveError?'Không lưu được bản nháp':cloudError||cloudState==='error'?'Lỗi đồng bộ':
    conflicts.length?'Có xung đột':cloudState==='offline'?'Ngoại tuyến':
    pendingCount?'Chờ đồng bộ':cloudState==='loading'?'Đang kết nối':'Đã đồng bộ';
  const statusColor=saveError||cloudError||cloudState==='error'?'text-rose-700':
    conflicts.length||pendingCount?'text-amber-700':
    cloudState==='offline'||cloudState==='loading'?'text-slate-600':'text-emerald-700';
  return <section data-hnl-health-center-warehouse-order="integrated" className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs" aria-label="Đồng bộ phiếu đặt hàng">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <b className="text-slate-800">Đặt hàng vật tư / thiết bị</b>
      <span role="status" aria-live="polite" className={`${statusColor} font-semibold`}>{phase}</span>
    </div>
    <p className="text-slate-600 text-[11px]">{pendingCount} thay đổi chờ · {conflicts.length} dòng xung đột</p>
    {(cloudError||saveError)&&<p role="alert" className="text-rose-700">{cloudError||'Không lưu được hàng chờ trên thiết bị; cần kiểm tra bộ nhớ.'}</p>}
    {conflicts.length>0&&<p role="alert" className="text-amber-800 flex items-start gap-1"><AlertTriangle size={14} className="shrink-0"/>Dữ liệu máy được giữ nguyên, không tự ghi đè từ Cloud.</p>}
    {canEdit&&(pendingCount>0||conflicts.length>0||eligibleLegacyCount>0)&&<div className="flex flex-wrap gap-2">
      {pendingCount>0&&<button type="button" disabled={cloudState!=='ready'} onClick={sync.flushPending} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw size={14} className="mr-1 inline"/>Thử đồng bộ lại</button>}
      {conflicts.length>0&&<button type="button" onClick={sync.acceptCloudConflicts} className="min-h-10 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-800">Lấy bản Cloud (xác nhận)</button>}
      {eligibleLegacyCount>0&&<button type="button" disabled={cloudState!=='ready'} onClick={sync.importLocalDraft} className="min-h-10 rounded-lg border border-indigo-300 px-3 text-xs font-semibold text-indigo-700 disabled:opacity-50">Khôi phục {eligibleLegacyCount} dòng nháp cũ</button>}
    </div>}
  </section>;
};
