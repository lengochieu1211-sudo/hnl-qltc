import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState, useEffect, useMemo } from 'react';
import { APP_VERSION_LABEL } from '../config/appVersion';
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
  Hash,
  Trash2,
  RotateCcw,
  Eraser
} from 'lucide-react';
import { GoogleAuthStatus, FloorPlan } from '../types';
import { ConflictMergeModal } from './ConflictMergeModal';
import { normalizeImportedData } from '../utils/dataNormalizer';
import { getNumberFormatPreset, setNumberFormatPreset, NumberFormatPreset } from '../utils/numberUtils';
import { getDateFormatPreset, setDateFormatPreset, DateFormatPreset } from '../utils/dateFormatter';
import { useLanguage } from '../context/LanguageContext';
import { apiFetch, hasApiBackend } from '../utils/api';
import { getImageQualityProfile, getImageQualitySettings, setImageQualitySettings, ImageQualityKind, ImageQualityPreset } from '../utils/imageQualitySettings';
import type { UserRole } from '../utils/securityUtils';
import type { TrashOperation, TrashSettings, TrashRetentionDays } from '../lib/trash';

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

  // Lightweight project trash (metadata only; no Base64/blob duplication).
  userRole?: UserRole;
  trashSettings?: TrashSettings;
  trashOperations?: TrashOperation[];
  onTrashSettingsChange?: (settings: TrashSettings) => void;
  onRestoreTrashOperation?: (operationId: string) => void | Promise<void>;
  onPurgeTrashOperation?: (operationId: string) => void | Promise<void>;
  onEmptyTrash?: () => void | Promise<void>;
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
  userRole = 'VIEWER',
  trashSettings = { enabled: true, retentionDays: 7 },
  trashOperations = [],
  onTrashSettingsChange,
  onRestoreTrashOperation,
  onPurgeTrashOperation,
  onEmptyTrash,
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
  const [imageQualitySettings, setImageQualitySettingsState] = useState(getImageQualitySettings());
  const trashApproxBytes = useMemo(() => trashOperations.reduce((sum, item) => sum + Number(item.approxBytes || 0), 0), [trashOperations]);
  const formatTrashBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleImageQualityChange = (kind: ImageQualityKind, preset: ImageQualityPreset) => {
    const next = { ...imageQualitySettings, [kind]: preset };
    setImageQualitySettingsState(next);
    setImageQualitySettings(next);
  };

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
    if (userRole !== 'ADMIN') {
      setSaveSuccessMsg('Chỉ ADMIN được thay đổi thông tin công trình dùng chung.');
      setTimeout(() => setSaveSuccessMsg(null), 3500);
      return;
    }
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
            <span>{t('version')}: {APP_VERSION_LABEL} (Cập nhật: {__BUILD_TIME__})</span>
          </div>
        </div>
      </div>

      {/* PROJECT SETTINGS FORM CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-1.5 text-xs">
          <Save className="w-4 h-4 text-blue-600" /> Thông tin công trình
        </h3>

        <form onSubmit={handleSaveSettings} className="space-y-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">{t('project_name')}</label>
            <input
              type="text"
              value={localProjectName}
              onChange={(e) => setLocalProjectName(e.target.value)}
              disabled={userRole !== 'ADMIN'}
              className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
              placeholder="Ví dụ: LTIA Sân bay Long Thành"
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
                disabled={userRole !== 'ADMIN'}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                placeholder="Tên công ty / đội thợ"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">{t('inspector')}</label>
              <input
                type="text"
                value={localInspectorName}
                onChange={(e) => setLocalInspectorName(e.target.value)}
                disabled={userRole !== 'ADMIN'}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                placeholder="Họ tên người duyệt"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={userRole !== 'ADMIN'}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 text-xs cursor-pointer disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {t('save_settings')}
          </button>
        </form>

        {userRole !== 'ADMIN' && (
          <p className="text-[10px] text-slate-500">Thông tin công trình là dữ liệu dùng chung. ENGINEER/VIEWER chỉ xem; ADMIN mới được sửa để tránh lệch tên giữa các thiết bị.</p>
        )}

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


      {/* IMAGE QUALITY & STORAGE CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">
        <div className="border-b border-slate-100 pb-2">
          <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
            <Sliders className="w-4 h-4 text-indigo-600" /> Chất lượng ảnh & dung lượng
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">Mặt bằng ưu tiên độ nét chữ; Defect ưu tiên chi tiết lỗi; Quân số ưu tiên cân bằng tốc độ đồng bộ. Thiết lập lưu trên thiết bị này.</p>
        </div>
        {([
          { kind: 'floorPlan' as const, title: 'Mặt bằng', note: 'PDF/ảnh bản vẽ. Tự động: khoảng 3.200 px trên điện thoại, 4.800 px trên PC; mức Gần gốc vẫn có giới hạn an toàn RAM.', options: ['auto','economy','standard','high','original'] as ImageQualityPreset[] },
          { kind: 'defect' as const, title: 'Ảnh Defect', note: 'Mặc định 1.600 px, ưu tiên nhìn rõ khe, vít, nứt và vị trí lỗi.', options: ['economy','standard','high','original'] as ImageQualityPreset[] },
          { kind: 'crew' as const, title: 'Ảnh báo quân số / thi công', note: 'Mặc định 1.440 px để xem rõ nhưng đồng bộ nhanh hơn.', options: ['economy','standard','high','original'] as ImageQualityPreset[] },
        ]).map((group) => (
          <div key={group.kind} className="space-y-1.5 border-b border-slate-100 last:border-b-0 pb-3 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <div><div className="font-extrabold text-slate-800 text-[11px]">{group.title}</div><div className="text-[10px] text-slate-500">{group.note}</div></div>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 shrink-0">{getImageQualityProfile(group.kind, imageQualitySettings[group.kind]).label}</span>
            </div>
            <div className={`grid gap-1.5 ${group.options.length >= 5 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {group.options.map((preset) => {
                const labels: Record<ImageQualityPreset, string> = { auto: 'Tự động', economy: 'Tiết kiệm', standard: 'Tiêu chuẩn', high: 'Cao', original: group.kind === 'floorPlan' ? 'Gần gốc' : 'Rất cao' };
                const active = imageQualitySettings[group.kind] === preset;
                return <button key={preset} type="button" onClick={() => handleImageQualityChange(group.kind, preset)} className={`px-2 py-2 rounded-xl border text-[10px] font-bold transition-all ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>{labels[preset]}</button>;
              })}
            </div>
          </div>
        ))}
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">Lưu ý: “Gốc/Rất cao” làm file lớn và đồng bộ chậm hơn. Với điện thoại nên giữ Mặt bằng = Tự động, Defect = Tiêu chuẩn, Quân số = Tiêu chuẩn.</p>
      </div>



      {/* LIGHTWEIGHT TRASH / RECOVERY CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <Trash2 className="w-4 h-4 text-rose-600" /> Thùng rác dữ liệu
            </h3>
            <p className="text-[10px] text-slate-500 mt-1">
              Chỉ lưu metadata cần khôi phục, không nhân đôi Base64/blob/ảnh nhị phân. Mặc định giữ 7 ngày.
            </p>
          </div>
          <span className={`text-[10px] font-bold rounded-lg px-2 py-1 border shrink-0 ${trashSettings.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
            {trashSettings.enabled ? 'Đang bật' : 'Đang tắt'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-extrabold text-slate-800">Bật Thùng rác</div>
              <div className="text-[10px] text-slate-500">Tắt = xóa không tạo bản khôi phục mới.</div>
            </div>
            <input
              type="checkbox"
              checked={trashSettings.enabled}
              disabled={userRole !== 'ADMIN'}
              onChange={(e) => onTrashSettingsChange?.({ ...trashSettings, enabled: e.target.checked })}
              className="w-4 h-4 accent-indigo-600 disabled:opacity-50"
            />
          </label>

          <label className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="text-[11px] font-extrabold text-slate-800">Tự dọn sau</div>
            <select
              value={trashSettings.retentionDays}
              disabled={userRole !== 'ADMIN' || !trashSettings.enabled}
              onChange={(e) => onTrashSettingsChange?.({ ...trashSettings, retentionDays: Number(e.target.value) as TrashRetentionDays })}
              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold disabled:opacity-50"
            >
              {[3, 7, 15, 30, 60, 90].map((days) => <option key={days} value={days}>{days} ngày</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-[10px]">
          <div className="text-slate-600">
            <b className="text-slate-900">{trashOperations.length}</b> lần xóa · metadata ước tính <b className="text-slate-900">{formatTrashBytes(trashApproxBytes)}</b>
          </div>
          {userRole === 'ADMIN' && trashOperations.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Dọn sạch toàn bộ Thùng rác? Dữ liệu này sẽ không thể khôi phục.')) void onEmptyTrash?.();
              }}
              className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-bold flex items-center gap-1 hover:bg-rose-100"
            >
              <Eraser className="w-3.5 h-3.5" /> Dọn sạch
            </button>
          )}
        </div>

        {!trashSettings.enabled && (
          <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            Thùng rác đang tắt. Các lần xóa mới sẽ không có bản khôi phục; tombstone kỹ thuật nhỏ vẫn được giữ để chống dữ liệu cũ tự sống lại khi realtime đồng bộ.
          </div>
        )}

        {trashOperations.length === 0 ? (
          <div className="text-center text-[11px] text-slate-500 italic py-3">Thùng rác đang trống.</div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {trashOperations.map((operation) => {
              const remainingMs = Math.max(0, Number(operation.expiresAt || 0) - Date.now());
              const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
              const names = (operation.deletedItems || []).slice(0, 3).map((item) => item.label);
              return (
                <div key={operation.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-extrabold text-slate-800 truncate">{names.join(' · ') || 'Dữ liệu đã xóa'}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {new Date(operation.deletedAt).toLocaleString('vi-VN')} · {operation.deletedItems?.length || 0} mục · còn {remainingDays} ngày
                      </div>
                      {operation.deletedByEmail && <div className="text-[9px] text-slate-400 truncate">Xóa bởi: {operation.deletedByEmail}</div>}
                    </div>
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md shrink-0">{formatTrashBytes(Number(operation.approxBytes || 0))}</span>
                  </div>
                  {userRole === 'ADMIN' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onRestoreTrashOperation?.(operation.id)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-emerald-700"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Khôi phục
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Xóa vĩnh viễn mục này khỏi Thùng rác?')) void onPurgeTrashOperation?.(operation.id);
                        }}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-rose-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xóa vĩnh viễn
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {userRole !== 'ADMIN' && (
          <p className="text-[10px] text-slate-500">Chỉ ADMIN được đổi thời gian lưu, khôi phục hoặc xóa vĩnh viễn.</p>
        )}
      </div>

      {/* Floor Plan Target Dates Configuration */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5 border-b border-slate-100 pb-2">
          <Clock className="w-4 h-4 text-indigo-500" /> Cài đặt Tiến Độ Mục Tiêu Từng Tầng
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
