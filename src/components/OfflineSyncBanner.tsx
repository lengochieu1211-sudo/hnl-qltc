import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw, CheckCircle2, Database, Zap } from 'lucide-react';

interface OfflineSyncBannerProps {
  onAutoSync?: () => Promise<{ success: boolean; message?: string }>;
  isSyncing?: boolean;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({
  onAutoSync,
  isSyncing = false,
}) => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const [offlineChangeCount, setOfflineChangeCount] = useState<number>(0);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [retryNeeded, setRetryNeeded] = useState(false);

  // Monitor network status
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setJustReconnected(true);
      setRetryNeeded(false);
      setSyncStatusMsg('Đã có kết nối. Đang tự đồng bộ...');

      // Auto trigger sync if provided
      if (onAutoSync) {
        try {
          const res = await onAutoSync();
          if (res.success) {
            setSyncStatusMsg('Đã đồng bộ dữ liệu ngoại tuyến.');
            localStorage.removeItem('construction_offline_pending');
            setOfflineChangeCount(0);
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

    // Track changes saved to localStorage while offline
    const handleStorageChange = () => {
      if (!navigator.onLine) {
        const currentCount = parseInt(localStorage.getItem('construction_offline_pending') || '0', 10);
        localStorage.setItem('construction_offline_pending', String(currentCount + 1));
        setOfflineChangeCount(currentCount + 1);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [onAutoSync]);

  if (isOnline && !justReconnected && !syncStatusMsg) {
    return null;
  }

  return (
    <div className="w-full transition-all duration-300">
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-amber-950 text-amber-200 border-b border-amber-800/80 px-4 py-2 text-xs flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <div className="truncate">
              <span className="font-extrabold text-white mr-1">Đang làm việc ngoại tuyến:</span>
              <span className="text-amber-300">
                Dữ liệu được lưu tạm trên thiết bị và sẽ tự đồng bộ khi có mạng lại.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="bg-amber-900/90 text-amber-300 font-mono text-[10px] px-2 py-0.5 rounded-full border border-amber-700/60 flex items-center gap-1">
              <Database className="w-3 h-3 text-amber-400" />
              <span>Đã lưu máy</span>
            </span>
          </div>
        </div>
      )}

      {/* Reconnected Banner */}
      {isOnline && (justReconnected || syncStatusMsg) && (
        <div className="bg-emerald-950 text-emerald-200 border-b border-emerald-800 px-4 py-2 text-xs flex items-center justify-between gap-2 shadow-md animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-white">{syncStatusMsg || '📶 Đã có kết nối Internet trở lại!'}</span>
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
