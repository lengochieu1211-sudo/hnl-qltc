import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState, useEffect } from 'react';
import { 
  Cloud, 
  FileSpreadsheet, 
  HardDrive, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw, 
  ShieldCheck, 
  Info,
  LogOut,
  Save,
  Building2,
  User,
  Download,
  Upload,
  Check,
  Clock,
  AlertTriangle,
  ArrowLeftRight,
  History,
  Copy,
  ArrowUpCircle,
  ArrowDownCircle,
  Sliders,
  Calendar,
  Hash
} from 'lucide-react';
import { GoogleAuthStatus, FloorPlan } from '../types';
import { ConflictMergeModal } from './ConflictMergeModal';
import { normalizeImportedData } from '../utils/dataNormalizer';
import { getNumberFormatPreset, setNumberFormatPreset, NumberFormatPreset } from '../utils/numberUtils';
import { getDateFormatPreset, setDateFormatPreset, DateFormatPreset } from '../utils/dateFormatter';
import { useLanguage } from '../context/LanguageContext';
import { apiFetch, hasApiBackend } from '../utils/api';

declare const __BUILD_TIME__: string;

interface GoogleConfigTabProps {
  projectName: string;
  setProjectName: (name: string) => void;
  contractorName: string;
  setContractorName: (name: string) => void;
  inspectorName: string;
  setInspectorName: (name: string) => void;
  floorPlans: FloorPlan[];
  onUpdateFloorPlan?: (id: string, updates: Partial<FloorPlan>) => void;
  onSyncAll: () => Promise<{ success: boolean; url?: string; message?: string }>;
  isSyncing: boolean;
  onRestoreData?: (data: any) => void;
    fullAppData?: any;
  driveSyncStatus: 'synced' | 'syncing' | 'error' | 'idle';
  driveLastSyncTime: string | null;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  onDriveSyncUp: (customFolderId?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  onDriveSyncDown: (customFolderId?: string, forceOverwrite?: boolean) => Promise<{ success: boolean; updated?: boolean; message?: string; error?: string }>;
  activeProjectId?: string;
  
  // Local File Auto Save props
  localFileHandle?: any;
  localSyncStatus?: 'synced' | 'saving' | 'error' | 'idle';
  localSyncPermissionNeeded?: boolean;
  localFileName?: string;
  onLinkLocalFile?: () => void;
  onUnlinkLocalFile?: () => void;
  onRequestLocalFilePermission?: () => void;
  onOpenProjectManager?: () => void;
}

export const GoogleConfigTab: React.FC<GoogleConfigTabProps> = ({
  projectName,
  setProjectName,
  contractorName,
  setContractorName,
  inspectorName,
  setInspectorName,
  floorPlans,
  onUpdateFloorPlan,
  onSyncAll,
  isSyncing,
  onRestoreData,
    fullAppData,
  driveSyncStatus,
  driveLastSyncTime,
  autoSyncEnabled,
  setAutoSyncEnabled,
  onDriveSyncUp,
  onDriveSyncDown,
  activeProjectId,
  
  localFileHandle,
  localSyncStatus = 'idle',
  localSyncPermissionNeeded = false,
  localFileName = '',
  onLinkLocalFile,
  onUnlinkLocalFile,
  onRequestLocalFilePermission,
  onOpenProjectManager,
}) => {
  const { t } = useLanguage();
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ authenticated: false });
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Local Settings State
  const [localProjectName, setLocalProjectName] = useState(projectName);
  const [localContractorName, setLocalContractorName] = useState(contractorName);
  const [localInspectorName, setLocalInspectorName] = useState(inspectorName);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // App Format Preferences State
  const [numberFormatPreset, setNumberFormatPresetState] = useState<NumberFormatPreset>(getNumberFormatPreset());
  const [dateFormatPreset, setDateFormatPresetState] = useState<DateFormatPreset>(getDateFormatPreset());

  const handleNumberFormatChange = (newPreset: NumberFormatPreset) => {
    setNumberFormatPresetState(newPreset);
    setNumberFormatPreset(newPreset);
  };

  const handleDateFormatChange = (newPreset: DateFormatPreset) => {
    setDateFormatPresetState(newPreset);
    setDateFormatPreset(newPreset);
  };

  // Fallbacks for APK/WebView where files cannot download
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [showPasteArea, setShowPasteArea] = useState(false);

  // Drive Backup Comparison State
  const [checkingCloud, setCheckingCloud] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<{
    status: 'newer' | 'older' | 'equal' | 'no_cloud' | null;
    localTimeStr: string;
    cloudTimeStr: string;
    cloudProjectName: string;
    localUpdatedAt: number;
    cloudUpdatedAt: number;
  } | null>(null);

  useEffect(() => {
    setLocalProjectName(projectName);
  }, [projectName]);

  useEffect(() => {
    setLocalContractorName(contractorName);
  }, [contractorName]);

  useEffect(() => {
    setLocalInspectorName(inspectorName);
  }, [inspectorName]);

  // Handle data comparison between device and cloud
  const handleCompareData = async () => {
    if (!hasApiBackend()) {
      alert('Google Drive compare can server backend. Firebase Hosting mien phi dang chay static-only nen tinh nang nay duoc tat.');
      return;
    }
    setCheckingCloud(true);
    try {
      const res = await apiFetch('/api/drive/sync-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6',
          projectId: activeProjectId
        }),
      });
      if (!res.ok) {
        throw new Error('Không thể tải dữ liệu từ Google Drive. Vui lòng kiểm tra quyền kết nối.');
      }
      const result = await res.json();
      const scopedKey = activeProjectId && activeProjectId !== 'default' ? `construction_updated_at_${activeProjectId}` : 'construction_updated_at';
      const localUpdatedAt = parseInt(localStorage.getItem(scopedKey) || localStorage.getItem('construction_updated_at') || '0', 10);
      const localTimeStr = localUpdatedAt ? new Date(localUpdatedAt).toLocaleString('vi-VN') : 'Chưa lưu lần nào';

      if (result.success && result.found && result.data) {
        const remoteData = result.data;
        const remoteUpdatedAt = remoteData.updatedAt || 0;
        const cloudTimeStr = remoteUpdatedAt ? new Date(remoteUpdatedAt).toLocaleString('vi-VN') : 'Chưa rõ';
        const cloudProj = remoteData.projectName || 'Công Trình Mẫu';

        let status: 'newer' | 'older' | 'equal' = 'equal';
        if (localUpdatedAt > remoteUpdatedAt) {
          status = 'newer';
        } else if (remoteUpdatedAt > localUpdatedAt) {
          status = 'older';
        }

        setComparisonResult({
          status,
          localTimeStr,
          cloudTimeStr,
          cloudProjectName: cloudProj,
          localUpdatedAt,
          cloudUpdatedAt: remoteUpdatedAt
        });
      } else {
        setComparisonResult({
          status: 'no_cloud',
          localTimeStr,
          cloudTimeStr: 'Không tìm thấy file trên Drive',
          cloudProjectName: '-',
          localUpdatedAt,
          cloudUpdatedAt: 0
        });
      }
    } catch (err: any) {
      alert('Lỗi khi so sánh dữ liệu: ' + err.message);
    } finally {
      setCheckingCloud(false);
    }
  };

  const checkAuth = async () => {
    try {
      if (!hasApiBackend()) {
        setAuthStatus({ authenticated: false });
        return;
      }
      const res = await apiFetch('/api/auth/status');
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
    } catch (e) {
      console.warn('GoogleConfigTab checkAuth error:', e);
      setAuthStatus({ authenticated: false });
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleConnect = async () => {
    try {
      if (!hasApiBackend()) {
        alert('Google Drive/Sheets OAuth can server backend. Ban web hien dung Firebase Auth/Firestore mien phi.');
        return;
      }
      const res = await apiFetch('/api/auth/url');
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (data.url) {
        window.open(data.url, 'GoogleAuth', 'width=550,height=650');
      } else {
        alert(data.message || 'Hệ thống đang hoạt động ở Chế độ Tự Do. Mọi cài đặt & dữ liệu của bạn đều được lưu 100% tự động.');
      }
    } catch (e) {
      alert('Không thể kết nối dịch vụ Google Auth');
    }
  };

  const handleLogout = async () => {
    if (!hasApiBackend()) {
      setAuthStatus({ authenticated: false });
      return;
    }
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setAuthStatus({ authenticated: false });
  };

  const handleSync = async () => {
    const res = await onSyncAll();
    if (res.url) {
      setSheetUrl(res.url);
      setSyncMsg(res.message || 'Đã đồng bộ thành công!');
    }
  };

  // Save Settings Handler
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = localProjectName.trim() || 'Công Trình Mẫu';
    setProjectName(cleanName);
    setContractorName(localContractorName.trim());
    setInspectorName(localInspectorName.trim());

    setSaveSuccessMsg('🎉 Đã lưu tất cả cài đặt công trình thành công vào bộ nhớ hệ thống!');
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto text-xs">
      
      {/* Title */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-indigo-600" />
          {t('config_title')}
        </h2>
        <p className="text-xs text-slate-500 mb-2">{t('config_subtitle')}</p>
        
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-[11px] text-indigo-800 space-y-1.5 shadow-sm">
          <div className="flex items-center gap-1.5 font-medium">
            <Info className="w-3.5 h-3.5 text-indigo-500" />
            <span>{t('version')}: 1.0.0 (Cập nhật: {__BUILD_TIME__})</span>
          </div>
        </div>
      </div>

      {/* PROJECT SETTINGS FORM CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-1.5 text-xs">
          <Save className="w-4 h-4 text-blue-600" /> Cài Đặt Thông Tin Công Trình
        </h3>

        <form onSubmit={handleSaveSettings} className="space-y-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">{t('project_name')}</label>
            <input
              type="text"
              value={localProjectName}
              onChange={(e) => setLocalProjectName(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              placeholder="Ví dụ: Tòa Nhà HH2 Sunrise Tower"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-700 font-bold mb-1">{t('contractor')}</label>
              <input
                type="text"
                value={localContractorName}
                onChange={(e) => setLocalContractorName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="Tên công ty / đội thợ"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">{t('inspector')}</label>
              <input
                type="text"
                value={localInspectorName}
                onChange={(e) => setLocalInspectorName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="Họ tên người duyệt"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 text-xs cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {t('save_settings')}
          </button>
        </form>

        {saveSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* APP FORMATTING PREFERENCES CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">
        <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-indigo-600" /> {t('formatting_settings')}
          </span>
          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold">
            {t('formatting_subtitle')}
          </span>
        </h3>

        {/* 1. Number Formatting Setting */}
        <div className="space-y-2">
          <label className="block text-slate-800 font-bold flex items-center gap-1.5 text-xs">
            <Hash className="w-3.5 h-3.5 text-indigo-500" /> {t('number_format')}
          </label>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => handleNumberFormatChange('dot_comma')}
              className={`p-3 rounded-xl border text-left flex items-start justify-between transition-all ${
                numberFormatPreset === 'dot_comma'
                  ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-2 ring-indigo-500/20'
                  : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60 text-slate-700'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span>Hàng nghìn: Dấu chấm (.) — Thập phân: Dấu phẩy (,)</span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">
                  Ví dụ: <strong className="text-slate-900 font-extrabold">1.234.567,85</strong> (Chuẩn Việt Nam & Châu Âu)
                </p>
              </div>
              {numberFormatPreset === 'dot_comma' && (
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleNumberFormatChange('comma_dot')}
              className={`p-3 rounded-xl border text-left flex items-start justify-between transition-all ${
                numberFormatPreset === 'comma_dot'
                  ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-2 ring-indigo-500/20'
                  : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60 text-slate-700'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <span>Hàng nghìn: Dấu phẩy (,) — Thập phân: Dấu chấm (.)</span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">
                  Ví dụ: <strong className="text-slate-900 font-extrabold">1,234,567.85</strong> (Chuẩn Mỹ & Quốc tế)
                </p>
              </div>
              {numberFormatPreset === 'comma_dot' && (
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              )}
            </button>
          </div>
        </div>

        {/* 2. Date Formatting Setting */}
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <label className="block text-slate-800 font-bold flex items-center gap-1.5 text-xs pt-1">
            <Calendar className="w-3.5 h-3.5 text-indigo-500" /> {t('date_format')}
          </label>

          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'DD/MM/YYYY', label: 'Ngày / Tháng / Năm', eg: '12/08/2026' },
              { id: 'MM/DD/YYYY', label: 'Tháng / Ngày / Năm', eg: '08/12/2026' },
              { id: 'YYYY-MM-DD', label: 'Năm - Tháng - Ngày', eg: '2026-08-12' },
              { id: 'DD-MM-YYYY', label: 'Ngày - Tháng - Năm', eg: '12-08-2026' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleDateFormatChange(opt.id as DateFormatPreset)}
                className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  dateFormatPreset === opt.id
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/60 text-slate-700'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[11px] font-bold">{opt.id}</span>
                  {dateFormatPreset === opt.id && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Ví dụ: <strong className="text-slate-800">{opt.eg}</strong></p>
              </button>
            ))}
          </div>
        </div>
      </div>



      {/* Floor Plan Target Dates Configuration */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 border-b border-slate-100 pb-2">
          <Clock className="w-4 h-4 text-indigo-500" /> Cài Đặt Tiến Độ Mục Tiêu Từng Tầng
        </h4>
        
        {(!floorPlans || floorPlans.length === 0) ? (
          <p className="text-slate-500 text-[11px] text-center italic py-2">Chưa có tầng nào được tạo. Hãy thêm mặt bằng tầng trước.</p>
        ) : (
          <div className="space-y-3">
            {floorPlans.map((floor) => {
              // Basic warning logic for approaching dates (e.g., within 3 days)
              const checkWarning = (dateStr?: string) => {
                if (!dateStr) return false;
                const target = new Date(dateStr).getTime();
                const now = new Date().getTime();
                const diffDays = (target - now) / (1000 * 60 * 60 * 24);
                return diffDays >= 0 && diffDays <= 3; // within 3 days
              };
              
              const isFrameWarning = checkWarning(floor.targetFrameDate);
              const isBoardWarning = checkWarning(floor.targetBoardDate);
              
              return (
                <div key={floor.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="font-bold text-slate-800 text-[12px]">{floor.floorName}</div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 flex items-center justify-between mb-1">
                        <span>Xong Khung:</span>
                        {isFrameWarning && <AlertTriangle className="w-3 h-3 text-amber-500 animate-pulse" title="Sắp đến hạn!" />}
                      </label>
                      <input 
                        type="date" 
                        value={floor.targetFrameDate || ''}
                        onChange={(e) => onUpdateFloorPlan && onUpdateFloorPlan(floor.id, { targetFrameDate: e.target.value })}
                        className={`w-full border rounded-lg px-2 py-1.5 text-[11px] outline-none transition-colors ${
                          isFrameWarning ? 'border-amber-300 bg-amber-50 focus:ring-amber-500 text-amber-900' : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                    </div>
                    
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 flex items-center justify-between mb-1">
                        <span>Xong Tấm:</span>
                        {isBoardWarning && <AlertTriangle className="w-3 h-3 text-rose-500 animate-pulse" title="Sắp đến hạn!" />}
                      </label>
                      <input 
                        type="date" 
                        value={floor.targetBoardDate || ''}
                        onChange={(e) => onUpdateFloorPlan && onUpdateFloorPlan(floor.id, { targetBoardDate: e.target.value })}
                        className={`w-full border rounded-lg px-2 py-1.5 text-[11px] outline-none transition-colors ${
                          isBoardWarning ? 'border-rose-300 bg-rose-50 focus:ring-rose-500 text-rose-900' : 'border-slate-200 focus:ring-indigo-500'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
