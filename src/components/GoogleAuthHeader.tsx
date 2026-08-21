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
  WifiOff,
  Folder,
  Cloud,
  Bell,
  Shield
} from 'lucide-react';
import { UndoRedoControls } from './UndoRedoControls';
import { GoogleAuthStatus } from '../types';
import { GoogleAuthModal } from './GoogleAuthModal';
import { formatDateTime } from '../utils/dateFormatter';
import { useFormatSettings } from '../utils/numberUtils';

import { UserRole } from '../utils/securityUtils';
import { getFirebaseAuthStatus, subscribeToFirebaseAuthStatus } from '../lib/firebase';

interface GoogleAuthHeaderProps {
  projectName: string;
  projectId?: string;
  setProjectName: (name: string) => void;
  onSyncAll: () => Promise<{ success: boolean; url?: string; message?: string }>;
  isSyncing: boolean;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onOpenProjectManager?: (tab?: 'projects' | 'sync') => void;
  onOpenSecurity?: () => void;
  lastUpdatedAt?: number;
  dueDateAlertCount?: number;
  onOpenNotificationCenter?: () => void;
  userRole?: UserRole;
}

export const GoogleAuthHeader: React.FC<GoogleAuthHeaderProps> = ({
  projectName,
  projectId,
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
  onOpenSecurity,
  lastUpdatedAt,
  dueDateAlertCount = 0,
  onOpenNotificationCenter,
  userRole,
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

  useFormatSettings();

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
    setLoadingAuth(true);
    setAuthStatus(getFirebaseAuthStatus());
    setLoadingAuth(false);
  };

  useEffect(() => {
    checkAuthStatus();

    const unsubscribe = subscribeToFirebaseAuthStatus((status) => {
      setAuthStatus(status);
      setLoadingAuth(false);
    });
    return unsubscribe;
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
        <div className="w-full px-3 sm:px-4 py-2.5 sm:py-3">
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
                      className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-1 cursor-pointer hover:text-blue-300 transition-colors truncate"
                      title="Nhấn để sửa tên dự án"
                    >
                      <span className="truncate">{projectName}</span>
                      <span className="text-[10px] text-slate-400 font-normal shrink-0">(Sửa)</span>
                    </h1>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5 min-w-0">
                  {lastUpdatedAt && (
                    <span className="text-[9px] sm:text-[10px] text-slate-400">
                      {formatDateTime(lastUpdatedAt)}
                    </span>
                  )}
                  {projectId && (
                    <span
                      className="text-[8px] sm:text-[9px] text-slate-500 font-mono truncate"
                      title={`Project ID: ${projectId}`}
                    >
                      ID {projectId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status Badges: Network & Google (Icon badges with tooltips) */}
            <div className="flex items-center gap-1.5 shrink-0">
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
                title={authStatus.authenticated ? `Tai khoan Google/Firebase da ket noi (${authStatus.email || authStatus.name})` : 'Nhan de dang nhap Google bang Firebase Auth'}
              >
                <UserCheck className={`w-3.5 h-3.5 shrink-0 ${authStatus.authenticated ? 'text-emerald-400' : 'text-blue-300'}`} />
              </button>
            </div>
          </div>

          {/* Action & Control Toolbar Row */}
          <div className="flex items-center justify-between gap-1.5 bg-slate-800/90 rounded-xl p-1.5 border border-slate-700/70 mt-1.5 shadow-inner overflow-hidden">
            {/* Left: Undo / Redo (Icon arrows only) */}
            <div className="shrink-0">
              <UndoRedoControls
                onUndo={onUndo}
                onRedo={onRedo}
                canUndo={canUndo}
                canRedo={canRedo}
                variant="dark"
                showLabel={false}
              />
            </div>

            {/* Right: Quick Action Buttons - Uniform sizing on mobile, icon + label on PC */}
            <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar shrink min-w-0">
              {/* Notification Bell button */}
              {onOpenNotificationCenter && (
                <button
                  onClick={onOpenNotificationCenter}
                  className="relative p-1.5 sm:px-2.5 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg transition-all shadow-sm active:scale-95 shrink-0 border border-slate-700 cursor-pointer flex items-center justify-center"
                  title="Trung tâm thông báo tiến độ, checklist & defect"
                >
                  <Bell className="w-4 h-4 text-amber-300 shrink-0" />
                  {dueDateAlertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-pulse border border-slate-900 shadow-sm">
                      {dueDateAlertCount > 99 ? '99+' : dueDateAlertCount}
                    </span>
                  )}
                </button>
              )}

              {/* Nút Bảo Mật & Phân Quyền */}
              {onOpenSecurity && (
                <button
                  onClick={onOpenSecurity}
                  className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-200 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 shrink-0 border border-slate-700 cursor-pointer whitespace-nowrap"
                  title="Trung tâm bảo mật, khóa mã PIN & phân quyền"
                >
                  <Shield className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="hidden sm:inline">Bảo Mật</span>
                  {userRole && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                      userRole === 'ADMIN' 
                        ? 'bg-rose-950/90 text-rose-300 border border-rose-700/80' 
                        : userRole === 'ENGINEER' 
                        ? 'bg-blue-950/90 text-blue-300 border border-blue-700/80' 
                        : 'bg-slate-700 text-slate-300 border border-slate-600'
                    }`}>
                      {userRole === 'ADMIN' ? 'Admin' : userRole === 'ENGINEER' ? 'Kỹ Sư' : 'Chỉ Xem'}
                    </span>
                  )}
                </button>
              )}

              {/* Nút Dự án nằm bên trái nút Đồng bộ */}
              {onOpenProjectManager && (
                <button
                  onClick={() => onOpenProjectManager('projects')}
                  className="flex items-center justify-center gap-1.5 bg-indigo-900/90 hover:bg-indigo-800 text-indigo-100 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 shrink-0 border border-indigo-700/70 cursor-pointer whitespace-nowrap"
                  title="Quản lý danh sách dự án"
                >
                  <Folder className="w-4 h-4 text-indigo-300 shrink-0" />
                  <span className="hidden sm:inline">Dự án</span>
                </button>
              )}

              {/* Nút Đồng Bộ mở Trung tâm lưu & đồng bộ dự án */}
              <button
                onClick={() => onOpenProjectManager ? onOpenProjectManager('sync') : handleTriggerSync()}
                disabled={isSyncing}
                className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-extrabold transition-all shadow-sm active:scale-95 shrink-0 cursor-pointer border border-emerald-500/50 whitespace-nowrap"
                title="Trung tâm lưu & đồng bộ dự án"
              >
                <RefreshCw className={`w-4 h-4 text-emerald-100 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{isSyncing ? 'Đang đồng bộ...' : 'Đồng Bộ'}</span>
              </button>

              {/* Nút Báo Cáo PDF & Excel */}
              {onOpenExportPdf && (
                <button
                  onClick={onOpenExportPdf}
                  className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 shrink-0 whitespace-nowrap"
                  title="Xuất Báo Cáo PDF & Excel"
                >
                  <FileText className="w-4 h-4 text-indigo-100 shrink-0" />
                  <span className="hidden sm:inline">Báo Cáo</span>
                </button>
              )}

              {/* Nút Mở Google Sheets */}
              {syncResult?.url && (
                <a
                  href={syncResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs bg-emerald-700/90 hover:bg-emerald-600 text-white p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg font-bold transition-colors shrink-0 shadow-sm whitespace-nowrap"
                  title="Mở Google Sheets"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">Sheets</span>
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
