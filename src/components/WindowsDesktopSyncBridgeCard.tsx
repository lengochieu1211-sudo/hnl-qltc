import React, { useMemo, useState } from 'react';
import { FolderSync, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { UserRole } from '../utils/securityUtils';
import { runWindowsDesktopSyncBridge, windowsDesktopBridgeSupported, type WindowsDesktopBridgeResult } from '../lib/windowsDesktopSyncBridge';

interface Props {
  activeProjectId?: string;
  userRole: UserRole;
}

export const WindowsDesktopSyncBridgeCard: React.FC<Props> = ({ activeProjectId, userRole }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<WindowsDesktopBridgeResult | null>(null);
  const supported = useMemo(() => windowsDesktopBridgeSupported(), []);
  const canWrite = userRole !== 'VIEWER';

  const run = async () => {
    setBusy(true);
    setResult(null);
    setMessage('Đang mở Windows Workspace…');
    try {
      const next = await runWindowsDesktopSyncBridge(activeProjectId || '', userRole, setMessage);
      setResult(next);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-extrabold text-slate-800 flex items-center gap-1.5"><FolderSync className="w-4 h-4 text-sky-700" /> Windows Desktop Sync Bridge</div>
          <div className="text-[10px] text-slate-600 mt-1">Đọc queue từ <span className="font-mono">Documents\HNL QLTC\DesktopBridge</span>. Web app kiểm SHA-256 rồi dùng đúng Firebase Auth/RBAC + R2 upload hiện có; EXE không tự ghi Cloud.</div>
        </div>
        <span className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-extrabold ${supported ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {supported ? 'Edge/Chrome sẵn sàng' : 'Không hỗ trợ'}
        </span>
      </div>

      <div className="rounded-lg border border-sky-100 bg-white/80 px-2.5 py-2 text-[10px] text-slate-600 space-y-1">
        <div><b>Cấu trúc staging:</b> <span className="font-mono break-all">Photos/&lt;projectId&gt;/&lt;defect|crewRecord|chat&gt;/&lt;entityId&gt;/&lt;category&gt;/ảnh.jpg</span></div>
        <div><b>Category:</b> defect_before / defect_after / crew_progress / chat_attachment.</div>
        <div><b>Fail-closed:</b> sai project, sai SHA-256, VIEWER, chưa đăng nhập hoặc Cloud chưa verify → không tạo ACK.</div>
        <div><b>Quản lý queue:</b> dùng Sync Center trong Windows Desktop Suite để xem trạng thái từng file, Retry thủ công, mở file nguồn và lịch sử Cloud-verified.</div>
      </div>

      {!canWrite && <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-800"><AlertTriangle className="w-3.5 h-3.5" /> VIEWER chỉ đọc nên Sync Bridge bị khóa.</div>}

      <button
        type="button"
        disabled={busy || !supported || !canWrite || !activeProjectId}
        onClick={() => void run()}
        className="rounded-lg bg-sky-700 px-3 py-2 text-[10px] font-extrabold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
      >
        {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        {busy ? 'Đang đồng bộ…' : 'Chọn HNL QLTC Workspace & đồng bộ'}
      </button>

      {message && <div className="text-[10px] font-semibold text-sky-900 break-words">{message}</div>}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[9px]">
          <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Manifest:</b> {result.manifestItems}</span>
          <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Project:</b> {result.projectItems}</span>
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-800"><b>Cloud-ready:</b> {result.uploaded}</span>
          <span className={`rounded-lg border px-2 py-1.5 ${result.failed ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white'}`}><b>Lỗi:</b> {result.failed}</span>
        </div>
      )}
      {result?.errors?.length ? <div className="max-h-28 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-2 text-[9px] text-rose-800 space-y-1">{result.errors.slice(0, 10).map((err, i) => <div key={`${i}-${err}`}>{err}</div>)}</div> : null}
    </div>
  );
};
