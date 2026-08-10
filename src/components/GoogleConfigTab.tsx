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
  ArrowDownCircle
} from 'lucide-react';
import { GoogleAuthStatus, FloorPlan } from '../types';
import { ConflictMergeModal } from './ConflictMergeModal';
import { getFirebaseAuthStatus, signInWithGoogleAccount, signOutFirebaseAccount } from '../lib/firebase';
import { saveTextFile } from '../utils/fileExport';

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
  
  localFileHandle,
  localSyncStatus = 'idle',
  localSyncPermissionNeeded = false,
  localFileName = '',
  onLinkLocalFile,
  onUnlinkLocalFile,
  onRequestLocalFilePermission,
  onOpenProjectManager,
}) => {
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus>({ authenticated: false });
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [pendingImportAllData, setPendingImportAllData] = useState<any | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Local Settings State
  const [localProjectName, setLocalProjectName] = useState(projectName);
  const [localContractorName, setLocalContractorName] = useState(contractorName);
  const [localInspectorName, setLocalInspectorName] = useState(inspectorName);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [pendingImportData, setPendingImportData] = useState<any | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);

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
    setCheckingCloud(true);
    try {
      const res = await fetch('/api/drive/sync-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6' }),
      });
      if (!res.ok) {
        throw new Error('Không thể tải dữ liệu từ Google Drive. Vui lòng kiểm tra quyền kết nối.');
      }
      const result = await res.json();
      const localUpdatedAt = parseInt(localStorage.getItem('construction_updated_at') || '0', 10);
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
      const firebaseStatus = await getFirebaseAuthStatus();
      if (firebaseStatus.authenticated) {
        setAuthStatus(firebaseStatus);
        return;
      }

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
      try {
        const status = await signInWithGoogleAccount();
        setAuthStatus(status);
        return;
      } catch (firebaseErr: any) {
        const code = String(firebaseErr?.code || '');
        if (code.includes('operation-not-allowed')) {
          alert('Firebase Google Auth chua duoc bat. Trong Firebase Console vao Authentication > Methode de connexion > Google > Activer.');
          return;
        }
        console.warn('Firebase Google login fallback:', firebaseErr);
      }

      const res = await fetch('/api/auth/url');
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
    await signOutFirebaseAccount();
    await fetch('/api/auth/logout', { method: 'POST' });
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

  // Export JSON Backup
  const handleExportJson = () => {
    if (!fullAppData) return;
    const jsonString = JSON.stringify(fullAppData, null, 2);
    saveTextFile(jsonString, `[Backup_CongTrinh]_${projectName}_${Date.now()}.json`);
  };

  // Copy JSON backup directly to clipboard (for APKs/WebViews where file download is disabled)
  const handleCopyJsonToClipboard = () => {
    if (!fullAppData) return;
    const jsonString = JSON.stringify(fullAppData, null, 2);
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 3000);
    }).catch(err => {
      console.error('Copy failed:', err);
      alert('Không thể tự động sao chép. Vui lòng thử lại hoặc dùng Google Drive để đồng bộ.');
    });
  };

  // Import JSON backup from pasted text
  const handleImportJsonText = () => {
    if (!pasteValue.trim()) {
      alert('Vui lòng dán nội dung JSON backup vào ô trống.');
      return;
    }
    try {
      const parsedData = JSON.parse(pasteValue.trim());
      setPendingImportData(parsedData);
      setShowConflictModal(true);
      setShowPasteArea(false);
      setPasteValue('');
    } catch (err) {
      console.error('JSON parse error from paste:', err);
      alert('Dữ liệu JSON không hợp lệ! Vui lòng kiểm tra lại định dạng dữ liệu đã dán.');
    }
  };

  // Import JSON Backup with Smart Conflict Merge
  const handleExportAllJson = () => {
    try {
      const allData: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = localStorage.getItem(key) || '';
        }
      }
      const jsonString = JSON.stringify(allData, null, 2);
      saveTextFile(jsonString, `Toan_Bo_Du_An_${Date.now()}.json`);
    } catch (e) {
      alert('Lỗi xuất file toàn bộ: ' + e);
    }
  };

  const handleImportAllJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let resultString = event.target?.result as string;
        if (resultString && typeof resultString === 'string' && resultString.startsWith('data:text/json')) {
          const commaIndex = resultString.indexOf(',');
          if (commaIndex !== -1) {
            resultString = decodeURIComponent(resultString.substring(commaIndex + 1));
          }
        }
        const parsedData = JSON.parse(resultString);
        setPendingImportAllData(parsedData);
      } catch (err) {
        console.error("JSON parse error:", err);
        alert('Tệp JSON không hợp lệ!');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let resultString = event.target?.result as string;
        // In case the file was saved with the data URI prefix by some browsers
        if (resultString && typeof resultString === 'string' && resultString.startsWith('data:text/json')) {
          const commaIndex = resultString.indexOf(',');
          if (commaIndex !== -1) {
            resultString = decodeURIComponent(resultString.substring(commaIndex + 1));
          }
        }
        const parsedData = JSON.parse(resultString);
        setPendingImportData(parsedData);
        setShowConflictModal(true);
      } catch (err) {
        console.error("JSON parse error:", err);
        alert('Tệp JSON không hợp lệ! Vui lòng chọn tệp backup đúng định dạng.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto text-xs">
      {/* Title */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-indigo-600" />
          Cài Đặt Dự Án
        </h2>
        <p className="text-xs text-slate-500">Quản lý thông tin công trình &amp; cài đặt tiến độ mục tiêu từng tầng</p>
      </div>

      {/* PROJECT SETTINGS FORM CARD */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-1.5 text-xs">
          <Save className="w-4 h-4 text-blue-600" /> Thông Tin &amp; Thiết Lập Công Trình
        </h3>

        <form onSubmit={handleSaveSettings} className="space-y-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">Tên Dự Án / Tòa Nhà</label>
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
              <label className="block text-slate-700 font-bold mb-1">Đơn Vị Thi Công</label>
              <input
                type="text"
                value={localContractorName}
                onChange={(e) => setLocalContractorName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="Tên công ty / đội thợ"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1">Kỹ Sư Giám Sát</label>
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
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 text-xs"
          >
            <Save className="w-4 h-4" />
            Lưu Cài Đặt Dự Án Ngay
          </button>
        </form>

        {saveSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
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



      {/* Smart Conflict Resolution & Merge Modal */}
      {showConflictModal && pendingImportData && (
        <ConflictMergeModal
          localData={fullAppData}
          importedData={pendingImportData}
          onClose={() => {
            setShowConflictModal(false);
            setPendingImportData(null);
          }}
          onApplyMerged={(merged) => {
            if (onRestoreData) {
              onRestoreData(merged);
              alert('🎉 Đã hợp nhất và khôi phục dữ liệu thành công!');
            }
            setShowConflictModal(false);
            setPendingImportData(null);
          }}
        />
      )}

      {/* CONFIRM IMPORT ALL OVERWRITE MODAL */}
      {pendingImportAllData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[250] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 border border-rose-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Khôi Phục Toàn Bộ Dự Án</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Bạn có chắc chắn muốn khôi phục <strong className="text-rose-600 font-bold">TOÀN BỘ DỰ ÁN</strong> không? Thao tác này sẽ ghi đè toàn bộ dữ liệu hiện tại trên thiết bị.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingImportAllData(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  for (const key in pendingImportAllData) {
                    if (key.startsWith('construction_') || key.startsWith('active_project_id')) {
                      localStorage.setItem(key, pendingImportAllData[key]);
                    }
                  }
                  alert('Khôi phục toàn bộ thành công!');
                  window.location.reload();
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-xs"
              >
                Xác Nhận Ghi Đè
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
