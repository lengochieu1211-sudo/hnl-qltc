import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, HardDrive, RefreshCw, Save, CloudUpload } from 'lucide-react';
import { getCurrentRealFirebaseUser, onAuthUserChanged } from '../lib/firebase';
import {
  getPrimaryDriveConfig,
  getPrimaryDriveQuota,
  PRIMARY_DRIVE_OWNER_EMAIL,
  savePrimaryDriveConfig,
  subscribePrimaryDriveConfig,
  testPrimaryDriveConnection,
  type PrimaryDriveConfig,
  type PrimaryDriveQuota,
} from '../lib/primaryDriveBridge';
import { syncProjectPhotosToCloud } from '../lib/photoCloudSync';
import { getProjectPhotos } from '../utils/photoStorage';
import type { UserRole } from '../utils/securityUtils';
import type { FloorPlan } from '../types';
import { syncFloorPlanImagesToCloud } from '../lib/floorPlanImageSync';

interface Props {
  activeProjectId: string;
  userRole: UserRole;
  floorPlans?: FloorPlan[];
}

function formatBytes(bytes?: number): string {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export const PrimaryDriveStatusCard: React.FC<Props> = ({ activeProjectId, userRole, floorPlans = [] }) => {
  const [config, setConfig] = useState<PrimaryDriveConfig | null>(null);
  const [webAppUrl, setWebAppUrl] = useState('');
  const [quota, setQuota] = useState<PrimaryDriveQuota | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'quota' | 'migrate' | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [photoStats, setPhotoStats] = useState({ total: 0, totalBytes: 0, driveCount: 0, driveBytes: 0, firestoreCount: 0, firestoreBytes: 0 });
  const [currentEmail, setCurrentEmail] = useState(() => String(getCurrentRealFirebaseUser()?.email || '').toLowerCase());

  const isPrimaryOwner = currentEmail === PRIMARY_DRIVE_OWNER_EMAIL;
  const isAdmin = userRole === 'ADMIN';

  const refreshPhotoStats = useCallback(async () => {
    if (!activeProjectId) return;
    const photos = await getProjectPhotos(activeProjectId, false);
    let totalBytes = 0;
    let driveCount = 0;
    let driveBytes = 0;
    let firestoreCount = 0;
    let firestoreBytes = 0;
    photos.forEach((photo) => {
      const size = Math.max(0, Number(photo.fileSize || 0));
      totalBytes += size;
      const cloudRef = String(photo.cloudFileId || photo.cloudUrl || '');
      if (cloudRef.startsWith('drive:')) {
        driveCount++;
        driveBytes += size;
      } else if (cloudRef.startsWith('firestore:')) {
        firestoreCount++;
        firestoreBytes += size;
      }
    });
    setPhotoStats({ total: photos.length, totalBytes, driveCount, driveBytes, firestoreCount, firestoreBytes });
  }, [activeProjectId]);

  useEffect(() => {
    const unsubAuth = onAuthUserChanged((user) => {
      setCurrentEmail(String(user?.email || '').toLowerCase());
      if (user && !user.isAnonymous) {
        getPrimaryDriveConfig(true).then((next) => {
          setConfig(next);
          if (next?.webAppUrl) setWebAppUrl(next.webAppUrl);
        }).catch(() => {});
      }
    });
    const unsubConfig = subscribePrimaryDriveConfig((next) => {
      setConfig(next);
      if (next?.webAppUrl) setWebAppUrl(next.webAppUrl);
    });
    getPrimaryDriveConfig(true).then((next) => {
      setConfig(next);
      if (next?.webAppUrl) setWebAppUrl(next.webAppUrl);
    }).catch(() => {});
    return () => {
      unsubAuth();
      unsubConfig();
    };
  }, []);

  useEffect(() => {
    refreshPhotoStats().catch(() => {});
    const handler = () => refreshPhotoStats().catch(() => {});
    window.addEventListener('qlct-photo-attachments-changed', handler);
    return () => window.removeEventListener('qlct-photo-attachments-changed', handler);
  }, [refreshPhotoStats]);

  const floorPlanStats = useMemo(() => {
    let total = 0;
    let totalBytes = 0;
    let driveCount = 0;
    let firestoreCount = 0;
    (floorPlans || []).forEach((plan) => {
      if (!plan?.imageUrl && !plan?.driveFileId && !plan?.cloudFileId) return;
      total++;
      totalBytes += Math.max(0, Number(plan.imageFileSize || 0));
      if (plan.storageProvider === 'google-drive-primary' || Boolean(plan.driveFileId) || String(plan.cloudFileId || '').startsWith('drive:')) driveCount++;
      else if (plan.storageProvider === 'firestore-fallback' || String(plan.cloudFileId || '').startsWith('firestore:')) firestoreCount++;
    });
    return { total, totalBytes, driveCount, firestoreCount };
  }, [floorPlans]);

  const quotaPercent = useMemo(() => {
    if (!quota?.limitBytes) return 0;
    return Math.min(100, Math.max(0, (quota.usageBytes / quota.limitBytes) * 100));
  }, [quota]);

  const handleSave = async () => {
    try {
      setBusy('save');
      setMessage(null);
      await savePrimaryDriveConfig(webAppUrl, true);
      const next = await getPrimaryDriveConfig(true);
      setConfig(next);
      setMessage({ type: 'ok', text: 'Đã lưu Drive chính cho toàn bộ tài khoản/dự án trong ứng dụng.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    try {
      setBusy('test');
      setMessage(null);
      const res = await testPrimaryDriveConnection(activeProjectId);
      setMessage({ type: 'ok', text: res?.message || `Đã kết nối Drive chính ${PRIMARY_DRIVE_OWNER_EMAIL}.` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleQuota = async () => {
    try {
      setBusy('quota');
      setMessage(null);
      const res = await getPrimaryDriveQuota(activeProjectId);
      setQuota(res);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleMigrate = async () => {
    try {
      setBusy('migrate');
      setMessage({ type: 'info', text: 'Đang chuyển các ảnh Firestore cũ của dự án sang Drive chính. Không đóng ứng dụng...' });
      const result = await syncProjectPhotosToCloud(activeProjectId);
      const floorResult = await syncFloorPlanImagesToCloud(activeProjectId, floorPlans);
      await refreshPhotoStats();
      setMessage({
        type: 'ok',
        text: `Ảnh Defect/Quân số: cập nhật ${result.uploaded}, bỏ qua ${result.skipped}. Ảnh mặt bằng: cập nhật ${floorResult.uploaded}, bỏ qua ${floorResult.skipped}${floorResult.failed ? `, lỗi ${floorResult.failed}` : ''}.`,
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 sm:p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <HardDrive className="w-4 h-4 text-emerald-600 shrink-0" />
            Drive chính An Phú
          </div>
          <div className="text-[11px] text-slate-500 mt-1 break-all">
            Tài khoản lưu file: <span className="font-bold text-emerald-700">{PRIMARY_DRIVE_OWNER_EMAIL}</span>
          </div>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-bold border ${config?.enabled && config?.webAppUrl ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
          {config?.enabled && config?.webAppUrl ? '● Đã cấu hình' : '● Chưa cấu hình'}
        </span>
      </div>

      <p className="text-[11px] leading-5 text-slate-600 mt-2">
        Mỗi người vẫn đăng nhập Gmail riêng. Ảnh Defect, báo quân số và ảnh mặt bằng do ADMIN/ENGINEER tải từ điện thoại/PC sẽ được đưa về Drive tài khoản chính; Firebase giữ dữ liệu dự án và liên kết file.
      </p>

      {isPrimaryOwner && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2.5">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">URL Apps Script Web App (/exec)</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={webAppUrl}
              onChange={(e) => setWebAppUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleSave}
              disabled={busy !== null || !webAppUrl.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy === 'save' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Lưu cấu hình
            </button>
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5">Chỉ {PRIMARY_DRIVE_OWNER_EMAIL} có quyền thay URL này.</div>
        </div>
      )}

      {!isPrimaryOwner && !config?.webAppUrl && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Drive chính chưa được kích hoạt. Cần đăng nhập tài khoản {PRIMARY_DRIVE_OWNER_EMAIL} một lần để nhập URL Apps Script.</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
        <div className="rounded-xl bg-white border border-slate-200 p-2.5">
          <div className="text-[10px] text-slate-400">Ảnh dự án</div>
          <div className="text-sm font-extrabold text-slate-800">{photoStats.total}</div>
          <div className="text-[10px] text-slate-500">{formatBytes(photoStats.totalBytes)}</div>
        </div>
        <div className="rounded-xl bg-white border border-emerald-200 p-2.5">
          <div className="text-[10px] text-emerald-600">Đã ở Drive</div>
          <div className="text-sm font-extrabold text-emerald-700">{photoStats.driveCount}</div>
          <div className="text-[10px] text-slate-500">{formatBytes(photoStats.driveBytes)}</div>
        </div>
        <div className="rounded-xl bg-white border border-amber-200 p-2.5">
          <div className="text-[10px] text-amber-600">Firestore cũ</div>
          <div className="text-sm font-extrabold text-amber-700">{photoStats.firestoreCount}</div>
          <div className="text-[10px] text-slate-500">~{formatBytes(photoStats.firestoreBytes)}</div>
        </div>
        <div className="rounded-xl bg-white border border-cyan-200 p-2.5">
          <div className="text-[10px] text-cyan-700">Ảnh mặt bằng</div>
          <div className="text-sm font-extrabold text-cyan-800">{floorPlanStats.driveCount}/{floorPlanStats.total}</div>
          <div className="text-[10px] text-slate-500">Drive · {formatBytes(floorPlanStats.totalBytes)}</div>
        </div>
        <div className="rounded-xl bg-white border border-blue-200 p-2.5">
          <div className="text-[10px] text-blue-600">Firebase free</div>
          <div className="text-sm font-extrabold text-blue-700">1 GB</div>
          <div className="text-[10px] text-slate-500">Dữ liệu + index</div>
        </div>
      </div>

      {quota && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-700">Google storage tài khoản chính</span>
            <span className="font-extrabold text-emerald-700">{quota.limitBytes ? `${quotaPercent.toFixed(1)}%` : 'Không rõ giới hạn'}</span>
          </div>
          {quota.limitBytes > 0 && (
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-2">
              <div className="h-full bg-emerald-500" style={{ width: `${quotaPercent}%` }} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-500">
            <div>Đã dùng: <b className="text-slate-700">{formatBytes(quota.usageBytes)}</b></div>
            <div>Còn lại: <b className="text-slate-700">{quota.limitBytes ? formatBytes(Math.max(0, quota.limitBytes - quota.usageBytes)) : '—'}</b></div>
            <div>Riêng Drive: <b className="text-slate-700">{formatBytes(quota.usageInDriveBytes)}</b></div>
            <div>Thùng rác: <b className="text-slate-700">{formatBytes(quota.trashBytes)}</b></div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={handleTest}
          disabled={busy !== null || !config?.webAppUrl}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-[11px] font-bold text-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy === 'test' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Kiểm tra kết nối
        </button>
        {isAdmin && (
          <button
            onClick={handleQuota}
            disabled={busy !== null || !config?.webAppUrl}
            className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-[11px] font-bold text-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === 'quota' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
            Xem dung lượng thật
          </button>
        )}
        {isAdmin && (photoStats.firestoreCount > 0 || floorPlanStats.firestoreCount > 0 || floorPlanStats.driveCount < floorPlanStats.total) && (
          <button
            onClick={handleMigrate}
            disabled={busy !== null || !config?.webAppUrl}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy === 'migrate' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
            Đồng bộ toàn bộ ảnh lên Drive
          </button>
        )}
      </div>

      {message && (
        <div className={`mt-3 rounded-xl border p-2.5 text-[11px] flex gap-2 ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : message.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
          {message.type === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : message.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="mt-3 text-[10px] leading-4 text-slate-400">
        “Firestore cũ” chỉ là ước tính phần binary ảnh Defect/Quân số còn nằm trong Firestore của dự án hiện tại. Card “Ảnh mặt bằng” cho biết số mặt bằng đã có file Drive trên tổng số mặt bằng có ảnh. Dung lượng Firestore chính xác toàn database vẫn xem trong Firebase Console. Khi Drive chính hoạt động, ảnh mới ưu tiên Drive; Firestore chỉ giữ metadata và tự fallback nếu Drive tạm lỗi.
      </div>
    </div>
  );
};

export default PrimaryDriveStatusCard;
