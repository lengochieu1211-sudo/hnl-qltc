import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw, Database } from 'lucide-react';

interface OfflineSyncBannerProps {
  onAutoSync?: () => Promise<{ success: boolean; message?: string }>;
  isSyncing?: boolean;
  userRole?: 'ADMIN' | 'EDITOR' | 'VIEWER';
  roleResolved?: boolean;
  roleSource?: 'cloud' | 'offline-cache' | 'unresolved';
  firestorePendingWriteCount?: number;
  firebaseOnly?: boolean;
  verifiedSnapshotFallback?: boolean;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({
  onAutoSync,
  isSyncing = false,
  userRole = 'VIEWER',
  roleResolved = false,
  roleSource = 'unresolved',
  firestorePendingWriteCount = 0,
  firebaseOnly = false,
  verifiedSnapshotFallback = false,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [retryNeeded, setRetryNeeded] = useState(false);

  // Monitor network status
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setJustReconnected(true);
      setRetryNeeded(false);
      setSyncStatusMsg(firebaseOnly ? 'Đã có kết nối. Firebase đang gửi các thay đổi chờ...' : 'Đã có kết nối. Đang tự đồng bộ...');

      // Auto trigger sync if provided
      if (onAutoSync) {
        try {
          const res = await onAutoSync();
          if (res.success) {
            setSyncStatusMsg('Đã đồng bộ dữ liệu ngoại tuyến.');
          } else {
            setRetryNeeded(true);
            setSyncStatusMsg('Đồng bộ chưa hoàn tất. Bạn có thể thử lại.');
          }
        } catch {
          setRetryNeeded(true);
          setSyncStatusMsg('Đồng bộ chưa hoàn tất. Bạn có thể thử lại.');
        }
      }

      // Hide reconnected banner after 6s
      setTimeout(() => {
        setJustReconnected(false);
        setSyncStatusMsg(null);
      setRetryNeeded(false);
      }, 6000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
      setSyncStatusMsg(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onAutoSync, firebaseOnly]);

  if (isOnline && !justReconnected && !syncStatusMsg) {
    return null;
  }

  return (
    <div className="w-full transition-all duration-300">
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div data-hnl-offline-banner className="bg-amber-50 text-amber-900 border-b border-amber-200 px-3 sm:px-4 py-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 shadow-sm">
          <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0 animate-pulse" />
            <div data-hnl-offline-safety-text className="min-w-0 leading-4">
              <span className="font-extrabold text-amber-900 mr-1">Đang ngoại tuyến:</span>
              <span className="text-amber-900">
                {roleResolved
                  ? (userRole === 'VIEWER'
                    ? (verifiedSnapshotFallback
                      ? 'Bản dữ liệu ngoại tuyến đã xác minh; VIEWER chỉ được xem.'
                      : 'Dữ liệu ngoại tuyến đã xác minh; VIEWER chỉ được xem.')
                    : firebaseOnly
                      ? (verifiedSnapshotFallback
                        ? `Bản dữ liệu đã xác minh; ${userRole} được sửa, thay đổi chờ Firestore.`
                        : `Quyền ${userRole} đã xác minh; thay đổi chờ Firestore khi có mạng.`)
                      : `Quyền ${userRole} đã xác minh; thay đổi lưu trên máy và tự đồng bộ khi có mạng.`)
                  : 'Chưa xác minh quyền ngoại tuyến cho tài khoản và dự án; tạm thời chỉ xem.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto pl-6 sm:pl-0">
            <span data-hnl-offline-status-chip className="bg-white/80 text-amber-900 font-mono text-[10px] px-2 py-0.5 rounded-full border border-amber-300/80 flex items-center gap-1">
              <Database className="w-3 h-3 text-amber-600" />
              <span>{verifiedSnapshotFallback ? `Bản dữ liệu + bộ nhớ máy${firestorePendingWriteCount > 0 ? ` · ${firestorePendingWriteCount} chờ Firestore` : ''}` : firebaseOnly ? `Firestore${firestorePendingWriteCount > 0 ? ` · ${firestorePendingWriteCount} chờ` : ''}` : (roleSource === 'offline-cache' ? 'Dữ liệu ngoại tuyến' : 'Đã lưu máy')}</span>
            </span>
          </div>
        </div>
      )}

      {/* Reconnected Banner */}
      {isOnline && (justReconnected || syncStatusMsg) && (
        <div className="bg-emerald-50 text-emerald-700 border-b border-emerald-200 px-3 sm:px-4 py-2 text-xs flex items-center justify-between gap-2 shadow-sm animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold text-emerald-700">{syncStatusMsg || 'Đã có kết nối Internet trở lại!'}</span>
          </div>
          {onAutoSync && retryNeeded && (
            <button
              type="button"
              onClick={async () => {
                setRetryNeeded(false);
                setSyncStatusMsg('Đang thử đồng bộ lại...');
                const res = await onAutoSync();
                if (res.success) {
                  setSyncStatusMsg('Đã đồng bộ xong.');
                } else {
                  setRetryNeeded(true);
                  setSyncStatusMsg('Đồng bộ vẫn chưa hoàn tất.');
                }
              }}
              disabled={isSyncing}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1 transition-all active:scale-95 shadow shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Đang đồng bộ...' : 'Thử lại'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
