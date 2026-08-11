import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState, useEffect } from 'react';
import {
  X, Plus, Folder, Trash2, HardDrive, Download, Upload, RefreshCw,
  CheckCircle2, AlertTriangle, ShieldCheck, ArrowLeftRight, ChevronDown,
  ChevronUp, Search, Edit3, Check, Building2, Copy, Sparkles, FolderPlus,
  Cloud, CloudUpload, CloudDownload, Smartphone, Monitor, Share2, Layers,
  CheckSquare, Square, FileSpreadsheet, Layers3, CheckCircle, Database, History
} from 'lucide-react';
import { ProjectInfo, getProjectsList, getActiveProjectId, setActiveProject, saveProjectsList } from '../App';
import { safeSetLocalStorageItem } from '../utils/storage';
import { getAllStorageData, getStorageKeys, getStorageItem, removeAsyncItem, setAsyncItem } from '../utils/asyncStorage';
import {
  saveCloudBackup,
  listCloudBackups,
  deleteCloudBackup,
  saveProjectToCloud,
  fetchProjectFromCloud,
  getCloudPayload,
  CloudBackupRecord
} from '../lib/firebase';
import { ConflictMergeModal } from './ConflictMergeModal';
import { confirmAsync } from '../utils/confirmAsync';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'sync' | 'projects';
  onDriveSyncUpAll?: (customFolderId?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  onDriveSyncDownAll?: (customFolderId?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  localAllSyncStatus?: 'synced' | 'saving' | 'error' | 'idle';
  localAllFileName?: string;
  localAllFileHandle?: any;
  localAllSyncPermissionNeeded?: boolean;
  onLinkLocalAllFile?: () => void;
  onUnlinkLocalAllFile?: () => void;
  onRequestLocalAllFilePermission?: () => void;
  handleExportAllJson?: () => void;
  handleImportAllJson?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fullAppData?: any;
  onRestoreData?: (data: any) => void;
  autosaveVersions?: any[];
  onRestoreAutoSaveVersion?: (version: any) => void;
  onCreateManualBackup?: () => void;
  onDeleteAutoSaveVersion?: (id: string) => void;
}

export type ScopeType = 'active' | 'selected' | 'all';

export const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'projects',
  onDriveSyncUpAll,
  onDriveSyncDownAll,
  localAllSyncStatus,
  localAllFileName,
  localAllFileHandle,
  localAllSyncPermissionNeeded,
  onLinkLocalAllFile,
  onUnlinkLocalAllFile,
  onRequestLocalAllFilePermission,
  fullAppData,
  onRestoreData,
  autosaveVersions = [],
  onRestoreAutoSaveVersion,
  onCreateManualBackup,
  onDeleteAutoSaveVersion,
}) => {
  const [projects, setProjects] = useState<ProjectInfo[]>(getProjectsList);
  const [activeId] = useState(getActiveProjectId);
  const [searchQuery, setSearchQuery] = useState('');

  // Scope selection: 'active' (1 dự án), 'selected' (chọn nhiều), 'all' (tất cả)
  const [saveScope, setSaveScope] = useState<ScopeType>('active');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([getActiveProjectId()]);

  // Main navigation tab within the modal
  const [modalTab, setModalTab] = useState<'sync' | 'projects'>('sync');

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [duplicateFromCurrent, setDuplicateFromCurrent] = useState(true);

  // Rename state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingCloudBackupTarget, setDeletingCloudBackupTarget] = useState<{ id: string; name: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cloud Backup & Multi-device Sync State
  const [cloudBackups, setCloudBackups] = useState<CloudBackupRecord[]>([]);
  const [isSavingCloudBackup, setIsSavingCloudBackup] = useState(false);
  const [isLoadingCloudBackups, setIsLoadingCloudBackups] = useState(false);
  const [cloudBackupName, setCloudBackupName] = useState('');
  const [cloudSyncCodeInput, setCloudSyncCodeInput] = useState('');
  const [isSyncingCurrentProject, setIsSyncingCurrentProject] = useState(false);
  const [cloudStatusMsg, setCloudStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Drive sync state
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);

  // Conflict modal & Paste JSON state
  const [pendingImportData, setPendingImportData] = useState<any | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteValue, setPasteValue] = useState('');

  const fetchCloudBackups = async () => {
    try {
      setIsLoadingCloudBackups(true);
      const list = await listCloudBackups();
      setCloudBackups(list);
    } catch (e) {
      console.warn("Lỗi tải danh sách sao lưu đám mây:", e);
    } finally {
      setIsLoadingCloudBackups(false);
    }
  };

  // Re-sync projects when opened
  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setModalTab(initialTab);
      }
      const curList = getProjectsList();
      setProjects(curList);
      const curActive = getActiveProjectId();
      if (!selectedProjectIds.includes(curActive)) {
        setSelectedProjectIds([curActive]);
      }
      fetchCloudBackups();
    }
  }, [isOpen, initialTab]);

  // Toggle project selection for 'selected' scope
  const toggleSelectProject = async (id: string) => {
    if (selectedProjectIds.includes(id)) {
      if (selectedProjectIds.length === 1) return; // keep at least one
      setSelectedProjectIds(selectedProjectIds.filter(p => p !== id));
    } else {
      setSelectedProjectIds([...selectedProjectIds, id]);
    }
  };

  const selectAllProjects = async () => {
    setSelectedProjectIds(projects.map(p => p.id));
  };

  // Helper: Collect storage items for selected scope
  const getStorageDataForScope = async (scope: ScopeType): Promise<Record<string, string>> => {
    const data: Record<string, string> = {};
    const storageData = await getAllStorageData();
    const allKeys = Object.keys(storageData);

    if (scope === 'all') {
      // Collect all keys
      allKeys.forEach(key => {
        if (key.startsWith('construction_') || key.startsWith('active_project_id')) {
          data[key] = storageData[key] || '';
        }
      });
    } else if (scope === 'active') {
      const activeSuffix = activeId === 'default' ? '' : `_${activeId}`;
      allKeys.forEach(key => {
        if (key.startsWith('construction_')) {
          if (activeId === 'default') {
            if (!key.includes('_proj_')) {
              data[key] = storageData[key] || '';
            }
          } else {
            if (key.endsWith(activeSuffix) || key === `construction_project_name_${activeId}`) {
              data[key] = storageData[key] || '';
            }
          }
        }
      });
      data['construction_projects_list'] = storageData['construction_projects_list'] || '[]';
    } else if (scope === 'selected') {
      // Selected specific projects
      selectedProjectIds.forEach(pId => {
        const suffix = pId === 'default' ? '' : `_${pId}`;
        allKeys.forEach(key => {
          if (key.startsWith('construction_')) {
            if (pId === 'default') {
              if (!key.includes('_proj_')) {
                data[key] = storageData[key] || '';
              }
            } else {
              if (key.endsWith(suffix) || key === `construction_project_name_${pId}`) {
                data[key] = storageData[key] || '';
              }
            }
          }
        });
      });
      data['construction_projects_list'] = storageData['construction_projects_list'] || '[]';
    }
    return data;
  };

  // 1. Export JSON based on chosen scope
  const handleExportJsonForScope = async () => {
    try {
      const data = await getStorageDataForScope(saveScope);
      let filename = `Backup_TatCa_${Date.now()}.json`;
      if (saveScope === 'active' && activeId) {
        filename = `Backup_DA_${activeId}_${Date.now()}.json`;
      }
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      await downloadOrShareFile(filename, blob, 'application/json');
    } catch (e) {
      alert('Lỗi xuất tệp JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // 2. Process Imported JSON Data (File or Pasted Text)
  const processImportedJsonData = (parsedData: any) => {
    // Check if it's a structured single-project data object (containing defects, inventory, workVolumes, or roomProgressList)
    if (parsedData && typeof parsedData === 'object' && (parsedData.defects || parsedData.inventory || parsedData.workVolumes || parsedData.roomProgressList || parsedData.projectName)) {
      if (fullAppData) {
        setPendingImportData(parsedData);
        setShowConflictModal(true);
        return;
      } else if (onRestoreData) {
        onRestoreData(parsedData);
        alert('🎉 Khôi phục dữ liệu dự án từ tệp JSON thành công!');
        window.location.reload();
        return;
      }
    }

    // Otherwise, handle as key-value pairs (or multi-project storage dump)
    if (confirm('Bạn có chắc chắn muốn khôi phục dữ liệu từ tệp này? Thao tác sẽ ghi đè các mục tương ứng.')) {
      for (const key in parsedData) {
        if (key.startsWith('construction_') || key.startsWith('active_project_id')) {
          safeSetLocalStorageItem(key, parsedData[key]);
        }
      }
      alert('🎉 Khôi phục dữ liệu từ tệp JSON thành công!');
      window.location.reload();
    }
  };

  const handleImportJsonForScope = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let resultString = event.target?.result as string;
        if (resultString && resultString.startsWith('data:text/json')) {
          const commaIndex = resultString.indexOf(',');
          if (commaIndex !== -1) {
            resultString = decodeURIComponent(resultString.substring(commaIndex + 1));
          }
        }
        const parsedData = JSON.parse(resultString);
        processImportedJsonData(parsedData);
      } catch (err) {
        console.error("JSON parse error:", err);
        alert('Tệp JSON không hợp lệ hoặc bị hỏng!');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestoreFromPastedJson = () => {
    if (!pasteValue.trim()) return;
    try {
      let resultString = pasteValue.trim();
      if (resultString.startsWith('data:text/json')) {
        const commaIndex = resultString.indexOf(',');
        if (commaIndex !== -1) {
          resultString = decodeURIComponent(resultString.substring(commaIndex + 1));
        }
      }
      const parsedData = JSON.parse(resultString);
      processImportedJsonData(parsedData);
      setPasteValue('');
      setShowPasteArea(false);
    } catch (err) {
      alert('Nội dung dán không phải là định dạng JSON hợp lệ!');
    }
  };

  // 3. Create Cloud Backup based on chosen scope
  const handleCreateCloudBackup = async () => {
    try {
      setIsSavingCloudBackup(true);
      setCloudStatusMsg(null);

      const scopeData = getStorageDataForScope(saveScope);
      const items = Object.keys(scopeData).map(k => ({ key: k, value: scopeData[k] }));

      let scopeLabel = 'Toàn bộ hệ thống';
      if (saveScope === 'active') {
        const curName = projects.find(p => p.id === activeId)?.name || 'Dự án hiện tại';
        scopeLabel = `Dự án "${curName}"`;
      } else if (saveScope === 'selected') {
        scopeLabel = `${selectedProjectIds.length} dự án được chọn`;
      }

      const defaultName = cloudBackupName.trim() || `Sao lưu ${scopeLabel} (${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')})`;
      await saveCloudBackup(defaultName, items);

      setCloudBackupName('');
      setCloudStatusMsg({ type: 'success', text: '🎉 Tạo bản sao lưu Đám Mây thành công!' });
      await fetchCloudBackups();
    } catch (err) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi sao lưu đám mây: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setIsSavingCloudBackup(false);
    }
  };

  // Restore Cloud Backup
  const handleRestoreCloudBackup = async (backup: CloudBackupRecord) => {
    if (!confirm(`Bạn có chắc muốn khôi phục bản sao lưu "${backup.backupName}"? Thao tác này sẽ ghi đè dữ liệu tương ứng.`)) {
      return;
    }
    try {
      if (Array.isArray(backup.projects)) {
        backup.projects.forEach((item: { key: string; value: string }) => {
          if (item.key && item.value) {
            safeSetLocalStorageItem(item.key, item.value);
          }
        });
        alert('🎉 Khôi phục dữ liệu từ Đám Mây thành công!');
        window.location.reload();
      }
    } catch (err) {
      alert('Lỗi khi khôi phục bản sao lưu: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Delete Cloud Backup
  const handleDeleteCloudBackup = async (b: { id: string; name: string }) => {
    setDeletingCloudBackupTarget(b);
  };

  const executeDeleteCloudBackup = async () => {
    if (!deletingCloudBackupTarget) return;
    try {
      await deleteCloudBackup(deletingCloudBackupTarget.id);
      await fetchCloudBackups();
    } catch (err) {
      alert('Lỗi xóa bản sao lưu: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingCloudBackupTarget(null);
    }
  };

  // Upload Active Project to Cloud (Sync Code)
  const handleUploadActiveProjectToCloud = async () => {
    try {
      setIsSyncingCurrentProject(true);
      setCloudStatusMsg(null);
      const curId = getActiveProjectId();
      const currentProj = projects.find(p => p.id === curId) || { id: curId, name: 'Dự án hiện tại' };

      const projData = getStorageDataForScope('active');

      await saveProjectToCloud({
        id: curId,
        name: currentProj.name,
        syncCode: curId.toUpperCase().slice(0, 8),
        payload: projData
      });

      setCloudStatusMsg({ type: 'success', text: `✅ Đã đẩy dự án "${currentProj.name}" lên Cloud! Mã Sync: ${curId}` });
    } catch (err) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi đồng bộ đám mây: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setIsSyncingCurrentProject(false);
    }
  };

  // Pull Project from Cloud via Sync Code
  const handlePullProjectFromCloud = async () => {
    if (!cloudSyncCodeInput.trim()) return;
    const targetId = cloudSyncCodeInput.trim();
    try {
      setIsSyncingCurrentProject(true);
      setCloudStatusMsg(null);
      const rec = await fetchProjectFromCloud(targetId);
      if (!rec) {
        alert('Không tìm thấy dự án trên Đám Mây với mã này!');
        return;
      }

      const cloudPayload = getCloudPayload(rec);
      if (cloudPayload) {
        for (const k in cloudPayload) {
          safeSetLocalStorageItem(k, cloudPayload[k]);
        }

        const curList = getProjectsList();
        if (!curList.some(p => p.id === rec.id)) {
          curList.push({ id: rec.id, name: rec.name, createdAt: new Date().toISOString() });
          saveProjectsList(curList);
        }

        setActiveProject(rec.id);
        alert(`🎉 Tải dữ liệu dự án "${rec.name}" từ Đám Mây thành công! Ứng dụng sẽ tự động tải lại.`);
        window.location.reload();
      }
    } catch (err) {
      alert('Lỗi tải dự án đám mây: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSyncingCurrentProject(false);
    }
  };

  // Google Drive Sync Up
  const handleDriveSyncUpAction = async () => {
    if (!onDriveSyncUpAll) return;
    try {
      setIsDriveSyncing(true);
      const res = await onDriveSyncUpAll();
      if (res.success) {
        setCloudStatusMsg({ type: 'success', text: '✅ Đã lưu và đồng bộ toàn bộ lên Google Drive thành công!' });
      } else {
        setCloudStatusMsg({ type: 'error', text: 'Lỗi Google Drive: ' + (res.error || res.message || 'Chưa đăng nhập Google') });
      }
    } catch (e) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi đồng bộ Google Drive: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setIsDriveSyncing(false);
    }
  };

  // Google Drive Sync Down
  const handleDriveSyncDownAction = async () => {
    if (!onDriveSyncDownAll) return;
    try {
      setIsDriveSyncing(true);
      const res = await onDriveSyncDownAll();
      if (res.success) {
        alert('🎉 Tải dữ liệu mới từ Google Drive thành công!');
        window.location.reload();
      } else {
        setCloudStatusMsg({ type: 'error', text: 'Lỗi tải từ Drive: ' + (res.error || res.message || 'Chưa đăng nhập Google') });
      }
    } catch (e) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi tải từ Google Drive: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const handleSwitchProject = (id: string) => {
    if (id === activeId) return;
    setActiveProject(id);
    window.location.reload();
  };

  const handleStartRename = (proj: ProjectInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(proj.id);
    setEditingProjectName(proj.name);
  };

  const handleSaveRename = (id: string) => {
    if (!editingProjectName.trim()) return;
    const trimmed = editingProjectName.trim();
    const updated = projects.map(p => p.id === id ? { ...p, name: trimmed } : p);
    saveProjectsList(updated);
    setProjects(updated);

    safeSetLocalStorageItem(`construction_project_name_${id}`, trimmed);
    if (id === 'default') {
      safeSetLocalStorageItem('construction_project_name', trimmed);
    }

    setEditingProjectId(null);
    if (id === activeId) {
      window.location.reload();
    }
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    try {
      const newProjectId = `proj_${Date.now()}`;
      const newProject: ProjectInfo = {
        id: newProjectId,
        name: newProjectName.trim(),
        createdAt: new Date().toISOString(),
      };

      let hadQuotaIssue = false;

      if (duplicateFromCurrent) {
        const activeSuffix = activeId === 'default' ? '' : `_${activeId}`;
        const newSuffix = `_${newProjectId}`;
        const keysToCopy: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('construction_') && k !== 'construction_projects_list') {
            if (activeId === 'default') {
              if (!k.includes('_proj_')) {
                keysToCopy.push(k);
              }
            } else {
              if (k.endsWith(activeSuffix)) {
                keysToCopy.push(k);
              }
            }
          }
        }

        keysToCopy.forEach(k => {
          const val = localStorage.getItem(k);
          let newKey = activeId === 'default' ? `${k}${newSuffix}` : k.replace(activeSuffix, newSuffix);
          if (newKey && val !== null) {
            const saved = safeSetLocalStorageItem(newKey, val);
            if (!saved) hadQuotaIssue = true;
          }
        });
      }

      safeSetLocalStorageItem(`construction_project_name_${newProjectId}`, newProjectName.trim());

      const updated = [...projects, newProject];
      saveProjectsList(updated);
      setActiveProject(newProject.id);

      if (hadQuotaIssue) {
        alert('Tạo dự án mới thành công! Do bộ nhớ đầy, một số hình ảnh lớn từ dự án cũ đã được bỏ qua.');
      }
      window.location.reload();
    } catch (err) {
      console.error("Error creating project:", err);
      setErrorMessage('Lỗi khi tạo dự án mới: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDeleteProject = (id: string) => {
    if (projects.length === 1) {
      setErrorMessage('Không thể xóa dự án duy nhất!');
      return;
    }
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;

    const updated = projects.filter(p => p.id !== confirmDeleteId);
    saveProjectsList(updated);
    setProjects(updated);

    const keysToRemove: string[] = [];
    const allKeys = await getStorageKeys();
    for (const k of allKeys) {
      if (k && (k.endsWith(`_${confirmDeleteId}`) || k === `construction_project_name_${confirmDeleteId}`)) {
        keysToRemove.push(k);
      }
    }

    for (const k of keysToRemove) {
      await removeAsyncItem(k);
    }

    if (confirmDeleteId === activeId) {
      setActiveProject(updated[0].id);
      window.location.reload();
    }
    setConfirmDeleteId(null);
  };

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-md z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl p-4 md:p-6 shadow-2xl relative border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 text-white rounded-xl shadow-md transition-colors ${modalTab === 'sync' ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
              {modalTab === 'sync' ? <RefreshCw className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                {modalTab === 'sync' ? 'Trung Tâm Lưu & Đồng Bộ Dự Án' : 'Quản Lý Danh Sách Dự Án'}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">
                {modalTab === 'sync'
                  ? 'Lưu trữ cục bộ, Đám mây Firebase, Google Drive & Google Sheets'
                  : 'Tạo mới, chuyển đổi, tìm kiếm và quản lý danh sách dự án công trình'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors cursor-pointer"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-3 mb-1 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 pt-3">

          {/* TAB 1: SAVING & SYNC HUB */}
          {modalTab === 'sync' && (
            <div className="space-y-4">

              {/* 🎯 SECTION 1: SCOPE SELECTOR */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers3 className="w-4 h-4 text-indigo-600" />
                    1. Chọn Phạm Vi Lưu &amp; Đồng Bộ:
                  </span>
                  {saveScope === 'selected' && (
                    <button
                      onClick={selectAllProjects}
                      className="text-[10px] font-bold text-indigo-600 hover:underline"
                    >
                      Chọn tất cả ({projects.length})
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1.5 bg-white p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setSaveScope('active')}
                    className={`py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                      saveScope === 'active'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>1 Dự Án Hiện Tại</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSaveScope('selected')}
                    className={`py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                      saveScope === 'selected'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>Nhiều Dự Án ({selectedProjectIds.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSaveScope('all')}
                    className={`py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                      saveScope === 'all'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>Tất Cả Dự Án ({projects.length})</span>
                  </button>
                </div>

                {/* Scope Description / Multi-Selector */}
                {saveScope === 'active' && (
                  <p className="text-[10.5px] text-slate-500 italic pl-1">
                    📍 Thao tác sẽ chỉ áp dụng cho dự án đang mở: <strong className="text-indigo-900">{projects.find(p => p.id === activeId)?.name}</strong>
                  </p>
                )}

                {saveScope === 'selected' && (
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1.5">
                    <p className="text-[10.5px] font-bold text-slate-700">Tích chọn danh sách dự án cần thao tác:</p>
                    <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                      {projects.map(p => {
                        const isChecked = selectedProjectIds.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectProject(p.id)}
                              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                            />
                            <span className={`font-semibold ${isChecked ? 'text-indigo-900' : 'text-slate-600'}`}>
                              {p.name} {p.id === activeId ? '(Đang mở)' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {saveScope === 'all' && (
                  <p className="text-[10.5px] text-slate-500 italic pl-1">
                    🌐 Thao tác sẽ lưu / đồng bộ <strong>TOÀN BỘ {projects.length} dự án</strong> và cấu hình cài đặt hệ thống.
                  </p>
                )}
              </div>



              {/* Status Message Alert */}
              {cloudStatusMsg && (
                <div className={`p-3 rounded-xl border font-bold text-xs flex items-center justify-between animate-in fade-in duration-150 ${
                  cloudStatusMsg.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  <div className="flex items-center gap-2">
                    {cloudStatusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                    <span>{cloudStatusMsg.text}</span>
                  </div>
                  <button onClick={() => setCloudStatusMsg(null)} className="text-slate-400 hover:text-slate-700 text-xs font-bold px-1">✕</button>
                </div>
              )}

              {/* 💾 SECTION 2: LOCAL SAVE & RESTORE (JSON FILE) */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-emerald-600" />
                    Lưu / Khôi Phục File Cục Bộ (Máy Tính / Điện Thoại)
                  </span>
                  <span className="text-[9px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                    Nhanh &amp; An toàn
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleExportJsonForScope}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer shadow-xs active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" /> Xuất File JSON
                  </button>

                  <label className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl font-bold flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer active:scale-95">
                    <Upload className="w-3.5 h-3.5 text-slate-600" /> Đọc File JSON
                    <input type="file" accept=".json" className="hidden" onChange={handleImportJsonForScope} />
                  </label>
                </div>

                {/* Optional Paste JSON text input for devices/mobile without file picker */}
                <div className="pt-1">
                  {!showPasteArea ? (
                    <button
                      type="button"
                      onClick={() => setShowPasteArea(true)}
                      className="text-[10.5px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3 text-indigo-500" /> Hoặc dán mã JSON trực tiếp (Điện thoại / APK)
                    </button>
                  ) : (
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-indigo-200 space-y-2 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-bold text-indigo-950">Dán nội dung tệp JSON:</span>
                        <button onClick={() => setShowPasteArea(false)} className="text-[10px] text-slate-400 font-bold hover:text-slate-700">Đóng</button>
                      </div>
                      <textarea
                        rows={3}
                        placeholder="Dán mã JSON bản sao lưu vào đây..."
                        value={pasteValue}
                        onChange={(e) => setPasteValue(e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-[10.5px] font-mono outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleRestoreFromPastedJson}
                        disabled={!pasteValue.trim()}
                        className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold text-[11px] transition-colors cursor-pointer"
                      >
                        Khôi Phục Dữ Liệu Từ JSON Đã Dán
                      </button>
                    </div>
                  )}
                </div>

                {/* Auto-save file system integration status & controls */}
                {onLinkLocalAllFile && (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                        <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                        Liên Kết Auto-Save Tệp Hệ Thống
                      </span>
                      {localAllFileHandle ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full font-extrabold text-[9.5px] uppercase tracking-wider flex items-center gap-1 shadow-xs">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          Đã Liên Kết
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-full font-bold text-[9.5px] uppercase tracking-wider">
                          Chưa Liên Kết
                        </span>
                      )}
                    </div>

                    {localAllFileHandle ? (
                      <div className="bg-emerald-50/90 border border-emerald-200 p-2.5 rounded-xl space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="truncate pr-2">
                            <p className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Tệp đĩa đang liên kết:</p>
                            <p className="font-extrabold text-emerald-900 truncate text-[11px]">{localAllFileName || 'file_du_an.json'}</p>
                          </div>
                          {onUnlinkLocalAllFile && (
                            <button
                              type="button"
                              onClick={onUnlinkLocalAllFile}
                              className="text-[10px] text-rose-600 font-bold hover:bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg transition-colors shrink-0"
                            >
                              Hủy liên kết
                            </button>
                          )}
                        </div>

                        {localAllSyncPermissionNeeded && onRequestLocalAllFilePermission && (
                          <button
                            type="button"
                            onClick={onRequestLocalAllFilePermission}
                            className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[10.5px] flex items-center justify-center gap-1 shadow-xs"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Cho Phép Ghi Để Đồng Bộ Auto-Save
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-slate-500 leading-normal">
                          Tự động ghi đè và lưu dữ liệu dự án trực tiếp vào file <code className="font-mono text-indigo-600 bg-slate-100 px-1 py-0.5 rounded font-bold">.json</code> trên đĩa cứng máy tính.
                        </p>
                        <button
                          type="button"
                          onClick={onLinkLocalAllFile}
                          className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl font-extrabold flex items-center justify-center gap-1.5 text-[11px] transition-colors cursor-pointer shadow-xs active:scale-98"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600" />
                          🔗 Chọn Tệp Trên Máy Để Liên Kết Auto-Save
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Multi-Version Backup & Restore system (Lịch Sử Bản Sao Lưu) */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-600" />
                      Lịch Sử Sao Lưu & Khôi Phục Phiên Bản
                    </span>
                    <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                      Tối đa: {localStorage.getItem('construction_max_autosave_versions') || '15'} bản
                    </span>
                  </div>

                  <div className="flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-500 font-bold flex-1">
                      Tự động lưu với số bản tối đa:
                    </span>
                    <select
                      value={localStorage.getItem('construction_max_autosave_versions') || '15'}
                      onChange={(e) => {
                        localStorage.setItem('construction_max_autosave_versions', e.target.value);
                        // Force state update to refresh local view
                        setProjects(getProjectsList());
                      }}
                      className="py-1 px-2 bg-white border border-slate-300 rounded-lg text-[10px] font-extrabold text-slate-700 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="5">Lưu 5 bản</option>
                      <option value="10">Lưu 10 bản</option>
                      <option value="15">Lưu 15 bản</option>
                      <option value="20">Lưu 20 bản</option>
                      <option value="30">Lưu 30 bản</option>
                      <option value="50">Lưu 50 bản</option>
                    </select>
                  </div>

                  {autosaveVersions.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-[10px] bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      Chưa có phiên bản sao lưu nào. Hệ thống sẽ tự động sao lưu khi phát sinh thay đổi dữ liệu.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                      {autosaveVersions.map((ver) => {
                        const dateStr = new Date(ver.timestamp).toLocaleString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                        });
                        return (
                          <div
                            key={ver.id}
                            className="bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-between gap-1.5 shadow-2xs hover:border-indigo-300 transition-all text-[10px]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider ${
                                    ver.type === 'manual'
                                      ? 'bg-indigo-100 text-indigo-800'
                                      : ver.type === 'monthly'
                                      ? 'bg-purple-100 text-purple-800'
                                      : ver.type === 'weekly'
                                      ? 'bg-blue-100 text-blue-800'
                                      : ver.type === 'daily'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {ver.typeLabel}
                                </span>
                                <span className="text-slate-400 text-[9px] font-medium">{dateStr}</span>
                              </div>
                              <p className="font-bold text-slate-700 truncate text-[10px] mt-0.5">{ver.projectName}</p>
                              <p className="text-slate-400 text-[9px] truncate">{ver.stats}</p>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => onRestoreAutoSaveVersion && onRestoreAutoSaveVersion(ver.data)}
                                className="px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded transition-colors cursor-pointer text-[9.5px]"
                              >
                                Phục Hồi
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (await confirmAsync('Bạn có chắc muốn xóa bản sao lưu này?')) {
                                    const raw = localStorage.getItem('construction_autosave_versions');
                                    let versions: any[] = raw ? JSON.parse(raw) : [];
                                    versions = versions.filter((v: any) => v.id !== ver.id);
                                    localStorage.setItem('construction_autosave_versions', JSON.stringify(versions));
                                    // Refresh view
                                    setProjects(getProjectsList());
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                title="Xóa bản sao lưu"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ☁️ SECTION 3: CLOUD SYNC & SNAPSHOTS (FIREBASE) */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-indigo-900 text-xs flex items-center gap-1.5">
                    <Cloud className="w-4 h-4 text-indigo-600" />
                    Đồng Bộ Đám Mây (Cloud Firebase)
                  </span>
                  <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-200 flex items-center gap-1">
                    <Smartphone className="w-2.5 h-2.5" /> <Monitor className="w-2.5 h-2.5" /> Multi-Device
                  </span>
                </div>

                {/* Quick Multi-Device Transfer Code */}
                <div className="bg-indigo-50/60 p-2.5 rounded-xl border border-indigo-100 space-y-2">
                  <p className="font-bold text-indigo-950 text-[11px] flex items-center gap-1">
                    <Share2 className="w-3.5 h-3.5 text-indigo-600" /> Đồng Bộ Nhanh Qua Mã Dự Án (Điện Thoại &lt;&gt; Máy Tính)
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleUploadActiveProjectToCloud}
                      disabled={isSyncingCurrentProject}
                      className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold text-[10.5px] flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-xs"
                    >
                      <CloudUpload className="w-3.5 h-3.5" /> Đẩy Dự Án Hiện Tại Lên Cloud
                    </button>
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    <input
                      type="text"
                      placeholder="Nhập Mã Sync Dự Án..."
                      value={cloudSyncCodeInput}
                      onChange={(e) => setCloudSyncCodeInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handlePullProjectFromCloud}
                      disabled={!cloudSyncCodeInput.trim() || isSyncingCurrentProject}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg font-bold text-[10.5px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                    >
                      <CloudDownload className="w-3.5 h-3.5 text-indigo-300" /> Tải Về
                    </button>
                  </div>
                </div>

                {/* Cloud History list */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                      Lịch Sử Bản Lưu Đám Mây ({cloudBackups.length})
                    </span>
                    <button onClick={fetchCloudBackups} className="text-[10px] text-indigo-600 font-bold hover:underline flex items-center gap-0.5">
                      <RefreshCw className={`w-3 h-3 ${isLoadingCloudBackups ? 'animate-spin' : ''}`} /> Tải lại
                    </button>
                  </div>

                  {isLoadingCloudBackups ? (
                    <div className="py-2 text-center text-slate-400 text-[10.5px] flex items-center justify-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" /> Đang tải lịch sử...
                    </div>
                  ) : cloudBackups.length === 0 ? (
                    <p className="text-[10.5px] text-slate-400 italic py-1">Chưa có bản sao lưu nào trên Đám Mây.</p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {cloudBackups.map((b) => (
                        <div key={b.id} className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-[10.5px]">
                          <div>
                            <p className="font-bold text-slate-800">{b.backupName}</p>
                            <p className="text-[9.5px] text-slate-400">
                              {new Date(b.createdAt).toLocaleString('vi-VN')}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRestoreCloudBackup(b)}
                              className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold rounded-lg border border-emerald-200 text-[10px] transition-colors cursor-pointer"
                            >
                              Khôi phục
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCloudBackup({ id: b.id, name: b.projectName || 'Bản sao lưu' })}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                              title="Xóa bản sao lưu"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 📁 SECTION 4: GOOGLE DRIVE SYNC */}
              {onDriveSyncUpAll && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      Đồng Bộ Trực Tiếp Google Drive
                    </span>
                    <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                      Google OAuth
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleDriveSyncUpAction}
                      disabled={isDriveSyncing}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer shadow-xs"
                    >
                      {isDriveSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                      <span>Đẩy Lên Google Drive</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDriveSyncDownAction}
                      disabled={isDriveSyncing}
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-50 text-slate-800 rounded-xl font-bold flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer"
                    >
                      {isDriveSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                      <span>Tải Từ Google Drive</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 2: PROJECTS LIST & MANAGEMENT */}
          {modalTab === 'projects' && (
            <div className="space-y-3">

              {/* Search Bar */}
              {projects.length > 2 && (
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Tìm kiếm dự án..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              )}

              {/* Confirm Delete Alert */}
              {confirmDeleteId && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2.5">
                  <p className="text-xs font-bold text-rose-900">
                    Bạn có chắc chắn muốn xóa dự án này? Toàn bộ dữ liệu của dự án trên máy sẽ bị xóa vĩnh viễn.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 py-1.5 font-bold text-slate-600 bg-white border border-slate-300 rounded-lg text-xs hover:bg-slate-50 transition-colors"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      className="flex-1 py-1.5 font-bold text-white bg-rose-600 rounded-lg text-xs hover:bg-rose-700 transition-colors shadow-xs"
                    >
                      Xác nhận xóa
                    </button>
                  </div>
                </div>
              )}

              {/* Project Cards List */}
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs font-medium">
                    Không tìm thấy dự án phù hợp
                  </div>
                ) : (
                  filteredProjects.map(proj => {
                    const isActive = proj.id === activeId;
                    const isEditing = editingProjectId === proj.id;

                    return (
                      <div
                        key={proj.id}
                        className={`p-3 rounded-2xl border transition-all ${
                          isActive
                            ? 'bg-gradient-to-r from-indigo-50/90 to-blue-50/50 border-indigo-300 ring-2 ring-indigo-500/20 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editingProjectName}
                              onChange={e => setEditingProjectName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveRename(proj.id);
                                if (e.key === 'Escape') setEditingProjectId(null);
                              }}
                              className="flex-1 border border-indigo-400 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(proj.id)}
                              className="p-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                              title="Lưu tên mới"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingProjectId(null)}
                              className="p-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              title="Hủy"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div
                              className="flex-1 min-w-0 cursor-pointer"
                              onClick={() => handleSwitchProject(proj.id)}
                            >
                              <div className="flex items-center gap-2">
                                <Folder className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                                <p className={`font-bold text-xs truncate ${isActive ? 'text-indigo-900' : 'text-slate-800'}`}>
                                  {proj.name}
                                </p>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5 pl-6 font-medium">
                                Khởi tạo: {new Date(proj.createdAt).toLocaleDateString('vi-VN')}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-indigo-600 text-white px-2.5 py-1 rounded-lg shadow-xs">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                                  Đang mở
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchProject(proj.id)}
                                  className="text-[11px] font-extrabold bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-700 px-3 py-1 rounded-lg transition-all cursor-pointer"
                                >
                                  Mở
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => handleStartRename(proj, e)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                title="Đổi tên dự án"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteProject(proj.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Xóa dự án"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Create New Project Section */}
              {isCreating ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateProject();
                  }}
                  className="bg-slate-50 p-3.5 rounded-2xl border border-indigo-200 space-y-3 animate-in fade-in duration-150"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                    <FolderPlus className="w-4 h-4 text-indigo-600" />
                    <span>Tạo Dự Án Mới</span>
                  </div>

                  <input
                    type="text"
                    autoFocus
                    placeholder="Nhập tên dự án mới..."
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />

                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer bg-white p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={duplicateFromCurrent}
                      onChange={(e) => setDuplicateFromCurrent(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="font-bold text-slate-800">Sao chép dữ liệu từ dự án hiện tại</span>
                      <p className="text-[10px] text-slate-500 font-normal mt-0.5">
                        Giữ lại danh mục vật tư, định mức, danh sách phòng và mẫu kiểm tra
                      </p>
                    </div>
                  </label>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="flex-1 py-2 font-bold text-slate-600 bg-white border border-slate-300 rounded-xl text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={!newProjectName.trim()}
                      className="flex-1 py-2 font-bold text-white bg-indigo-600 rounded-xl text-xs hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> Tạo ngay
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="w-full py-2.5 bg-white border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 text-indigo-700 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer text-xs shadow-2xs"
                >
                  <Plus className="w-4 h-4 text-indigo-600" />
                  Thêm dự án mới
                </button>
              )}

            </div>
          )}

        </div>
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
              alert('🎉 Đã hợp nhất và khôi phục dữ liệu dự án thành công!');
            }
            setShowConflictModal(false);
            setPendingImportData(null);
          }}
        />
      )}

      {/* CONFIRM DELETE CLOUD BACKUP MODAL */}
      {deletingCloudBackupTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[250] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-rose-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xóa Bản Sao Lưu Đám Mây</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Bạn có chắc chắn muốn xóa bản sao lưu đám mây <strong className="text-slate-800 font-bold">"{deletingCloudBackupTarget.name}"</strong> không?
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingCloudBackupTarget(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={executeDeleteCloudBackup}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-xs"
              >
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
