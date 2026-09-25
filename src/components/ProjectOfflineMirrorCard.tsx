import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, Download, RefreshCw, WifiOff } from 'lucide-react';
import type { FloorPlan } from '../types';
import {
  inspectProjectOfflineMirror,
  prepareProjectOfflineMirror,
  type ProjectOfflineMirrorProgress,
  type ProjectOfflineMirrorSnapshot,
} from '../lib/projectOfflineMirror';
import {
  getProjectOfflineMirrorLastSyncAt,
  isProjectOfflineMirrorEnabled,
  setProjectOfflineMirrorEnabled,
} from '../lib/offlineMirrorSettings';
import { formatDateTime } from '../utils/dateFormatter';
import { cacheFloorPlansForOffline } from '../lib/floorPlanImageSync';

interface Props {
  activeProjectId?: string;
  floorPlans: FloorPlan[];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ProjectOfflineMirrorCard: React.FC<Props> = ({ activeProjectId, floorPlans }) => {
  const projectId = activeProjectId || '';
  const [enabled, setEnabled] = useState(() => isProjectOfflineMirrorEnabled(projectId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<ProjectOfflineMirrorProgress | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectOfflineMirrorSnapshot | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => getProjectOfflineMirrorLastSyncAt(projectId));
  const [floorPlanBusy, setFloorPlanBusy] = useState(false);
  const [floorPlanMessage, setFloorPlanMessage] = useState('');

  const refreshSnapshot = async () => {
    if (!projectId) {
      setSnapshot(null);
      return;
    }
    const next = await inspectProjectOfflineMirror(projectId, floorPlans).catch(() => null);
    setSnapshot(next);
    setLastSyncAt(getProjectOfflineMirrorLastSyncAt(projectId));
  };

  useEffect(() => {
    setEnabled(isProjectOfflineMirrorEnabled(projectId));
    setLastSyncAt(getProjectOfflineMirrorLastSyncAt(projectId));
    setMessage('');
    setProgress(null);
    void refreshSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, floorPlans]);

  const ready = useMemo(() => {
    if (!snapshot) return false;
    return snapshot.photoReady >= snapshot.photoTotal && snapshot.floorPlanReady >= snapshot.floorPlanTotal;
  }, [snapshot]);

  const run = async (keepEnabled = enabled) => {
    if (!projectId || busy || floorPlanBusy) return;
    setBusy(true);
    setMessage('Đang chuẩn bị dữ liệu offline…');
    try {
      if (keepEnabled) setProjectOfflineMirrorEnabled(projectId, true);
      const result = await prepareProjectOfflineMirror(projectId, floorPlans, (next) => {
        setProgress(next);
        setMessage(next.message);
      });
      await refreshSnapshot();
      if (result.photoFailed || result.floorPlanFailed) {
        setMessage(`Đã cập nhật offline; còn ${result.photoFailed + result.floorPlanFailed} mục chưa tải được. Có thể bấm Đồng bộ lại.`);
      } else {
        setMessage('Dự án đã sẵn sàng offline trên thiết bị này. Ảnh/mặt bằng sẽ ưu tiên đọc từ cache local.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setEnabled(isProjectOfflineMirrorEnabled(projectId));
      setLastSyncAt(getProjectOfflineMirrorLastSyncAt(projectId));
    }
  };

  const refreshFloorPlans = async () => {
    if (!projectId || busy || floorPlanBusy) return;
    setFloorPlanBusy(true);
    setFloorPlanMessage('Đang cập nhật riêng mặt bằng offline…');
    try {
      const result = await cacheFloorPlansForOffline(projectId, floorPlans, (next) => {
        setFloorPlanMessage(`Mặt bằng offline ${next.completed}/${next.total}`);
      });
      await refreshSnapshot();
      if (result.failed > 0) {
        setFloorPlanMessage(`Đã cập nhật ${result.cached + result.downloaded}/${result.total} mặt bằng; còn ${result.failed} mục chưa tải được.`);
      } else {
        setFloorPlanMessage(`Mặt bằng offline đã sẵn sàng ${result.cached + result.downloaded}/${result.total}.`);
      }
    } catch (error) {
      setFloorPlanMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setFloorPlanBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!projectId || busy) return;
    const next = !enabled;
    setProjectOfflineMirrorEnabled(projectId, next);
    setEnabled(next);
    if (next) await run(true);
    else setMessage('Đã tắt tự duy trì offline. Cache hiện có vẫn được giữ để tránh phải tải lại; xóa cache là thao tác riêng.');
  };

  const totalBytes = Number(snapshot?.photoBytes || 0) + Number(snapshot?.floorPlanBytes || 0);
  const totalReady = Number(snapshot?.photoReady || 0) + Number(snapshot?.floorPlanReady || 0);
  const totalItems = Number(snapshot?.photoTotal || 0) + Number(snapshot?.floorPlanTotal || 0);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-800">
            <Database className="h-4 w-4 text-emerald-700" /> Dữ liệu offline trên thiết bị
          </div>
          <div className="mt-1 text-[10px] text-slate-600">Giữ dữ liệu dự án, ảnh và mặt bằng trong cache local/IndexedDB để mở nhanh và tiếp tục làm việc khi mất mạng. Cloud vẫn là nguồn chuẩn.</div>
        </div>
        <span className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-extrabold ${ready ? 'border-emerald-200 bg-white text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {ready ? 'Offline sẵn sàng' : `${totalReady}/${totalItems || 0} sẵn sàng`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 text-[9px]">
        <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Ảnh:</b> {snapshot?.photoReady || 0}/{snapshot?.photoTotal || 0}</span>
        <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Mặt bằng:</b> {snapshot?.floorPlanReady || 0}/{snapshot?.floorPlanTotal || 0}</span>
        <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Local:</b> {formatBytes(totalBytes)}</span>
        <span className="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><b>Lần cuối:</b> {lastSyncAt > 0 ? formatDateTime(lastSyncAt) : 'Chưa tải đủ'}</span>
      </div>

      {progress && progress.total > 0 && busy && (
        <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.max(2, Math.min(100, Math.round(progress.completed / progress.total * 100)))}%` }} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!projectId || busy || floorPlanBusy}
          onClick={() => void toggleEnabled()}
          className={`rounded-lg px-3 py-2 text-[10px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-700 hover:bg-slate-800'}`}
        >
          {busy ? <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Đang tải…</span> : enabled ? <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Giữ sẵn offline: Bật</span> : <span className="flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5" /> Bật dùng offline</span>}
        </button>
        <button
          type="button"
          disabled={!projectId || busy || floorPlanBusy || (typeof navigator !== 'undefined' && navigator.onLine === false)}
          onClick={() => void run(enabled)}
          className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[10px] font-extrabold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
        >
          <Download className="h-3.5 w-3.5" /> Đồng bộ offline ngay
        </button>
        <button
          type="button"
          disabled={!projectId || busy || floorPlanBusy || (typeof navigator !== 'undefined' && navigator.onLine === false)}
          onClick={() => void refreshFloorPlans()}
          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-[10px] font-extrabold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${floorPlanBusy ? 'animate-spin' : ''}`} /> {floorPlanBusy ? 'Đang cập nhật mặt bằng…' : 'Cập nhật riêng mặt bằng'}
        </button>
      </div>

      {message && <div className="text-[10px] font-semibold text-emerald-900 break-words">{message}</div>}
      {floorPlanMessage && <div className="text-[10px] font-semibold text-indigo-800 break-words">{floorPlanMessage}</div>}
      <div className="text-[9px] text-slate-500">Tắt chế độ offline không xóa cache local. Không có thao tác nào ở đây tự xóa dữ liệu Cloud/R2.</div>
    </div>
  );
};
