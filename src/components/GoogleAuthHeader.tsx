import React, { useState, useEffect } from 'react';
import { 
  CloudCheck, 
  RefreshCw, 
  FileSpreadsheet, 
  CheckCircle2, 
  ExternalLink,
  FileText,
  UserCheck,
  Wifi,
  WifiOff
} from 'lucide-react';
import { UndoRedoControls } from './UndoRedoControls';
import { GoogleAuthStatus } from '../types';
import { GoogleAuthModal } from './GoogleAuthModal';

interface GoogleAuthHeaderProps {
  projectName: string;
  setProjectName: (name: string) => void;
  onSyncAll: () => Promise<{ success: boolean; url?: string; message?: string }>;
  isSyncing: boolean;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpenProjectManager?: () => void;
}

export const GoogleAuthHeader: React.FC<GoogleAuthHeaderProps> = ({
  projectName,
  setProjectName,
  onSyncAll,
  isSyncing,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpenProjectManager,
}) => {
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ authenticated: false });
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [syncResult, setSyncResult] = useState<{ url?: string; message?: string } | null>(null);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [tempProjectName, setTempProjectName] = useState(projectName);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const checkAuthStatus = async () => {
    try {
      setLoadingAuth(true);
      const res = await fetch('/api/auth/status');
      if (!res.ok) {
        setAuthStatus({ authenticated: false });
        return;
      }
      const text = await res.text();
      let data: GoogleAuthStatus = { authenticated: false };
      try {
        data = JSON.parse(text);
      } catch {
        data = { authenticated: false };
      }
      setAuthStatus(data);
    } catch (err) {
      console.warn('Auth status check skipped:', err);
      setAuthStatus({ authenticated: false });
    } finally {
      setLoadingAuth(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();

    // Listen to OAuth popup message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        checkAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectGoogle = async () => {
    setIsAuthModalOpen(true);
  };

  const handleTriggerSync = async () => {
    if (!authStatus.authenticated) {
      setIsAuthModalOpen(true);
      return;
    }

    const result = await onSyncAll();
    if (result.success && result.url) {
      setSyncResult({ url: result.url, message: result.message });
    }
  };

  return (
    <>
      <div className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-lg">
        <div className="max-w-md mx-auto px-4 py-3">
          {/* Top Header Row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center p-1.5 shadow-md shrink-0 border border-slate-200/50 select-none">
                <svg viewBox="0 0 95 80" className="w-full h-full">
                  <polygon points="48,0 0,80 28,80 62,23" fill="#284ba0" />
                  <polygon points="67,31 38,80 95,80" fill="#284ba0" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isEditingProject ? (
                    <input
                      type="text"
                      value={tempProjectName}
                      onChange={(e) => setTempProjectName(e.target.value)}
                      onBlur={() => {
                        if (tempProjectName.trim()) setProjectName(tempProjectName.trim());
                        setIsEditingProject(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (tempProjectName.trim()) setProjectName(tempProjectName.trim());
                          setIsEditingProject(false);
                        }
                      }}
                      className="bg-slate-800 text-white text-xs font-semibold px-2 py-0.5 rounded border border-blue-500 outline-none"
                      autoFocus
                    />
                  ) : (
                    <h1 
                      onClick={() => setIsEditingProject(true)}
                      className="text-xs font-bold text-slate-100 flex items-center gap-1 cursor-pointer hover:text-blue-300 transition-colors truncate"
                      title="Nhấn để sửa tên dự án"
                    >
                      <span className="truncate">{projectName}</span>
                      <span className="text-[10px] text-slate-400 font-normal shrink-0">(Sửa)</span>
                    </h1>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px] text-slate-400 truncate">
                    Quản lý thi công &amp; Kho
                  </p>
                  <button
                    onClick={onOpenProjectManager}
                    className="text-[9.5px] font-bold bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 hover:text-white px-1.5 py-0.5 rounded-md border border-indigo-700/60 transition-colors flex items-center gap-1 shrink-0"
                    title="Quản lý dự án, lưu file & đồng bộ"
                  >
                    <span>Dự án</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Status Badges: Network & Google (Icon badges with tooltips) */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Network Status Badge */}
              <div 
                className={`p-1.5 rounded-lg border flex items-center justify-center transition-all ${
                  isOnline 
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' 
                    : 'bg-amber-950/90 text-amber-300 border-amber-600/80 animate-pulse'
                }`}
                title={isOnline ? 'Mạng Trực Tuyến (Online): Dữ liệu lưu thiết bị & đám mây' : 'Chế độ Ngoại Tuyến (Offline): Dữ liệu lưu an toàn trên máy'}
              >
                {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
              </div>

              {/* Google Account Quick Badge */}
              <button
                onClick={handleConnectGoogle}
                className={`p-1.5 rounded-lg border transition-all flex items-center justify-center shrink-0 ${
                  authStatus.authenticated 
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 hover:bg-emerald-900' 
                    : 'bg-blue-950/80 text-blue-300 border-blue-700/80 hover:bg-blue-900'
                }`}
                title={authStatus.authenticated ? `Tài khoản Google Drive đã kết nối (${authStatus.email || authStatus.name})` : 'Nhấn để kết nối Google Drive & Sheets'}
              >
                <UserCheck className={`w-3.5 h-3.5 shrink-0 ${authStatus.authenticated ? 'text-emerald-400' : 'text-blue-300'}`} />
              </button>
            </div>
          </div>

          {/* Action & Control Toolbar Row */}
          <div className="flex items-center justify-between gap-1.5 bg-slate-800/90 rounded-xl p-1.5 border border-slate-700/70 mt-1.5 shadow-inner">
            {/* Left: Undo / Redo (Icon arrows only) */}
            <UndoRedoControls
              onUndo={onUndo}
              onRedo={onRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              variant="dark"
              showLabel={false}
            />

            {/* Right: Quick Action Buttons */}
            <div className="flex items-center gap-1.5">
              {/* 1-Click Google Sync Button */}
              <button
                onClick={handleTriggerSync}
                disabled={isSyncing}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-2.5 py-1.5 rounded-lg text-xs font-extrabold transition-all shadow-sm active:scale-95 shrink-0"
                title="Đồng Bộ Google Sheets & Tự Động Lưu Google Drive"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-100 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Đang đồng bộ...' : 'Đồng Bộ'}</span>
              </button>

              {onOpenExportPdf && (
                <button
                  onClick={onOpenExportPdf}
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 shrink-0"
                  title="Xuất Báo Cáo PDF & Excel"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-100" />
                  <span>Báo Cáo</span>
                </button>
              )}

              {syncResult?.url && (
                <a
                  href={syncResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs bg-emerald-700/90 hover:bg-emerald-600 text-white px-2 py-1.5 rounded-lg font-bold transition-colors shrink-0 shadow-sm"
                  title="Mở Google Sheets"
                >
                  Sheet <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>



          {syncResult?.message && (
            <div className="mt-2 text-[11px] bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 p-2 rounded flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{syncResult.message}</span>
              </div>
              <button 
                onClick={() => setSyncResult(null)} 
                className="text-slate-400 hover:text-white text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Google Auth Modal */}
      <GoogleAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        authStatus={authStatus}
        onRefreshAuth={checkAuthStatus}
      />
    </>
  );
};

