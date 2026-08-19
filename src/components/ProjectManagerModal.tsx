import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Plus, Folder, Trash2, HardDrive, Download, Upload, RefreshCw, 
  CheckCircle2, AlertTriangle, ShieldCheck, ArrowLeftRight, ChevronDown, 
  ChevronUp, Search, Edit3, Check, Building2, Copy, Sparkles, FolderPlus,
  Cloud, CloudUpload, CloudDownload, Smartphone, Monitor, Share2, Layers,
  CheckSquare, Square, FileSpreadsheet, Layers3, CheckCircle, Database, History, Eye,
  Lock, Key, ShieldAlert
} from 'lucide-react';
import { ProjectInfo, getProjectsList, getActiveProjectId, setActiveProject, saveProjectsList, getKey } from '../App';
import { safeSetLocalStorageItem } from '../utils/storage';
import { getAllStorageData, getStorageKeys, getStorageItem, getAsyncItem, removeAsyncItem, setAsyncItem } from '../utils/asyncStorage';
import { 
  saveCloudBackup, 
  listCloudBackups, 
  deleteCloudBackup, 
  saveProjectToCloud, 
  fetchProjectFromCloud,
  getCloudPayload,
  CloudBackupRecord,
  signInWithGoogle,
  signOutGoogle,
  onAuthUserChanged,
  subscribeProjectSharedSettings,
  saveProjectSharedSettings,
  subscribeCurrentUserProjectsRealtime,
  saveProjectMetadataToCloud,
  deleteCloudProject
} from '../lib/firebase';
import type { User as FirebaseUser } from 'firebase/auth';
import { ConflictMergeModal } from './ConflictMergeModal';
import { PrimaryDriveStatusCard } from './PrimaryDriveStatusCard';
import { confirmAsync } from '../utils/confirmAsync';
import { 
  normalizeImportedData, 
  isStorageDump, 
  getProjectsFromStorageDump, 
  createProjectId,
  extractProjectsFromImportData,
  smartMergeProjectData,
  ProjectImportCandidate
} from '../utils/dataNormalizer';
import { formatDateTime, parseLegacyTimestamp } from '../utils/dateFormatter';
import { useFormatSettings } from '../utils/numberUtils';
import { detectOrphanProjectData, cleanupOrphanProjectData, OrphanScanResult, OrphanProjectInfo } from '../utils/projectReconciliation';
import { isStorageKeyOwnedByProject, getProjectStorageKeys } from '../utils/projectStorageUtils';
import { deleteProjectPhotos, getProjectPhotos, saveProjectPhotos, getProjectPhotosWithBinary, restorePhotosFromBackup } from '../utils/photoStorage';
import { logAuditAction, UserRole, getCurrentUserRole, canManageProjects, canEditProjectData } from '../utils/securityUtils';
import { encryptBackupData, decryptBackupData, isEncryptedBackup, EncryptedBackupContainer } from '../utils/cryptoUtils';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProjectId?: string;
  initialTab?: 'sync' | 'projects';
  autoSyncEnabled?: boolean;
  setAutoSyncEnabled?: (enabled: boolean) => void;
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
  onRestoreData?: (data: any, targetProjectId?: string) => void | Promise<void>;
  autosaveVersions?: any[];
  onRestoreAutoSaveVersion?: (version: any) => void;
  onCreateManualBackup?: () => void;
  onDeleteAutoSaveVersion?: (id: string) => void;
  onSwitchProject?: (id: string) => Promise<void>;
  onFlushCurrentProject?: () => Promise<void>;
  userRole?: UserRole;
  photoCloudStatus?: { phase: 'idle' | 'syncing' | 'synced' | 'error'; pending?: number; message?: string; lastSyncAt?: number };
}

export type ScopeType = 'active' | 'selected' | 'all';

export const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({ 
  isOpen, 
  onClose,
  activeProjectId,
  initialTab = 'projects',
  autoSyncEnabled = false,
  setAutoSyncEnabled,
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
  onSwitchProject,
  onFlushCurrentProject,
  userRole,
  photoCloudStatus,
}) => {
  useFormatSettings();
  const effectiveRole = userRole || getCurrentUserRole();
  const canManage = canManageProjects(effectiveRole);
  const canEdit = canEditProjectData(effectiveRole);
  const hasDriveBackend = Boolean(onDriveSyncUpAll && onDriveSyncDownAll);

  const [projects, setProjects] = useState<ProjectInfo[]>(getProjectsList);
  const [activeId, setActiveId] = useState<string>(() => activeProjectId || getActiveProjectId());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    return subscribeCurrentUserProjectsRealtime((cloudProjects) => {
      if (cloudProjects.length === 0) return;
      const cached = new Map(getProjectsList().map((p) => [p.id, p]));
      const next = cloudProjects.map((p) => ({
        id: p.id,
        name: p.name || cached.get(p.id)?.name || p.id,
        // createdAt must come from projects/{projectId}.createdAt in Firestore.
        // Missing legacy values stay visibly "migrating"; never fake them with cache/updatedAt/Date.now().
        createdAt: Number(p.createdAt || 0),
        createdAtSource: p.createdAt ? 'cloud' as const : 'migrating' as const,
        updatedAt: Number(p.updatedAt || cached.get(p.id)?.updatedAt || 0),
      }));
      saveProjectsList(next); // local cache only
      setProjects(next);
    });
  }, [isOpen]);
  
  // Scope selection: 'active' (1 dự án), 'selected' (chọn nhiều), 'all' (tất cả)
  const [saveScope, setSaveScope] = useState<ScopeType>('active');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([getActiveProjectId()]);

  // Main navigation tab within the modal
  const [modalTab, setModalTab] = useState<'sync' | 'projects'>('sync');

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [duplicateFromCurrent, setDuplicateFromCurrent] = useState(false);

  // Rename state
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingCloudBackupTarget, setDeletingCloudBackupTarget] = useState<{ id: string; name: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
  const [mergingDuplicateTargetId, setMergingDuplicateTargetId] = useState<string | null>(null);

  // Cloud Backup & Multi-device Sync State
  const [cloudBackups, setCloudBackups] = useState<CloudBackupRecord[]>([]);
  const [isSavingCloudBackup, setIsSavingCloudBackup] = useState(false);
  const [isLoadingCloudBackups, setIsLoadingCloudBackups] = useState(false);
  const [cloudBackupName, setCloudBackupName] = useState('');
  const [cloudSyncCodeInput, setCloudSyncCodeInput] = useState('');
  const [isSyncingCurrentProject, setIsSyncingCurrentProject] = useState(false);

  // Auto Backup toggles per category
  const [syncNorms, setSyncNorms] = useState(() => localStorage.getItem(getKey('construction_sync_opt_norms', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncInventory, setSyncInventory] = useState(() => localStorage.getItem(getKey('construction_sync_opt_inventory', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncWorkVolumes, setSyncWorkVolumes] = useState(() => localStorage.getItem(getKey('construction_sync_opt_workVolumes', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncFloorPlans, setSyncFloorPlans] = useState(() => localStorage.getItem(getKey('construction_sync_opt_floorPlans', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncDefects, setSyncDefects] = useState(() => localStorage.getItem(getKey('construction_sync_opt_defects', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncRoomProgress, setSyncRoomProgress] = useState(() => localStorage.getItem(getKey('construction_sync_opt_roomProgress', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncChecklist, setSyncChecklist] = useState(() => localStorage.getItem(getKey('construction_sync_opt_checklist', activeProjectId || getActiveProjectId())) !== 'false');
  const [syncCrew, setSyncCrew] = useState(() => localStorage.getItem(getKey('construction_sync_opt_crew', activeProjectId || getActiveProjectId())) !== 'false');

  useEffect(() => {
    const pid = activeId || activeProjectId || getActiveProjectId();
    const unsubscribe = subscribeProjectSharedSettings(pid, (settings) => {
      const opt = settings.syncOptions;
      if (!opt) return;
      if (typeof opt.norms === 'boolean') setSyncNorms(opt.norms);
      if (typeof opt.inventory === 'boolean') setSyncInventory(opt.inventory);
      if (typeof opt.workVolumes === 'boolean') setSyncWorkVolumes(opt.workVolumes);
      if (typeof opt.floorPlans === 'boolean') setSyncFloorPlans(opt.floorPlans);
      if (typeof opt.defects === 'boolean') setSyncDefects(opt.defects);
      if (typeof opt.roomProgress === 'boolean') setSyncRoomProgress(opt.roomProgress);
      if (typeof opt.checklist === 'boolean') setSyncChecklist(opt.checklist);
      if (typeof opt.crew === 'boolean') setSyncCrew(opt.crew);
    });
    return unsubscribe;
  }, [activeId, activeProjectId]);

  useEffect(() => {
    const pid = activeId || activeProjectId || getActiveProjectId();
    const options = { norms: syncNorms, inventory: syncInventory, workVolumes: syncWorkVolumes, floorPlans: syncFloorPlans, defects: syncDefects, roomProgress: syncRoomProgress, checklist: syncChecklist, crew: syncCrew };
    Object.entries(options).forEach(([key, value]) => localStorage.setItem(getKey(`construction_sync_opt_${key}`, pid), String(value)));
    saveProjectSharedSettings(pid, { syncOptions: options }).catch((err) => console.warn('Project sync options cloud warning:', err));
  }, [activeId, activeProjectId, syncNorms, syncInventory, syncWorkVolumes, syncFloorPlans, syncDefects, syncRoomProgress, syncChecklist, syncCrew]);
  const [cloudStatusMsg, setCloudStatusMsg] = useState<{ type: 'success' | 'error'; text: string; stats?: any } | null>(null);
  const [driveStatusMsg, setDriveStatusMsg] = useState<{ type: 'success' | 'error'; text: string; stats?: any } | null>(null);
  const [isAutoBackupConfigExpanded, setIsAutoBackupConfigExpanded] = useState(false);
  const [exportedFileInfo, setExportedFileInfo] = useState<{
    fileName: string;
    fileSizeStr: string;
    projectsExported: string[];
    categoriesExported: { label: string; count: number; icon: any; details?: string }[];
    imageStats: { hasImages: boolean; imageCount: number; detailStats?: { label: string; count: number }[] };
    isFullBackup: boolean;
    title?: string;
  } | null>(null);

  const [importedFileInfo, setImportedFileInfo] = useState<{
    fileName: string;
    fileSizeStr: string;
    projectsImported: string[];
    categoriesImported: { label: string; count: number; icon: any; details?: string }[];
    imageStats: { hasImages: boolean; imageCount: number; detailStats: { label: string; count: number }[] };
    isFullBackup: boolean;
  } | null>(null);

  // Drive sync state
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);

  // Multi-Project Intelligent Sync & Conflict Resolution state
  const [multiProjectSyncState, setMultiProjectSyncState] = useState<{
    fileName: string;
    fileSize?: number;
    rawData: any;
    items: {
      candidate: ProjectImportCandidate;
      existsLocally: boolean;
      localProjectInfo?: ProjectInfo;
      localUpdatedAt: number;
      isLocalNewer: boolean;
      isIncomingNewer: boolean;
      action: 'CREATE_PRESERVE_ID' | 'KEEP_LOCAL' | 'OVERWRITE_FILE' | 'SMART_MERGE' | 'IMPORT_AS_NEW_COPY' | 'SKIP';
    }[];
  } | null>(null);
  const [isExecutingMultiSync, setIsExecutingMultiSync] = useState(false);

  // Legacy single project conflict modal state & Paste JSON state
  const [pendingImportData, setPendingImportData] = useState<any | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pendingImportChoice, setPendingImportChoice] = useState<{ parsedData: any; normalized: any; fileName?: string; fileSize?: number } | null>(null);
  const [selectedDumpProjectId, setSelectedDumpProjectId] = useState<string>('default');

  // Google Auth User state
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);

  useEffect(() => {
    const unsub = onAuthUserChanged((user) => {
      setGoogleUser(user);
    });
    return () => unsub();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleSigningIn(true);
      const user = await signInWithGoogle();
      if (user) {
        const { saveUserProfileToCloud } = await import('../lib/firebase');
        await saveUserProfileToCloud(user).catch(() => {});
      }
      setCloudStatusMsg({ type: 'success', text: '✅ Đăng nhập Google thành công! Dữ liệu Cloud được bảo vệ an toàn.' });
      await fetchCloudBackups();
    } catch (err: any) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi đăng nhập Google: ' + (err?.message || err) });
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await signOutGoogle();
      setCloudStatusMsg({ type: 'success', text: 'Đã đăng xuất tài khoản Google.' });
    } catch (err: any) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi đăng xuất: ' + (err?.message || err) });
    }
  };

  // Encrypted Backup (AES-GCM) states
  const [exportEncrypt, setExportEncrypt] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportHint, setExportHint] = useState('');
  const [showExportEncryptOptions, setShowExportEncryptOptions] = useState(false);

  const [pendingEncryptedPayload, setPendingEncryptedPayload] = useState<EncryptedBackupContainer | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [decryptError, setDecryptError] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [pendingImportFileInfo, setPendingImportFileInfo] = useState<{ name?: string; size?: number } | null>(null);
  const [showReencryptOptions, setShowReencryptOptions] = useState(false);
  const [newReencryptPassword, setNewReencryptPassword] = useState('');
  const [newReencryptHint, setNewReencryptHint] = useState('');

  // Orphan project diagnostics & cleanup state
  const [isScanningOrphans, setIsScanningOrphans] = useState(false);
  const [orphanScanResult, setOrphanScanResult] = useState<OrphanScanResult | null>(null);
  const [isCleaningOrphans, setIsCleaningOrphans] = useState(false);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<string[]>([]);
  const [recoveringOrphanId, setRecoveringOrphanId] = useState<string | null>(null);

  const handleScanOrphans = async () => {
    try {
      setIsScanningOrphans(true);
      const allStorage = await getAllStorageData();
      const curProjects = getProjectsList();
      const result = detectOrphanProjectData(allStorage, curProjects);
      setOrphanScanResult(result);
      // Never pre-select local-only project data for permanent deletion.
      setSelectedOrphanIds([]);
    } catch (e: any) {
      setErrorMessage(`Lỗi khi quét dữ liệu mồ côi: ${e?.message || e}`);
    } finally {
      setIsScanningOrphans(false);
    }
  };

  const handleCleanupOrphans = async () => {
    if (!orphanScanResult || selectedOrphanIds.length === 0) return;
    const count = selectedOrphanIds.length;
    const confirm = await confirmAsync(
      `⚠️ CẢNH BÁO DỌN DẸP BỘ NHỚ:\n\n` +
      `Bạn có chắc chắn muốn xóa dữ liệu cục bộ của ${count} dự án đã chọn khỏi thiết bị này?\n\n` +
      `Chỉ thực hiện khi bạn chắc chắn dự án đã có trên Cloud hoặc không còn cần dữ liệu này. Thao tác không thể hoàn tác.`
    );
    if (!confirm) return;

    try {
      setIsCleaningOrphans(true);
      const targetOrphans = orphanScanResult.orphanProjects.filter(p => selectedOrphanIds.includes(p.id));
      const specificKeys = targetOrphans.flatMap(p => p.keys);
      const cleanResult = await cleanupOrphanProjectData(selectedOrphanIds, specificKeys);
      
      // Re-scan
      const allStorage = await getAllStorageData();
      const curProjects = getProjectsList();
      const result = detectOrphanProjectData(allStorage, curProjects);
      setOrphanScanResult(result);

      // Only unselect projects that were completely deleted with zero remaining/failed keys
      const successfullyDeletedPids = targetOrphans
        .filter(p => p.keys.every(k => cleanResult.deletedKeys.includes(k) && !cleanResult.remainingKeys.includes(k) && !cleanResult.failedKeys.includes(k)))
        .map(p => p.id);
      
      setSelectedOrphanIds(prev => prev.filter(id => !successfullyDeletedPids.includes(id)));

      logAuditAction('ORPHAN_CLEANUP', `Đã dọn dẹp ${cleanResult.deletedKeys.length} khóa dữ liệu mồ côi thuộc ${count} dự án`);
      
      if (cleanResult.success && cleanResult.remainingKeys.length === 0 && cleanResult.failedKeys.length === 0) {
        alert(`🎉 Đã dọn dẹp và giải phóng hoàn toàn ${cleanResult.deletedKeys.length} khóa dữ liệu mồ côi thuộc ${count} dự án!`);
      } else {
        const errorMsg = cleanResult.errorDetails ? `\nChi tiết lỗi: ${cleanResult.errorDetails.join('; ')}` : '';
        alert(`⚠️ Đã xóa ${cleanResult.deletedKeys.length}/${cleanResult.requestedKeys.length} khóa. Còn ${cleanResult.remainingKeys.length + cleanResult.failedKeys.length} khóa chưa giải phóng xong.${errorMsg}`);
      }
    } catch (e: any) {
      setErrorMessage(`Lỗi khi dọn dẹp dữ liệu: ${e?.message || e}`);
    } finally {
      setIsCleaningOrphans(false);
    }
  };

  const handleExportOrphansBackup = async () => {
    if (!orphanScanResult || selectedOrphanIds.length === 0) return;
    try {
      const allStorage = await getAllStorageData();
      const exportData: Record<string, string> = {};
      const targetOrphans = orphanScanResult.orphanProjects.filter(p => selectedOrphanIds.includes(p.id));
      targetOrphans.forEach(p => {
        p.keys.forEach(k => {
          exportData[k] = allStorage[k] || '';
        });
      });
      const jsonStr = JSON.stringify(exportData, null, 2);
      await downloadOrShareFile(`Du_Lieu_Mo_Coi_Backup_${new Date().toISOString().split('T')[0]}.json`, jsonStr, 'application/json');
    } catch (e: any) {
      setErrorMessage(`Lỗi khi xuất tệp: ${e?.message || e}`);
    }
  };


  const handleRecoverLocalProject = async (orphan: OrphanProjectInfo) => {
    if (!orphan?.id || recoveringOrphanId) return;
    try {
      setRecoveringOrphanId(orphan.id);
      setErrorMessage(null);

      const allStorage = await getAllStorageData();
      const projectStorage: Record<string, string> = {};
      orphan.keys.forEach((key) => {
        const value = allStorage[key];
        projectStorage[key] = typeof value === 'string' ? value : JSON.stringify(value ?? '');
      });

      const normalized = normalizeImportedData(projectStorage, orphan.id);
      const restoredName = String(normalized.projectName || orphan.name || `Dự án ${orphan.id}`).trim();
      const contractorName = String(normalized.contractorName || '');
      const inspectorName = String(normalized.inspectorName || '');

      // Preserve the original projectId. This either repairs the old Cloud project
      // index or creates the missing metadata for a genuinely local-only legacy project.
      await saveProjectMetadataToCloud(orphan.id, restoredName, { contractorName, inspectorName });
      await saveProjectToCloud({
        id: orphan.id,
        name: restoredName,
        contractorName,
        inspectorName,
        syncCode: orphan.id.toUpperCase().slice(0, 8),
        payload: normalized,
      });

      // Explicit recovery cancels any stale local project-deletion tombstone.
      try {
        const raw = localStorage.getItem('construction_deleted_projects') || '[]';
        const list = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
        const nextDeleted = list.filter((item: any) => item?.projectId !== orphan.id);
        localStorage.setItem('construction_deleted_projects', JSON.stringify(nextDeleted));
        await setAsyncItem('construction_deleted_projects', nextDeleted);
      } catch (_) {}

      const current = getProjectsList();
      const nextProjects: ProjectInfo[] = current.some((project) => project.id === orphan.id)
        ? current.map((project) =>
            project.id === orphan.id
              ? { ...project, name: restoredName, updatedAt: Date.now() }
              : project
          )
        : [
            ...current,
            {
              id: orphan.id,
              name: restoredName,
              createdAt: 0,
              createdAtSource: 'migrating' as const,
              updatedAt: Date.now(),
            },
          ];
      saveProjectsList(nextProjects);
      setProjects(nextProjects);
      setSelectedOrphanIds((prev) => prev.filter((id) => id !== orphan.id));

      const refreshedStorage = await getAllStorageData();
      const refreshed = detectOrphanProjectData(refreshedStorage, nextProjects);
      setOrphanScanResult(refreshed);

      logAuditAction('PROJECT_RECOVER_LOCAL', `Đã khôi phục dự án cục bộ lên Cloud, giữ nguyên ID: ${orphan.id}`, orphan.id);
      alert(`Đã khôi phục dự án “${restoredName}” lên Cloud với đúng ID cũ. Dự án sẽ xuất hiện lại trong danh sách và đồng bộ trên các thiết bị.`);
    } catch (e: any) {
      setErrorMessage(`Không thể khôi phục dự án lên Cloud: ${e?.message || e}`);
    } finally {
      setRecoveringOrphanId(null);
    }
  };

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
      const curActive = activeProjectId || getActiveProjectId();
      setActiveId(curActive);
      if (!selectedProjectIds.includes(curActive)) {
        setSelectedProjectIds([curActive]);
      }
      fetchCloudBackups();
    }
  }, [isOpen, initialTab, activeProjectId]);

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

  // Helper: Collect storage items for selected scope (Asynchronous to support IndexedDB/localforage)
  const getStorageDataForScope = async (scope: ScopeType): Promise<Record<string, string>> => {
    const data: Record<string, string> = {};
    const allStorage = await getAllStorageData();
    const allKeys = Object.keys(allStorage);

    if (scope === 'all') {
      // Collect valid keys belonging to currently registered projects and global configs
      const currentProjects = getProjectsList();
      const validProjectIds = new Set(currentProjects.map(p => p.id));
      if (validProjectIds.size === 0) validProjectIds.add('default');

      allKeys.forEach(key => {
        if (!key.startsWith('construction_') && !key.startsWith('active_project_id')) return;

        // Global keys that should always be kept
        const isGlobalKey = [
          'construction_projects_list',
          'active_project_id',
          'construction_theme',
          'construction_format_settings',
          'construction_notification_settings',
          'construction_drive_last_sync',
          'construction_drive_auto_sync_enabled',
          'construction_google_cloud_folder_id'
        ].includes(key) || key.startsWith('construction_sync_opt_');

        if (isGlobalKey) {
          data[key] = allStorage[key] || '';
          return;
        }

        // Project-specific key: verify it belongs to a valid project ID
        let belongsToValid = false;
        for (const pid of validProjectIds) {
          if (isStorageKeyOwnedByProject(key, pid)) {
            belongsToValid = true;
            break;
          }
        }

        if (belongsToValid) {
          data[key] = allStorage[key] || '';
        }
      });
      data['construction_projects_list'] = JSON.stringify(currentProjects);
      if (activeId) {
        data['active_project_id'] = activeId;
      }
    } else if (scope === 'active') {
      const activeProjId = activeId || 'default';
      allKeys.forEach(key => {
        if (key.startsWith('construction_')) {
          if (isStorageKeyOwnedByProject(key, activeProjId)) {
            data[key] = allStorage[key] || '';
          }
        }
      });
      const allProjectsList = JSON.parse(allStorage['construction_projects_list'] || '[]');
      const filteredProjects = allProjectsList.filter((p: any) => p.id === activeProjId);
      data['construction_projects_list'] = JSON.stringify(filteredProjects.length > 0 ? filteredProjects : [{ id: activeProjId, name: 'Dự án hiện tại' }]);
      if (activeProjId) {
        data['active_project_id'] = activeProjId;
      }
    } else if (scope === 'selected') {
      // Selected specific projects
      allKeys.forEach(key => {
        if (key.startsWith('construction_')) {
          const belongsToSelected = selectedProjectIds.some(pId => isStorageKeyOwnedByProject(key, pId));
          if (belongsToSelected) {
            data[key] = allStorage[key] || '';
          }
        }
      });
      const allProjectsList = JSON.parse(allStorage['construction_projects_list'] || '[]');
      const filteredProjects = allProjectsList.filter((p: any) => selectedProjectIds.includes(p.id));
      data['construction_projects_list'] = JSON.stringify(filteredProjects);
      if (selectedProjectIds.length === 1) {
        data['active_project_id'] = selectedProjectIds[0];
      }
    }
    return data;
  };

  const analyzeExportData = (scope: ScopeType, exportedData: any, rawJsonString: string) => {
    const exportedProjects: string[] = [];
    let processedData = { ...exportedData };
    
    if (exportedData && exportedData.schemaVersion === 3 && exportedData.data) {
      const d = exportedData.data;
      const pid = exportedData.project?.id || 'active';
      const suffix = pid === 'default' ? '' : `_${pid}`;
      processedData = {
        [`construction_project_name_${pid}`]: d.projectName || exportedData.project?.name || '',
        [`construction_material_norms${suffix}`]: JSON.stringify(d.materialNorms || []),
        [`construction_inventory${suffix}`]: JSON.stringify(d.inventory || []),
        [`construction_work_volumes${suffix}`]: JSON.stringify(d.workVolumes || []),
        [`construction_floor_plans${suffix}`]: JSON.stringify(d.floorPlans || []),
        [`construction_defects${suffix}`]: JSON.stringify(d.defects || []),
        [`construction_room_progress${suffix}`]: JSON.stringify(d.roomProgressList || []),
        [`construction_checklist${suffix}`]: JSON.stringify(d.checklist || []),
        [`construction_crew_records${suffix}`]: JSON.stringify(d.crewRecords || []),
        [`construction_teams${suffix}`]: JSON.stringify(d.teams || []),
      };
    }

    const projListRaw = processedData['construction_projects_list'] || localStorage.getItem('construction_projects_list') || '[]';
    let allProjsList: any[] = [];
    try {
      allProjsList = JSON.parse(projListRaw);
    } catch (_) {}

    let normsCount = 0;
    let invCount = 0;
    let volsCount = 0;
    let plansCount = 0;
    let defectsCount = 0;
    let progressCount = 0;
    let checkCount = 0;
    let crewCount = 0;

    // Granular details
    let invInCount = 0;
    let invOutCount = 0;
    let defectsWithImage = 0;
    let defectsWithAfterImage = 0;
    let floorPlansWithImage = 0;
    let volsDoneCount = 0;
    let volsInProgCount = 0;
    let volsNotStartedCount = 0;

    Object.keys(processedData).forEach(k => {
      try {
        const valStr = processedData[k];
        if (!valStr || valStr.trim() === '') return;

        // Trace project names
        if (k.startsWith('construction_project_name_')) {
          const pId = k.substring('construction_project_name_'.length);
          const foundProj = allProjsList.find(p => p.id === pId);
          if (foundProj && !exportedProjects.includes(foundProj.name)) {
            exportedProjects.push(foundProj.name);
          }
        } else if (k === 'construction_project_name') {
          const defaultProjName = localStorage.getItem('construction_project_name') || 'Dự án mặc định';
          if (!exportedProjects.includes(defaultProjName)) {
            exportedProjects.push(defaultProjName);
          }
        }

        // Granular scanning of standard tables
        if (k.includes('construction_material_norms')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) normsCount += parsed.length;
        }
        else if (k.includes('construction_inventory')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            invCount += parsed.length;
            parsed.forEach((item: any) => {
              if (item.type === 'in') invInCount++;
              if (item.type === 'out') invOutCount++;
            });
          }
        }
        else if (k.includes('construction_work_volumes')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            volsCount += parsed.length;
            parsed.forEach((item: any) => {
              if (item.status === 'Đã hoàn thành') volsDoneCount++;
              else if (item.status === 'Đang thi công') volsInProgCount++;
              else volsNotStartedCount++;
            });
          }
        }
        else if (k.includes('construction_floor_plans')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            plansCount += parsed.length;
            parsed.forEach((item: any) => {
              if (item.imageUrl && item.imageUrl.trim().length > 0) {
                floorPlansWithImage++;
              }
            });
          }
        }
        else if (k.includes('construction_defects')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            defectsCount += parsed.length;
            parsed.forEach((item: any) => {
              if (item.imageUrl && item.imageUrl.trim().length > 0) {
                defectsWithImage++;
              }
              if (item.afterImageUrl && item.afterImageUrl.trim().length > 0) {
                defectsWithAfterImage++;
              }
            });
          }
        }
        else if (k.includes('construction_room_progress')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            progressCount += parsed.length;
          }
        }
        else if (k.includes('construction_checklist')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            checkCount += parsed.length;
          }
        }
        else if (k.includes('construction_crew_records')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            crewCount += parsed.length;
          }
        }
        else if (k.includes('construction_teams')) {
          const parsed = JSON.parse(valStr);
          if (Array.isArray(parsed)) {
            crewCount += parsed.length;
          }
        }
      } catch (_) {}
    });

    if (exportedProjects.length === 0) {
      if (scope === 'active') {
        const curName = projects.find(p => p.id === activeId)?.name || 'Dự án hiện tại';
        exportedProjects.push(curName);
      } else {
        if (projects.length > 0) {
          projects.forEach(p => exportedProjects.push(p.name));
        } else {
          exportedProjects.push('Dự án mặc định');
        }
      }
    }

    const categories: { label: string; count: number; icon: any; details?: string }[] = [];
    if (normsCount > 0) {
      categories.push({ 
        label: 'Định mức vật tư', 
        count: normsCount, 
        icon: Layers3,
        details: `${normsCount} chủng loại định mức thiết lập`
      });
    }
    if (invCount > 0) {
      categories.push({ 
        label: 'Kho & Phân phối', 
        count: invCount, 
        icon: HardDrive,
        details: `${invInCount} Nhập kho | ${invOutCount} Xuất kho`
      });
    }
    if (volsCount > 0) {
      categories.push({ 
        label: 'Khối lượng hoàn thành', 
        count: volsCount, 
        icon: FileSpreadsheet,
        details: `${volsDoneCount} Xong | ${volsInProgCount} Đang làm | ${volsNotStartedCount} Chưa làm`
      });
    }
    if (plansCount > 0) {
      categories.push({ 
        label: 'Mặt bằng & Bản vẽ', 
        count: plansCount, 
        icon: Building2,
        details: `${plansCount} tầng bản vẽ (${floorPlansWithImage} ảnh sơ đồ)`
      });
    }
    if (defectsCount > 0) {
      categories.push({ 
        label: 'Nhật ký lỗi Defect', 
        count: defectsCount, 
        icon: AlertTriangle,
        details: `${defectsCount} lỗi ghim (${defectsWithImage} ảnh trước, ${defectsWithAfterImage} ảnh sau)`
      });
    }
    if (progressCount > 0) {
      categories.push({ 
        label: 'Tiến độ tầng', 
        count: progressCount, 
        icon: CheckCircle,
        details: `${progressCount} Căn / Phòng đã định vị`
      });
    }
    if (checkCount > 0) {
      categories.push({ 
        label: 'Danh mục kiểm tra', 
        count: checkCount, 
        icon: CheckSquare,
        details: `${checkCount} chỉ tiêu nghiệm thu`
      });
    }
    if (crewCount > 0) {
      categories.push({ 
        label: 'Nhân công & Đội thợ', 
        count: crewCount, 
        icon: History,
        details: `${crewCount} đội & nhật ký chấm công`
      });
    }

    const matches = rawJsonString.match(/data:image\//g);
    const imageCount = matches ? matches.length : 0;
    const isFullBackup = categories.length >= 4;

    // Detailed image audit
    const imageDetailStats: { label: string; count: number }[] = [];
    if (floorPlansWithImage > 0) {
      imageDetailStats.push({ label: 'Ảnh sơ đồ mặt bằng', count: floorPlansWithImage });
    }
    if (defectsWithImage > 0) {
      imageDetailStats.push({ label: 'Ảnh lỗi phát hiện (Trước)', count: defectsWithImage });
    }
    if (defectsWithAfterImage > 0) {
      imageDetailStats.push({ label: 'Ảnh lỗi khắc phục (Sau)', count: defectsWithAfterImage });
    }

    return {
      projectsExported: exportedProjects,
      categoriesExported: categories,
      imageStats: {
        hasImages: imageCount > 0 || floorPlansWithImage > 0 || defectsWithImage > 0 || defectsWithAfterImage > 0,
        imageCount: floorPlansWithImage + defectsWithImage + defectsWithAfterImage,
        detailStats: imageDetailStats
      },
      isFullBackup
    };
  };

  const analyzeImportData = (parsedData: any) => {
    const importedProjects: string[] = [];
    const projListRaw = localStorage.getItem('construction_projects_list') || '[]';
    let allProjsList: any[] = [];
    try {
      allProjsList = JSON.parse(projListRaw);
    } catch (_) {}

    let normsCount = 0;
    let invCount = 0;
    let volsCount = 0;
    let plansCount = 0;
    let defectsCount = 0;
    let progressCount = 0;
    let checkCount = 0;
    let crewCount = 0;

    // Granular details
    let invInCount = 0;
    let invOutCount = 0;
    let defectsWithImage = 0;
    let defectsWithAfterImage = 0;
    let floorPlansWithImage = 0;
    let volsDoneCount = 0;
    let volsInProgCount = 0;
    let volsNotStartedCount = 0;

    const normalized = normalizeImportedData(parsedData);
    const keys = Object.keys(parsedData || {});
    const isStorageDump = keys.some(k => k.startsWith('construction_') || k === 'active_project_id');

    if (isStorageDump) {
      keys.forEach(k => {
        try {
          const valStr = parsedData[k];
          if (!valStr || typeof valStr !== 'string' || valStr.trim() === '') return;

          // Trace project names
          if (k.startsWith('construction_project_name_')) {
            const pId = k.substring('construction_project_name_'.length);
            const foundProj = allProjsList.find(p => p.id === pId);
            if (foundProj && !importedProjects.includes(foundProj.name)) {
              importedProjects.push(foundProj.name);
            }
          } else if (k === 'construction_project_name') {
            const defaultProjName = localStorage.getItem('construction_project_name') || 'Dự án mặc định';
            if (!importedProjects.includes(defaultProjName)) {
              importedProjects.push(defaultProjName);
            }
          }

          // Granular scanning of standard tables
          if (k.includes('construction_material_norms')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) normsCount += parsed.length;
          }
          else if (k.includes('construction_inventory')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) {
              invCount += parsed.length;
              parsed.forEach((item: any) => {
                if (item.type === 'in') invInCount++;
                if (item.type === 'out') invOutCount++;
              });
            }
          }
          else if (k.includes('construction_work_volumes')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) {
              volsCount += parsed.length;
              parsed.forEach((item: any) => {
                if (item.status === 'Đã hoàn thành') volsDoneCount++;
                else if (item.status === 'Đang thi công') volsInProgCount++;
                else volsNotStartedCount++;
              });
            }
          }
          else if (k.includes('construction_floor_plans')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) {
              plansCount += parsed.length;
              parsed.forEach((item: any) => {
                if (item.imageUrl && item.imageUrl.trim().length > 0) {
                  floorPlansWithImage++;
                }
              });
            }
          }
          else if (k.includes('construction_defects')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) {
              defectsCount += parsed.length;
              parsed.forEach((item: any) => {
                if (item.imageUrl && item.imageUrl.trim().length > 0) {
                  defectsWithImage++;
                }
                if (item.afterImageUrl && item.afterImageUrl.trim().length > 0) {
                  defectsWithAfterImage++;
                }
              });
            }
          }
          else if (k.includes('construction_room_progress')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) progressCount += parsed.length;
          }
          else if (k.includes('construction_checklist')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) checkCount += parsed.length;
          }
          else if (k.includes('construction_crew_records')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) crewCount += parsed.length;
          }
          else if (k.includes('construction_teams')) {
            const parsed = JSON.parse(valStr);
            if (Array.isArray(parsed)) crewCount += parsed.length;
          }
        } catch (_) {}
      });
    } else {
      const pName = normalized.projectName || 'Dự án khôi phục';
      importedProjects.push(pName);

      if (Array.isArray(normalized.materialNorms)) {
        normsCount = normalized.materialNorms.length;
      }
      if (Array.isArray(normalized.inventory)) {
        invCount = normalized.inventory.length;
        normalized.inventory.forEach((item: any) => {
          if (item.type === 'in') invInCount++;
          if (item.type === 'out') invOutCount++;
        });
      }
      if (Array.isArray(normalized.workVolumes)) {
        volsCount = normalized.workVolumes.length;
        normalized.workVolumes.forEach((item: any) => {
          if (item.status === 'Đã hoàn thành') volsDoneCount++;
          else if (item.status === 'Đang thi công') volsInProgCount++;
          else volsNotStartedCount++;
        });
      }
      if (Array.isArray(normalized.floorPlans)) {
        plansCount = normalized.floorPlans.length;
        normalized.floorPlans.forEach((item: any) => {
          if (item.imageUrl && item.imageUrl.trim().length > 0) {
            floorPlansWithImage++;
          }
        });
      }
      if (Array.isArray(normalized.defects)) {
        defectsCount = normalized.defects.length;
        normalized.defects.forEach((item: any) => {
          if (item.imageUrl && item.imageUrl.trim().length > 0) {
            defectsWithImage++;
          }
          if (item.afterImageUrl && item.afterImageUrl.trim().length > 0) {
            defectsWithAfterImage++;
          }
        });
      }
      if (Array.isArray(normalized.roomProgressList)) {
        progressCount = normalized.roomProgressList.length;
      }
      if (Array.isArray(normalized.checklist)) {
        checkCount = normalized.checklist.length;
      }
      if (Array.isArray(normalized.crewRecords)) {
        crewCount += normalized.crewRecords.length;
      }
      if (Array.isArray(normalized.teams)) {
        crewCount += normalized.teams.length;
      }
    }

    if (importedProjects.length === 0) {
      if (projects.length > 0) {
        projects.forEach(p => importedProjects.push(p.name));
      } else {
        importedProjects.push('Dự án mặc định');
      }
    }

    const categories: { label: string; count: number; icon: any; details?: string }[] = [];
    if (normsCount > 0) {
      categories.push({ 
        label: 'Định mức vật tư', 
        count: normsCount, 
        icon: Layers3,
        details: `${normsCount} chủng loại định mức thiết lập`
      });
    }
    if (invCount > 0) {
      categories.push({ 
        label: 'Kho & Phân phối', 
        count: invCount, 
        icon: HardDrive,
        details: `${invInCount} Nhập kho | ${invOutCount} Xuất kho`
      });
    }
    if (volsCount > 0) {
      categories.push({ 
        label: 'Khối lượng hoàn thành', 
        count: volsCount, 
        icon: FileSpreadsheet,
        details: `${volsDoneCount} Xong | ${volsInProgCount} Đang làm | ${volsNotStartedCount} Chưa làm`
      });
    }
    if (plansCount > 0) {
      categories.push({ 
        label: 'Mặt bằng & Bản vẽ', 
        count: plansCount, 
        icon: Building2,
        details: `${plansCount} tầng bản vẽ (${floorPlansWithImage} ảnh sơ đồ)`
      });
    }
    if (defectsCount > 0) {
      categories.push({ 
        label: 'Nhật ký lỗi Defect', 
        count: defectsCount, 
        icon: AlertTriangle,
        details: `${defectsCount} lỗi ghim (${defectsWithImage} ảnh trước, ${defectsWithAfterImage} ảnh sau)`
      });
    }
    if (progressCount > 0) {
      categories.push({ 
        label: 'Tiến độ tầng', 
        count: progressCount, 
        icon: CheckCircle,
        details: `${progressCount} Căn / Phòng đã định vị`
      });
    }
    if (checkCount > 0) {
      categories.push({ 
        label: 'Danh mục kiểm tra', 
        count: checkCount, 
        icon: CheckSquare,
        details: `${checkCount} chỉ tiêu nghiệm thu`
      });
    }
    if (crewCount > 0) {
      categories.push({ 
        label: 'Nhân công & Đội thợ', 
        count: crewCount, 
        icon: History,
        details: `${crewCount} đội & nhật ký chấm công`
      });
    }

    const rawJsonString = JSON.stringify(parsedData);
    const matches = rawJsonString.match(/data:image\//g);
    const imageCount = matches ? matches.length : 0;

    const imageDetailStats: { label: string; count: number }[] = [];
    if (floorPlansWithImage > 0) {
      imageDetailStats.push({ label: 'Ảnh sơ đồ mặt bằng', count: floorPlansWithImage });
    }
    if (defectsWithImage > 0) {
      imageDetailStats.push({ label: 'Ảnh lỗi phát hiện (Trước)', count: defectsWithImage });
    }
    if (defectsWithAfterImage > 0) {
      imageDetailStats.push({ label: 'Ảnh lỗi khắc phục (Sau)', count: defectsWithAfterImage });
    }

    return {
      projectsImported: importedProjects,
      categoriesImported: categories,
      imageStats: {
        hasImages: imageCount > 0 || floorPlansWithImage > 0 || defectsWithImage > 0 || defectsWithAfterImage > 0,
        imageCount: floorPlansWithImage + defectsWithImage + defectsWithAfterImage,
        detailStats: imageDetailStats
      },
      isFullBackup: categories.length >= 4
    };
  };

  // Helper to sanitize project name for filenames
  const sanitizeFilename = (name: string) => {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/đ/g, 'd').replace(/Đ/g, 'D') // Replace đ/Đ
      .replace(/[^a-zA-Z0-9]/g, '_') // Replace non-alphanumeric with underscore
      .replace(/_+/g, '_') // Remove duplicate underscores
      .replace(/^_|_$/g, ''); // Trim underscores
  };

  // 1. Export JSON based on chosen scope
  const handleExportJsonForScope = async () => {
    try {
      if (exportEncrypt && (!exportPassword || exportPassword.length < 4)) {
        alert('Vui lòng nhập mật khẩu mã hóa từ 4 ký tự trở lên để bảo vệ tệp sao lưu.');
        return;
      }

      const data = await getStorageDataForScope(saveScope);
      let filename = `Backup_TatCa_${Date.now()}.json`;
      let finalDataToExport: any = data;
      
      if (saveScope === 'active' && activeId) {
        const curName = projects.find(p => p.id === activeId)?.name || activeId;
        const safeName = sanitizeFilename(curName);
        filename = `Backup_${safeName}_${Date.now()}.json`;

        const normalized = normalizeImportedData(data, activeId);
        const photosWithBinary = await getProjectPhotosWithBinary(activeId);
        const photoDataMap: Record<string, string> = {};
        photosWithBinary.forEach(p => {
          if (p.id && (p.base64 || p.localUri)) {
            photoDataMap[p.id] = p.base64 || p.localUri;
          }
        });

        finalDataToExport = {
          schemaVersion: 3,
          backupType: "single-project",
          project: {
            id: activeId,
            name: curName
          },
          data: {
            projectName: normalized.projectName || curName,
            contractorName: normalized.contractorName || '',
            inspectorName: normalized.inspectorName || '',
            materialNorms: normalized.materialNorms || [],
            inventory: normalized.inventory || [],
            workVolumes: normalized.workVolumes || [],
            floorPlans: normalized.floorPlans || [],
            defects: normalized.defects || [],
            roomProgressList: normalized.roomProgressList || [],
            checklist: normalized.checklist || [],
            crewRecords: normalized.crewRecords || [],
            teams: normalized.teams || [],
            photos: (photosWithBinary || []).map((photo) => {
              const { base64, localUri, dataUrl, ...metadataOnly } = photo as any;
              return metadataOnly;
            }),
            photoData: photoDataMap,
            tombstones: normalized.tombstones || data[getKey('construction_tombstones', activeId)] || {},
            updatedAt: normalized.updatedAt || Date.now()
          },
          tombstones: normalized.tombstones || data[getKey('construction_tombstones', activeId)] || {}
        };
      } else {
        const targetPids = saveScope === 'selected' ? selectedProjectIds : projects.map(p => p.id);
        if (saveScope === 'selected' && selectedProjectIds.length > 0) {
          filename = `Backup_${selectedProjectIds.length}_DuAn_${Date.now()}.json`;
        }

        const allProjectPhotos: Record<string, any[]> = {};
        const allProjectPhotoData: Record<string, Record<string, string>> = {};

        for (const pId of targetPids) {
          const pPhotos = await getProjectPhotosWithBinary(pId);
          if (pPhotos.length > 0) {
            allProjectPhotos[pId] = pPhotos.map((photo) => {
              const { base64, localUri, dataUrl, ...metadataOnly } = photo as any;
              return metadataOnly;
            });
            const pDataMap: Record<string, string> = {};
            pPhotos.forEach(ph => {
              if (ph.id && (ph.base64 || ph.localUri)) {
                pDataMap[ph.id] = ph.base64 || ph.localUri;
              }
            });
            allProjectPhotoData[pId] = pDataMap;
          }
        }

        if (Object.keys(allProjectPhotos).length > 0) {
          finalDataToExport.projectPhotos = allProjectPhotos;
          finalDataToExport.projectPhotoData = allProjectPhotoData;
        }
      }
      
      // Analyze export stats before encryption
      const stats = analyzeExportData(saveScope, finalDataToExport, JSON.stringify(finalDataToExport));

      // Apply AES-GCM encryption if user toggled encryption
      if (exportEncrypt && exportPassword) {
        finalDataToExport = await encryptBackupData(finalDataToExport, exportPassword, exportHint.trim() || undefined);
        filename = filename.replace('.json', '_Encrypted.json');
      }

      const jsonString = JSON.stringify(finalDataToExport, null, 2);
      // JSON is text: use the streaming Android text bridge instead of converting the
      // whole file to Base64. Large photo backups previously exhausted WebView memory
      // and could create a visible 0 KB file on Android.
      await downloadOrShareFile(filename, jsonString, 'application/json;charset=utf-8');

      // Calculate file size
      let fileSizeStr = '';
      const bytes = jsonString.length;
      if (bytes >= 1024 * 1024) {
        fileSizeStr = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      } else {
        fileSizeStr = `${(bytes / 1024).toFixed(1)} KB`;
      }

      logAuditAction('BACKUP_EXPORT', `Xuất file sao lưu (${saveScope}) ${exportEncrypt ? '[AES-GCM Encrypted]' : ''}`);

      setExportedFileInfo({
        fileName: filename,
        fileSizeStr,
        ...stats
      });

    } catch (e) {
      alert('Lỗi xuất tệp JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Handler for decrypting encrypted backup payloads
  const handlePerformDecryption = async () => {
    if (!pendingEncryptedPayload) return;
    if (!decryptPassword) {
      setDecryptError('Vui lòng nhập mật khẩu giải mã.');
      return;
    }
    try {
      setIsDecrypting(true);
      setDecryptError('');
      const decrypted = await decryptBackupData(pendingEncryptedPayload, decryptPassword);
      const fileInfo = pendingImportFileInfo;
      setPendingEncryptedPayload(null);
      setDecryptPassword('');
      setShowReencryptOptions(false);
      setNewReencryptPassword('');
      setNewReencryptHint('');
      await processImportedJsonData(decrypted, fileInfo?.name || 'Bản sao lưu đã giải mã', fileInfo?.size);
    } catch (err: any) {
      console.error('Decryption error:', err);
      setDecryptError('Mật khẩu giải mã không chính xác hoặc dữ liệu bị sửa đổi!');
    } finally {
      setIsDecrypting(false);
    }
  };

  // Handler for changing backup password (decrypt with old key -> re-encrypt with new key)
  const handleReencryptBackupPayload = async () => {
    if (!pendingEncryptedPayload) return;
    if (!decryptPassword) {
      setDecryptError('Vui lòng nhập mật khẩu hiện tại để giải mã.');
      return;
    }
    if (!newReencryptPassword || newReencryptPassword.length < 4) {
      setDecryptError('Mật khẩu mới phải từ 4 ký tự trở lên.');
      return;
    }
    try {
      setIsDecrypting(true);
      setDecryptError('');
      // 1. Decrypt using current password
      const decryptedData = await decryptBackupData(pendingEncryptedPayload, decryptPassword);
      
      // 2. Encrypt with new password
      const reencryptedPayload = await encryptBackupData(decryptedData, newReencryptPassword, newReencryptHint.trim() || undefined);
      
      // 3. Export new file
      let baseName = pendingImportFileInfo?.name || 'Backup_Encrypted.json';
      if (!baseName.endsWith('.json')) baseName += '.json';
      const newFileName = baseName.replace(/\.json$/i, '_NewPassword.json');
      
      const jsonString = JSON.stringify(reencryptedPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      await downloadOrShareFile(newFileName, blob, 'application/json');

      logAuditAction('BACKUP_EXPORT', `Đã đổi mật khẩu mã hóa cho file sao lưu: ${newFileName}`);
      alert(`🎉 Đổi mật khẩu file backup thành công!\n\nDữ liệu đã được giải mã bằng mật khẩu cũ và mã hóa lại bằng mật khẩu mới. File mới đã được xuất với tên:\n${newFileName}`);
      
      setPendingEncryptedPayload(null);
      setDecryptPassword('');
      setNewReencryptPassword('');
      setNewReencryptHint('');
      setShowReencryptOptions(false);
    } catch (err: any) {
      console.error('Re-encryption error:', err);
      setDecryptError('Mật khẩu hiện tại không chính xác! Không thể giải mã để đổi mật khẩu mới.');
    } finally {
      setIsDecrypting(false);
    }
  };

  // 2. Process Imported JSON Data (File or Pasted Text)
  const processImportedJsonData = async (parsedData: any, fileName?: string, fileSize?: number) => {
    try {
      const candidates = extractProjectsFromImportData(parsedData);
      if (!candidates || candidates.length === 0) {
        alert('Tệp sao lưu không chứa dữ liệu công trình hợp lệ hoặc cấu trúc không được nhận diện.');
        return;
      }

      const curList = getProjectsList();
      const pendingItems: {
        candidate: ProjectImportCandidate;
        existsLocally: boolean;
        localProjectInfo?: ProjectInfo;
        localUpdatedAt: number;
        isLocalNewer: boolean;
        isIncomingNewer: boolean;
        action: 'CREATE_PRESERVE_ID' | 'KEEP_LOCAL' | 'OVERWRITE_FILE' | 'SMART_MERGE' | 'IMPORT_AS_NEW_COPY' | 'SKIP';
      }[] = [];

      for (const cand of candidates) {
        const localMatch = curList.find(p => p.id === cand.id);
        if (!localMatch) {
          // Project does not exist locally: default to creating preserving exact original ID
          pendingItems.push({
            candidate: cand,
            existsLocally: false,
            localUpdatedAt: 0,
            isLocalNewer: false,
            isIncomingNewer: true,
            action: 'CREATE_PRESERVE_ID',
          });
        } else {
          // Project exists locally: compare timestamps
          const localUpdatedStr = localStorage.getItem(getKey('construction_updated_at', cand.id));
          const localUpdatedAt = localUpdatedStr ? parseInt(localUpdatedStr, 10) : (localMatch.updatedAt || 0);

          const isLocalNewer = localUpdatedAt > cand.updatedAt;
          const isIncomingNewer = cand.updatedAt > localUpdatedAt;

          // Default action: SMART_MERGE preserves changes from both sides
          pendingItems.push({
            candidate: cand,
            existsLocally: true,
            localProjectInfo: localMatch,
            localUpdatedAt,
            isLocalNewer,
            isIncomingNewer,
            action: 'SMART_MERGE',
          });
        }
      }

      setMultiProjectSyncState({
        fileName: fileName || 'Tệp sao lưu',
        fileSize,
        rawData: parsedData,
        items: pendingItems,
      });
    } catch (err) {
      console.error('Error analyzing backup file:', err);
      alert('Có lỗi khi phân tích dữ liệu tệp sao lưu: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const executeMultiProjectSync = async () => {
    if (!multiProjectSyncState || isExecutingMultiSync) return;
    setIsExecutingMultiSync(true);

    try {
      if (onFlushCurrentProject) {
        await onFlushCurrentProject();
      }

      let curList = getProjectsList();
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let newlyCreatedFirstId: string | null = null;

      for (const item of multiProjectSyncState.items) {
        const { candidate, action } = item;
        const candData = candidate.normalizedData;

        if (action === 'SKIP' || action === 'KEEP_LOCAL') {
          skippedCount++;
          continue;
        }

        const candidatePhotos = candData.photos || (multiProjectSyncState.rawData?.projectPhotos && multiProjectSyncState.rawData.projectPhotos[candidate.id]);
        const candidatePhotoData = candData.photoData || candData.photoDataMap || candidate.photoData || (multiProjectSyncState.rawData?.projectPhotoData && multiProjectSyncState.rawData.projectPhotoData[candidate.id]);

        if (action === 'CREATE_PRESERVE_ID') {
          const targetId = candidate.id;
          if (Array.isArray(candidatePhotos)) {
            await restorePhotosFromBackup(targetId, candidatePhotos, candidatePhotoData);
          }
          await Promise.all([
            setAsyncItem(getKey('construction_project_name', targetId), candidate.name),
            setAsyncItem(getKey('construction_contractor', targetId), candidate.contractorName || ''),
            setAsyncItem(getKey('construction_inspector', targetId), candidate.inspectorName || ''),
            setAsyncItem(getKey('construction_material_norms', targetId), candData.materialNorms || []),
            setAsyncItem(getKey('construction_inventory', targetId), candData.inventory || []),
            setAsyncItem(getKey('construction_work_volumes', targetId), candData.workVolumes || []),
            setAsyncItem(getKey('construction_floor_plans', targetId), candData.floorPlans || []),
            setAsyncItem(getKey('construction_defects', targetId), candData.defects || []),
            setAsyncItem(getKey('construction_room_progress', targetId), candData.roomProgressList || []),
            setAsyncItem(getKey('construction_checklist', targetId), candData.checklist || []),
            setAsyncItem(getKey('construction_crew_records', targetId), candData.crewRecords || []),
            setAsyncItem(getKey('construction_teams', targetId), candData.teams || []),
            setAsyncItem(getKey('construction_updated_at', targetId), String(candidate.updatedAt || Date.now())),
            ...(candData.tombstones ? [setAsyncItem(getKey('construction_tombstones', targetId), candData.tombstones)] : []),
          ]);

          safeSetLocalStorageItem(getKey('construction_project_name', targetId), candidate.name);
          safeSetLocalStorageItem(getKey('construction_contractor', targetId), candidate.contractorName || '');
          safeSetLocalStorageItem(getKey('construction_inspector', targetId), candidate.inspectorName || '');
          safeSetLocalStorageItem(getKey('construction_updated_at', targetId), String(candidate.updatedAt || Date.now()));
          if (candData.tombstones) {
            safeSetLocalStorageItem(getKey('construction_tombstones', targetId), JSON.stringify(candData.tombstones));
          }

          if (!curList.some(p => p.id === targetId)) {
            curList.push({
              id: targetId,
              name: candidate.name,
              // A preserved-ID restore must not invent a creation time from this device.
              // Realtime Firestore metadata is the only authority for displayed createdAt.
              createdAt: 0,
              createdAtSource: 'migrating',
              updatedAt: candidate.updatedAt || Date.now()
            });
          }
          createdCount++;
          if (!newlyCreatedFirstId) newlyCreatedFirstId = targetId;
        } else if (action === 'OVERWRITE_FILE') {
          const targetId = candidate.id;
          if (Array.isArray(candidatePhotos)) {
            await restorePhotosFromBackup(targetId, candidatePhotos, candidatePhotoData);
          }
          await Promise.all([
            setAsyncItem(getKey('construction_project_name', targetId), candidate.name),
            setAsyncItem(getKey('construction_contractor', targetId), candidate.contractorName || ''),
            setAsyncItem(getKey('construction_inspector', targetId), candidate.inspectorName || ''),
            setAsyncItem(getKey('construction_material_norms', targetId), candData.materialNorms || []),
            setAsyncItem(getKey('construction_inventory', targetId), candData.inventory || []),
            setAsyncItem(getKey('construction_work_volumes', targetId), candData.workVolumes || []),
            setAsyncItem(getKey('construction_floor_plans', targetId), candData.floorPlans || []),
            setAsyncItem(getKey('construction_defects', targetId), candData.defects || []),
            setAsyncItem(getKey('construction_room_progress', targetId), candData.roomProgressList || []),
            setAsyncItem(getKey('construction_checklist', targetId), candData.checklist || []),
            setAsyncItem(getKey('construction_crew_records', targetId), candData.crewRecords || []),
            setAsyncItem(getKey('construction_teams', targetId), candData.teams || []),
            setAsyncItem(getKey('construction_updated_at', targetId), String(candidate.updatedAt || Date.now())),
            ...(candData.tombstones ? [setAsyncItem(getKey('construction_tombstones', targetId), candData.tombstones)] : []),
          ]);

          safeSetLocalStorageItem(getKey('construction_project_name', targetId), candidate.name);
          safeSetLocalStorageItem(getKey('construction_contractor', targetId), candidate.contractorName || '');
          safeSetLocalStorageItem(getKey('construction_inspector', targetId), candidate.inspectorName || '');
          safeSetLocalStorageItem(getKey('construction_updated_at', targetId), String(candidate.updatedAt || Date.now()));
          if (candData.tombstones) {
            safeSetLocalStorageItem(getKey('construction_tombstones', targetId), JSON.stringify(candData.tombstones));
          }

          curList = curList.map(p => p.id === targetId ? { ...p, name: candidate.name, updatedAt: candidate.updatedAt || Date.now() } : p);
          updatedCount++;

          if (targetId === activeId && onRestoreData) {
            await onRestoreData(candData, targetId);
          }
        } else if (action === 'SMART_MERGE') {
          const targetId = candidate.id;
          if (Array.isArray(candidatePhotos)) {
            await restorePhotosFromBackup(targetId, candidatePhotos, candidatePhotoData);
          }
          let localData: any = {};
          if (targetId === activeId && fullAppData) {
            localData = fullAppData;
          } else {
            const [norms, inv, vols, plans, defs, rooms, chk, crew, teams, pName, cName, iName, uTime, tombstones] = await Promise.all([
              getAsyncItem(getKey('construction_material_norms', targetId), []),
              getAsyncItem(getKey('construction_inventory', targetId), []),
              getAsyncItem(getKey('construction_work_volumes', targetId), []),
              getAsyncItem(getKey('construction_floor_plans', targetId), []),
              getAsyncItem(getKey('construction_defects', targetId), []),
              getAsyncItem(getKey('construction_room_progress', targetId), []),
              getAsyncItem(getKey('construction_checklist', targetId), []),
              getAsyncItem(getKey('construction_crew_records', targetId), []),
              getAsyncItem(getKey('construction_teams', targetId), []),
              getAsyncItem(getKey('construction_project_name', targetId), candidate.name),
              getAsyncItem(getKey('construction_contractor', targetId), ''),
              getAsyncItem(getKey('construction_inspector', targetId), ''),
              getAsyncItem(getKey('construction_updated_at', targetId), '0'),
              getAsyncItem(getKey('construction_tombstones', targetId), {}),
            ]);
            localData = {
              projectName: pName,
              contractorName: cName,
              inspectorName: iName,
              materialNorms: norms,
              inventory: inv,
              workVolumes: vols,
              floorPlans: plans,
              defects: defs,
              roomProgressList: rooms,
              checklist: chk,
              crewRecords: crew,
              teams,
              updatedAt: parseInt(uTime || '0', 10),
              tombstones: (tombstones && typeof tombstones === 'object' && !Array.isArray(tombstones)) ? tombstones : {}
            };
          }

          const merged = smartMergeProjectData(localData, candData);

          await Promise.all([
            setAsyncItem(getKey('construction_project_name', targetId), merged.projectName || candidate.name),
            setAsyncItem(getKey('construction_contractor', targetId), merged.contractorName || ''),
            setAsyncItem(getKey('construction_inspector', targetId), merged.inspectorName || ''),
            setAsyncItem(getKey('construction_material_norms', targetId), merged.materialNorms || []),
            setAsyncItem(getKey('construction_inventory', targetId), merged.inventory || []),
            setAsyncItem(getKey('construction_work_volumes', targetId), merged.workVolumes || []),
            setAsyncItem(getKey('construction_floor_plans', targetId), merged.floorPlans || []),
            setAsyncItem(getKey('construction_defects', targetId), merged.defects || []),
            setAsyncItem(getKey('construction_room_progress', targetId), merged.roomProgressList || []),
            setAsyncItem(getKey('construction_checklist', targetId), merged.checklist || []),
            setAsyncItem(getKey('construction_crew_records', targetId), merged.crewRecords || []),
            setAsyncItem(getKey('construction_teams', targetId), merged.teams || []),
            setAsyncItem(getKey('construction_updated_at', targetId), String(merged.updatedAt || Date.now())),
            ...(merged.tombstones ? [setAsyncItem(getKey('construction_tombstones', targetId), merged.tombstones)] : []),
          ]);

          safeSetLocalStorageItem(getKey('construction_project_name', targetId), merged.projectName || candidate.name);
          safeSetLocalStorageItem(getKey('construction_contractor', targetId), merged.contractorName || '');
          safeSetLocalStorageItem(getKey('construction_inspector', targetId), merged.inspectorName || '');
          safeSetLocalStorageItem(getKey('construction_updated_at', targetId), String(merged.updatedAt || Date.now()));
          if (merged.tombstones) {
            safeSetLocalStorageItem(getKey('construction_tombstones', targetId), JSON.stringify(merged.tombstones));
          }

          curList = curList.map(p => p.id === targetId ? { ...p, name: merged.projectName || candidate.name, updatedAt: merged.updatedAt || Date.now() } : p);
          updatedCount++;

          if (targetId === activeId && onRestoreData) {
            await onRestoreData(merged, targetId);
          }
        } else if (action === 'IMPORT_AS_NEW_COPY') {
          const newTargetId = createProjectId();
          const copyName = `${candidate.name} (Bản sao nhập)`;
          await Promise.all([
            setAsyncItem(getKey('construction_project_name', newTargetId), copyName),
            setAsyncItem(getKey('construction_contractor', newTargetId), candidate.contractorName || ''),
            setAsyncItem(getKey('construction_inspector', newTargetId), candidate.inspectorName || ''),
            setAsyncItem(getKey('construction_material_norms', newTargetId), candData.materialNorms || []),
            setAsyncItem(getKey('construction_inventory', newTargetId), candData.inventory || []),
            setAsyncItem(getKey('construction_work_volumes', newTargetId), candData.workVolumes || []),
            setAsyncItem(getKey('construction_floor_plans', newTargetId), candData.floorPlans || []),
            setAsyncItem(getKey('construction_defects', newTargetId), candData.defects || []),
            setAsyncItem(getKey('construction_room_progress', newTargetId), candData.roomProgressList || []),
            setAsyncItem(getKey('construction_checklist', newTargetId), candData.checklist || []),
            setAsyncItem(getKey('construction_crew_records', newTargetId), candData.crewRecords || []),
            setAsyncItem(getKey('construction_teams', newTargetId), candData.teams || []),
            setAsyncItem(getKey('construction_updated_at', newTargetId), String(Date.now())),
            ...(candData.tombstones ? [setAsyncItem(getKey('construction_tombstones', newTargetId), candData.tombstones)] : []),
          ]);

          safeSetLocalStorageItem(getKey('construction_project_name', newTargetId), copyName);
          safeSetLocalStorageItem(getKey('construction_contractor', newTargetId), candidate.contractorName || '');
          safeSetLocalStorageItem(getKey('construction_inspector', newTargetId), candidate.inspectorName || '');
          safeSetLocalStorageItem(getKey('construction_updated_at', newTargetId), String(Date.now()));
          if (candData.tombstones) {
            safeSetLocalStorageItem(getKey('construction_tombstones', newTargetId), JSON.stringify(candData.tombstones));
          }

          curList.push({
            id: newTargetId,
            name: copyName,
            // This is a genuinely new project ID; Firestore assigns its immutable
            // creation time via serverTimestamp() when metadata is first uploaded.
            createdAt: 0,
            createdAtSource: 'migrating',
            updatedAt: Date.now()
          });
          createdCount++;
          if (!newlyCreatedFirstId) newlyCreatedFirstId = newTargetId;
        }
      }

      saveProjectsList(curList);
      setProjects(curList);
      setMultiProjectSyncState(null);

      const summaryParts: string[] = [];
      if (createdCount > 0) summaryParts.push(`Thêm mới ${createdCount} dự án (Bảo toàn ID gốc)`);
      if (updatedCount > 0) summaryParts.push(`Đồng bộ / Cập nhật ${updatedCount} dự án`);
      if (skippedCount > 0) summaryParts.push(`Giữ nguyên ${skippedCount} dự án`);

      const summaryMsg = `🎉 Đồng bộ & Nhập hoàn tất!\n• ${summaryParts.join('\n• ')}`;
      alert(summaryMsg);

      if (newlyCreatedFirstId && (!curList.some(p => p.id === activeId) || createdCount === 1)) {
        if (confirm(`Bạn có muốn chuyển sang xem dự án vừa thêm ("${curList.find(p => p.id === newlyCreatedFirstId)?.name}") ngay không?`)) {
          await handleSwitchProject(newlyCreatedFirstId);
        }
      }
    } catch (err) {
      console.error('Multi project sync error:', err);
      alert('Lỗi khi đồng bộ dự án: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExecutingMultiSync(false);
    }
  };

  const executeFullReplaceRestore = async () => {
    if (!multiProjectSyncState) return;
    const candidates = multiProjectSyncState.items.map(it => it.candidate);
    const count = candidates.length;

    const confirm = await confirmAsync(
      `⚠️ CẢNH BÁO KHÔI PHỤC toàn bộ & THAY THẾ (FULL REPLACE):\n\n` +
      `Thao tác này sẽ:\n` +
      `1. XÓA HOÀN TOÀN các dự án hiện có trên máy không nằm trong tệp sao lưu này.\n` +
      `2. Ghi đè toàn bộ dữ liệu của ${count} dự án trong tệp sao lưu vào máy.\n` +
      `3. Đồng bộ danh sách dự án khớp 100% với tệp sao lưu.\n\n` +
      `Bạn có chắc chắn muốn thực hiện Khôi Phục Thay Thế không?`
    );
    if (!confirm) return;

    try {
      setIsExecutingMultiSync(true);
      const curList = getProjectsList();
      const incomingIds = new Set(candidates.map(c => c.id));
      
      // Atomic snapshot for rollback if operation fails
      const preSnapshot = await getAllStorageData();
      const preProjectsList = [...curList];

      try {
        // 1. Dynamic key cleanup for obsolete local projects not in incoming backup
        const obsoleteProjects = curList.filter(p => !incomingIds.has(p.id));
        for (const p of obsoleteProjects) {
          const keysToRemove = await getProjectStorageKeys(p.id);
          for (const k of keysToRemove) {
            localStorage.removeItem(k);
            await removeAsyncItem(k);
          }
          await deleteProjectPhotos(p.id);
        }

        // 2. Write all incoming projects data with exact original ID using normalizedData
        const newProjectsList: ProjectInfo[] = [];
        let activeRestoredData: any = null;

        for (const cand of candidates) {
          const candData = cand.normalizedData || {};
          const targetId = cand.id;

          const candidatePhotos = candData.photos || (multiProjectSyncState.rawData?.projectPhotos && multiProjectSyncState.rawData.projectPhotos[cand.id]);
          const candidatePhotoData = candData.photoData || candData.photoDataMap || cand.photoData || (multiProjectSyncState.rawData?.projectPhotoData && multiProjectSyncState.rawData.projectPhotoData[cand.id]);

          if (Array.isArray(candidatePhotos)) {
            await restorePhotosFromBackup(targetId, candidatePhotos, candidatePhotoData);
          }

          await Promise.all([
            setAsyncItem(getKey('construction_project_name', targetId), candData.projectName || cand.name),
            setAsyncItem(getKey('construction_contractor', targetId), candData.contractorName || ''),
            setAsyncItem(getKey('construction_inspector', targetId), candData.inspectorName || ''),
            setAsyncItem(getKey('construction_material_norms', targetId), candData.materialNorms || []),
            setAsyncItem(getKey('construction_inventory', targetId), candData.inventory || []),
            setAsyncItem(getKey('construction_work_volumes', targetId), candData.workVolumes || []),
            setAsyncItem(getKey('construction_floor_plans', targetId), candData.floorPlans || []),
            setAsyncItem(getKey('construction_defects', targetId), candData.defects || []),
            setAsyncItem(getKey('construction_room_progress', targetId), candData.roomProgressList || []),
            setAsyncItem(getKey('construction_checklist', targetId), candData.checklist || []),
            setAsyncItem(getKey('construction_crew_records', targetId), candData.crewRecords || []),
            setAsyncItem(getKey('construction_teams', targetId), candData.teams || []),
            setAsyncItem(getKey('construction_updated_at', targetId), String(candData.updatedAt || Date.now())),
            ...(candData.tombstones ? [setAsyncItem(getKey('construction_tombstones', targetId), candData.tombstones)] : []),
          ]);

          safeSetLocalStorageItem(getKey('construction_project_name', targetId), candData.projectName || cand.name);
          safeSetLocalStorageItem(getKey('construction_contractor', targetId), candData.contractorName || '');
          safeSetLocalStorageItem(getKey('construction_inspector', targetId), candData.inspectorName || '');
          safeSetLocalStorageItem(getKey('construction_updated_at', targetId), String(candData.updatedAt || Date.now()));
          if (candData.tombstones) {
            safeSetLocalStorageItem(getKey('construction_tombstones', targetId), JSON.stringify(candData.tombstones));
          }

          const resolvedUpdatedAt = candData.updatedAt || Date.now();

          newProjectsList.push({
            id: targetId,
            name: candData.projectName || cand.name,
            // Full restore replaces local data only. Do not restore/fabricate the
            // display creation date; the same projectId must re-read it from Cloud.
            createdAt: 0,
            createdAtSource: 'migrating',
            updatedAt: resolvedUpdatedAt
          });

          if (targetId === activeId) {
            activeRestoredData = candData;
          }
        }

        saveProjectsList(newProjectsList);
        setProjects(newProjectsList);
        setMultiProjectSyncState(null);

        // If active project is not in new list, switch to first project
        const nextActiveId = newProjectsList.some(p => p.id === activeId) ? activeId! : newProjectsList[0]?.id;
        if (nextActiveId && nextActiveId !== activeId) {
          await handleSwitchProject(nextActiveId);
        } else if (activeRestoredData && onRestoreData && activeId) {
          await onRestoreData(activeRestoredData, activeId);
        }

        logAuditAction('FULL_RESTORE_REPLACE', `Khôi phục thay thế toàn bộ ${count} dự án từ tệp sao lưu`);
        alert(`🎉 Khôi phục hoàn tất! Đã thay thế toàn bộ hệ thống bằng ${count} dự án trong tệp sao lưu.`);
      } catch (innerErr) {
        // Rollback state from preSnapshot on failure
        console.error('Full replace restore failed, rolling back to original state:', innerErr);
        saveProjectsList(preProjectsList);
        setProjects(preProjectsList);

        // Remove any keys created during failed restore that were not present in preSnapshot
        const postKeys = await getStorageKeys();
        const preKeysSet = new Set(Object.keys(preSnapshot));
        for (const k of postKeys) {
          if (!preKeysSet.has(k)) {
            localStorage.removeItem(k);
            await removeAsyncItem(k);
          }
        }

        // Restore all original keys and values from preSnapshot
        for (const k of Object.keys(preSnapshot)) {
          const val = preSnapshot[k];
          if (val !== undefined && val !== null) {
            safeSetLocalStorageItem(k, typeof val === 'string' ? val : JSON.stringify(val));
            await setAsyncItem(k, val);
          }
        }
        throw innerErr;
      }
    } catch (err: any) {
      console.error('Full replace restore error:', err);
      alert('Lỗi khi khôi phục thay thế: ' + (err?.message || err));
    } finally {
      setIsExecutingMultiSync(false);
    }
  };

  const handleImportJsonForScope = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        let resultString = event.target?.result as string;
        if (resultString && resultString.startsWith('data:text/json')) {
          const commaIndex = resultString.indexOf(',');
          if (commaIndex !== -1) {
            resultString = decodeURIComponent(resultString.substring(commaIndex + 1));
          }
        }
        const parsedData = JSON.parse(resultString);

        // Check if file is AES-GCM Encrypted
        if (isEncryptedBackup(parsedData)) {
          setPendingEncryptedPayload(parsedData as EncryptedBackupContainer);
          setPendingImportFileInfo({ name: file.name, size: file.size });
          setDecryptPassword('');
          setDecryptError('');
          return;
        }

        await processImportedJsonData(parsedData, file.name, file.size);
      } catch (err) {
        console.error("JSON parse error:", err);
        alert('Tệp JSON không hợp lệ hoặc bị hỏng!');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestoreFromPastedJson = async () => {
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
      const byteLen = new Blob([resultString]).size;

      // Check if encrypted
      if (isEncryptedBackup(parsedData)) {
        setPendingEncryptedPayload(parsedData as EncryptedBackupContainer);
        setPendingImportFileInfo({ name: 'Nội dung dán mã hóa', size: byteLen });
        setDecryptPassword('');
        setDecryptError('');
        setPasteValue('');
        setShowPasteArea(false);
        return;
      }

      await processImportedJsonData(parsedData, 'Nội dung dán trực tiếp', byteLen);
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
      
      const scopeData = await getStorageDataForScope(saveScope);
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
      setCloudStatusMsg({ type: 'success', text: '🎉 Đã tạo bản sao lưu đám mây.' });
      await fetchCloudBackups();
    } catch (err) {
      setCloudStatusMsg({ type: 'error', text: 'Lỗi sao lưu đám mây: ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setIsSavingCloudBackup(false);
    }
  };

  // Restore Cloud Backup
  
  const handleViewCloudBackupStats = (b: any) => {
    const payload = getCloudPayload(b);
    if (!payload) {
      alert('Không thể đọc dữ liệu chi tiết của bản lưu này.');
      return;
    }
    const stats = analyzeImportData(payload);
    setExportedFileInfo({
      title: 'Chi tiết bản sao lưu đám mây',
      fileName: b.backupName,
      fileSizeStr: formatDateTime(b.createdAt),
      projectsExported: stats.projectsImported,
      categoriesExported: stats.categoriesImported,
      imageStats: stats.imageStats,
      isFullBackup: stats.isFullBackup,
    });
  };

  const handleRestoreCloudBackup = async (backup: CloudBackupRecord) => {
    const payload = getCloudPayload(backup);
    if (!payload) {
      alert('Không thể đọc dữ liệu từ bản sao lưu đám mây này.');
      return;
    }
    await processImportedJsonData(payload, backup.backupName);
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
      
      const projData = await getStorageDataForScope('active');
      const normalized = normalizeImportedData(projData, curId);

      await saveProjectToCloud({
        id: curId,
        name: normalized.projectName || currentProj.name,
        contractorName: normalized.contractorName || '',
        inspectorName: normalized.inspectorName || '',
        syncCode: curId.toUpperCase().slice(0, 8),
        payload: normalized
      });

      const jsonString = JSON.stringify(normalized);
      const stats = analyzeExportData('active', projData, jsonString);
      setCloudStatusMsg({ 
        type: 'success', 
        text: `✅ Đã đẩy dự án "${normalized.projectName || currentProj.name}" lên Cloud! Mã Sync: ${curId}`,
        stats 
      });
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
        alert('Không tìm thấy dự án trên đám mây với mã này!');
        return;
      }

      const cloudPayload = getCloudPayload(rec) as any;
      if (cloudPayload) {
        const pid = rec.id;
        const pName = cloudPayload.projectName || rec.name || 'Dự Án Mới';
        const pContractor = cloudPayload.contractorName || '';
        const pInspector = cloudPayload.inspectorName || '';
        let fallbackUpdatedAt = 0;
        const scanArray = (arr: any[]) => {
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            if (item && typeof item === 'object') {
              const t = parseLegacyTimestamp(item.updatedAt || item.date, 0);
              if (t > fallbackUpdatedAt) fallbackUpdatedAt = t;
            }
          }
        };
        scanArray(cloudPayload.materialNorms);
        scanArray(cloudPayload.inventory);
        scanArray(cloudPayload.workVolumes);
        scanArray(cloudPayload.floorPlans);
        scanArray(cloudPayload.defects);
        scanArray(cloudPayload.roomProgressList);
        scanArray(cloudPayload.checklist);
        scanArray(cloudPayload.crewRecords);
        scanArray(cloudPayload.teams);

        const pUpdatedAt = String(cloudPayload.updatedAt || fallbackUpdatedAt);

        // Write metadata
        localStorage.setItem(getKey('construction_project_name', pid), pName);
        localStorage.setItem(getKey('construction_contractor', pid), pContractor);
        localStorage.setItem(getKey('construction_inspector', pid), pInspector);
        localStorage.setItem(getKey('construction_updated_at', pid), pUpdatedAt);

        // Write domain collections to IndexedDB with correct project-scoped keys
        await Promise.all([
          setAsyncItem(getKey('construction_project_name', pid), pName),
          setAsyncItem(getKey('construction_contractor', pid), pContractor),
          setAsyncItem(getKey('construction_inspector', pid), pInspector),
          setAsyncItem(getKey('construction_material_norms', pid), cloudPayload.materialNorms || []),
          setAsyncItem(getKey('construction_inventory', pid), cloudPayload.inventory || []),
          setAsyncItem(getKey('construction_work_volumes', pid), cloudPayload.workVolumes || []),
          setAsyncItem(getKey('construction_floor_plans', pid), cloudPayload.floorPlans || []),
          setAsyncItem(getKey('construction_defects', pid), cloudPayload.defects || []),
          setAsyncItem(getKey('construction_room_progress', pid), cloudPayload.roomProgressList || []),
          setAsyncItem(getKey('construction_checklist', pid), cloudPayload.checklist || []),
          setAsyncItem(getKey('construction_crew_records', pid), cloudPayload.crewRecords || []),
          setAsyncItem(getKey('construction_teams', pid), cloudPayload.teams || []),
          setAsyncItem(getKey('construction_updated_at', pid), pUpdatedAt),
        ]);
        
        const curList = getProjectsList();
        if (!curList.some(p => p.id === pid)) {
          curList.push({
            id: pid,
            name: pName,
            createdAt: 0,
            createdAtSource: 'migrating',
            updatedAt: Number(pUpdatedAt || 0),
          });
          saveProjectsList(curList);
        }
        
        setActiveProject(pid);
        alert(`🎉 Tải dữ liệu dự án "${pName}" từ đám mây thành công! Ứng dụng sẽ tự động tải lại.`);
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

  const handleSwitchProject = async (id: string) => {
    if (id === activeId || switchingProjectId) return;
    setSwitchingProjectId(id);
    try {
      if (onSwitchProject) {
        await onSwitchProject(id);
        setActiveId(id);
        onClose();
      } else {
        setActiveProject(id);
        window.location.reload();
      }
    } finally {
      setSwitchingProjectId(null);
    }
  };

  const handleStartRename = (proj: ProjectInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProjectId(proj.id);
    setEditingProjectName(proj.name);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingProjectName.trim()) return;
    const trimmed = editingProjectName.trim();
    const now = Date.now();
    const updated = projects.map(p => p.id === id ? { ...p, name: trimmed, updatedAt: now } : p);
    saveProjectsList(updated);
    setProjects(updated);
    saveProjectMetadataToCloud(id, trimmed).catch((err) => console.warn('Rename project cloud sync warning:', err));

    safeSetLocalStorageItem(`construction_project_name_${id}`, trimmed);
    if (id === 'default') {
      safeSetLocalStorageItem('construction_project_name', trimmed);
    }

    setEditingProjectId(null);
    if (id === activeId) {
      if (onFlushCurrentProject) {
        await onFlushCurrentProject();
      }
      if (onSwitchProject) {
        await onSwitchProject(id);
      } else {
        window.location.reload();
      }
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      if (onFlushCurrentProject) {
        await onFlushCurrentProject();
      }
      const newProjectId = createProjectId();
      const now = Date.now();
      const trimmedName = newProjectName.trim();
      const newProject: ProjectInfo = {
        id: newProjectId,
        name: trimmedName,
        // Do not fabricate the displayed creation date locally. Firestore writes
        // serverTimestamp() and the realtime project index fills this value back in.
        createdAt: 0,
        createdAtSource: 'migrating',
        updatedAt: now,
      };
      
      let hadQuotaIssue = false;

      if (duplicateFromCurrent) {
        const activeSuffix = activeId === 'default' ? '' : `_${activeId}`;
        const newSuffix = `_${newProjectId}`;
        const keysToCopy: string[] = [];
        
        // Fetch keys from both localStorage and localforage
        const allKeys = await getStorageKeys();
        const allStorage = await getAllStorageData();

        allKeys.forEach(k => {
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
        });
        
        for (const k of keysToCopy) {
          const val = allStorage[k];
          let newKey = activeId === 'default' ? `${k}${newSuffix}` : k.replace(activeSuffix, newSuffix);
          if (newKey && val !== null && val !== undefined) {
            const isLargeKey = [
              'material_norms', 'inventory', 'work_volumes', 'floor_plans',
              'defects', 'room_progress', 'checklist', 'crew_records', 'teams'
            ].some(b => newKey.includes(`construction_${b}`));

            if (isLargeKey) {
              await setAsyncItem(newKey, val);
            } else {
              const saved = safeSetLocalStorageItem(newKey, val);
              if (!saved) hadQuotaIssue = true;
            }
          }
        }
      } else {
        // Explicitly initialize empty collections for the new project so it has a completely clean slate
        await Promise.all([
          setAsyncItem(getKey('construction_material_norms', newProjectId), []),
          setAsyncItem(getKey('construction_inventory', newProjectId), []),
          setAsyncItem(getKey('construction_work_volumes', newProjectId), []),
          setAsyncItem(getKey('construction_floor_plans', newProjectId), []),
          setAsyncItem(getKey('construction_defects', newProjectId), []),
          setAsyncItem(getKey('construction_room_progress', newProjectId), []),
          setAsyncItem(getKey('construction_checklist', newProjectId), []),
          setAsyncItem(getKey('construction_crew_records', newProjectId), []),
          setAsyncItem(getKey('construction_teams', newProjectId), []),
          setAsyncItem(getKey('construction_project_name', newProjectId), trimmedName),
          setAsyncItem(getKey('construction_contractor', newProjectId), ''),
          setAsyncItem(getKey('construction_inspector', newProjectId), ''),
          setAsyncItem(getKey('construction_updated_at', newProjectId), String(now)),
        ]);
      }
      
      safeSetLocalStorageItem(getKey('construction_project_name', newProjectId), trimmedName);
      safeSetLocalStorageItem(getKey('construction_contractor', newProjectId), duplicateFromCurrent ? (localStorage.getItem(getKey('construction_contractor', activeId)) || '') : '');
      safeSetLocalStorageItem(getKey('construction_inspector', newProjectId), duplicateFromCurrent ? (localStorage.getItem(getKey('construction_inspector', activeId)) || '') : '');
      safeSetLocalStorageItem(getKey('construction_updated_at', newProjectId), String(now));

      const updated = [...projects, newProject];
      saveProjectsList(updated);
      setProjects(updated);
      await saveProjectMetadataToCloud(newProjectId, trimmedName, {
        contractorName: duplicateFromCurrent ? (localStorage.getItem(getKey('construction_contractor', activeId)) || '') : '',
        inspectorName: duplicateFromCurrent ? (localStorage.getItem(getKey('construction_inspector', activeId)) || '') : '',
      });
      setNewProjectName('');
      setIsCreating(false);

      if (hadQuotaIssue) {
        alert('Tạo dự án mới thành công! Do bộ nhớ đầy, một số hình ảnh lớn từ dự án cũ đã được bỏ qua.');
      }

      if (onSwitchProject) {
        await onSwitchProject(newProjectId);
        setActiveId(newProjectId);
        onClose();
      } else {
        setActiveProject(newProjectId);
        window.location.reload();
      }
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

    const targetDeleteId = confirmDeleteId;
    setConfirmDeleteId(null);

    const updated = projects.filter(p => p.id !== targetDeleteId);
    saveProjectsList(updated);
    setProjects(updated);
    
    // 1. Dynamic storage cleanup across all storage layers
    const keysToRemove = await getProjectStorageKeys(targetDeleteId);
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
      await removeAsyncItem(k);
    }
    await deleteProjectPhotos(targetDeleteId);
    await deleteCloudProject(targetDeleteId).catch((err) => console.warn('Delete project cloud warning:', err));

    // 2. Write project deletion tombstone to prevent resurrection during sync
    try {
      const deletedListRaw = localStorage.getItem('construction_deleted_projects') || '[]';
      let deletedList: any[] = [];
      try { deletedList = JSON.parse(deletedListRaw); } catch (_) {}
      if (!deletedList.some((d: any) => d.projectId === targetDeleteId)) {
        deletedList.push({
          projectId: targetDeleteId,
          deleted: true,
          deletedAt: Date.now(),
          updatedAt: Date.now()
        });
        localStorage.setItem('construction_deleted_projects', JSON.stringify(deletedList));
        await setAsyncItem('construction_deleted_projects', deletedList);
      }
    } catch (e) {
      console.warn('Error recording project deletion tombstone:', e);
    }

    logAuditAction('PROJECT_DELETE', `Đã xóa dự án ID: ${targetDeleteId}`, targetDeleteId);

    if (targetDeleteId === activeId) {
      const nextId = updated[0]?.id || 'default';
      if (onSwitchProject) {
        await onSwitchProject(nextId);
        setActiveId(nextId);
      } else {
        setActiveProject(nextId);
        window.location.reload();
      }
    }
  };

  const normalizeProjectNameForDuplicate = (name: string): string =>
    (name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('vi-VN')
      .replace(/\s+/g, ' ')
      .trim();

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, ProjectInfo[]>();
    projects.forEach((project) => {
      const key = normalizeProjectNameForDuplicate(project.name);
      if (!key) return;
      const current = groups.get(key) || [];
      current.push(project);
      groups.set(key, current);
    });
    return Array.from(groups.values()).filter((group) => group.length > 1);
  }, [projects]);

  const duplicateProjectIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.map((project) => project.id))),
    [duplicateGroups]
  );

  const formatProjectCreatedAt = (project: ProjectInfo): string => {
    const timestamp = parseLegacyTimestamp(project.createdAt, 0);
    if (project.createdAtSource === 'migrating') return 'Đang chuẩn hóa từ Cloud…';
    if (!timestamp) return project.createdAtSource === 'local' ? 'Chưa có mốc Cloud' : 'Đang chuẩn hóa từ Cloud…';
    const suffix = project.createdAtSource === 'local' ? ' (cục bộ)' : '';
    return `${new Date(timestamp).toLocaleDateString('vi-VN')}${suffix}`;
  };

  const shortProjectId = (projectId: string): string => `…${projectId.slice(-4)}`;

  const summarizeCloudPayload = (payload: any) => {
    const keys = [
      ['materialNorms', 'Định mức'],
      ['inventory', 'Nhập/xuất'],
      ['workVolumes', 'Khối lượng'],
      ['floorPlans', 'Mặt bằng'],
      ['defects', 'Defect'],
      ['roomProgressList', 'Căn/phòng'],
      ['checklist', 'Checklist'],
      ['crewRecords', 'Quân số'],
      ['teams', 'Đội'],
    ] as const;
    return keys.map(([key, label]) => `${label}: ${Array.isArray(payload?.[key]) ? payload[key].length : 0}`).join(', ');
  };

  /**
   * Safely merge same-name/different-ID projects INTO the project chosen by the user.
   * The source project(s) are never deleted automatically. This makes comparison and
   * rollback possible before the user decides which duplicate ID should eventually be removed.
   */
  const handleMergeDuplicateInto = async (target: ProjectInfo) => {
    const key = normalizeProjectNameForDuplicate(target.name);
    const group = duplicateGroups.find((items) => normalizeProjectNameForDuplicate(items[0]?.name || '') === key) || [];
    const sources = group.filter((project) => project.id !== target.id);
    if (sources.length === 0 || mergingDuplicateTargetId) return;

    setMergingDuplicateTargetId(target.id);
    try {
      const records = await Promise.all(group.map(async (project) => ({
        project,
        record: await fetchProjectFromCloud(project.id),
      })));
      const missing = records.filter((item) => !item.record);
      if (missing.length > 0) {
        throw new Error(`Không đọc được dữ liệu Cloud của: ${missing.map((item) => shortProjectId(item.project.id)).join(', ')}`);
      }

      const comparisonLines = records.map(({ project, record }) => {
        const payload = getCloudPayload(record as any) || {};
        const created = formatProjectCreatedAt(project);
        const updated = project.updatedAt ? new Date(Number(project.updatedAt)).toLocaleString('vi-VN') : 'Chưa rõ';
        const marker = project.id === target.id ? 'GIỮ LÀM DỰ ÁN CHÍNH' : 'Nguồn hợp nhất';
        return `• ${project.name} ${shortProjectId(project.id)} [${marker}]\n  Khởi tạo: ${created} | Cập nhật: ${updated}\n  ${summarizeCloudPayload(payload)}`;
      });

      const accepted = await confirmAsync(
        `Phát hiện ${group.length} dự án cùng tên nhưng projectId khác nhau.\n\n${comparisonLines.join('\n\n')}\n\n` +
        `Hợp nhất dữ liệu vào ${shortProjectId(target.id)}?\n` +
        `Nguồn còn lại SẼ ĐƯỢC GIỮ NGUYÊN, không xóa tự động. Sau khi kiểm tra dữ liệu đã đủ trên PC và điện thoại, bạn mới quyết định xóa bản dư.`
      );
      if (!accepted) return;

      const targetRecord = records.find((item) => item.project.id === target.id)!.record!;
      let mergedPayload: any = getCloudPayload(targetRecord) || {};
      for (const source of sources) {
        const sourceRecord = records.find((item) => item.project.id === source.id)!.record!;
        mergedPayload = smartMergeProjectData(mergedPayload, getCloudPayload(sourceRecord) || {});
      }

      await saveProjectToCloud({
        id: target.id,
        name: target.name,
        contractorName: mergedPayload.contractorName || '',
        inspectorName: mergedPayload.inspectorName || '',
        payload: mergedPayload,
      });

      if (target.id === activeId && onRestoreData) {
        await onRestoreData(mergedPayload, target.id);
      }

      alert(
        `Đã hợp nhất dữ liệu vào ${target.name} ${shortProjectId(target.id)}.\n\n` +
        `Các projectId nguồn vẫn được giữ nguyên để đối chiếu; hệ thống KHÔNG tự xóa dự án trùng.`
      );
    } catch (err) {
      console.error('Duplicate project merge error:', err);
      setErrorMessage('Không thể so sánh/hợp nhất dự án trùng: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setMergingDuplicateTargetId(null);
    }
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

  const filteredProjects = projects.filter(p => {
    const q = searchQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || shortProjectId(p.id).toLowerCase().includes(q);
  });

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
                {modalTab === 'sync' ? 'Trung tâm đồng bộ & sao lưu dự án' : 'Quản lý danh sách dự án'}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">
                {modalTab === 'sync' 
                  ? (hasDriveBackend ? 'Lưu trữ cục bộ, Đám mây Firebase, Google Drive & Google Sheets' : 'Lưu trữ cục bộ và Đám mây Firebase miễn phí')
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

        {/* Top Tab Bar Switcher */}
        <div className="grid grid-cols-2 gap-2 mt-3 p-1 bg-slate-100/90 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setModalTab('sync')}
            className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              modalTab === 'sync'
                ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-slate-200/50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Đồng bộ & Sao lưu</span>
          </button>
          <button
            type="button"
            onClick={() => setModalTab('projects')}
            className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              modalTab === 'projects'
                ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200/50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Danh sách dự án ({projects.length})</span>
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
              <details className="group bg-slate-50 rounded-2xl border border-slate-200/80">
                <summary className="cursor-pointer select-none p-3 flex items-center justify-between text-[11px] font-extrabold text-slate-700">
                  <span className="flex items-center gap-1.5"><Layers3 className="w-4 h-4 text-indigo-600" /> Phạm vi sao lưu: {saveScope === 'active' ? 'Dự án hiện tại' : saveScope === 'selected' ? `Nhiều dự án (${selectedProjectIds.length})` : `Tất cả dự án (${projects.length})`}</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="px-3 pb-3 space-y-2 border-t border-slate-200/70 pt-2">
                <div className="flex items-center justify-end">
                  <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers3 className="w-4 h-4 text-indigo-600" />
                    Phạm vi sao lưu
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
                    🌐 Thao tác sẽ lưu / đồng bộ <strong>toàn bộ {projects.length} dự án</strong> và cấu hình cài đặt hệ thống.
                  </p>
                )}
                </div>
              </details>

              {/* 🤖 AUTOMATIC BACKUP CONFIGURATION & CATEGORY STATUS */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200">
                {/* Header Row */}
                <div 
                  onClick={() => setIsAutoBackupConfigExpanded(!isAutoBackupConfigExpanded)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50/50 select-none transition-colors"
                >
                  <span className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-emerald-600 animate-pulse" />
                    Tự động sao lưu
                  </span>
                  
                  <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                    {hasDriveBackend && (
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={autoSyncEnabled} 
                          onChange={(e) => setAutoSyncEnabled && setAutoSyncEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-emerald-500/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                        <span className="ml-1.5 text-[10.5px] font-bold text-slate-700">
                          {autoSyncEnabled ? 'BẬT' : 'TẮT'}
                        </span>
                      </label>
                    )}

                    {/* Collapse Button */}
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsAutoBackupConfigExpanded(!isAutoBackupConfigExpanded);
                      }}
                      className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                      title={isAutoBackupConfigExpanded ? 'Thu gọn' : 'Mở rộng'}
                    >
                      {isAutoBackupConfigExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Collapsible Content */}
                {isAutoBackupConfigExpanded && (
                  <div className="p-4 pt-0 border-t border-slate-100 space-y-3.5 bg-slate-50/20 animate-in fade-in slide-in-from-top-1 duration-200">
                    <p className="text-slate-500 text-[10px] leading-relaxed pt-3">
                      {hasDriveBackend
                        ? 'Tự động lưu và đồng bộ dữ liệu lên Đám mây Firebase & Google Drive khi có thay đổi. Tích chọn các danh mục muốn đưa vào bản sao lưu:'
                        : 'Dữ liệu được lưu cục bộ và đồng bộ qua Đám mây Firebase miễn phí. Google Drive trực tiếp cần backend server nên đang được ẩn trên Firebase Hosting tĩnh.'}
                    </p>

                    {/* Categories & Timestamps Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { 
                          key: 'norms', 
                          label: 'Định mức vật tư', 
                          icon: Layers3, 
                          checked: syncNorms, 
                          setter: setSyncNorms, 
                          time: localStorage.getItem(getKey('construction_last_backup_norms')) 
                        },
                        { 
                          key: 'inventory', 
                          label: 'Kho & Phân phối', 
                          icon: HardDrive, 
                          checked: syncInventory, 
                          setter: setSyncInventory, 
                          time: localStorage.getItem(getKey('construction_last_backup_inventory')) 
                        },
                        { 
                          key: 'workVolumes', 
                          label: 'Khối lượng hoàn thành', 
                          icon: FileSpreadsheet, 
                          checked: syncWorkVolumes, 
                          setter: setSyncWorkVolumes, 
                          time: localStorage.getItem(getKey('construction_last_backup_workVolumes')) 
                        },
                        { 
                          key: 'floorPlans', 
                          label: 'Mặt bằng & Bản vẽ', 
                          icon: Building2, 
                          checked: syncFloorPlans, 
                          setter: setSyncFloorPlans, 
                          time: localStorage.getItem(getKey('construction_last_backup_floorPlans')) 
                        },
                        { 
                          key: 'defects', 
                          label: 'Nhật ký lỗi Defect', 
                          icon: AlertTriangle, 
                          checked: syncDefects, 
                          setter: setSyncDefects, 
                          time: localStorage.getItem(getKey('construction_last_backup_defects')) 
                        },
                        { 
                          key: 'roomProgress', 
                          label: 'Tiến độ tầng', 
                          icon: CheckCircle, 
                          checked: syncRoomProgress, 
                          setter: setSyncRoomProgress, 
                          time: localStorage.getItem(getKey('construction_last_backup_roomProgress')) 
                        },
                        { 
                          key: 'checklist', 
                          label: 'Danh mục kiểm tra', 
                          icon: CheckSquare, 
                          checked: syncChecklist, 
                          setter: setSyncChecklist, 
                          time: localStorage.getItem(getKey('construction_last_backup_checklist')) 
                        },
                        { 
                          key: 'crew', 
                          label: 'Nhân công & Đội thợ', 
                          icon: History, 
                          checked: syncCrew, 
                          setter: setSyncCrew, 
                          time: localStorage.getItem(getKey('construction_last_backup_crew')) 
                        },
                      ].map((cat) => {
                        const CatIcon = cat.icon;
                        return (
                          <div 
                            key={cat.key} 
                            className={`p-2 rounded-xl border transition-all flex flex-col justify-between min-h-[56px] ${
                              cat.checked 
                                ? 'bg-emerald-50/20 border-emerald-100 hover:border-emerald-200' 
                                : 'bg-slate-50/50 border-slate-200/50 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <input 
                                type="checkbox" 
                                checked={cat.checked} 
                                onChange={(e) => cat.setter(e.target.checked)}
                                className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="font-extrabold text-slate-700 text-[10px] leading-tight flex items-center gap-1">
                                <CatIcon className={`w-3.5 h-3.5 ${cat.checked ? 'text-emerald-600' : 'text-slate-400'}`} />
                                {cat.label}
                              </span>
                            </div>
                            <div className="mt-1 pl-5 flex items-center">
                              {cat.time ? (
                                <span className="text-[8.5px] bg-emerald-50 text-emerald-700 font-extrabold px-1.5 py-0.5 rounded border border-emerald-100/60 shadow-3xs">
                                  🕒 {cat.time}
                                </span>
                              ) : (
                                <span className="text-[8.5px] bg-slate-100 text-slate-400 font-bold px-1.5 py-0.5 rounded border border-slate-200/30 italic">
                                  Chưa sao lưu
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>



              
              

              {/* 💾 SECTION 2: LOCAL SAVE & RESTORE (JSON FILE) */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-emerald-600" />
                    Sao lưu & Khôi phục
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
                    <Download className="w-3.5 h-3.5" /> Xuất File JSON {exportEncrypt ? '🔒' : ''}
                  </button>

                  <label className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl font-bold flex items-center justify-center gap-1.5 text-xs transition-colors cursor-pointer active:scale-95">
                    <Upload className="w-3.5 h-3.5 text-slate-600" /> Đọc File JSON
                    <input type="file" accept=".json" className="hidden" onChange={handleImportJsonForScope} />
                  </label>
                </div>

                {/* AES-GCM Encryption options for exported JSON backup */}
                <div className="pt-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[10.5px] font-bold text-slate-700 select-none">
                      <input 
                        type="checkbox"
                        checked={exportEncrypt}
                        onChange={(e) => {
                          setExportEncrypt(e.target.checked);
                          if (e.target.checked) setShowExportEncryptOptions(true);
                        }}
                        className="w-3.5 h-3.5 text-indigo-600 rounded"
                      />
                      <Lock className="w-3 h-3 text-indigo-600" />
                      <span>Mã hóa AES-256 GCM (Bảo mật sao lưu)</span>
                    </label>
                    {exportEncrypt && (
                      <button 
                        type="button" 
                        onClick={() => setShowExportEncryptOptions(!showExportEncryptOptions)}
                        className="text-[10px] text-indigo-600 font-bold hover:underline"
                      >
                        {showExportEncryptOptions ? 'Thu gọn' : 'Tùy chỉnh'}
                      </button>
                    )}
                  </div>

                  {exportEncrypt && showExportEncryptOptions && (
                    <div className="mt-2 p-2.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2 animate-in fade-in duration-150">
                      <div>
                        <label className="block text-[10px] font-extrabold text-indigo-900 mb-0.5">
                          Mật khẩu mã hóa (Tối thiểu 4 ký tự):
                        </label>
                        <input
                          type="password"
                          placeholder="Nhập mật khẩu bảo vệ file..."
                          value={exportPassword}
                          onChange={(e) => setExportPassword(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                          Gợi ý mật khẩu (Tùy chọn - Hiển thị khi mở tệp):
                        </label>
                        <input
                          type="text"
                          placeholder="Ví dụ: Sinh nhật + tên công trình..."
                          value={exportHint}
                          onChange={(e) => setExportHint(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-600"
                        />
                      </div>
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-[10px] text-rose-800 space-y-1">
                        <div className="font-extrabold flex items-center gap-1 text-rose-900">
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>CẢNH BÁO BẢO MẬT MẬT KHẨU BACKUP:</span>
                        </div>
                        <p className="leading-normal">
                          Mật khẩu này không thể khôi phục nếu bị quên. Hãy lưu mật khẩu ở nơi an toàn. Nếu quên mật khẩu, file backup mã hóa sẽ không thể mở hay khôi phục.
                        </p>
                      </div>
                    </div>
                  )}
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

                {/* Multi-Version Backup & Restore system (Lịch sử Bản Sao Lưu) */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-600" />
                      Lịch sử Sao Lưu & Khôi Phục Phiên Bản
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
                        const dateStr = formatDateTime(ver.timestamp);
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
                                    if (onDeleteAutoSaveVersion) {
                                      onDeleteAutoSaveVersion(ver.id);
                                    } else {
                                      const raw = localStorage.getItem('construction_autosave_versions');
                                      let versions: any[] = raw ? JSON.parse(raw) : [];
                                      versions = versions.filter((v: any) => v.id !== ver.id);
                                      localStorage.setItem('construction_autosave_versions', JSON.stringify(versions));
                                    }
                                    // Refresh view
                                    setProjects(getProjectsList());
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
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
                    Đồng bộ dự án
                  </span>
                  <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-200 flex items-center gap-1">
                    <Smartphone className="w-2.5 h-2.5" /> <Monitor className="w-2.5 h-2.5" /> Nhiều thiết bị
                  </span>
                </div>

                {/* Google Authentication Account Card */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                        {googleUser?.photoURL ? (
                          <img src={googleUser.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-800 truncate">
                          {googleUser?.displayName || (googleUser?.email ? googleUser.email.split('@')[0] : 'Phiên Ẩn Danh Firebase')}
                        </p>
                        <p className="text-[9px] text-slate-400 truncate font-mono">
                          {googleUser?.email ? googleUser.email : 'Chưa liên kết tài khoản Google'}
                        </p>
                      </div>
                    </div>

                    {googleUser && !googleUser.isAnonymous ? (
                      <button
                        type="button"
                        onClick={handleGoogleSignOut}
                        className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Đăng xuất
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={isGoogleSigningIn}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10.5px] font-bold rounded-lg transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isGoogleSigningIn ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                        <span>Đăng Nhập Google</span>
                      </button>
                    )}
                  </div>
                  <p className="text-[9.5px] text-slate-500 italic">
                    {googleUser && !googleUser.isAnonymous 
                      ? '🔒 Đã xác thực. Dự án được nhận diện theo tài khoản và đồng bộ tự động giữa các thiết bị.' 
                      : 'ℹ️ Đăng nhập Google để nhận diện đúng dự án và đồng bộ dữ liệu/ảnh giữa các thiết bị.'}
                  </p>
                </div>

                
                {/* Cloud Status Message */}
                {cloudStatusMsg && (
                  <div className={`p-3 rounded-xl border font-bold text-xs flex flex-col gap-2 animate-in fade-in duration-150 mb-2 ${
                    cloudStatusMsg.type === 'success' 
                       ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                       : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {cloudStatusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span>{cloudStatusMsg.text}</span>
                      </div>
                      <button onClick={() => setCloudStatusMsg(null)} className="text-slate-400 hover:text-slate-700 text-xs font-bold px-1">✕</button>
                    </div>
                    {cloudStatusMsg.type === 'success' && cloudStatusMsg.stats && (
                      <button 
                        onClick={() => setExportedFileInfo({
                          title: 'Chi tiết Sao Lưu Cloud',
                          fileName: `Cloud_Sync_${getActiveProjectId()}`,
                          fileSizeStr: 'Cloud Storage',
                          ...cloudStatusMsg.stats
                        })}
                        className="mt-1 self-start flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 rounded-lg text-[10.5px] shadow-xs transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem chi tiết dữ liệu đã sao lưu</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Primary multi-device flow: account first, automatic sync by projectId. */}
                <div className="bg-indigo-50/60 p-2.5 rounded-xl border border-indigo-100 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-indigo-950 text-[11px] flex items-center gap-1">
                        <Share2 className="w-3.5 h-3.5 text-indigo-600" /> Đồng bộ tự động theo tài khoản
                      </p>
                      <p className="text-[9.5px] text-indigo-800/80 mt-1 leading-relaxed">
                        Cùng tài khoản Google sẽ nhận đúng dự án và tự đồng bộ dữ liệu, phân quyền, defect, quân số và toàn bộ ảnh đính kèm giữa điện thoại &amp; máy tính.
                      </p>
                    </div>
                    <span className={`shrink-0 text-[9px] px-2 py-1 rounded-full font-bold border ${
                      !googleUser || googleUser.isAnonymous ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      photoCloudStatus?.phase === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                      photoCloudStatus?.phase === 'syncing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {!googleUser || googleUser.isAnonymous ? 'Cần đăng nhập' :
                       photoCloudStatus?.phase === 'error' ? '● Lỗi ảnh' :
                       photoCloudStatus?.phase === 'syncing' ? '● Đang đồng bộ' : '● Đã đồng bộ'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[9.5px]">
                    <div className="bg-white border border-indigo-100 rounded-lg px-2 py-1.5">
                      <span className="text-slate-400">Dự án hiện tại</span>
                      <p className="font-bold text-slate-800 truncate">{projects.find(p => p.id === (activeProjectId || activeId))?.name || activeProjectId || activeId}</p>
                    </div>
                    <div className="bg-white border border-indigo-100 rounded-lg px-2 py-1.5">
                      <span className="text-slate-400">Nội dung Cloud</span>
                      <p className="font-bold text-slate-800">Dữ liệu + ảnh đầy đủ</p>
                    </div>
                  </div>
                  {googleUser && !googleUser.isAnonymous && (
                    <p className="text-[9px] text-slate-500 flex items-center justify-between gap-2">
                      <span>Ảnh ưu tiên lưu vào Drive chính An Phú; Firebase giữ metadata và chỉ dùng Firestore làm dự phòng khi Drive chưa cấu hình hoặc tạm lỗi.</span>
                      {photoCloudStatus?.lastSyncAt ? <span className="shrink-0">{new Date(photoCloudStatus.lastSyncAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span> : null}
                    </p>
                  )}

                  <details className="group bg-white/70 border border-indigo-100 rounded-lg">
                    <summary className="cursor-pointer select-none px-2.5 py-2 text-[10px] font-bold text-indigo-700 flex items-center justify-between">
                      <span>Công cụ đồng bộ nâng cao</span>
                      <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="px-2.5 pb-2.5 space-y-2 border-t border-indigo-100 pt-2">
                      <button
                        type="button"
                        onClick={handleUploadActiveProjectToCloud}
                        disabled={isSyncingCurrentProject || !googleUser || googleUser.isAnonymous}
                        className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold text-[10.5px] flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-xs"
                      >
                        <CloudUpload className="w-3.5 h-3.5" /> Đồng bộ lại dự án này
                      </button>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="ID dự án (chỉ dùng khi phục hồi/liên kết cũ)"
                          value={cloudSyncCodeInput}
                          onChange={(e) => setCloudSyncCodeInput(e.target.value)}
                          className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[10px] font-semibold outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={handlePullProjectFromCloud}
                          disabled={!cloudSyncCodeInput.trim() || isSyncingCurrentProject}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        >
                          <CloudDownload className="w-3.5 h-3.5 text-indigo-300" /> Phục hồi
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-500">
                        Bình thường không cần nhập mã dự án. ID chỉ giữ lại để xử lý dự án cũ hoặc sự cố đặc biệt.
                      </p>
                    </div>
                  </details>
                </div>

                <PrimaryDriveStatusCard
                  activeProjectId={activeProjectId || activeId}
                  userRole={effectiveRole}
                  floorPlans={fullAppData?.floorPlans || []}
                />

                {/* Cloud History list - collapsed by default on mobile */}
                <details className="group pt-2 border-t border-slate-100">
                  <summary className="cursor-pointer select-none flex items-center justify-between mb-1.5 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    <span>Khôi phục phiên bản đám mây ({cloudBackups.length})</span>
                    <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div>
                  <div className="flex items-center justify-end mb-1.5">
                    <span className="hidden">Lịch sử</span>
                    <button onClick={fetchCloudBackups} className="text-[10px] text-indigo-600 font-bold hover:underline flex items-center gap-0.5">
                      <RefreshCw className={`w-3 h-3 ${isLoadingCloudBackups ? 'animate-spin' : ''}`} /> Tải lại
                    </button>
                  </div>

                  {isLoadingCloudBackups ? (
                    <div className="py-2 text-center text-slate-400 text-[10.5px] flex items-center justify-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" /> Đang tải lịch sử...
                    </div>
                  ) : cloudBackups.length === 0 ? (
                    <p className="text-[10.5px] text-slate-400 italic py-1">Chưa có bản sao lưu nào trên đám mây.</p>
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
                              onClick={() => handleViewCloudBackupStats(b)}
                              className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold rounded-lg border border-indigo-200 text-[10px] transition-colors cursor-pointer flex items-center gap-1"
                              title="Xem chi tiết sao lưu"
                            >
                              <Eye className="w-3 h-3" /> Chi tiết
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRestoreCloudBackup(b)}
                              className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold rounded-lg border border-emerald-200 text-[10px] transition-colors cursor-pointer"
                            >
                              Khôi phục
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCloudBackup({ id: b.id, name: b.backupName || 'Bản sao lưu' })}
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
                </details>
              </div>

              {/* 📁 SECTION 4: GOOGLE DRIVE SYNC */}
              {hasDriveBackend && (
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
                  {/* Google Drive Status Message */}
                  {driveStatusMsg && (
                    <div className={`p-3 rounded-xl border font-bold text-xs flex flex-col gap-2 animate-in fade-in duration-150 mt-2 ${
                      driveStatusMsg.type === 'success' 
                         ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                         : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {driveStatusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                          <span>{driveStatusMsg.text}</span>
                        </div>
                        <button onClick={() => setDriveStatusMsg(null)} className="text-slate-400 hover:text-slate-700 text-xs font-bold px-1">✕</button>
                      </div>
                      {driveStatusMsg.type === 'success' && driveStatusMsg.stats && (
                        <button 
                          onClick={() => setExportedFileInfo({
                            title: 'Chi tiết Sao Lưu Google Drive',
                            fileName: `GoogleDrive_Backup_${new Date().toISOString().split('T')[0]}`,
                            fileSizeStr: 'Google Drive',
                            ...driveStatusMsg.stats
                          })}
                          className="mt-1 self-start flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100 rounded-lg text-[10.5px] shadow-xs transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Xem chi tiết dữ liệu đã đồng bộ</span>
                        </button>
                      )}
                    </div>
                  )}
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

              {duplicateGroups.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl space-y-1.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-amber-900">
                        Phát hiện {duplicateGroups.reduce((sum, group) => sum + group.length, 0)} dự án có tên trùng nhưng projectId khác nhau
                      </p>
                      <p className="text-[10.5px] text-amber-800 leading-relaxed">
                        Không xóa theo ngày “Khởi tạo”. Hãy đối chiếu ID và dữ liệu, sau đó chọn đúng dự án chính để hợp nhất. Bản nguồn luôn được giữ lại sau khi hợp nhất.
                      </p>
                    </div>
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
                    const isDuplicate = duplicateProjectIds.has(proj.id);

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
                              <div className="flex items-center gap-2 min-w-0">
                                <Folder className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                                <p className={`font-bold text-xs truncate ${isActive ? 'text-indigo-900' : 'text-slate-800'}`}>
                                  {proj.name} <span className="font-mono text-[10px] text-slate-400">· {shortProjectId(proj.id)}</span>
                                </p>
                                {isDuplicate && (
                                  <span className="shrink-0 text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    Trùng tên · ID khác
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5 pl-6 font-medium">
                                Khởi tạo: {formatProjectCreatedAt(proj)} · ID {shortProjectId(proj.id)}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-indigo-600 text-white px-2.5 py-1 rounded-lg shadow-xs">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                                  Đang mở
                                </span>
                              ) : switchingProjectId === proj.id ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-amber-500 text-white px-2.5 py-1 rounded-lg shadow-xs animate-pulse">
                                  Đang chuyển...
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

                        {!isEditing && isDuplicate && canManage && (
                          <div className="mt-2 pl-6 flex items-center justify-between gap-2 border-t border-amber-100 pt-2">
                            <span className="text-[10px] text-amber-700 font-semibold">
                              Chọn ID này làm dự án chính
                            </span>
                            <button
                              type="button"
                              onClick={() => handleMergeDuplicateInto(proj)}
                              disabled={Boolean(mergingDuplicateTargetId)}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[10px] font-extrabold transition-colors cursor-pointer"
                              title="So sánh dữ liệu các projectId cùng tên rồi hợp nhất vào ID này, không xóa bản nguồn"
                            >
                              {mergingDuplicateTargetId === proj.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <ArrowLeftRight className="w-3 h-3" />
                              )}
                              So sánh &amp; hợp nhất vào ID này
                            </button>
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
                    <span>Tạo dự án mới</span>
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

              {/* 🧹 CARD: ORPHAN PROJECT DIAGNOSTICS & CLEANUP */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-600" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Bảo trì dữ liệu</h4>
                      <p className="text-[10px] text-slate-500">Kiểm tra dữ liệu dự án còn trên thiết bị nhưng chưa có trong danh sách Cloud. Có thể khôi phục trước khi xóa.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleScanOrphans}
                    disabled={isScanningOrphans}
                    className="px-2.5 py-1.5 bg-amber-100/80 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs shrink-0"
                  >
                    {isScanningOrphans ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    <span>{isScanningOrphans ? 'Đang kiểm tra...' : 'Kiểm tra dữ liệu'}</span>
                  </button>
                </div>

                {orphanScanResult && (
                  <div className="space-y-2.5 pt-1">
                    {orphanScanResult.orphanProjects.length === 0 ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-emerald-800 text-[11px] font-medium flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Không phát hiện dữ liệu dự án cục bộ bị tách khỏi danh sách Cloud.</span>
                      </div>
                    ) : (
                      <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            Phát hiện {orphanScanResult.orphanProjects.length} dự án cục bộ chưa liên kết Cloud ({orphanScanResult.totalOrphanKeys} khóa dữ liệu)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedOrphanIds.length === orphanScanResult.orphanProjects.length) {
                                  setSelectedOrphanIds([]);
                                } else {
                                  setSelectedOrphanIds(orphanScanResult.orphanProjects.map(p => p.id));
                                }
                              }}
                              className="text-[10px] font-bold text-amber-800 hover:underline"
                            >
                              {selectedOrphanIds.length === orphanScanResult.orphanProjects.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {orphanScanResult.orphanProjects.map(p => (
                            <div
                              key={p.id}
                              className="p-2 bg-white rounded-lg border border-amber-200/80 text-[11px] space-y-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-800 truncate">{p.name}</div>
                                  <div className="text-[9px] text-slate-400 font-mono break-all">{p.id}</div>
                                </div>
                                <span className="shrink-0 text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                                  {p.keys.length} mục
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRecoverLocalProject(p)}
                                  disabled={Boolean(recoveringOrphanId)}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10.5px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {recoveringOrphanId === p.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
                                  {recoveringOrphanId === p.id ? 'Đang khôi phục...' : 'Khôi phục lên Cloud'}
                                </button>
                                <label className="flex items-center gap-1.5 text-[10px] text-rose-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selectedOrphanIds.includes(p.id)}
                                    onChange={e => {
                                      if (e.target.checked) {
                                        setSelectedOrphanIds([...selectedOrphanIds, p.id]);
                                      } else {
                                        setSelectedOrphanIds(selectedOrphanIds.filter(id => id !== p.id));
                                      }
                                    }}
                                    className="w-3.5 h-3.5 text-rose-600 rounded"
                                  />
                                  Chọn để xóa khỏi máy
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleExportOrphansBackup}
                            disabled={selectedOrphanIds.length === 0}
                            className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Download className="w-3 h-3 text-slate-500" />
                            <span>Tải bản sao lưu (.json)</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleCleanupOrphans}
                            disabled={isCleaningOrphans || selectedOrphanIds.length === 0}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 shadow-xs"
                          >
                            {isCleaningOrphans ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span>Xóa khỏi máy ({selectedOrphanIds.length})</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

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
              const stats = analyzeImportData(merged);
              setImportedFileInfo({
                fileName: 'Hợp nhất dữ liệu thông minh',
                fileSizeStr: 'Được gộp & tối ưu',
                ...stats
              });
            }
            setShowConflictModal(false);
            setPendingImportData(null);
          }}
        />
      )}

      {/* MULTI-PROJECT INTELLIGENT SYNC & IMPORT MODAL */}
      {multiProjectSyncState && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[280] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-indigo-100 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Đồng Bộ &amp; Nhập Dự Án
                    <span className="px-2 py-0.5 text-xs font-bold bg-indigo-100 text-indigo-700 rounded-full">
                      {multiProjectSyncState.items.length} dự án
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-md" title={multiProjectSyncState.fileName}>
                    Nguồn: <span className="font-semibold text-slate-700">{multiProjectSyncState.fileName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMultiProjectSyncState(null)}
                disabled={isExecutingMultiSync}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-all cursor-pointer font-bold text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Subtitle / Tip banner */}
            <div className="px-4 py-2.5 bg-blue-50/70 border-b border-blue-100 text-[11px] text-blue-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Hệ thống tự động phân loại theo <strong>Mã định danh (ID)</strong> của từng dự án. Các dự án mới sẽ được tạo và giữ nguyên ID gốc để đồng bộ đa thiết bị; dự án trùng ID sẽ được hợp nhất thông minh mà không làm ảnh hưởng lẫn nhau.
              </span>
            </div>

            {/* Projects List */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
              {multiProjectSyncState.items.map((item, idx) => {
                const { candidate, existsLocally, localUpdatedAt, isLocalNewer, isIncomingNewer, action } = item;
                const counts = candidate.itemCounts;

                return (
                  <div
                    key={candidate.id || idx}
                    className={`p-4 rounded-xl border transition-all ${
                      action === 'SKIP'
                        ? 'border-slate-200 bg-slate-50/50 opacity-60'
                        : existsLocally
                        ? 'border-amber-200 bg-amber-50/20'
                        : 'border-emerald-200 bg-emerald-50/20'
                    }`}
                  >
                    {/* Top Row: Name, ID, Exists Status */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span className="font-extrabold text-sm text-slate-900 truncate" title={candidate.name}>
                          {candidate.name}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-600 rounded border border-slate-200">
                          ID: {candidate.id}
                        </span>
                      </div>

                      <div>
                        {!existsLocally ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                            ✨ Dự án mới (Chưa có trên máy)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                            ⚠️ Đã có trên máy (Trùng ID)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle: Content stats & Comparison */}
                    <div className="text-xs text-slate-600 bg-white/80 rounded-lg p-2.5 border border-slate-100 mb-3 space-y-1.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-700">
                        <span>📦 {counts.inventory} vật tư</span>
                        <span>📋 {counts.workVolumes} đầu việc</span>
                        <span>📐 {counts.floorPlans} bản vẽ</span>
                        <span>⚠️ {counts.defects} lỗi</span>
                        <span>🏢 {counts.roomProgressList} căn</span>
                        <span>✅ {counts.checklist} kiểm</span>
                        <span>👷 {counts.crewRecords} điểm danh</span>
                      </div>

                      {existsLocally && (
                        <div className="pt-1.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                          <div>
                            <span className="text-slate-400">Máy này:</span>{' '}
                            <span className="font-semibold text-slate-700">
                              {localUpdatedAt ? formatDateTime(localUpdatedAt) : 'Chưa có mốc thời gian'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Trong tệp:</span>{' '}
                            <span className="font-semibold text-slate-700">
                              {candidate.updatedAt ? formatDateTime(candidate.updatedAt) : 'Chưa có mốc thời gian'}
                            </span>
                          </div>
                          <div>
                            {isLocalNewer ? (
                              <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                ⚡ Dữ liệu trên máy MỚI HƠN
                              </span>
                            ) : isIncomingNewer ? (
                              <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                ✨ Dữ liệu trong tệp MỚI HƠN
                              </span>
                            ) : (
                              <span className="text-slate-500 font-medium">Thời gian tương đương</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Selector Buttons */}
                    <div>
                      <div className="text-[11px] font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                        <span>Hành động áp dụng:</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {action === 'CREATE_PRESERVE_ID' && 'Tạo dự án mới giữ nguyên ID để đồng bộ'}
                          {action === 'SMART_MERGE' && 'Gộp 2 bên, tự động giữ mục mới nhất'}
                          {action === 'KEEP_LOCAL' && 'Bỏ qua tệp, bảo toàn 100% dữ liệu máy'}
                          {action === 'OVERWRITE_FILE' && 'Ghi đè hoàn toàn bằng dữ liệu tệp'}
                          {action === 'IMPORT_AS_NEW_COPY' && 'Tạo dự án mới độc lập (mã ID mới)'}
                          {action === 'SKIP' && 'Bỏ qua, không nạp dự án này'}
                        </span>
                      </div>

                      {!existsLocally ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'CREATE_PRESERVE_ID' } : it)
                                };
                              });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                              action === 'CREATE_PRESERVE_ID'
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" /> Khôi phục vào dự án hiện có (giữ ID)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'SKIP' } : it)
                                };
                              });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              action === 'SKIP'
                                ? 'bg-slate-700 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            Bỏ qua
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'SMART_MERGE' } : it)
                                };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              action === 'SMART_MERGE'
                                ? 'bg-indigo-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50/50'
                            }`}
                          >
                            <Sparkles className="w-3 h-3 text-amber-300" /> Hợp nhất theo ID & dữ liệu mới hơn
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'KEEP_LOCAL' } : it)
                                };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              action === 'KEEP_LOCAL'
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-blue-50/50'
                            }`}
                          >
                            Giữ dữ liệu hiện tại
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'OVERWRITE_FILE' } : it)
                                };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              action === 'OVERWRITE_FILE'
                                ? 'bg-rose-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-rose-50/50'
                            }`}
                          >
                            Khôi phục từ bản sao lưu
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMultiProjectSyncState(prev => {
                                if (!prev) return null;
                                return {
                                  ...prev,
                                  items: prev.items.map((it, i) => i === idx ? { ...it, action: 'IMPORT_AS_NEW_COPY' } : it)
                                };
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                              action === 'IMPORT_AS_NEW_COPY'
                                ? 'bg-purple-600 text-white shadow-2xs'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-purple-50/50'
                            }`}
                          >
                            Tạo bản sao mới
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {multiProjectSyncState.items.filter(it => it.action !== 'SKIP' && it.action !== 'KEEP_LOCAL').length} / {multiProjectSyncState.items.length} dự án sẽ được nạp/đồng bộ
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMultiProjectSyncState(null)}
                  disabled={isExecutingMultiSync}
                  className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs cursor-pointer transition-all"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={executeFullReplaceRestore}
                  disabled={isExecutingMultiSync}
                  title="Xóa các dự án khác trên máy và thay thế 100% bằng danh sách dự án trong tệp sao lưu"
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl font-bold text-xs cursor-pointer transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Thay Thế Toàn Bộ (Full Replace)</span>
                </button>
                <button
                  type="button"
                  onClick={executeMultiProjectSync}
                  disabled={isExecutingMultiSync}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs cursor-pointer transition-all shadow-xs flex items-center gap-2 disabled:opacity-50"
                >
                  {isExecutingMultiSync ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Đang đồng bộ...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Tiến Hành Đồng Bộ &amp; Nhập
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE CLOUD BACKUP MODAL */}
      {deletingCloudBackupTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[250] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-rose-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xóa Bản Sao Lưu đám mây</h3>
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
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 SUCCESSFUL MANUAL EXPORT SUMMARY OVERLAY */}
      {exportedFileInfo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[270] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 border border-emerald-100 shadow-2xl relative">
            <button 
              type="button" 
              onClick={() => setExportedFileInfo(null)} 
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all font-bold"
            >
              &times;
            </button>

            <div className="text-center">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-950">Xuất File JSON Thành Công!</h3>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Tệp sao lưu cục bộ đã được nén hoàn tất và tải về thiết bị của bạn.
              </p>
            </div>

            <div className="bg-slate-50/70 rounded-xl border border-slate-200/60 p-3 space-y-2.5">
              {/* File details */}
              <div className="grid grid-cols-2 gap-x-2 text-[10px] border-b border-slate-200/40 pb-2">
                <div>
                  <span className="text-slate-500 font-semibold block">Tên tệp tin:</span>
                  <span className="text-slate-800 font-extrabold truncate block max-w-[140px]" title={exportedFileInfo.fileName}>
                    {exportedFileInfo.fileName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block">Dung lượng tệp:</span>
                  <span className="text-emerald-700 font-black block">
                    {exportedFileInfo.fileSizeStr}
                  </span>
                </div>
              </div>

              {/* Projects List */}
              <div className="space-y-1">
                <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Dự án đã xuất ({exportedFileInfo.projectsExported.length})</span>
                <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto">
                  {exportedFileInfo.projectsExported.map((name, i) => (
                    <span key={i} className="bg-indigo-50 text-indigo-700 text-[9px] font-extrabold px-2 py-0.5 rounded border border-indigo-100/60">
                      🏢 {name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Categories Grid */}
              <div className="space-y-1.5 pt-0.5">
                <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Chi tiết danh mục đã đóng gói ({exportedFileInfo.categoriesExported.length})</span>
                {exportedFileInfo.categoriesExported.length > 0 ? (
                  <div className="space-y-1 max-h-[160px] overflow-y-auto pr-0.5">
                    {exportedFileInfo.categoriesExported.map((cat, i) => {
                      const CatIcon = cat.icon;
                      return (
                        <div key={i} className="flex items-start gap-2 p-1.5 bg-white border border-slate-200/80 rounded-lg shadow-3xs hover:bg-slate-50/50 transition-colors">
                          <div className="p-1 rounded bg-slate-50 text-slate-600 mt-0.5 shrink-0">
                            <CatIcon className="w-3.5 h-3.5" />
                          </div>
                          <div className="leading-normal flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-extrabold text-slate-800">{cat.label}</span>
                              <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded-full">{cat.count}</span>
                            </div>
                            {cat.details && (
                              <span className="text-[9px] text-slate-500 font-medium block mt-0.5">{cat.details}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[9px] text-slate-400 italic block">Không có bản ghi nào được ghi nhận</span>
                )}
              </div>

              {/* Detailed Image Audit */}
              {exportedFileInfo.imageStats.hasImages && exportedFileInfo.imageStats.detailStats && exportedFileInfo.imageStats.detailStats.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-200/40">
                  <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Vị trí ảnh đính kèm ({exportedFileInfo.imageStats.imageCount} ảnh)</span>
                  <div className="grid grid-cols-1 gap-1">
                    {exportedFileInfo.imageStats.detailStats.map((imgStat, i) => (
                      <div key={i} className="flex justify-between items-center text-[9px] bg-emerald-50/40 text-emerald-800 border border-emerald-100/40 px-2 py-1 rounded">
                        <span className="font-semibold">📸 {imgStat.label}:</span>
                        <span className="font-black">{imgStat.count} hình</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photos check fallback */}
              {!exportedFileInfo.imageStats.hasImages && (
                <div className="pt-2 border-t border-slate-200/40 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-bold">Hình ảnh đính kèm:</span>
                  <span className="text-slate-400 bg-slate-100 border border-slate-200/40 font-semibold px-2 py-0.5 rounded-full text-[9px]">
                    Không chứa hình ảnh
                  </span>
                </div>
              )}

              {/* Integrity check */}
              <div className="pt-1.5 flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                <span>Cấu trúc tệp hoàn toàn đầy đủ &amp; an toàn để khôi phục!</span>
              </div>
            </div>

            <div className="flex pt-1">
              <button
                type="button"
                onClick={() => setExportedFileInfo(null)}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer shadow-xs active:scale-95"
              >
                Xác Nhận &amp; Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📥 SUCCESSFUL MANUAL IMPORT SUMMARY OVERLAY */}
      {importedFileInfo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[270] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 border border-indigo-100 shadow-2xl relative">
            <button 
              type="button" 
              onClick={() => window.location.reload()} 
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all font-bold"
            >
              &times;
            </button>

            <div className="text-center">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-xs">
                <CheckCircle className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-sm font-extrabold text-slate-950">Khôi Phục Dữ Liệu Thành Công!</h3>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Hệ thống đã nạp và lưu trữ thành công các hạng mục sau từ tệp JSON của bạn.
              </p>
            </div>

            <div className="bg-slate-50/70 rounded-xl border border-slate-200/60 p-3 space-y-2.5">
              {/* File details */}
              <div className="grid grid-cols-2 gap-x-2 text-[10px] border-b border-slate-200/40 pb-2">
                <div>
                  <span className="text-slate-500 font-semibold block">Nguồn tệp:</span>
                  <span className="text-slate-800 font-extrabold truncate block max-w-[140px]" title={importedFileInfo.fileName}>
                    {importedFileInfo.fileName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block">Dung lượng:</span>
                  <span className="text-indigo-700 font-black block">
                    {importedFileInfo.fileSizeStr}
                  </span>
                </div>
              </div>

              {/* Projects List */}
              <div className="space-y-1">
                <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Dự án đã khôi phục ({importedFileInfo.projectsImported.length})</span>
                <div className="flex flex-wrap gap-1 max-h-[60px] overflow-y-auto">
                  {importedFileInfo.projectsImported.map((name, i) => (
                    <span key={i} className="bg-indigo-50 text-indigo-700 text-[9px] font-extrabold px-2 py-0.5 rounded border border-indigo-100/60">
                      🏢 {name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Categories Grid */}
              <div className="space-y-1.5 pt-0.5">
                <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Chi tiết danh mục đã khôi phục ({importedFileInfo.categoriesImported.length})</span>
                {importedFileInfo.categoriesImported.length > 0 ? (
                  <div className="space-y-1 max-h-[160px] overflow-y-auto pr-0.5">
                    {importedFileInfo.categoriesImported.map((cat, i) => {
                      const CatIcon = cat.icon;
                      return (
                        <div key={i} className="flex items-start gap-2 p-1.5 bg-white border border-slate-200/80 rounded-lg shadow-3xs hover:bg-slate-50/50 transition-colors">
                          <div className="p-1 rounded bg-slate-50 text-slate-600 mt-0.5 shrink-0">
                            <CatIcon className="w-3.5 h-3.5" />
                          </div>
                          <div className="leading-normal flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-extrabold text-slate-800">{cat.label}</span>
                              <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded-full">{cat.count}</span>
                            </div>
                            {cat.details && (
                              <span className="text-[9px] text-slate-500 font-medium block mt-0.5">{cat.details}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[9px] text-slate-400 italic block">Không ghi nhận danh mục nào</span>
                )}
              </div>

              {/* Detailed Image Audit */}
              {importedFileInfo.imageStats.hasImages && importedFileInfo.imageStats.detailStats && importedFileInfo.imageStats.detailStats.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-200/40">
                  <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Vị trí ảnh đính kèm ({importedFileInfo.imageStats.imageCount} ảnh)</span>
                  <div className="grid grid-cols-1 gap-1">
                    {importedFileInfo.imageStats.detailStats.map((imgStat, i) => (
                      <div key={i} className="flex justify-between items-center text-[9px] bg-emerald-50/40 text-emerald-800 border border-emerald-100/40 px-2 py-1 rounded">
                        <span className="font-semibold">📸 {imgStat.label}:</span>
                        <span className="font-black">{imgStat.count} hình</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photos check fallback */}
              {!importedFileInfo.imageStats.hasImages && (
                <div className="pt-2 border-t border-slate-200/40 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-bold">Hình ảnh đính kèm:</span>
                  <span className="text-slate-400 bg-slate-100 border border-slate-200/40 font-semibold px-2 py-0.5 rounded-full text-[9px]">
                    Không chứa hình ảnh
                  </span>
                </div>
              )}

              {/* Integrity check */}
              <div className="pt-1.5 flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                <span>Cấu trúc tệp hoàn toàn đầy đủ &amp; đồng bộ hoàn hảo!</span>
              </div>
            </div>

            <div className="flex pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer shadow-xs active:scale-95"
              >
                Xác Nhận &amp; Hoàn Tất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decrypt Password Modal for AES-GCM Encrypted Backups */}
      {pendingEncryptedPayload && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-slate-800 text-sm">
                  Tệp Sao Lưu Đã Được Mã Hóa (AES-256)
                </h3>
                <p className="text-slate-500 text-xs truncate">
                  {pendingImportFileInfo?.name || 'Bản sao lưu bảo mật'}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Tệp sao lưu này được bảo vệ bằng chuẩn mã hóa cấp cao AES-256-GCM. Vui lòng nhập mật khẩu để mở khóa và xem nội dung:
            </p>

            <div className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-xl text-[10.5px] text-amber-900 leading-relaxed">
              ⚠️ <strong>Lưu ý bảo mật:</strong> Mật khẩu mã hóa AES-256 không thể khôi phục nếu bị quên. Nếu quên mật khẩu, hãy sử dụng bản sao lưu khác hoặc dùng dữ liệu hiện có để xuất bản sao lưu mới.
            </div>

            {pendingEncryptedPayload.hint && (
              <div className="p-2.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs text-indigo-950">
                <span className="font-bold">💡 Gợi ý mật khẩu:</span> {pendingEncryptedPayload.hint}
              </div>
            )}

            <div className="space-y-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Mật Khẩu Giải Mã Hiện Tại:
                </label>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu hiện tại..."
                  value={decryptPassword}
                  onChange={(e) => {
                    setDecryptPassword(e.target.value);
                    setDecryptError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !showReencryptOptions) handlePerformDecryption();
                  }}
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
              </div>

              {/* Option to Change Backup Password */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowReencryptOptions(!showReencryptOptions)}
                  className="text-[11px] text-indigo-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{showReencryptOptions ? 'Ẩn tùy chọn đổi mật khẩu file' : 'Muốn đổi mật khẩu mới cho file backup này?'}</span>
                </button>

                {showReencryptOptions && (
                  <div className="mt-2 p-3 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-2 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-[10px] font-extrabold text-indigo-950 mb-0.5">
                        Mật Khẩu Mới Cho File Backup (Tối thiểu 4 ký tự):
                      </label>
                      <input
                        type="password"
                        placeholder="Nhập mật khẩu mới..."
                        value={newReencryptPassword}
                        onChange={(e) => setNewReencryptPassword(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                        Gợi Ý Mật Khẩu Mới (Tùy chọn):
                      </label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Tên công trình + 2026"
                        value={newReencryptHint}
                        onChange={(e) => setNewReencryptHint(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              {decryptError && (
                <p className="text-[11px] text-rose-600 font-bold flex items-center gap-1 pt-1">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{decryptError}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setPendingEncryptedPayload(null);
                  setDecryptPassword('');
                  setDecryptError('');
                  setShowReencryptOptions(false);
                  setNewReencryptPassword('');
                  setNewReencryptHint('');
                }}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Hủy Bỏ
              </button>

              <div className="flex items-center gap-2">
                {showReencryptOptions && (
                  <button
                    type="button"
                    onClick={handleReencryptBackupPayload}
                    disabled={isDecrypting || !decryptPassword || !newReencryptPassword}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
                  >
                    {isDecrypting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>Đổi Mật Khẩu &amp; Tải Tệp</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePerformDecryption}
                  disabled={isDecrypting || !decryptPassword}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isDecrypting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                  <span>Giải Mã &amp; Khôi Phục</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
