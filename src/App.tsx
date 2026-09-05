import { GlobalConfirmModal } from './components/GlobalConfirmModal';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import { safeSetLocalStorageItem } from './utils/storage';
import { parseLegacyTimestamp, formatDateTime } from './utils/dateFormatter';
import { AppLockOverlay } from './components/AppLockOverlay';
import { SecurityModal } from './components/SecurityModal';
import { getStoredPinLockConfig, applyRemotePinReset, logAuditAction, getCurrentUserRole, setCurrentUserRole, UserRole, canEditProjectData, canManageProjects, canManageWorkVolumeStructure, canManageFloorPlanStructure, canManageMaterialNorms, canManageTeams, canManageChecklistStructure, canDeleteBusinessData, canDeleteCrewRecord, canManageBackups, canUseGlobalUndoRedo, canEditWarehouseData, canEditDefectData, canEditChecklistData, canEditCrewData, canImportData } from './utils/securityUtils';
import { cacheVerifiedProjectRole, getCachedVerifiedProjectRole, getRememberedVerifiedAuthIdentity, rememberVerifiedAuthIdentity } from './utils/offlineAccess';
import { resolveVerifiedIdentityLabel } from './utils/authIdentityUtils';

function restoreLocalOmittedImages(cloudItem: any, localItem: any): any {
  if (!cloudItem || !localItem) return cloudItem;
  const merged = { ...cloudItem };
  for (const key of Object.keys(merged)) {
    const val = merged[key];
    if (typeof val === 'string' && (
      val.includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]') ||
      (key === 'imageUrl' && val.startsWith('cloud-floorplan:'))
    )) {
      const localImage = localItem[key];
      const localImageDisplayable = typeof localImage === 'string' && (
        localImage.startsWith('data:image/') || localImage.startsWith('blob:') || /^https?:\/\//i.test(localImage)
      );
      const cloudImageRevision = Number(cloudItem.imageCloudRevision || cloudItem.imageRevision || 0);
      const cloudSyncedRevision = Number(cloudItem.imageCloudRevision || 0);
      const localCloudRevision = Number(localItem.imageCloudRevision || 0);
      const localImageRevision = Number(localItem.imageRevision || 0);
      const sameDriveFile = Boolean(cloudItem.driveFileId && localItem.driveFileId && cloudItem.driveFileId === localItem.driveFileId);
      // A local image is safe to retain for a cloud marker only when it is known to
      // represent that exact uploaded binary. Comparing imageRevision alone is unsafe:
      // a pending metadata patch can copy the NEW revision onto an OLD hydrated image.
      const sameSyncedImageRevision = cloudSyncedRevision > 0 && localCloudRevision === cloudSyncedRevision;
      const localHasNewerUnsyncedImage = localImageRevision > cloudImageRevision;
      const isFloorPlanCloudMarker = key === 'imageUrl' && val.startsWith('cloud-floorplan:');
      const isOmittedMarker = val.includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]');
      if (localImageDisplayable && (key !== 'imageUrl' || (!isFloorPlanCloudMarker && !isOmittedMarker) || sameDriveFile || sameSyncedImageRevision || localHasNewerUnsyncedImage || isOmittedMarker)) {
        merged[key] = localImage;

        // While another device is still uploading a replacement, Firestore may first
        // publish an omitted-image metadata record. Keep showing the old local bitmap,
        // but DO NOT relabel it with the new image revision/cloud revision. Otherwise
        // the later real Drive/Firestore marker can be mistaken for the same image and
        // the remote device will stay stuck on the old drawing forever.
        if (key === 'imageUrl' && (localHasNewerUnsyncedImage || (isOmittedMarker && cloudImageRevision > localImageRevision))) {
          // Preserve the metadata that belongs to the bitmap we kept. This also
          // protects a second quick replacement: an older upload may finish later
          // with a newer updatedAt, but its lower imageRevision must never relabel
          // or suppress the newer local bitmap waiting to upload.
          merged.imageRevision = localImageRevision;
          merged.imageCloudRevision = localCloudRevision;
          merged.driveFileId = localItem.driveFileId;
          merged.driveUrl = localItem.driveUrl;
          merged.cloudFileId = localItem.cloudFileId;
          merged.storageProvider = localItem.storageProvider;
          merged.imageCloudSyncedAt = localItem.imageCloudSyncedAt;
        }
      }
    } else if (Array.isArray(val) && Array.isArray(localItem[key])) {
      merged[key] = val.map((item: any, idx: number) => {
        if (typeof item === 'string' && item.includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]')) {
          return localItem[key][idx] && typeof localItem[key][idx] === 'string' && !localItem[key][idx].includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]') ? localItem[key][idx] : item;
        } else if (item && typeof item === 'object') {
          return restoreLocalOmittedImages(item, localItem[key][idx]);
        }
        return item;
      });
    } else if (val && typeof val === 'object' && localItem[key] && typeof localItem[key] === 'object') {
      merged[key] = restoreLocalOmittedImages(val, localItem[key]);
    }
  }
  return merged;
}
import { subscribeToProjectRealtime, saveProjectDiffsToCloud, queueProjectDiffsToFirestoreOffline, saveProjectToCloud, getCloudPayload, getCurrentRealFirebaseUser, onAuthUserChanged, fetchProjectUserRoleFromCloud, subscribeProjectUserRoleRealtime, subscribeCurrentUserPinResetRealtime, signOutGoogle, fetchCurrentUserProjectsFromCloud, subscribeCurrentUserProjectsRealtime, refreshCurrentUserProjectDiscovery, subscribeProjectSharedSettings, saveProjectSharedSettings, saveProjectAuditLog, loadProjectFromFirestoreCache, fetchProjectFromCloud } from './lib/firebase';
import { REALTIME_STATE_KEYS, STATE_KEY_TO_CLOUD_NAME } from './config/realtimeCollections';
import { FIREBASE_ONLY_RUNTIME, LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED, LEGACY_LOCAL_IMPORT_ENABLED } from './config/runtimeArchitecture';
import { CURRENT_DATA_SCHEMA_VERSION } from './config/dataSchema';
import { 
  InventoryItem, 
  WorkVolume, 
  FloorPlan, 
  DefectItem, 
  ChecklistItem, 
  ChecklistStatus,
  DefectStatus,
  MaterialNorm,
  RoomProgressItem,
  CrewRecord,
  TeamInfo
} from './types';
import { GoogleAuthHeader } from './components/GoogleAuthHeader';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { ExportPdfModal } from './components/ExportPdfModal';
import { MaterialNormModal } from './components/MaterialNormModal';
import { ProjectManagerModal } from './components/ProjectManagerModal';
import { DueDateToastNotifier } from './components/DueDateToastNotifier';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { SuperAdminCenter, SuperAdminUiSettings } from './components/SuperAdminCenter';
import { BottomNav, TabType } from './components/BottomNav';
import { isSuperAdminEmail } from './config/superAdmin';
import { 
  exportWarehouseToExcel, 
  exportWorkVolumesToExcel, 
  exportFloorPlanToExcel, 
  exportChecklistToExcel,
  exportCrewToExcel
} from './utils/excelExport';
import { collectDueDateAlerts, DueDateAlertItem } from './utils/dueDateUtils';
import { getFileHandle, saveFileHandle, removeFileHandle } from './utils/localSyncDb';
import { getAllBackupVersions, saveBackupVersion, deleteBackupVersion, BackupVersion } from './utils/backupDb';
import { cleanupAndCompressOldImages } from './utils/cleanupStorage';
import { getAsyncItem, setAsyncItem, getAllStorageData } from './utils/asyncStorage';
import { migrateAndCleanLocalStorage } from './utils/migrateStorage';
import { confirmAsync } from './utils/confirmAsync';
import { normalizeImportedData } from './utils/dataNormalizer';
import { getSubItemGroupWeight } from './utils/teamUtils';
import { reconcileMaterialNormWorkCategoryLinks } from './utils/projectReconciliation';
import { createEntityId, createShortToken } from './utils/idUtils';
import { normalizeUnit, areSameUnit } from './utils/unitUtils';
import { resolveNormMaterialId, normalizeMaterialNameKey } from './utils/inventoryUtils';
import { apiFetch, hasApiBackend } from './utils/api';
import {
  getAndroidAutoSaveFolderName,
  hasAndroidAutoSaveFolder,
  isAndroidAutoSaveAvailable,
  pickAndroidAutoSaveFolder,
  saveTextFileToAndroidAutoFolder
} from './utils/fileExport';
import { deleteEntityPhotos, getProjectPhotos, getProjectPhotosWithBinary, restorePhotosFromBackup } from './utils/photoStorage';
import { refreshProjectPhotoMetadataFromCloud, subscribeProjectPhotosRealtime, syncProjectPhotosToCloud, PhotoCloudSyncStatus } from './lib/photoCloudSync';
import { appendRuntimeDiagnostic } from './lib/runtimeDiagnostics';
import { isPrimaryDriveReady, PRIMARY_DRIVE_OWNER_EMAIL, uploadProjectBackupToPrimaryDrive } from './lib/primaryDriveBridge';
import { subscribeConversationReadState, subscribeConversationSummary } from './lib/chatService';
import { floorPlanNeedsCloudUpload, isDisplayableFloorPlanUrl, loadFloorPlanImageFromCloud, syncFloorPlanImageToCloud, deleteFloorPlanImageFromCloud } from './lib/floorPlanImageSync';
import { DEFAULT_TRASH_SETTINGS, TrashOperation, TrashSettings, TrashCollectionKey, deleteTrashOperationFromCloud, estimateTrashBytes, getTrashCollectionLabel, normalizeTrashSettings, sanitizeTrashSnapshot, saveTrashOperationToCloud, subscribeProjectTrash } from './lib/trash';
import { commitWarehouseTransactionAtomic, updateWarehouseTransactionAtomic, softDeleteWarehouseTransactionAtomic } from './lib/warehouseTransactions';

// Heavy screens are code-split so Android does not parse XLSX/PDF-heavy modules at startup.
const WarehouseTab = React.lazy(() => import('./components/WarehouseTab').then(m => ({ default: m.WarehouseTab })));
const WorkVolumeTab = React.lazy(() => import('./components/WorkVolumeTab').then(m => ({ default: m.WorkVolumeTab })));
const FloorPlanDefectTab = React.lazy(() => import('./components/FloorPlanDefectTab').then(m => ({ default: m.FloorPlanDefectTab })));
const ChecklistTab = React.lazy(() => import('./components/ChecklistTab').then(m => ({ default: m.ChecklistTab })));
const CrewTab = React.lazy(() => import('./components/CrewTab').then(m => ({ default: m.CrewTab })));
const GoogleConfigTab = React.lazy(() => import('./components/GoogleConfigTab').then(m => ({ default: m.GoogleConfigTab })));
const ChatTab = React.lazy(() => import('./features/chat/ChatTab').then(m => ({ default: m.ChatTab })));
const AiAssistantPage = React.lazy(() => import('./features/ai/AiAssistantPage').then(m => ({ default: m.AiAssistantPage })));
const HNL_AI_ENABLED = String(((import.meta as any).env || {}).VITE_HNL_AI_ENABLED || 'false').toLowerCase() === 'true';

interface AppData {
  materialNorms: MaterialNorm[];
  inventory: InventoryItem[];
  workVolumes: WorkVolume[];
  floorPlans: FloorPlan[];
  defects: DefectItem[];
  roomProgressList: RoomProgressItem[];
  checklist: ChecklistItem[];
  crewRecords: CrewRecord[];
  teams: TeamInfo[];
}

const ANDROID_AUTO_SAVE_HANDLE_FLAG = '__qlctAndroidAutoSave';
const ANDROID_ALL_AUTOSAVE_ENABLED_KEY = 'qlct_android_all_autosave_enabled';
const getAndroidSingleAutosaveKey = (projectId: string) => `qlct_android_single_autosave_enabled_${projectId || 'default'}`;
const makeAndroidAutoSaveHandle = (scope: string, name: string) => ({
  [ANDROID_AUTO_SAVE_HANDLE_FLAG]: true,
  scope,
  name
});
const isAndroidAutoSaveHandle = (handle: any) => Boolean(handle && handle[ANDROID_AUTO_SAVE_HANDLE_FLAG]);

export const getActiveProjectId = () => {
  if (typeof window !== 'undefined') {
    // Per-tab active project prevents two tabs/accounts on the same origin from
    // overwriting each other's current project. localStorage is retained only as
    // the legacy/next-tab fallback.
    return sessionStorage.getItem('active_project_id') || localStorage.getItem('active_project_id') || 'default';
  }
  return 'default';
};

export const getKey = (baseKey: string, pid?: string) => {
  const p = pid || getActiveProjectId();
  return p === 'default' ? baseKey : `${baseKey}_${p}`;
};

const isEditableTextTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string | number;
  updatedAt?: number;
  createdAtSource?: 'cloud' | 'local' | 'migrating';
  canonicalProjectId?: string;
  aliases?: string[];
}

export const getProjectsList = (): ProjectInfo[] => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('construction_projects_list');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
  }
  return [{ id: 'default', name: 'Dự án chưa đặt tên', createdAt: 0, createdAtSource: 'local' }];
};

export const setActiveProject = (id: string) => {
  if (typeof window !== 'undefined') {
    try { sessionStorage.setItem('active_project_id', id); } catch (_) {}
  }
  // Keep the legacy last-used value so a brand-new tab still opens the last project,
  // but an already-open tab always prefers its own sessionStorage value.
  safeSetLocalStorageItem('active_project_id', id);
};

export const saveProjectsList = (list: ProjectInfo[]) => {
  const next = JSON.stringify(list);
  try {
    if (localStorage.getItem('construction_projects_list') === next) return;
  } catch (_) {}
  safeSetLocalStorageItem('construction_projects_list', next);
};

const DEFAULT_SUPER_ADMIN_UI_SETTINGS: SuperAdminUiSettings = {
  scalePercent: 100,
  checklistVisibility: 'auto',
  theme: 'system',
  primaryColor: '#4f46e5',
  secondaryColor: '#059669',
  buttonSize: 'standard',
  iconSize: 'standard',
  density: 'standard',
  borderRadius: 'soft',
  appDisplayName: 'HNL QLTC',
  logoUrl: '',
};

const normalizeHexColor = (value: unknown, fallback: string): string => {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
};

const normalizeSuperAdminUiSettings = (raw: any): SuperAdminUiSettings => {
  const logoCandidate = String(raw?.logoUrl || '').trim();
  const safeLogoUrl = !logoCandidate || logoCandidate.startsWith('/') || /^https:\/\//i.test(logoCandidate) ? logoCandidate : '';
  return {
    scalePercent: [90, 100, 110, 120].includes(Number(raw?.scalePercent)) ? Number(raw.scalePercent) : 100,
    checklistVisibility: raw?.checklistVisibility === 'always' ? 'always' : 'auto',
    theme: ['light', 'dark', 'system'].includes(String(raw?.theme)) ? raw.theme : 'system',
    primaryColor: normalizeHexColor(raw?.primaryColor, DEFAULT_SUPER_ADMIN_UI_SETTINGS.primaryColor),
    secondaryColor: normalizeHexColor(raw?.secondaryColor, DEFAULT_SUPER_ADMIN_UI_SETTINGS.secondaryColor),
    buttonSize: ['compact', 'standard', 'large'].includes(String(raw?.buttonSize)) ? raw.buttonSize : 'standard',
    iconSize: ['small', 'standard', 'large'].includes(String(raw?.iconSize)) ? raw.iconSize : 'standard',
    density: ['compact', 'standard', 'comfortable'].includes(String(raw?.density)) ? raw.density : 'standard',
    borderRadius: ['square', 'soft', 'round'].includes(String(raw?.borderRadius)) ? raw.borderRadius : 'soft',
    appDisplayName: String(raw?.appDisplayName || 'HNL QLTC').trim().slice(0, 40) || 'HNL QLTC',
    logoUrl: safeLogoUrl.slice(0, 1000),
  };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('floorplan');

  // Diagnostic navigation stays decoupled from individual screens. The source screen
  // stores the entity request in sessionStorage, while App only switches modules.
  useEffect(() => {
    const handleDiagnosticOpenTab = (event: Event) => {
      const detail = (event as CustomEvent<{ entityType?: string }>).detail || {};
      const nextTab: TabType | null = detail.entityType === 'crewRecord'
        ? 'crew'
        : detail.entityType === 'defect'
          ? 'floorplan'
          : detail.entityType === 'chat'
            ? 'chat'
            : null;
      if (nextTab) setActiveTab(nextTab);
    };
    window.addEventListener('qlct-diagnostic-open-entity', handleDiagnosticOpenTab);
    return () => window.removeEventListener('qlct-diagnostic-open-entity', handleDiagnosticOpenTab);
  }, []);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => getActiveProjectId());
  const activeProjectIdRef = useRef<string>(activeProjectId);
  // Firebase-only business data must come from Firestore/its official cache. Legacy
  // localforage may be displayed only as a migration candidate and is read-only until
  // an explicit online Import writes it through the Firestore validation path.
  const [businessDataSource, setBusinessDataSource] = useState<'cloud' | 'firestore-cache' | 'legacy-migration-fallback' | 'empty'>('empty');
  const [isExportPdfOpen, setIsExportPdfOpen] = useState(false);
  const [isMaterialNormOpen, setIsMaterialNormOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [projectManagerInitialTab, setProjectManagerInitialTab] = useState<'projects' | 'sync'>('projects');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [currentUserRole, setCurrentUserRoleState] = useState<UserRole>(() => getCurrentUserRole());
  const [isProjectRoleResolved, setIsProjectRoleResolved] = useState(false);
  const [projectRoleSource, setProjectRoleSource] = useState<'cloud' | 'offline-cache' | 'unresolved'>('unresolved');
  const [projectRoleAllowed, setProjectRoleAllowed] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [isSoftKeyboardOpen, setIsSoftKeyboardOpen] = useState(false);
  const [cloudDefectIndex, setCloudDefectIndex] = useState<{ projectId: string; ids: Set<string> } | null>(null);
  const [trashSettings, setTrashSettings] = useState<TrashSettings>(DEFAULT_TRASH_SETTINGS);
  const [superAdminUiSettings, setSuperAdminUiSettings] = useState<SuperAdminUiSettings>(DEFAULT_SUPER_ADMIN_UI_SETTINGS);
  const trashSettingsRef = useRef<TrashSettings>(DEFAULT_TRASH_SETTINGS);
  const [trashOperations, setTrashOperations] = useState<TrashOperation[]>([]);
  const trashOperationsRef = useRef<TrashOperation[]>([]);
  const trashCaptureSuppressedRef = useRef(false);
  const googleServerBackendAvailable = hasApiBackend();

  // Keep SecurityModal project props stable while Android's VisualViewport changes as
  // the soft keyboard opens/closes. Calling getProjectsList() inline creates a fresh array
  // on every App render, which retriggers SecurityModal initialization and can steal focus
  // from the phone editor on Android Web/PWA. Refresh only when the modal is (re)opened
  // or the active project actually changes.
  const securityModalProjects = React.useMemo(
    () => getProjectsList(),
    [isSecurityModalOpen, activeProjectId]
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

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateKeyboardState = () => {
      // Android/iOS keyboard normally reduces VisualViewport by >140px. Small browser
      // chrome changes must not hide the navigation bar.
      const obscured = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setIsSoftKeyboardOpen(obscured > 140);
    };
    updateKeyboardState();
    viewport.addEventListener('resize', updateKeyboardState);
    viewport.addEventListener('scroll', updateKeyboardState);
    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
      viewport.removeEventListener('scroll', updateKeyboardState);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let roleUnsub: (() => void) | null = null;
    let pinResetUnsub: (() => void) | null = null;

    const attachRoleListener = () => {
      if (roleUnsub) { roleUnsub(); roleUnsub = null; }
      if (pinResetUnsub) { pinResetUnsub(); pinResetUnsub = null; }
      const realUser = getCurrentRealFirebaseUser();
      const rememberedIdentity = !realUser && !isOnline ? getRememberedVerifiedAuthIdentity() : null;
      const identity = realUser
        ? { uid: realUser.uid, email: realUser.email || '', displayName: realUser.displayName || '' }
        : rememberedIdentity;

      if (!identity || !activeProjectId) {
        // Never inherit a role from another account/project. Without a matching real
        // or remembered identity + project-scoped verified lease, fail closed.
        setCurrentUserRoleState('VIEWER');
        setCurrentUserRole('VIEWER');
        setIsProjectRoleResolved(false);
        setProjectRoleSource('unresolved');
        setProjectRoleAllowed(false);
        return;
      }

      const cachedRole = getCachedVerifiedProjectRole(activeProjectId, identity);
      if (cachedRole) {
        // Offline startup resumes the last role that was authoritatively verified for
        // this exact uid/email + projectId. VIEWER stays read-only; EDITOR/ADMIN may
        // keep editing the local IndexedDB cache while Cloud is unavailable.
        setCurrentUserRole(cachedRole.role);
        setCurrentUserRoleState(cachedRole.role);
        setIsProjectRoleResolved(true);
        setProjectRoleSource('offline-cache');
        setProjectRoleAllowed(cachedRole.allowed);
      } else {
        setCurrentUserRoleState('VIEWER');
        setCurrentUserRole('VIEWER');
        setIsProjectRoleResolved(false);
        setProjectRoleSource('unresolved');
        setProjectRoleAllowed(false);
      }

      if (!realUser || !isOnline) return;
      rememberVerifiedAuthIdentity(realUser);
      pinResetUnsub = subscribeCurrentUserPinResetRealtime(activeProjectId, realUser, (epoch) => {
        if (!isMounted || !applyRemotePinReset(epoch, realUser.email)) return;
        setIsAppLocked(false);
        logAuditAction('SECURITY_CONFIG_CHANGE', `PIN local đã bị SUPER ADMIN reset từ xa (${realUser.email || realUser.uid})`, activeProjectId);
        window.setTimeout(() => {
          alert('SUPER ADMIN đã đặt lại mã PIN trên tài khoản này.\n\nPIN cũ đã bị vô hiệu hóa. Vui lòng đăng nhập Google lại và tạo PIN mới trong Bảo mật.');
          void signOutGoogle();
        }, 0);
      });
      roleUnsub = subscribeProjectUserRoleRealtime(activeProjectId, realUser, (res) => {
        if (!isMounted) return;
        if (res.verification !== 'verified') {
          // Network/backend failure is not an authorization change. Re-read the lease
          // because a previous successful realtime refresh in this same subscription may
          // already have updated it after `attachRoleListener` captured `cachedRole`.
          const fallbackRole = getCachedVerifiedProjectRole(activeProjectId, realUser);
          if (fallbackRole) {
            setCurrentUserRole(fallbackRole.role);
            setCurrentUserRoleState(fallbackRole.role);
            setIsProjectRoleResolved(true);
            setProjectRoleSource('offline-cache');
            setProjectRoleAllowed(fallbackRole.allowed);
          } else {
            setIsProjectRoleResolved(false);
            setProjectRoleSource('unresolved');
            setProjectRoleAllowed(false);
          }
          return;
        }
        const effectiveRole: UserRole = res.allowed ? res.role : 'VIEWER';
        cacheVerifiedProjectRole(activeProjectId, realUser, effectiveRole, res.allowed);
        rememberVerifiedAuthIdentity(realUser);
        setCurrentUserRole(effectiveRole);
        setCurrentUserRoleState(effectiveRole);
        setIsProjectRoleResolved(true);
        setProjectRoleSource('cloud');
        setProjectRoleAllowed(res.allowed);
      });
    };

    attachRoleListener();
    const authUnsub = onAuthUserChanged(attachRoleListener);

    return () => {
      isMounted = false;
      if (pinResetUnsub) pinResetUnsub();
      if (roleUnsub) roleUnsub();
      authUnsub();
    };
  }, [activeProjectId, isOnline]);
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    const pinCfg = getStoredPinLockConfig();
    return !!(pinCfg.enabled && pinCfg.pinHash);
  });

  // Auto-lock on background & Inactivity timer
  useEffect(() => {
    const checkBackgroundLock = () => {
      const pinCfg = getStoredPinLockConfig();
      if (document.hidden && pinCfg.enabled && pinCfg.pinHash && pinCfg.lockOnBackground) {
        setIsAppLocked(true);
      }
    };

    let inactivityTimer: any = null;
    const resetInactivity = () => {
      const pinCfg = getStoredPinLockConfig();
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (pinCfg.enabled && pinCfg.pinHash && pinCfg.autoLockMinutes > 0) {
        inactivityTimer = setTimeout(() => {
          setIsAppLocked(true);
        }, pinCfg.autoLockMinutes * 60 * 1000);
      }
    };

    document.addEventListener('visibilitychange', checkBackgroundLock);
    window.addEventListener('mousemove', resetInactivity);
    window.addEventListener('keydown', resetInactivity);
    window.addEventListener('touchstart', resetInactivity);

    resetInactivity();

    return () => {
      document.removeEventListener('visibilitychange', checkBackgroundLock);
      window.removeEventListener('mousemove', resetInactivity);
      window.removeEventListener('keydown', resetInactivity);
      window.removeEventListener('touchstart', resetInactivity);
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
  }, []);

  const handleOpenProjectManager = (tab: 'projects' | 'sync' = 'projects') => {
    setProjectManagerInitialTab(tab);
    setIsProjectManagerOpen(true);
  };
  const [projectName, setProjectName] = useState<string>('Dự án chưa đặt tên');

  const [contractorName, setContractorName] = useState<string>('');
  const [inspectorName, setInspectorName] = useState<string>('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  // App Data State with Undo/Redo support
  const [past, setPast] = useState<AppData[]>([]);
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const [present, setPresent] = useState<AppData>({
    materialNorms: [], inventory: [], workVolumes: [], floorPlans: [], defects: [], roomProgressList: [], checklist: [], crewRecords: [], teams: []
  });
  const lastSyncedPresentRef = React.useRef<AppData | null>(null);
  const lastSyncedMetadataRef = React.useRef<{ projectName: string; contractorName: string; inspectorName: string } | null>(null);
  const lastServerMetadataUpdatedAtRef = React.useRef<number>(0);
  const hasUserEditedSinceHydrateRef = React.useRef<boolean>(false);
  const hasUnsavedAllBackupChangesRef = React.useRef<boolean>(false);
  const localTombstonesRef = React.useRef<Record<string, number>>({});

  // V6.2.22: Persist only collections that the user actually changed. Rewriting all
  // nine large arrays on every small edit caused avoidable IndexedDB serialization
  // and mobile UI stalls. Revision counters avoid clearing a newer dirty mark while
  // an older async save is still in flight.
  const localDirtyRevisionRef = React.useRef<Partial<Record<keyof AppData, number>>>({});
  const localMetadataDirtyRevisionRef = React.useRef(0);
  const editorLocalRecoveryKeyRef = React.useRef('');
  const localCollectionStorageKey: Record<keyof AppData, string> = {
    materialNorms: 'construction_material_norms',
    inventory: 'construction_inventory',
    workVolumes: 'construction_work_volumes',
    floorPlans: 'construction_floor_plans',
    defects: 'construction_defects',
    roomProgressList: 'construction_room_progress',
    checklist: 'construction_checklist',
    crewRecords: 'construction_crew_records',
    teams: 'construction_teams',
  };
  const markLocalCollectionDirty = (key: keyof AppData) => {
    localDirtyRevisionRef.current[key] = Number(localDirtyRevisionRef.current[key] || 0) + 1;
  };
  const markAllLocalCollectionsDirty = () => {
    (Object.keys(localCollectionStorageKey) as (keyof AppData)[]).forEach(markLocalCollectionDirty);
  };

  const persistLocalTombstones = (projectId: string) => {
    if (FIREBASE_ONLY_RUNTIME && !LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) return;
    const snapshot = { ...localTombstonesRef.current };
    setAsyncItem(getKey('construction_tombstones', projectId), snapshot).catch((err) =>
      console.warn('Legacy tombstone cache save warning:', err)
    );
  };

  const recordLocalTombstone = (stateKey: keyof AppData | string, id: string, timestamp: number, projectId = activeProjectIdRef.current || activeProjectId) => {
    if (!id) return;
    const key = `${String(stateKey)}_${id}`;
    if (timestamp > Number(localTombstonesRef.current[key] || 0)) {
      localTombstonesRef.current[key] = timestamp;
      persistLocalTombstones(projectId);
    }
  };

  const clearLocalTombstone = (stateKey: keyof AppData | string, id: string, projectId = activeProjectIdRef.current || activeProjectId) => {
    const key = `${String(stateKey)}_${id}`;
    if (key in localTombstonesRef.current) {
      delete localTombstonesRef.current[key];
      persistLocalTombstones(projectId);
    }
  };

  const [pendingFileRestorePrompt, setPendingFileRestorePrompt] = useState<{
    handleName: string;
    fileData: any;
    fileUpdatedAt: number;
    localUpdatedAt: number;
    isAll?: boolean;
  } | null>(null);

  const loadGenerationRef = useRef(0);

  const loadProject = async (projectId: string) => {
    const currentGeneration = ++loadGenerationRef.current;
    setIsLoadingProject(true);
    setIsHydrated(false);
    console.log('[LOAD PROJECT]', projectId, 'gen:', currentGeneration, 'backend=', FIREBASE_ONLY_RUNTIME ? 'firestore-cache' : 'legacy');
    try {
      await migrateAndCleanLocalStorage();

      const deduplicateById = (list: any[], prefix: string) => {
        const seen = new Set<string>();
        return list.map((item: any, idx: number) => {
          let id = item.id;
          if (!id || seen.has(id)) {
            const itemPrefix = (prefix === 'INV' && item.type)
              ? (item.type === 'in' ? 'NK' : 'XK')
              : prefix;
            id = `${createEntityId(itemPrefix)}-${idx}`;
          }
          seen.add(id);
          return { ...item, id };
        });
      };

      // Firebase-only runtime hydrates business records from Firestore's official
      // persistent cache. The old localforage arrays are consulted only as a read-only
      // migration fallback when this browser has never cached this project in Firestore.
      const firestoreCached = FIREBASE_ONLY_RUNTIME
        ? await loadProjectFromFirestoreCache(projectId).catch((err) => {
            console.warn('[Firestore cache hydrate] unavailable:', err);
            return null;
          })
        : null;
      const shouldReadLegacy = !FIREBASE_ONLY_RUNTIME || Boolean(!firestoreCached?.found && LEGACY_LOCAL_IMPORT_ENABLED);
      const parseSaved = async <T,>(key: string, fallback: T): Promise<T> => {
        if (!shouldReadLegacy) return fallback;
        return await getAsyncItem(getKey(key, projectId), fallback);
      };

      let rawFloorPlans: any[] = [];
      let rawRooms: any[] = [];
      let rawDefects: any[] = [];
      let rawChecklist: any[] = [];
      let rawCrew: any[] = [];
      let rawMaterialNorms: any[] = [];
      let rawInventory: any[] = [];
      let rawWorkVolumes: any[] = [];
      let rawTeams: any[] = [];
      let rawTombstones: Record<string, number> = {};

      if (firestoreCached?.found) {
        setBusinessDataSource('firestore-cache');
        rawFloorPlans = firestoreCached.data.floorPlans || [];
        rawRooms = firestoreCached.data.roomProgressList || [];
        rawDefects = firestoreCached.data.defects || [];
        rawChecklist = firestoreCached.data.checklist || [];
        rawCrew = firestoreCached.data.crewRecords || [];
        rawMaterialNorms = firestoreCached.data.materialNorms || [];
        rawInventory = firestoreCached.data.inventory || [];
        rawWorkVolumes = firestoreCached.data.workVolumes || [];
        rawTeams = firestoreCached.data.teams || [];
      } else if (shouldReadLegacy) {
        setBusinessDataSource(FIREBASE_ONLY_RUNTIME ? 'legacy-migration-fallback' : 'empty');
        [
          rawFloorPlans,
          rawRooms,
          rawDefects,
          rawChecklist,
          rawCrew,
          rawMaterialNorms,
          rawInventory,
          rawWorkVolumes,
          rawTeams,
        ] = await Promise.all([
          parseSaved('construction_floor_plans', []),
          parseSaved('construction_room_progress', []),
          parseSaved('construction_defects', []),
          parseSaved('construction_checklist', []),
          parseSaved('construction_crew_records', []),
          parseSaved('construction_material_norms', []),
          parseSaved('construction_inventory', []),
          parseSaved('construction_work_volumes', []),
          parseSaved('construction_teams', []),
        ]);
        rawTombstones = await parseSaved<Record<string, number>>('construction_tombstones', {});
        if (FIREBASE_ONLY_RUNTIME) {
          console.warn('[LEGACY MIGRATION FALLBACK] Firestore cache is empty; displaying read-only legacy business cache candidate for project', projectId);
        }
      }

      if (!firestoreCached?.found && !shouldReadLegacy) setBusinessDataSource('empty');

      const tombstoneMap = (rawTombstones && typeof rawTombstones === 'object' && !Array.isArray(rawTombstones)) ? rawTombstones : {};
      const filterTombstoned = <T extends { id?: string; updatedAt?: any; deleted?: boolean; deletedAt?: any }>(stateKey: keyof AppData, list: T[] | undefined | null): T[] =>
        (list || []).filter((item) => {
          if (item?.deleted === true || item?.deletedAt) return false;
          if (!item?.id) return true;
          const tombTime = Number(tombstoneMap[`${String(stateKey)}_${item.id}`] || 0);
          const itemTime = parseLegacyTimestamp(item.updatedAt, 0);
          return !(tombTime > 0 && tombTime >= itemTime);
        });

      if (currentGeneration !== loadGenerationRef.current) {
        console.log('[STALE LOAD DISCARDED]', projectId);
        return;
      }

      const floorPlans = deduplicateById(filterTombstoned('floorPlans', rawFloorPlans), 'FP');
      floorPlans.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      floorPlans.forEach((fp, idx) => { fp.order = idx; });
      const roomProgressList = deduplicateById(filterTombstoned('roomProgressList', rawRooms), 'ROOM');
      const defects = deduplicateById(filterTombstoned('defects', rawDefects), 'DEF');
      const checklist = deduplicateById(filterTombstoned('checklist', rawChecklist), 'CHK');
      const crewRecords = deduplicateById(filterTombstoned('crewRecords', rawCrew), 'CREW');
      const materialIdByNameUnit = new Map<string, string>();
      const materialNorms = deduplicateById(filterTombstoned('materialNorms', rawMaterialNorms), 'NORM').map((norm: MaterialNorm) => {
        const normalizedUnit = normalizeUnit(norm.unit) || norm.unit;
        const materialKey = `${normalizeMaterialNameKey(norm.materialName)}|${normalizedUnit}`;
        const materialId = norm.materialId || materialIdByNameUnit.get(materialKey) || `MAT-${norm.id}`;
        if (materialKey && !materialIdByNameUnit.has(materialKey)) materialIdByNameUnit.set(materialKey, materialId);
        return {
          ...norm,
          materialId,
          unit: normalizedUnit,
          normBasisUnit: norm.normBasisUnit ? (normalizeUnit(norm.normBasisUnit) || norm.normBasisUnit) : undefined,
        };
      });
      const normByLegacyId = new Map<string, MaterialNorm>();
      materialNorms.forEach((norm: MaterialNorm) => {
        normByLegacyId.set(String(norm.id), norm);
        if (norm.materialId) normByLegacyId.set(String(norm.materialId), norm);
      });
      const inventory = deduplicateById(filterTombstoned('inventory', rawInventory), 'INV').map((item: InventoryItem) => {
        let matchedNorm = item.materialId ? normByLegacyId.get(String(item.materialId)) : undefined;
        if (!matchedNorm) {
          matchedNorm = materialNorms.find((norm: MaterialNorm) =>
            normalizeMaterialNameKey(norm.materialName) === normalizeMaterialNameKey(item.materialName) &&
            areSameUnit(norm.unit, item.unit)
          );
        }
        return {
          ...item,
          materialId: matchedNorm ? resolveNormMaterialId(matchedNorm) : item.materialId,
          unit: normalizeUnit(item.unit) || item.unit,
        };
      });
      const workVolumes = deduplicateById(filterTombstoned('workVolumes', rawWorkVolumes), 'VOL');
      const teams = deduplicateById(filterTombstoned('teams', rawTeams), 'TEAM');

      const isDefault = projectId === 'default';
      const loadedProjectName = firestoreCached?.metadata.projectName || localStorage.getItem(getKey('construction_project_name', projectId)) || (isDefault ? 'Dự án chưa đặt tên' : `Dự án ${projectId}`);
      const loadedContractor = firestoreCached?.metadata.contractorName || localStorage.getItem(getKey('construction_contractor', projectId)) || '';
      const loadedInspector = firestoreCached?.metadata.inspectorName || localStorage.getItem(getKey('construction_inspector', projectId)) || '';
      const loadedUpdatedAt = Number(firestoreCached?.metadata.updatedAt || localStorage.getItem(getKey('construction_updated_at', projectId)) || 0);

      setProjectName(loadedProjectName);
      setContractorName(loadedContractor);
      setInspectorName(loadedInspector);
      setLastUpdatedAt(loadedUpdatedAt);
      localTombstonesRef.current = { ...tombstoneMap };

      const initialState = {
        materialNorms,
        inventory,
        workVolumes,
        floorPlans,
        defects,
        roomProgressList,
        checklist,
        crewRecords,
        teams,
      };
      setPresent(initialState);
      lastSyncedMetadataRef.current = {
        projectName: loadedProjectName,
        contractorName: loadedContractor,
        inspectorName: loadedInspector
      };
      // Only a real Firestore cache snapshot is eligible as the synchronized baseline.
      // Legacy migration fallback must not be silently uploaded as if Cloud had approved it.
      lastSyncedPresentRef.current = firestoreCached?.found ? initialState : null;
      hasUserEditedSinceHydrateRef.current = false;
      setIsHydrated(true);
      console.log('[HYDRATED SUCCESS]', projectId, firestoreCached?.found ? 'firestore-cache' : shouldReadLegacy ? 'legacy-migration-fallback' : 'empty');
    } catch (err) {
      console.error(`Error loading project ${projectId}:`, err);
    } finally {
      if (currentGeneration === loadGenerationRef.current) {
        setIsLoadingProject(false);
        setIsInitializing(false);
        switchingProjectRef.current = false;
      }
    }
  };

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueSave = (job: () => Promise<void>) => {
    const next = saveQueueRef.current.catch(() => {}).then(job);
    saveQueueRef.current = next.catch(err => {
      console.error('[SAVE QUEUE ERROR]', err);
    });
    return next;
  };

  const cloudSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueCloudSave = (job: () => Promise<void>) => {
    const next = cloudSaveQueueRef.current.catch(() => {}).then(job);
    cloudSaveQueueRef.current = next.catch((err) => console.warn('[CLOUD SAVE QUEUE ERROR]', err));
    return next;
  };

  const saveCurrentProject = async (targetProjectId?: string) => {
    if (!isHydrated || isRestoring || isLoadingProject) return;
    if (!isProjectRoleResolved || !canEditProjectData(currentUserRole)) return;
    const frozenProjectId = targetProjectId || activeProjectIdRef.current || activeProjectId;
    if (!frozenProjectId) return;

    const dirtyEntries = (Object.entries(localDirtyRevisionRef.current) as Array<[keyof AppData, number]>)
      .filter(([, revision]) => Number(revision || 0) > 0);
    const metadataRevision = localMetadataDirtyRevisionRef.current;
    if (dirtyEntries.length === 0 && metadataRevision <= 0) return;

    setIsSaving(true);
    console.log('[SAVE START]', frozenProjectId, 'collections=', dirtyEntries.map(([key]) => key));

    try {
      await queueSave(async () => {
        const frozenPresent = present;
        if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
          await Promise.all(dirtyEntries.map(([key]) =>
            setAsyncItem(getKey(localCollectionStorageKey[key], frozenProjectId), frozenPresent[key])
          ));
        }

        // Project name/active ID are only discovery/UI cache in Firebase-only mode, not
        // an authoritative business database. Firestore remains the source of truth.
        if (metadataRevision > 0) {
          safeSetLocalStorageItem(getKey('construction_project_name', frozenProjectId), projectName);
          safeSetLocalStorageItem(getKey('construction_contractor', frozenProjectId), contractorName);
          safeSetLocalStorageItem(getKey('construction_inspector', frozenProjectId), inspectorName);
        }
        safeSetLocalStorageItem(getKey('construction_updated_at', frozenProjectId), String(lastUpdatedAt));

        dirtyEntries.forEach(([key, savedRevision]) => {
          if (Number(localDirtyRevisionRef.current[key] || 0) === Number(savedRevision)) {
            delete localDirtyRevisionRef.current[key];
          }
        });
        if (metadataRevision > 0 && localMetadataDirtyRevisionRef.current === metadataRevision) {
          localMetadataDirtyRevisionRef.current = 0;
        }
      });
      console.log('[SAVE DONE]', frozenProjectId);
    } catch (err) {
      console.error('[SAVE FAILED]', frozenProjectId, err);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const switchProject = async (newProjectId: string) => {
    const oldId = activeProjectIdRef.current || activeProjectId;
    if (newProjectId === oldId) return;
    console.log('[SWITCH PROJECT]', oldId, '=>', newProjectId);

    switchingProjectRef.current = true;
    setLocalFileHandle(null);
    setLocalFileName('');
    lastSavedLocalSnapshotRef.current = '';
    setPast([]);
    setFuture([]);

    // Save the old project from the frozen render snapshot, but do not block the
    // project switch on IndexedDB writes. The new project hydrates from local data
    // immediately; Cloud listeners attach afterwards in the background.
    void saveCurrentProject(oldId).catch((e) => {
      console.warn('Background save before switch failed:', e);
    });
    // Dirty revisions are project-scoped. The old save captured its own snapshot above;
    // do not let a failed/slow old-project write make the next project persist all tables.
    localDirtyRevisionRef.current = {};
    localMetadataDirtyRevisionRef.current = 0;
    editorLocalRecoveryKeyRef.current = '';

    setIsHydrated(false);
    setActiveProject(newProjectId);
    activeProjectIdRef.current = newProjectId;
    lastSyncedPresentRef.current = null;
    lastSyncedMetadataRef.current = null;
    lastServerMetadataUpdatedAtRef.current = 0;
    setCloudInitialReady(false);
    receivedInitialSubcollectionsRef.current.clear();
    priorityCloudSyncRevisionRef.current = 0;
    flushedPriorityCloudSyncRevisionRef.current = 0;
    cloudDataRetryAttemptRef.current = 0;
    if (cloudDataRetryTimerRef.current !== null) {
      window.clearTimeout(cloudDataRetryTimerRef.current);
      cloudDataRetryTimerRef.current = null;
    }
    setDataCloudStatus({ phase: 'idle' });
    setActiveFloorViewId('');
    setActiveProjectId(newProjectId);
  };

  useEffect(() => {
    if (FIREBASE_ONLY_RUNTIME) {
      // Firestore cache is origin-wide. Never render it before a project-scoped role
      // has been resolved for the current/remembered identity.
      if (!isProjectRoleResolved) {
        setIsHydrated(false);
        setIsLoadingProject(true);
        return;
      }
      if (!projectRoleAllowed) {
        setPresent({ materialNorms: [], inventory: [], workVolumes: [], floorPlans: [], defects: [], roomProgressList: [], checklist: [], crewRecords: [], teams: [] });
        setIsHydrated(true);
        setIsLoadingProject(false);
        setIsInitializing(false);
        return;
      }
    }
    void loadProject(activeProjectId);
  }, [activeProjectId, isProjectRoleResolved, projectRoleAllowed]);

  useEffect(() => {
    if (!isHydrated || isRestoring || isLoadingProject || !activeProjectIdRef.current) return;
    saveCurrentProject(activeProjectIdRef.current).catch(err => console.warn('Autosave error:', err));
  }, [present, projectName, contractorName, inspectorName, isHydrated, isRestoring, isLoadingProject]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isHydrated && !isRestoring && !isLoadingProject && activeProjectIdRef.current) {
        saveCurrentProject(activeProjectIdRef.current).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (isHydrated && !isRestoring && !isLoadingProject && activeProjectIdRef.current) {
          saveCurrentProject(activeProjectIdRef.current).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHydrated, isRestoring, isLoadingProject, present, projectName, contractorName, inspectorName]);

  const [future, setFuture] = useState<AppData[]>([]);

  const [isSyncing, setIsSyncing] = useState(false);

  // Destructure current present state
  const { materialNorms, inventory, workVolumes, floorPlans, defects, roomProgressList, checklist, crewRecords, teams } = present;
  const activeDefects = useMemo(() => {
    const cloudIds = cloudDefectIndex?.projectId === activeProjectId ? cloudDefectIndex.ids : null;
    return defects.filter((item) => {
      if (item.archivedAt) return false;
      // A verified VIEWER must see the shared Firestore truth, not stale/local-only
      // defects left in this browser from an older/offline session. Keep those records
      // in local storage (no data loss); if the account later becomes EDITOR/ADMIN,
      // they become visible again and the autosave reconciliation can publish them.
      if (isProjectRoleResolved && currentUserRole === 'VIEWER' && cloudIds) {
        return cloudIds.has(item.id);
      }
      return true;
    });
  }, [defects, cloudDefectIndex, activeProjectId, isProjectRoleResolved, currentUserRole]);
  const activeChecklist = useMemo(() => checklist.filter((item) => !item.archivedAt), [checklist]);
  const showChecklistModule = superAdminUiSettings.checklistVisibility === 'always' || activeChecklist.length > 0;
  const currentIdentityEmail = getCurrentRealFirebaseUser()?.email || (!isOnline ? getRememberedVerifiedAuthIdentity()?.email : undefined);
  const isCurrentSuperAdmin = isSuperAdminEmail(currentIdentityEmail);

  useEffect(() => {
    const root = document.documentElement;
    const pct = Math.min(120, Math.max(90, Number(superAdminUiSettings.scalePercent) || 100));
    root.style.fontSize = `${pct}%`;
    root.style.setProperty('--hnl-primary', superAdminUiSettings.primaryColor);
    root.style.setProperty('--hnl-secondary', superAdminUiSettings.secondaryColor);
    root.dataset.hnlButtonSize = superAdminUiSettings.buttonSize;
    root.dataset.hnlIconSize = superAdminUiSettings.iconSize;
    root.dataset.hnlDensity = superAdminUiSettings.density;
    root.dataset.hnlRadius = superAdminUiSettings.borderRadius;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      root.dataset.hnlTheme = superAdminUiSettings.theme === 'system'
        ? (media.matches ? 'dark' : 'light')
        : superAdminUiSettings.theme;
    };
    applyTheme();
    if (superAdminUiSettings.theme === 'system') media.addEventListener?.('change', applyTheme);

    return () => {
      if (superAdminUiSettings.theme === 'system') media.removeEventListener?.('change', applyTheme);
    };
  }, [superAdminUiSettings]);

  useEffect(() => {
    // Checklist is kept in source/data for compatibility but stays out of navigation
    // until the current project actually has checklist items.
    if (activeTab === 'checklist' && !showChecklistModule) setActiveTab('crew');
  }, [activeTab, showChecklistModule]);

  useEffect(() => {
    // SUPER ADMIN navigation is protected at render level as well as by the existing
    // Firebase/handler authorization. A stale/deep-linked tab must never expose it.
    if (activeTab === 'superadmin' && !isCurrentSuperAdmin) setActiveTab('crew');
  }, [activeTab, isCurrentSuperAdmin]);


  // Helper to match floor names or floor IDs (supports multi-floor strings like "Tầng 1, Tầng 2")
  const isFloorMatch = (volFloor: string, roomFloorName: string, volFloorIds?: string[], roomFloorId?: string) => {
    if (volFloorIds && volFloorIds.length > 0 && roomFloorId) {
      if (volFloorIds.includes(roomFloorId)) return true;
    }
    if (!volFloor || !roomFloorName) return false;
    const vf = volFloor.toLowerCase().trim();
    const rf = roomFloorName.toLowerCase().trim();
    if (vf === rf || vf === 'tất cả' || vf === 'toàn nhà' || vf === 'công trình') return true;
    
    // Split comma or semicolon separated floor list e.g. "Tầng 1, Tầng 2"
    const splitVf = vf.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (splitVf.length > 1) {
      return splitVf.includes(rf);
    }
    return false;
  };

  // Dynamically compute workVolumes actual from room progress list
  const computedWorkVolumes = useMemo(() => {
    return workVolumes.map(item => {
      const itemCatId = item.workCategoryId || item.id;
      // Check if there are any rooms at all that match this item's floor and have this work category
      const matchingRooms = roomProgressList.filter(room => {
        const hasCategory = (itemCatId && room.workCategoryId === itemCatId) ||
                            (room.categoryVolumes && (room.categoryVolumes[item.title] !== undefined || (itemCatId && room.categoryVolumes[itemCatId] !== undefined))) ||
                            (room.workCategory === item.title) ||
                            (itemCatId && room.workCategoryId === itemCatId);
        if (!hasCategory) return false;

        // Floor matching
        const roomFloorName = floorPlans.find(f => f.id === room.floorId)?.floorName || room.floorName || '';
        const normItemFloor = item.floor ? item.floor.trim() : '';

        if (item.floorIds && item.floorIds.length > 0) {
          if (room.floorId && item.floorIds.includes(room.floorId)) return true;
        }

        if (item.floorId && room.floorId) {
          if (room.floorId === item.floorId) return true;
        }

        if (normItemFloor && normItemFloor !== 'Tất cả' && normItemFloor !== 'Toàn nhà' && normItemFloor !== 'Công trình') {
          if (!isFloorMatch(normItemFloor, roomFloorName, item.floorIds, room.floorId)) return false;
        }
        return true;
      });

      if (matchingRooms.length === 0) {
        // Khối lượng thực hiện trong app là số liệu liên kết từ Căn / Phòng.
        // Khi không còn Căn / Phòng nguồn, không giữ lại actual cũ vì sẽ tạo sản lượng “mồ côi”.
        return {
          ...item,
          actual: 0,
          status: 'Chưa thi công',
        } as WorkVolume;
      }

      let totalPlanned = 0;
      let totalActual = 0;
      matchingRooms.forEach(room => {
        const roomVol = (itemCatId && room.categoryVolumes?.[itemCatId] !== undefined)
          ? (room.categoryVolumes?.[itemCatId] ?? 0)
          : (room.categoryVolumes?.[item.title] !== undefined
            ? (room.categoryVolumes?.[item.title] ?? 0)
            : ((room.workCategory === item.title || room.workCategoryId === itemCatId) ? room.workVolume || 0 : 0));
          
        if (roomVol <= 0) return;
        totalPlanned += roomVol;

        const subItemsInCat = room.subItems?.filter(s => 
          (itemCatId && s.workCategoryId === itemCatId) || 
          (s.category || room.workCategory) === item.title
        ) || [];
        if (subItemsInCat.length > 0) {
          // Detailed sub-items are authoritative. A room-level “Đạt nghiệm thu”
          // must not force unfinished sub-items to 100%. One sibling group also
          // uses one weight system only (all volume, all %, or equal weights).
          const totalWeight = subItemsInCat.reduce((sum, s) => sum + getSubItemGroupWeight(subItemsInCat, s), 0);
          const completedWeight = subItemsInCat.reduce((sum, s) => {
            const isDone = s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu';
            return isDone ? sum + getSubItemGroupWeight(subItemsInCat, s) : sum;
          }, 0);
          const ratio = totalWeight > 0 ? Math.min(1, completedWeight / totalWeight) : 0;
          totalActual += roomVol * ratio;
        } else if (room.inspectionStatus === 'Đạt nghiệm thu') {
          totalActual += roomVol;
        } else {
          const titleLower = item.title.toLowerCase();
          const isFrame = titleLower.includes('khung') || titleLower.includes('xương');
          const isBoard = titleLower.includes('tấm');

          if (isFrame && room.frameStatus === 'Đã hoàn thành') {
            totalActual += roomVol;
          } else if (isBoard && room.boardStatus === 'Đã hoàn thành') {
            totalActual += roomVol;
          }
        }
      });

      const actualVolume = Math.round(totalActual * 100) / 100;
      const plannedVolume = (item.planned !== undefined && item.planned !== null && item.planned > 0)
        ? item.planned
        : (totalPlanned > 0 ? Math.round(totalPlanned * 100) / 100 : 0);

      const dynamicFloors = Array.from(new Set(matchingRooms.map(room => {
        const fp = floorPlans.find(f => f.id === room.floorId);
        return fp?.floorName || room.floorName || '';
      }).filter(Boolean)));
      const computedFloor = dynamicFloors.length > 0 ? dynamicFloors.join(', ') : item.floor;

      return {
        ...item,
        floor: computedFloor,
        planned: plannedVolume,
        actual: actualVolume,
        status: actualVolume >= plannedVolume && plannedVolume > 0 ? 'Đã hoàn thành' : actualVolume > 0 ? 'Đang thi công' : 'Chưa thi công'
      } as WorkVolume;
    });
  }, [workVolumes, roomProgressList, floorPlans]);

  // Dynamically compute materialNorms quantity based on linked work categories.
  // ID links are authoritative; name links are legacy fallback only. Each WorkVolume
  // can contribute at most once to one norm calculation.
  const computedMaterialNorms = useMemo(() => {
    return materialNorms.map((norm) => {
      const categoryIds = Array.from(new Set([
        ...(norm.workCategoryIds || []),
        ...(norm.workCategoryId ? [norm.workCategoryId] : []),
      ].filter(Boolean)));
      const categories = Array.from(new Set([
        ...(norm.workCategories || []),
        ...(norm.workCategory ? [norm.workCategory] : []),
      ].filter(Boolean)));

      const processedVolumeIds = new Set<string>();
      let totalQuota = 0;
      let hasNorms = false;

      const applyVolume = (volume: WorkVolume, factor: number) => {
        if (!volume?.id || processedVolumeIds.has(volume.id) || factor <= 0) return;
        processedVolumeIds.add(volume.id);
        totalQuota += (Number(volume.planned) || 0) * factor;
        hasNorms = true;
      };

      // 1) Authoritative ID links.
      categoryIds.forEach((catId) => {
        computedWorkVolumes
          .filter((v) => v.id === catId || v.workCategoryId === catId)
          .forEach((v) => {
            let factor = Number(norm.workCategoryNormsById?.[catId] || 0);
            if (!(factor > 0)) {
              const byName = norm.workCategoryNorms?.[v.title];
              if (Number(byName || 0) > 0) factor = Number(byName);
            }
            if (!(factor > 0) && Number(norm.unitNormPerM2 || 0) > 0) {
              const basisUnit = norm.normBasisUnit || 'm²';
              if (areSameUnit(basisUnit, v.unit)) factor = Number(norm.unitNormPerM2);
            }
            applyVolume(v, factor);
          });
      });

      // 2) Legacy name fallback only for volumes not already linked by ID.
      categories.forEach((cat) => {
        computedWorkVolumes
          .filter((v) => !processedVolumeIds.has(v.id) && (v.title === cat || v.category === cat))
          .forEach((v) => {
            let factor = Number(norm.workCategoryNorms?.[cat] || 0);
            if (!(factor > 0) && Number(norm.unitNormPerM2 || 0) > 0) {
              const basisUnit = norm.normBasisUnit || 'm²';
              if (areSameUnit(basisUnit, v.unit)) factor = Number(norm.unitNormPerM2);
            }
            applyVolume(v, factor);
          });
      });

      if (hasNorms) {
        return { ...norm, quotaQuantity: Math.round(totalQuota * 100) / 100 };
      }
      return norm;
    });
  }, [materialNorms, computedWorkVolumes]);

  // Additional settings managed at top level for sync

  // Google Drive Sync States
  const [driveSyncStatus, setDriveSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle'>('idle');
  const [driveLastSyncTime, setDriveLastSyncTime] = useState<string | null>(() => {
    return localStorage.getItem(getKey('construction_drive_last_sync'));
  });
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(getKey('construction_drive_auto_sync_enabled'));
    return saved === 'true';
  });

  useEffect(() => {
    const saved = localStorage.getItem(getKey('construction_drive_auto_sync_enabled', activeProjectId));
    setAutoSyncEnabled(saved === 'true');

    const savedTrashRaw = localStorage.getItem(getKey('construction_trash_settings', activeProjectId));
    let initialTrash = DEFAULT_TRASH_SETTINGS;
    if (savedTrashRaw) {
      try { initialTrash = normalizeTrashSettings(JSON.parse(savedTrashRaw)); } catch (_) {}
    }
    trashSettingsRef.current = initialTrash;
    setTrashSettings(initialTrash);

    // Project-level setting follows the project across PC/Web/APK. LocalStorage is only the offline cache.
    const unsubscribe = subscribeProjectSharedSettings(activeProjectId, (settings) => {
      if (typeof settings.driveAutoSyncEnabled === 'boolean') {
        setAutoSyncEnabled(settings.driveAutoSyncEnabled);
        localStorage.setItem(getKey('construction_drive_auto_sync_enabled', activeProjectId), String(settings.driveAutoSyncEnabled));
      }
      if (settings.trash) {
        const nextTrash = normalizeTrashSettings(settings.trash);
        trashSettingsRef.current = nextTrash;
        setTrashSettings(nextTrash);
        localStorage.setItem(getKey('construction_trash_settings', activeProjectId), JSON.stringify(nextTrash));
      }
      if (settings.superAdminUi && typeof settings.superAdminUi === 'object') {
        const nextUi = normalizeSuperAdminUiSettings(settings.superAdminUi);
        setSuperAdminUiSettings(nextUi);
        localStorage.setItem(getKey('construction_superadmin_ui', activeProjectId), JSON.stringify(nextUi));
      }
    });
    return unsubscribe;
  }, [activeProjectId]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Local File Sync States
  const [localFileHandle, setLocalFileHandle] = useState<any>(null);
  const [localSyncStatus, setLocalSyncStatus] = useState<'synced' | 'saving' | 'error' | 'idle'>('idle');
  const [localSyncPermissionNeeded, setLocalSyncPermissionNeeded] = useState<boolean>(false);
  const [localFileName, setLocalFileName] = useState<string>('');

  const [localAllFileHandle, setLocalAllFileHandle] = useState<any>(null);
  const [localAllSyncStatus, setLocalAllSyncStatus] = useState<'synced' | 'saving' | 'error' | 'idle'>('idle');
  const [localAllSyncPermissionNeeded, setLocalAllSyncPermissionNeeded] = useState<boolean>(false);
  const [localAllFileName, setLocalAllFileName] = useState<string>('');

  const lastSavedLocalSnapshotRef = useRef<string>('');
  const lastSavedLocalAllSnapshotRef = useRef<string>('');
  const lastPrimaryDriveBackupAtRef = useRef<number>(0);
  const lastLocalVersionBackupAtRef = useRef<number>(0);

  const getSafeProjectFileName = () => (projectName || activeProjectId || 'Du_An')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
  const getSingleAutoSaveFileName = () => `[Auto_Sync_Backup]_${getSafeProjectFileName()}.json`;
  const getAllAutoSaveFileName = () => '[Toan_Bo_Du_An]_Backup.json';

  const blobToBackupDataUrl = async (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không chuyển được ảnh backup sang Data URL.'));
    reader.readAsDataURL(blob);
  });

  const hydrateFloorPlansForBackup = async (projectId: string, sourcePlans: FloorPlan[]): Promise<FloorPlan[]> => {
    const result: FloorPlan[] = [];
    for (const rawPlan of sourcePlans || []) {
      const plan = { ...rawPlan };
      const currentUrl = String(plan.imageUrl || '').trim();
      if (currentUrl.startsWith('data:image/')) {
        result.push(plan);
        continue;
      }

      let resolved = '';
      if (currentUrl.startsWith('blob:')) {
        try {
          const response = await fetch(currentUrl);
          if (response.ok) resolved = await blobToBackupDataUrl(await response.blob());
        } catch (_) {}
      }
      const hasCloudPointer = Boolean(plan.storagePath || plan.driveFileId || plan.cloudFileId || plan.storageProvider || String(plan.driveUrl || '').startsWith('drive:'));
      if (!resolved && hasCloudPointer) {
        resolved = String(await loadFloorPlanImageFromCloud(projectId, plan).catch(() => '') || '');
      }
      if (!resolved && /^https?:\/\//i.test(currentUrl)) {
        try {
          const response = await fetch(currentUrl);
          if (response.ok) resolved = await blobToBackupDataUrl(await response.blob());
        } catch (_) {}
      }
      if ((currentUrl || hasCloudPointer) && !resolved.startsWith('data:image/')) {
        throw new Error(`Không thể đóng gói ảnh mặt bằng ${plan.floorName || plan.id} của dự án ${projectId}; từ chối tạo backup thiếu ảnh.`);
      }
      result.push({ ...plan, imageUrl: resolved || '' });
    }
    return result;
  };

  const collectProjectPhotoBackup = async (projectIds: string[]) => {
    const projectPhotos: Record<string, any[]> = {};
    const projectPhotoData: Record<string, Record<string, string>> = {};

    for (const projectId of projectIds) {
      if (FIREBASE_ONLY_RUNTIME) {
        const photoMeta = await refreshProjectPhotoMetadataFromCloud(projectId);
        if (!photoMeta.verified) {
          throw new Error(`Không xác minh được metadata ảnh Firestore của dự án ${projectId}; từ chối tạo backup có nguy cơ thiếu ảnh.`);
        }
      }
      const photos = await getProjectPhotosWithBinary(projectId, true);
      if (photos.length === 0) continue;

      const photoData: Record<string, string> = {};
      for (const photo of photos) {
        const dataUrl = photo.base64 || photo.localUri || photo.dataUrl || '';
        if (photo.id && dataUrl.startsWith('data:image/')) {
          photoData[photo.id] = dataUrl;
        }
      }

      // Keep photo metadata and binary payload separate. Storing Base64 inside both
      // `projectPhotos` and `projectPhotoData` multiplies JSON size/RAM usage and can
      // make Android exports appear as 0 KB when WebView runs out of memory.
      projectPhotos[projectId] = photos.map((photo) => {
        const { base64, localUri, dataUrl, ...metadataOnly } = photo as any;
        return metadataOnly;
      });
      if (Object.keys(photoData).length > 0) {
        projectPhotoData[projectId] = photoData;
      }
    }

    return { projectPhotos, projectPhotoData };
  };

  const buildSingleProjectBackupObject = async (includePhotoBinary = true) => {
    let photos: any[] = [];
    let photoData: Record<string, string> = {};
    if (includePhotoBinary) {
      const collected = await collectProjectPhotoBackup([activeProjectId]);
      photos = collected.projectPhotos[activeProjectId] || [];
      photoData = collected.projectPhotoData[activeProjectId] || {};
    } else {
      // Drive backup does not duplicate image Base64. Images are stored as separate
      // files in the primary Drive; JSON only keeps metadata + drive file references.
      const currentPhotos = await getProjectPhotos(activeProjectId, false);
      photos = currentPhotos.map((photo: any) => {
        const { base64, localUri, dataUrl, ...metadataOnly } = photo;
        return metadataOnly;
      });
    }

    const floorPlansForBackup = includePhotoBinary
      ? await hydrateFloorPlansForBackup(activeProjectId, floorPlans)
      : floorPlans.map((plan) => ({
          ...plan,
          imageUrl: plan.driveFileId
            ? `cloud-floorplan:drive:${activeProjectId}:${plan.driveFileId}`
            : (plan.storageProvider === 'firestore-fallback' || String(plan.cloudFileId || '').startsWith('firestore:'))
              ? `cloud-floorplan:firestore:${activeProjectId}:${plan.id}`
              : (String(plan.imageUrl || '').startsWith('data:image/') || String(plan.imageUrl || '').startsWith('blob:'))
                ? '[FLOOR_PLAN_IMAGE_BINARY_STORED_SEPARATELY]'
                : plan.imageUrl,
        }));

    return {
      schemaVersion: 3,
      backupType: 'single-project',
      project: {
        id: activeProjectId,
        name: projectName,
        contractorName,
        inspectorName,
        updatedAt: lastUpdatedAt,
      },
      data: {
        projectName,
        contractorName,
        inspectorName,
        materialNorms,
        inventory,
        workVolumes,
        floorPlans: floorPlansForBackup,
        defects,
        roomProgressList,
        checklist,
        crewRecords,
        teams,
        photos: photos.map((photo) => {
          const { base64, localUri, dataUrl, ...metadataOnly } = photo as any;
          return metadataOnly;
        }),
        tombstones: { ...localTombstonesRef.current },
        ...(includePhotoBinary ? { photoData } : {}),
        updatedAt: lastUpdatedAt,
      },
    };
  };

  const buildSingleProjectBackupJson = async () => JSON.stringify(await buildSingleProjectBackupObject(), null, 2);

  const buildPrimaryDriveBackupObject = async () => ({
    ...(await buildSingleProjectBackupObject(false)),
    backupType: 'primary-drive-project',
    primaryDriveOwnerEmail: PRIMARY_DRIVE_OWNER_EMAIL,
    imageStorage: 'google-drive-primary',
    generatedAt: Date.now(),
  });

  const buildAllProjectsBackupObject = async () => {
    const projectList = getProjectsList();
    const projectIds = projectList.length > 0 ? projectList.map((project) => project.id) : [activeProjectId || 'default'];

    if (FIREBASE_ONLY_RUNTIME) {
      // FIREBASE_ONLY_ALL_BACKUP_CLOUD_SOURCE: never build a DR backup from the
      // deprecated localforage business mirror. Active project uses live reconciled
      // React state; other projects are read from Firestore.
      const allData: Record<string, any> = {
        construction_projects_list: JSON.stringify(projectList),
        active_project_id: activeProjectId || projectIds[0] || 'default',
      };

      for (const projectId of projectIds) {
        const projectInfo = projectList.find((project) => project.id === projectId);
        let payload: any;
        if (projectId === activeProjectIdRef.current) {
          payload = {
            projectName, contractorName, inspectorName,
            materialNorms, inventory, workVolumes, floorPlans, defects,
            roomProgressList, checklist, crewRecords, teams, updatedAt: lastUpdatedAt,
          };
        } else {
          const cloudRecord = await fetchProjectFromCloud(projectId, { serverOnly: true });
          payload = cloudRecord ? getCloudPayload(cloudRecord) : null;
        }
        if (!payload) {
          throw new Error(`Không đọc được Firestore của dự án ${projectInfo?.name || projectId}; từ chối tạo backup toàn bộ không đầy đủ.`);
        }

        const backupFloorPlans = await hydrateFloorPlansForBackup(projectId, Array.isArray(payload.floorPlans) ? payload.floorPlans : []);
        allData[getKey('construction_project_name', projectId)] = payload.projectName || projectInfo?.name || projectId;
        allData[getKey('construction_contractor', projectId)] = payload.contractorName || '';
        allData[getKey('construction_inspector', projectId)] = payload.inspectorName || '';
        allData[getKey('construction_material_norms', projectId)] = JSON.stringify(payload.materialNorms || []);
        allData[getKey('construction_inventory', projectId)] = JSON.stringify(payload.inventory || []);
        allData[getKey('construction_work_volumes', projectId)] = JSON.stringify(payload.workVolumes || []);
        allData[getKey('construction_floor_plans', projectId)] = JSON.stringify(backupFloorPlans);
        allData[getKey('construction_defects', projectId)] = JSON.stringify(payload.defects || []);
        allData[getKey('construction_room_progress', projectId)] = JSON.stringify(payload.roomProgressList || []);
        allData[getKey('construction_checklist', projectId)] = JSON.stringify(payload.checklist || []);
        allData[getKey('construction_crew_records', projectId)] = JSON.stringify(payload.crewRecords || []);
        allData[getKey('construction_teams', projectId)] = JSON.stringify(payload.teams || []);
        allData[getKey('construction_updated_at', projectId)] = String(payload.updatedAt || projectInfo?.updatedAt || Date.now());
      }

      const { projectPhotos, projectPhotoData } = await collectProjectPhotoBackup(projectIds);
      if (Object.keys(projectPhotos).length > 0) {
        allData.projectPhotos = projectPhotos;
        allData.projectPhotoData = projectPhotoData;
      }
      return allData;
    }

    const allData: Record<string, any> = {};
    const storageData = await getAllStorageData();
    for (const key in storageData) {
      if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
        allData[key] = storageData[key] || '';
      }
    }

    const { projectPhotos, projectPhotoData } = await collectProjectPhotoBackup(projectIds);
    if (Object.keys(projectPhotos).length > 0) {
      allData.projectPhotos = projectPhotos;
      allData.projectPhotoData = projectPhotoData;
    }
    return allData;
  };

  const buildCurrentProjectVersionBackupObject = async (): Promise<Record<string, any>> => {
    // Firebase-only version history is a disaster-recovery snapshot of the current
    // canonical app state, not a dump of the deprecated IndexedDB business mirror.
    // This keeps local backup useful without turning it into a second runtime database.
    if (FIREBASE_ONLY_RUNTIME) {
      return await buildSingleProjectBackupObject(true) as Record<string, any>;
    }

    const currentId = activeProjectIdRef.current || activeProjectId || 'default';
    const suffix = currentId === 'default' ? '' : `_${currentId}`;
    const storageData = await getAllStorageData();
    const scoped: Record<string, any> = {};

    for (const [key, value] of Object.entries(storageData)) {
      if (!key) continue;
      const isGlobalProjectIndex = key === 'construction_projects';
      const isCurrentProjectKey = currentId === 'default'
        ? key.startsWith('construction_') && !/^construction_.+_[^_]+$/.test(key)
        : key.startsWith('construction_') && key.endsWith(suffix);
      if (isGlobalProjectIndex || isCurrentProjectKey) {
        scoped[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    const { projectPhotos, projectPhotoData } = await collectProjectPhotoBackup([currentId]);
    if (Object.keys(projectPhotos).length > 0) scoped.projectPhotos = JSON.stringify(projectPhotos);
    if (Object.keys(projectPhotoData).length > 0) scoped.projectPhotoData = JSON.stringify(projectPhotoData);
    return scoped;
  };

  const isLargeConstructionStorageKey = (key: string) => [
    'material_norms',
    'inventory',
    'work_volumes',
    'floor_plans',
    'defects',
    'room_progress',
    'checklist',
    'crew_records',
    'teams',
    'photos'
  ].some(x => key.includes(`construction_${x}`));

  const restorePhotoBackupBundle = async (backupData: any) => {
    const rawProjectPhotos = backupData?.projectPhotos;
    if (!rawProjectPhotos) return;
    const projectPhotos = typeof rawProjectPhotos === 'string' ? JSON.parse(rawProjectPhotos) : rawProjectPhotos;
    if (!projectPhotos || typeof projectPhotos !== 'object') return;

    const rawProjectPhotoData = backupData?.projectPhotoData || {};
    const projectPhotoData = typeof rawProjectPhotoData === 'string' ? JSON.parse(rawProjectPhotoData) : rawProjectPhotoData;
    for (const projectId of Object.keys(projectPhotos)) {
      const photos = projectPhotos[projectId];
      if (Array.isArray(photos)) {
        await restorePhotosFromBackup(projectId, photos, projectPhotoData[projectId] || {});
      }
    }
  };

  const restoreAllProjectsBackupObject = async (backupData: any) => {
    if (FIREBASE_ONLY_RUNTIME) {
      throw new Error('Legacy IndexedDB restore bị khóa trong Firebase-only. Hãy khôi phục qua Firestore/Storage.');
    }
    if (!backupData || typeof backupData !== 'object') return;
    await restorePhotoBackupBundle(backupData);

    for (const key in backupData) {
      if (key === 'projectPhotos' || key === 'projectPhotoData') continue;
      const val = backupData[key];

      if (key.startsWith('photo_blob_') || key.startsWith('photo_thumb_')) {
        await setAsyncItem(key, val);
        continue;
      }

      if (key.startsWith('construction_') || key.startsWith('active_project_id')) {
        if (isLargeConstructionStorageKey(key)) {
          await setAsyncItem(key, typeof val === 'string' ? JSON.parse(val) : val);
        } else {
          safeSetLocalStorageItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        }
      }
    }
  };

  const buildCloudProjectPayload = () => ({
    projectName,
    contractorName,
    inspectorName,
    materialNorms,
    inventory,
    workVolumes,
    floorPlans,
    defects,
    roomProgressList,
    checklist,
    crewRecords,
    teams,
    updatedAt: lastUpdatedAt || Date.now(),
  });

  const switchingProjectRef = useRef<boolean>(false);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  const [photoCloudStatus, setPhotoCloudStatus] = useState<PhotoCloudSyncStatus>({ phase: 'idle', pending: 0 });
  const photoSyncTimerRef = useRef<number | null>(null);
  const photoOutboxRetryTimerRef = useRef<number | null>(null);
  const photoOutboxRetryAttemptRef = useRef(0);
  const startupPhotoSyncKeyRef = useRef<string>('');
  const floorPlanImageSyncInFlightRef = useRef<Set<string>>(new Set());
  const floorPlanImageHydrateInFlightRef = useRef<Set<string>>(new Set());
  const floorPlanImageSyncPendingRef = useRef<Set<string>>(new Set());
  const floorPlanImageHydratePendingRef = useRef<Set<string>>(new Set());
  const floorPlanImageSyncRetryCountRef = useRef<Map<string, number>>(new Map());
  const floorPlanImageHydrateRetryCountRef = useRef<Map<string, number>>(new Map());
  const floorPlanImageRetryTimersRef = useRef<Set<number>>(new Set());
  const [floorPlanImageSyncRetryTick, setFloorPlanImageSyncRetryTick] = useState(0);
  const [floorPlanImageHydrateRetryTick, setFloorPlanImageHydrateRetryTick] = useState(0);
  const [activeFloorViewId, setActiveFloorViewId] = useState<string>('');

  const [cloudInitialReady, setCloudInitialReady] = useState<boolean>(false);
  const receivedInitialSubcollectionsRef = useRef<Set<string>>(new Set());
  const [dataCloudStatus, setDataCloudStatus] = useState<{ phase: 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'; lastSyncAt?: number; message?: string }>({ phase: 'idle' });
  // Firestore SDK owns offline pending writes. This counter is UI-only telemetry; it is
  // never used as a second persistence queue and is decremented only when the SDK's
  // commit Promises settle after reconnect/server validation.
  const [firestorePendingWriteCount, setFirestorePendingWriteCount] = useState(0);
  const firestorePendingWriteCountRef = useRef(0);
  const adjustFirestorePendingWriteCount = (delta: number) => {
    firestorePendingWriteCountRef.current = Math.max(0, firestorePendingWriteCountRef.current + delta);
    setFirestorePendingWriteCount(firestorePendingWriteCountRef.current);
  };
  const syncDiagnosticPendingData = useMemo(() => {
    const synced = lastSyncedPresentRef.current;
    if (!cloudInitialReady || !synced) return 0;
    let pending = 0;
    for (const key of REALTIME_STATE_KEYS as (keyof AppData)[]) {
      const currentList = (present[key] || []) as any[];
      const syncedList = (synced[key] || []) as any[];
      const syncedById = new Map<string, any>();
      syncedList.forEach((item) => { if (item?.id) syncedById.set(String(item.id), item); });
      const currentIds = new Set<string>();
      currentList.forEach((item) => {
        if (!item?.id) return;
        const id = String(item.id);
        currentIds.add(id);
        const previous = syncedById.get(id);
        if (!previous || Number(previous.updatedAt || 0) !== Number(item.updatedAt || 0)) pending++;
      });
      syncedList.forEach((item) => {
        if (item?.id && !currentIds.has(String(item.id))) pending++;
      });
    }
    return pending;
  }, [present, cloudInitialReady, dataCloudStatus.phase]);
  const [cloudDataRetryTick, setCloudDataRetryTick] = useState(0);
  const cloudDataRetryAttemptRef = useRef(0);
  const cloudDataRetryTimerRef = useRef<number | null>(null);
  const priorityCloudSyncRevisionRef = useRef(0);
  const flushedPriorityCloudSyncRevisionRef = useRef(0);
  const [cloudUserKey, setCloudUserKey] = useState<string>('');

  // V6.2.22: VIEWER renders Firestore truth only, but its older IndexedDB cache is not
  // destroyed. If the same account later gains edit rights, reconcile any genuinely
  // newer/local-only records once and let the normal diff uploader publish them.
  useEffect(() => {
    // Firebase-only never auto-promotes legacy IndexedDB business rows back into live
    // state. Legacy data is migration input only and must pass explicit online Import/
    // validation; otherwise a stale browser could silently resurrect deleted records.
    if (FIREBASE_ONLY_RUNTIME) return;
    if (!isHydrated || isLoadingProject || isRestoring || !isProjectRoleResolved || !cloudInitialReady || !canEditProjectData(currentUserRole)) return;
    const recoveryKey = `${activeProjectId}:${cloudUserKey}:${currentUserRole}`;
    if (!cloudUserKey || editorLocalRecoveryKeyRef.current === recoveryKey) return;
    editorLocalRecoveryKeyRef.current = recoveryKey;
    let cancelled = false;

    const recover = async () => {
      const cachedByKey: Partial<Record<keyof AppData, any[]>> = {};
      for (const key of Object.keys(localCollectionStorageKey) as (keyof AppData)[]) {
        cachedByKey[key] = await getAsyncItem<any[]>(getKey(localCollectionStorageKey[key], activeProjectId), []);
      }
      if (cancelled || activeProjectIdRef.current !== activeProjectId) return;

      setPresent((prev) => {
        let next = prev;
        const recoveredKeys = new Set<keyof AppData>();
        for (const key of Object.keys(localCollectionStorageKey) as (keyof AppData)[]) {
          const cached = Array.isArray(cachedByKey[key]) ? cachedByKey[key]! : [];
          if (cached.length === 0) continue;
          const currentList = (next[key] || []) as any[];
          const currentMap = new Map<string, any>();
          currentList.forEach((item) => { if (item?.id) currentMap.set(String(item.id), item); });
          let merged = currentList;
          let changed = false;

          for (const localItem of cached) {
            if (!localItem?.id) continue;
            const id = String(localItem.id);
            const localTime = parseLegacyTimestamp(localItem.updatedAt, 0);
            const tombTime = Number(localTombstonesRef.current[`${String(key)}_${id}`] || 0);
            if (tombTime > 0 && tombTime >= localTime) continue;
            const current = currentMap.get(id);
            const currentTime = parseLegacyTimestamp(current?.updatedAt, 0);
            if (!current || localTime > currentTime) {
              if (!changed) merged = [...currentList];
              const idx = merged.findIndex((item: any) => String(item?.id || '') === id);
              if (idx >= 0) merged[idx] = localItem;
              else merged.push(localItem);
              currentMap.set(id, localItem);
              changed = true;
            }
          }

          if (changed) {
            if (next === prev) next = { ...prev };
            (next as any)[key] = key === 'floorPlans'
              ? [...merged].sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0))
              : merged;
            recoveredKeys.add(key);
          }
        }

        if (recoveredKeys.size > 0) {
          window.setTimeout(() => {
            recoveredKeys.forEach((key) => markLocalCollectionDirty(key));
            if (recoveredKeys.has('defects') || recoveredKeys.has('crewRecords')) priorityCloudSyncRevisionRef.current += 1;
            hasUserEditedSinceHydrateRef.current = true;
            hasUnsavedAllBackupChangesRef.current = true;
            setLastUpdatedAt(Date.now());
          }, 0);
        }
        return next;
      });
    };

    void recover().catch((err) => console.warn('Editor local recovery warning:', err));
    return () => { cancelled = true; };
  }, [activeProjectId, cloudUserKey, cloudInitialReady, currentUserRole, isProjectRoleResolved, isHydrated, isLoadingProject, isRestoring]);

  useEffect(() => {
    let disposed = false;
    let unsubscribeCloud: (() => void) | null = null;

    const persistTrashLocal = async (items: TrashOperation[]) => {
      trashOperationsRef.current = items;
      setTrashOperations(items);
      await setAsyncItem(getKey('construction_trash', activeProjectId), items).catch((err) =>
        console.warn('Trash local cache save warning:', err)
      );
    };

    getAsyncItem<TrashOperation[]>(getKey('construction_trash', activeProjectId), []).then((localItems) => {
      if (disposed) return;
      const now = Date.now();
      const valid = (Array.isArray(localItems) ? localItems : [])
        .filter((item) => item?.id && Number(item.expiresAt || 0) > now)
        .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
      trashOperationsRef.current = valid;
      setTrashOperations(valid);
    }).catch(() => {});

    unsubscribeCloud = subscribeProjectTrash(activeProjectId, (cloudItems) => {
      if (disposed) return;
      const now = Date.now();
      const valid = cloudItems.filter((item) => Number(item.expiresAt || 0) > now);
      const expired = cloudItems.filter((item) => Number(item.expiresAt || 0) > 0 && Number(item.expiresAt || 0) <= now);
      void persistTrashLocal(valid);

      // Purge only when an ADMIN is online. This avoids a timer/Cloud Function cost while
      // still enforcing the selected retention period in normal app use. Floor-plan
      // binaries are deleted at this point; ordinary business tombstones stay tiny to
      // protect against stale offline resurrection.
      if (isProjectRoleResolved && currentUserRole === 'ADMIN' && expired.length > 0) {
        expired.forEach((operation) => {
          void (async () => {
            for (const item of operation.deletedItems || []) {
              if (item.collection === 'floorPlans') {
                await deleteFloorPlanImageFromCloud(operation.projectId, item.snapshot as FloorPlan).catch(() => {});
              } else if (item.collection === 'defects') {
                await deleteEntityPhotos(operation.projectId, 'defect', item.entityId).catch(() => {});
              } else if (item.collection === 'crewRecords') {
                await deleteEntityPhotos(operation.projectId, 'crewRecord', item.entityId).catch(() => {});
              }
            }
            await deleteTrashOperationFromCloud(operation.projectId, operation.id).catch(() => {});
          })();
        });
      }
    });

    return () => {
      disposed = true;
      unsubscribeCloud?.();
    };
  }, [activeProjectId, cloudUserKey, currentUserRole, isProjectRoleResolved]);
  // Chat must only list projects currently authorized by Firestore. Local recovery
  // projects remain available in Project Manager, but are never treated as chat access.
  const [authorizedChatProjects, setAuthorizedChatProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudBootstrapVersion, setCloudBootstrapVersion] = useState<number>(0);
  const cloudBootstrapAttemptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const retryWhenOnline = () => {
      cloudDataRetryAttemptRef.current = 0;
      if (cloudDataRetryTimerRef.current !== null) {
        window.clearTimeout(cloudDataRetryTimerRef.current);
        cloudDataRetryTimerRef.current = null;
      }
      setCloudDataRetryTick((tick) => tick + 1);
    };
    window.addEventListener('online', retryWhenOnline);
    return () => {
      window.removeEventListener('online', retryWhenOnline);
      if (cloudDataRetryTimerRef.current !== null) {
        window.clearTimeout(cloudDataRetryTimerRef.current);
        cloudDataRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handlePhotoAttachmentsChanged = (event: Event) => {
      const eventDetail = (event as CustomEvent)?.detail || {};
      const source = eventDetail?.source;
      if (source === 'cloud') return;

      hasUserEditedSinceHydrateRef.current = true;
      hasUnsavedAllBackupChangesRef.current = true;
      const now = Date.now();
      setLastUpdatedAt(now);
      localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
      const photoArea = eventDetail.entityType === 'defect' ? 'Defect' : eventDetail.entityType === 'crewRecord' ? 'Báo cáo quân số' : 'Hình ảnh';
      const photoVerb = eventDetail.operation === 'add' ? `Thêm ${Number(eventDetail.count || 1)} ảnh`
        : eventDetail.operation === 'delete' ? 'Xóa ảnh'
        : eventDetail.operation === 'edit' ? 'Chỉnh sửa ảnh'
        : 'Thay đổi ảnh';
      const photoTarget = eventDetail.entityId ? ` · bản ghi ${String(eventDetail.entityId)}` : '';
      saveProjectAuditLog(activeProjectIdRef.current, {
        timestamp: now,
        action: 'PHOTO_CHANGE',
        details: `${photoVerb} ${photoArea}${photoTarget}`,
        actorRole: currentUserRole,
      }).catch((err) => console.warn('Photo audit log warning:', err));

      const photoUser = getCurrentRealFirebaseUser();
      if (!photoUser || photoUser.isAnonymous || switchingProjectRef.current || !navigator.onLine) return;
      if (photoSyncTimerRef.current) window.clearTimeout(photoSyncTimerRef.current);
      if (photoOutboxRetryTimerRef.current) window.clearTimeout(photoOutboxRetryTimerRef.current);
      photoOutboxRetryAttemptRef.current = 0;
      const projectId = activeProjectIdRef.current;
      const mobilePhotoSyncDelay = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 250 : 150;
      const drainPhotoOutbox = async () => {
        if (!navigator.onLine || activeProjectIdRef.current !== projectId || switchingProjectRef.current) return;
        setPhotoCloudStatus({ phase: 'syncing' });
        try {
          const result = await syncProjectPhotosToCloud(projectId);
          const failed = Number(result.failed || 0);
          if (failed > 0) {
            const attempt = ++photoOutboxRetryAttemptRef.current;
            setPhotoCloudStatus({ phase: 'error', pending: failed, message: `${failed} ảnh chưa lên Cloud/R2; đang tự retry.${result.lastError ? ` Lỗi gần nhất: ${result.lastError}` : ''}` });
            const delay = Math.min(30000, 750 * Math.pow(2, Math.min(attempt - 1, 6)));
            photoOutboxRetryTimerRef.current = window.setTimeout(() => void drainPhotoOutbox(), delay);
          } else {
            photoOutboxRetryAttemptRef.current = 0;
            setPhotoCloudStatus({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });
          }
        } catch (err: any) {
          const attempt = ++photoOutboxRetryAttemptRef.current;
          setPhotoCloudStatus({ phase: 'error', message: err?.message || String(err) });
          const delay = Math.min(30000, 750 * Math.pow(2, Math.min(attempt - 1, 6)));
          photoOutboxRetryTimerRef.current = window.setTimeout(() => void drainPhotoOutbox(), delay);
        }
      };
      photoSyncTimerRef.current = window.setTimeout(() => void drainPhotoOutbox(), mobilePhotoSyncDelay);
    };
    window.addEventListener('qlct-photo-attachments-changed', handlePhotoAttachmentsChanged);
    return () => {
      window.removeEventListener('qlct-photo-attachments-changed', handlePhotoAttachmentsChanged);
      if (photoSyncTimerRef.current) window.clearTimeout(photoSyncTimerRef.current);
      if (photoOutboxRetryTimerRef.current) window.clearTimeout(photoOutboxRetryTimerRef.current);
    };
  }, [activeProjectId]);

  // V6.2.25: retry locally pending photos once whenever an authenticated project is
  // opened, even if the user never opens the Crew/Defect/Chat tab. This closes the
  // common mobile gap where a photo was stored in IndexedDB and the app was closed
  // before the old debounced uploader had a chance to run.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed || switchingProjectRef.current) return;
    const projectId = activeProjectId;
    const syncKey = `${projectId}:${cloudUserKey}`;
    if (!projectId || startupPhotoSyncKeyRef.current === syncKey) return;
    startupPhotoSyncKeyRef.current = syncKey;
    let cancelled = false;
    let retryTimer: number | null = null;
    const run = async (attempt: number) => {
      try {
        const result = await syncProjectPhotosToCloud(projectId);
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        const failed = Number(result.failed || 0);
        if (failed > 0) {
          setPhotoCloudStatus({ phase: 'error', pending: failed, message: `${failed} ảnh đang chờ Cloud/R2; ứng dụng sẽ tự retry.${result.lastError ? ` Lỗi gần nhất: ${result.lastError}` : ''}` });
          if (attempt < 4) {
            const delay = Math.min(10000, 1000 * Math.pow(2, attempt - 1));
            retryTimer = window.setTimeout(() => void run(attempt + 1), delay);
          } else {
            startupPhotoSyncKeyRef.current = '';
          }
        } else {
          setPhotoCloudStatus({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });
        }
      } catch (err: any) {
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        setPhotoCloudStatus({ phase: 'error', message: err?.message || String(err) });
        if (attempt < 4) {
          const delay = Math.min(10000, 1000 * Math.pow(2, attempt - 1));
          retryTimer = window.setTimeout(() => void run(attempt + 1), delay);
        } else {
          startupPhotoSyncKeyRef.current = '';
        }
      }
    };
    const timer = window.setTimeout(() => void run(1), 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, isOnline, projectRoleSource, projectRoleAllowed]);

  useEffect(() => {
    const retryWhenOnline = () => {
      startupPhotoSyncKeyRef.current = '';
      const photoProjectId = activeProjectIdRef.current;
      if (photoProjectId && getCurrentRealFirebaseUser()) {
        setPhotoCloudStatus({ phase: 'syncing' });
        void syncProjectPhotosToCloud(photoProjectId)
          .then((result) => {
            const failed = Number(result.failed || 0);
            if (failed > 0) setPhotoCloudStatus({ phase: 'error', pending: failed, message: `${failed} ảnh vẫn đang chờ Cloud/R2.${result.lastError ? ` Lỗi gần nhất: ${result.lastError}` : ''}` });
            else setPhotoCloudStatus({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });
          })
          .catch((err) => setPhotoCloudStatus({ phase: 'error', message: err?.message || String(err) }));
      }
      floorPlanImageSyncRetryCountRef.current.clear();
      floorPlanImageHydrateRetryCountRef.current.clear();
      setFloorPlanImageSyncRetryTick((tick) => tick + 1);
      setFloorPlanImageHydrateRetryTick((tick) => tick + 1);
    };
    window.addEventListener('online', retryWhenOnline);
    return () => {
      window.removeEventListener('online', retryWhenOnline);
      for (const timerId of floorPlanImageRetryTimersRef.current) window.clearTimeout(timerId);
      floorPlanImageRetryTimersRef.current.clear();
    };
  }, []);

  // Floor-plan images use the same multi-device principle as Defect/Crew photos:
  // metadata stays in Firestore, while the binary goes to Firebase Storage.
  // Legacy Drive/Firestore chunks remain read-only migration fallbacks; new binaries never write to Drive.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed || switchingProjectRef.current) return;
    const projectId = activeProjectId;
    let cancelled = false;

    const candidates = floorPlans.filter((plan) => floorPlanNeedsCloudUpload(plan));
    if (candidates.length === 0) return;

    const run = async () => {
      // Sequential upload avoids large simultaneous Base64 copies on Android.
      for (const plan of candidates) {
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        if (floorPlanImageSyncInFlightRef.current.has(plan.id)) {
          // A newer replacement arrived while this floor was already uploading. Mark
          // it pending so the latest revision is retried immediately after in-flight
          // work releases the floor ID instead of being silently skipped forever.
          floorPlanImageSyncPendingRef.current.add(plan.id);
          continue;
        }
        floorPlanImageSyncInFlightRef.current.add(plan.id);
        const uploadRetryKey = `${projectId}:${plan.id}:${Number(plan.imageRevision || plan.updatedAt || 0)}`;
        try {
          const metadata = await syncFloorPlanImageToCloud(projectId, plan);
          if (!metadata || cancelled || activeProjectIdRef.current !== projectId) continue;
          floorPlanImageSyncRetryCountRef.current.delete(uploadRetryKey);
          setPresent((prev) => {
            const current = prev.floorPlans.find((item) => item.id === plan.id);
            if (!current) return prev;
            const expectedRevision = Number(plan.imageRevision || plan.updatedAt || 0);
            const currentRevision = Number(current.imageRevision || current.updatedAt || 0);
            // User selected a newer replacement image while the older upload was running.
            if (currentRevision > expectedRevision) return prev;
            const nextPlans = prev.floorPlans.map((item) => item.id === plan.id ? {
              ...item,
              ...metadata,
              // Keep the local binary visible on the uploader; other devices lazily hydrate it.
              imageUrl: isDisplayableFloorPlanUrl(item.imageUrl) ? item.imageUrl : (metadata.imageUrl || item.imageUrl),
            } : item);
            if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
              setAsyncItem(getKey('construction_floor_plans', projectId), nextPlans).catch((err) => console.warn('Legacy floor-plan sync cache warning:', err));
            }
            return { ...prev, floorPlans: nextPlans };
          });
        } catch (err) {
          console.warn('[Floor Plan Image] upload warning:', plan.floorName, err);
          const attempt = (floorPlanImageSyncRetryCountRef.current.get(uploadRetryKey) || 0) + 1;
          floorPlanImageSyncRetryCountRef.current.set(uploadRetryKey, attempt);
          if (attempt <= 4 && activeProjectIdRef.current === projectId) {
            const delay = Math.min(12000, 1500 * Math.pow(2, attempt - 1));
            const timerId = window.setTimeout(() => {
              floorPlanImageRetryTimersRef.current.delete(timerId);
              if (activeProjectIdRef.current === projectId) setFloorPlanImageSyncRetryTick((tick) => tick + 1);
            }, delay);
            floorPlanImageRetryTimersRef.current.add(timerId);
          }
        } finally {
          floorPlanImageSyncInFlightRef.current.delete(plan.id);
          if (floorPlanImageSyncPendingRef.current.delete(plan.id) && activeProjectIdRef.current === projectId) {
            setFloorPlanImageSyncRetryTick((tick) => tick + 1);
          }
        }
      }
    };

    const timer = window.setTimeout(run, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [floorPlans, activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, floorPlanImageSyncRetryTick, isOnline, projectRoleSource, projectRoleAllowed]);

  // Hydrate cloud-backed floor-plan binaries on another phone/PC. Run one-by-one so
  // opening a project does not allocate every large plan image in RAM at the same time.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed || switchingProjectRef.current) return;
    const projectId = activeProjectId;
    let cancelled = false;
    // V6.2.22: hydrate only the floor currently being viewed. Previously every
    // cloud-backed drawing was converted to a data URL at project startup, which could
    // retain many large images in phone RAM. Export resolves its selected floor images
    // on demand, so normal navigation stays lightweight.
    if (activeTab !== 'floorplan') return;
    const preferredFloorId = activeFloorViewId || floorPlans[0]?.id || '';
    const selectedPlan = floorPlans.find((plan) => plan.id === preferredFloorId);
    const candidates = selectedPlan && !isDisplayableFloorPlanUrl(selectedPlan.imageUrl) &&
      Boolean(selectedPlan.driveFileId || selectedPlan.cloudFileId || selectedPlan.storageProvider)
      ? [selectedPlan]
      : [];
    if (candidates.length === 0) return;

    const run = async () => {
      for (const plan of candidates) {
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        if (floorPlanImageHydrateInFlightRef.current.has(plan.id)) {
          // The cloud marker changed while an older download was in flight. Queue one
          // retry so the newest revision is fetched as soon as the old request ends.
          floorPlanImageHydratePendingRef.current.add(plan.id);
          continue;
        }
        floorPlanImageHydrateInFlightRef.current.add(plan.id);
        const expectedCloudIdentity = [
          plan.storageProvider || '',
          plan.driveFileId || '',
          plan.cloudFileId || '',
          Number(plan.imageCloudRevision || plan.imageRevision || 0),
        ].join('|');
        const hydrateRetryKey = `${projectId}:${plan.id}:${expectedCloudIdentity}`;
        try {
          const imageUrl = await loadFloorPlanImageFromCloud(projectId, plan);
          if (cancelled || activeProjectIdRef.current !== projectId) continue;
          if (!imageUrl) throw new Error('Cloud floor-plan image is not available yet.');
          floorPlanImageHydrateRetryCountRef.current.delete(hydrateRetryKey);
          setPresent((prev) => {
            const current = prev.floorPlans.find((item) => item.id === plan.id);
            if (!current || isDisplayableFloorPlanUrl(current.imageUrl)) return prev;

            const currentCloudIdentity = [
              current.storageProvider || '',
              current.driveFileId || '',
              current.cloudFileId || '',
              Number(current.imageCloudRevision || current.imageRevision || 0),
            ].join('|');

            // A replacement may have reached Firestore while an older cloud image was
            // still downloading. Never install that stale bitmap over the new marker.
            // Leave the current marker untouched so the retry pass hydrates the latest
            // revision instead of getting stuck forever on the old drawing.
            if (currentCloudIdentity !== expectedCloudIdentity) {
              floorPlanImageHydratePendingRef.current.add(plan.id);
              return prev;
            }

            const nextPlans = prev.floorPlans.map((item) => item.id === plan.id ? { ...item, imageUrl } : item);
            if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
              setAsyncItem(getKey('construction_floor_plans', projectId), nextPlans).catch((err) => console.warn('Legacy floor-plan hydrate cache warning:', err));
            }
            return { ...prev, floorPlans: nextPlans };
          });
        } catch (err) {
          console.warn('[Floor Plan Image] hydrate warning:', plan.floorName, err);
          const attempt = (floorPlanImageHydrateRetryCountRef.current.get(hydrateRetryKey) || 0) + 1;
          floorPlanImageHydrateRetryCountRef.current.set(hydrateRetryKey, attempt);
          if (attempt <= 4 && activeProjectIdRef.current === projectId) {
            const delay = Math.min(12000, 1200 * Math.pow(2, attempt - 1));
            const timerId = window.setTimeout(() => {
              floorPlanImageRetryTimersRef.current.delete(timerId);
              if (activeProjectIdRef.current === projectId) setFloorPlanImageHydrateRetryTick((tick) => tick + 1);
            }, delay);
            floorPlanImageRetryTimersRef.current.add(timerId);
          }
        } finally {
          floorPlanImageHydrateInFlightRef.current.delete(plan.id);
          if (floorPlanImageHydratePendingRef.current.delete(plan.id) && activeProjectIdRef.current === projectId) {
            setFloorPlanImageHydrateRetryTick((tick) => tick + 1);
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
    };
    const timer = window.setTimeout(run, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [floorPlans, activeProjectId, activeTab, activeFloorViewId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, floorPlanImageHydrateRetryTick, isOnline, projectRoleSource, projectRoleAllowed]);

  useEffect(() => {
    const refreshCloudUser = () => {
      const user = getCurrentRealFirebaseUser();
      setCloudUserKey(user ? `${user.uid}:${user.email || ''}` : '');
    };
    refreshCloudUser();
    return onAuthUserChanged(refreshCloudUser);
  }, []);

  useEffect(() => {
    if (!isOnline) {
      const identity = getCurrentRealFirebaseUser() || getRememberedVerifiedAuthIdentity();
      const cachedProjects = identity
        ? getProjectsList().filter((project) => getCachedVerifiedProjectRole(project.id, identity)?.allowed === true)
        : [];
      setAuthorizedChatProjects(cachedProjects.map((project) => ({ id: project.id, name: project.name })));
      return;
    }
    if (!cloudUserKey) {
      setAuthorizedChatProjects([]);
      return;
    }

    // Firestore/invitations are the source of truth for the cross-device project index.
    // construction_projects_list remains only a local cache for fast/offline startup.
    // Proactively consume/repair pending invitations when Auth is restored so Chat and
    // the global project cache do not depend on the Project Manager modal being opened.
    refreshCurrentUserProjectDiscovery().catch((err) =>
      console.warn('Global project discovery refresh warning:', err)
    );

    let firstCloudEmission = true;
    const unsubscribe = subscribeCurrentUserProjectsRealtime((remoteProjects) => {
      setAuthorizedChatProjects(remoteProjects.map((project) => ({ id: project.id, name: project.name })));
      const localProjects = getProjectsList();
      const localById = new Map(localProjects.map((p) => [p.id, p]));
      const cloudIds = new Set(remoteProjects.map((p) => p.id));

      // Keep cloud-authorized projects plus local-only cached projects that have never been cloud-synced.
      // We never generate a new projectId from a cloud login, preventing duplicate projects on a second device.
      const cloudBacked: ProjectInfo[] = remoteProjects.map((remoteProject) => {
        const cached = localById.get(remoteProject.id);
        return {
          id: remoteProject.id,
          name: remoteProject.name || cached?.name || remoteProject.id,
          // Cloud metadata is the only source of truth for creation time.
          // Never substitute cached.createdAt, updatedAt or Date.now().
          createdAt: Number(remoteProject.createdAt || 0),
          createdAtSource: remoteProject.createdAt ? 'cloud' : 'migrating',
          updatedAt: Math.max(Number(cached?.updatedAt || 0), Number(remoteProject.updatedAt || 0)),
          canonicalProjectId: remoteProject.canonicalProjectId,
          aliases: remoteProject.aliases,
        };
      });

      // Cloud remains authoritative for synced projects, but never silently discard
      // a legacy local project that still has data unless it was explicitly deleted.
      // Such a project stays visible on this device as a recovery candidate and can be
      // re-linked to Cloud with the exact same projectId from Project Manager.
      let deletedProjectIds = new Set<string>();
      try {
        const rawDeleted = JSON.parse(localStorage.getItem('construction_deleted_projects') || '[]');
        if (Array.isArray(rawDeleted)) {
          deletedProjectIds = new Set(rawDeleted.filter((x: any) => x?.deleted).map((x: any) => String(x.projectId || '')));
        }
      } catch (_) {}
      const recoverableLocal = localProjects.filter((p) =>
        p.id !== 'default' &&
        !cloudIds.has(p.id) &&
        !deletedProjectIds.has(p.id) &&
        Number(p.updatedAt || 0) > 0 &&
        p.createdAtSource !== 'cloud'
      );
      const nextCache = [
        ...cloudBacked,
        ...recoverableLocal
          .filter((p) => !cloudBacked.some((c) => c.id === p.id))
          .map((p) => ({ ...p, createdAtSource: 'local' as const })),
      ];
      saveProjectsList(nextCache);

      const currentActive = getActiveProjectId();
      const currentIsAuthorized = remoteProjects.some((project) => project.id === currentActive);
      const canonicalTargetForActive = remoteProjects.find((project) =>
        Array.isArray(project.aliases) && project.aliases.includes(currentActive)
      )?.id;

      // If an ADMIN explicitly merged the active projectId into a canonical project,
      // switch to that exact ID before applying the generic "first accessible project"
      // fallback. Never do this after the user has edited unsaved local data.
      const shouldFollowCanonicalRedirect = firstCloudEmission
        && Boolean(canonicalTargetForActive)
        && canonicalTargetForActive !== currentActive
        && !hasUserEditedSinceHydrateRef.current;

      const shouldAutoSwitch = firstCloudEmission
        && !shouldFollowCanonicalRedirect
        && !currentIsAuthorized
        && !hasUserEditedSinceHydrateRef.current
        && remoteProjects[0]?.id
        && (currentActive === 'default' || localProjects.length <= 1);
      firstCloudEmission = false;

      if (shouldFollowCanonicalRedirect && canonicalTargetForActive) {
        void switchProject(canonicalTargetForActive).catch((err) =>
          console.warn('Canonical project switch warning:', err)
        );
        return;
      }

      if (shouldAutoSwitch) {
        void switchProject(remoteProjects[0].id).catch((err) =>
          console.warn('Authorized project auto-switch warning:', err)
        );
      }
    });

    return unsubscribe;
  }, [cloudUserKey, isOnline]);

  const [autosaveVersions, setAutosaveVersions] = useState<BackupVersion[]>([]);

  // Load stored ALL file handle on mount
  useEffect(() => {
    const loadStoredAllHandle = async () => {
      try {
        if (
          isAndroidAutoSaveAvailable()
          && hasAndroidAutoSaveFolder()
          && localStorage.getItem(ANDROID_ALL_AUTOSAVE_ENABLED_KEY) === 'true'
        ) {
          const folderName = getAndroidAutoSaveFolderName();
          const name = folderName ? `${folderName}/${getAllAutoSaveFileName()}` : getAllAutoSaveFileName();
          setLocalAllFileHandle(makeAndroidAutoSaveHandle('ALL', name));
          setLocalAllFileName(name);
          setLocalAllSyncPermissionNeeded(false);
          setLocalAllSyncStatus('synced');
          return;
        }
        if (window.self !== window.top) return;
        const handle = await getFileHandle('ALL');
        if (handle) {
          setLocalAllFileHandle(handle);
          setLocalAllFileName(handle.name || '[Toan_Bo_Du_An]_Backup.json');
          const options = { mode: 'readwrite' as const };
          if ((await handle.queryPermission(options)) === 'granted') {
            setLocalAllSyncPermissionNeeded(false);
            setLocalAllSyncStatus('synced');
            try {
              const file = await handle.getFile();
              const text = await file.text();
              if (text) {
                lastSavedLocalAllSnapshotRef.current = text;
                try {
                  const fileData = JSON.parse(text);
                  let maxFileUpdatedAt = file.lastModified || 0;
                  for (const k in fileData) {
                    if (k.startsWith('construction_updated_at')) {
                      const val = parseInt(fileData[k], 10);
                      if (val > maxFileUpdatedAt) maxFileUpdatedAt = val;
                    }
                  }
                  let maxLocalUpdatedAt = 0;
                  for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('construction_updated_at')) {
                      const val = parseInt(localStorage.getItem(k) || '0', 10);
                      if (val > maxLocalUpdatedAt) maxLocalUpdatedAt = val;
                    }
                  }
                  if (maxFileUpdatedAt > maxLocalUpdatedAt + 2000 && maxFileUpdatedAt > 0) {
                    setPendingFileRestorePrompt({
                      handleName: handle.name || '[Toan_Bo_Du_An]_Backup.json',
                      fileData,
                      fileUpdatedAt: maxFileUpdatedAt,
                      localUpdatedAt: maxLocalUpdatedAt,
                      isAll: true
                    });
                  }
                } catch (e) {
                  console.warn('Error parsing stored ALL handle JSON:', e);
                }
              }
            } catch (e) {
              console.warn('Error reading stored ALL handle text:', e);
            }
          } else {
            setLocalAllSyncPermissionNeeded(true);
            setLocalAllSyncStatus('idle');
          }
        }
      } catch (err) {
        console.warn('Error loading stored local ALL file handle:', err);
      }
    };
    loadStoredAllHandle();
  }, []);

  // Load autosave versions on mount
  useEffect(() => {
    const loadBackups = async () => {
      try {
        const versions = await getAllBackupVersions();
        setAutosaveVersions(versions);
      } catch (e) {
        console.error('Error loading autosave versions on mount:', e);
      }
    };
    loadBackups();
  }, []);

  // Load local file handle on activeProjectId change
  useEffect(() => {
    let cancelled = false;
    const targetProjectId = activeProjectId;
    const loadStoredHandle = async () => {
      try {
        if (
          isAndroidAutoSaveAvailable()
          && hasAndroidAutoSaveFolder()
          && localStorage.getItem(getAndroidSingleAutosaveKey(targetProjectId)) === 'true'
        ) {
          const folderName = getAndroidAutoSaveFolderName();
          const fileName = getSingleAutoSaveFileName();
          const displayName = folderName ? `${folderName}/${fileName}` : fileName;
          setLocalFileHandle(makeAndroidAutoSaveHandle(targetProjectId, displayName));
          setLocalFileName(displayName);
          setLocalSyncPermissionNeeded(false);
          setLocalSyncStatus('synced');
          return;
        }
        if (window.self !== window.top) return; // Prevent filesystem access in iframe sandbox
        const handle = await getFileHandle(targetProjectId);
        if (cancelled || targetProjectId !== activeProjectId) return;
        if (handle) {
          setLocalFileHandle(handle);
          setLocalFileName(handle.name || 'Dữ liệu liên kết');
          
          const options = { mode: 'readwrite' as const };
          const permission = await handle.queryPermission(options);
          if (cancelled || targetProjectId !== activeProjectId) return;
          if (permission !== 'granted') {
            setLocalSyncPermissionNeeded(true);
            setLocalSyncStatus('idle');
          } else {
            setLocalSyncStatus('synced');
            try {
              const file = await handle.getFile();
              if (cancelled || targetProjectId !== activeProjectId) return;
              const text = await file.text();
              if (cancelled || targetProjectId !== activeProjectId) return;
              if (text) {
                lastSavedLocalSnapshotRef.current = text;
                try {
                  const fileData = JSON.parse(text);
                  const fileUpdatedAt = parseLegacyTimestamp(fileData.updatedAt || file.lastModified, 0);
                  const localUpdatedAt = parseInt(localStorage.getItem(getKey('construction_updated_at', targetProjectId)) || '0', 10);

                  if (fileUpdatedAt > localUpdatedAt + 2000 && fileUpdatedAt > 0) {
                    setPendingFileRestorePrompt({
                      handleName: handle.name,
                      fileData,
                      fileUpdatedAt,
                      localUpdatedAt
                    });
                  }
                } catch (e) {
                  console.warn('Error parsing stored handle JSON:', e);
                }
              }
            } catch (e) {
              console.warn('Error reading stored handle text:', e);
            }
          }
        } else {
          setLocalFileHandle(null);
          setLocalFileName('');
          setLocalSyncStatus('idle');
        }
      } catch (err) {
        console.warn('Error loading stored local file handle:', err);
      }
    };
    loadStoredHandle();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const persistTrashOperations = (items: TrashOperation[], projectId = activeProjectIdRef.current || activeProjectId) => {
    const sorted = [...items].sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
    trashOperationsRef.current = sorted;
    setTrashOperations(sorted);
    void setAsyncItem(getKey('construction_trash', projectId), sorted).catch((err) =>
      console.warn('Trash local persist warning:', err)
    );
  };

  const appendTrashOperation = (operation: TrashOperation) => {
    const next = [operation, ...trashOperationsRef.current.filter((item) => item.id !== operation.id)];
    persistTrashOperations(next, operation.projectId);
    void saveTrashOperationToCloud(operation).catch((err) =>
      console.warn('Trash cloud save warning:', err)
    );
  };

  const previewSuperAdminUiSettings = (next: SuperAdminUiSettings) => {
    if (!isCurrentSuperAdmin) return;
    setSuperAdminUiSettings(normalizeSuperAdminUiSettings(next));
  };

  const saveSuperAdminUiSettings = async (next: SuperAdminUiSettings) => {
    if (!isCurrentSuperAdmin || !getCurrentRealFirebaseUser()) throw new Error('Chỉ SUPER ADMIN đã xác thực được lưu cấu hình giao diện.');
    const sanitized = normalizeSuperAdminUiSettings(next);
    setSuperAdminUiSettings(sanitized);
    localStorage.setItem(getKey('construction_superadmin_ui', activeProjectIdRef.current), JSON.stringify(sanitized));
    await saveProjectSharedSettings(activeProjectIdRef.current, { superAdminUi: sanitized });
    await saveProjectAuditLog(activeProjectIdRef.current, { action: 'SECURITY_CONFIG_CHANGE', description: `SUPER ADMIN cập nhật giao diện V2: theme ${sanitized.theme}, scale ${sanitized.scalePercent}%, checklist ${sanitized.checklistVisibility}`, module: 'system-ui', syncStatus: 'PENDING' }).catch(() => {});
  };

  const resetSuperAdminUiSettings = async () => {
    await saveSuperAdminUiSettings(DEFAULT_SUPER_ADMIN_UI_SETTINGS);
  };

  const handleTrashSettingsChange = (nextInput: TrashSettings) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') {
      alert('Chỉ ADMIN được thay đổi cài đặt Thùng rác.');
      return;
    }
    const next = normalizeTrashSettings(nextInput);
    trashSettingsRef.current = next;
    setTrashSettings(next);
    localStorage.setItem(getKey('construction_trash_settings', activeProjectIdRef.current), JSON.stringify(next));
    void saveProjectSharedSettings(activeProjectIdRef.current, { trash: next }).catch((err) =>
      console.warn('Trash shared settings save warning:', err)
    );
  };

  const restoreTrashOperation = async (operationId: string) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') {
      alert('Chỉ ADMIN được khôi phục dữ liệu từ Thùng rác.');
      return;
    }
    const operation = trashOperationsRef.current.find((item) => item.id === operationId);
    if (!operation) return;
    trashCaptureSuppressedRef.current = true;
    try {
      updateAppData((prev) => {
        const next: AppData = { ...prev };
        const opTime = Number(operation.deletedAt || 0);

        for (const deleted of operation.deletedItems || []) {
          const key = deleted.collection as keyof AppData;
          const list = [...((next[key] || []) as any[])];
          if (list.some((item) => String(item?.id || '') === deleted.entityId)) continue;
          let restored = sanitizeTrashSnapshot(deleted.snapshot);
          if (key === 'floorPlans' && restored && !restored.imageUrl) {
            restored = { ...restored, imageUrl: `cloud-floorplan:${restored.id}` };
          }
          list.push({ ...restored, updatedAt: Date.now() });
          if (key === 'floorPlans') list.sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
          (next as any)[key] = list;
        }

        for (const [rawKey, snapshots] of Object.entries(operation.relatedBefore || {})) {
          const key = rawKey as keyof AppData;
          if (!Array.isArray(snapshots) || snapshots.length === 0) continue;
          const beforeById = new Map<string, any>(snapshots.map((item: any) => [String(item?.id || ''), item]));
          (next as any)[key] = ((next[key] || []) as any[]).map((current: any) => {
            const before = beforeById.get(String(current?.id || ''));
            if (!before) return current;
            // Never overwrite a record another user edited after this delete operation.
            if (Number(current?.updatedAt || 0) > opTime) return current;
            return { ...sanitizeTrashSnapshot(before), updatedAt: Date.now() };
          });
        }

        return next;
      });

      const remaining = trashOperationsRef.current.filter((item) => item.id !== operationId);
      persistTrashOperations(remaining, operation.projectId);
      await deleteTrashOperationFromCloud(operation.projectId, operationId).catch((err) =>
        console.warn('Trash cloud restore cleanup warning:', err)
      );
    } finally {
      window.setTimeout(() => { trashCaptureSuppressedRef.current = false; }, 250);
    }
  };

  const purgeTrashOperation = async (operationId: string) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') {
      alert('Chỉ ADMIN được xóa vĩnh viễn dữ liệu trong Thùng rác.');
      return;
    }
    const operation = trashOperationsRef.current.find((item) => item.id === operationId);
    if (!operation) return;
    // Floor-plan binaries are intentionally retained while recoverable. Only purge them
    // when the trash entry is permanently removed/expired. Other business tombstones stay
    // tiny in Firestore to prevent stale offline clients from resurrecting old records.
    for (const item of operation.deletedItems || []) {
      if (item.collection === 'floorPlans') {
        await deleteFloorPlanImageFromCloud(operation.projectId, item.snapshot as FloorPlan).catch((err) =>
          console.warn('Permanent floor-plan image cleanup warning:', err)
        );
      } else if (item.collection === 'defects') {
        await deleteEntityPhotos(operation.projectId, 'defect', item.entityId).catch(() => {});
      } else if (item.collection === 'crewRecords') {
        await deleteEntityPhotos(operation.projectId, 'crewRecord', item.entityId).catch(() => {});
      }
    }
    const remaining = trashOperationsRef.current.filter((item) => item.id !== operationId);
    persistTrashOperations(remaining, operation.projectId);
    await deleteTrashOperationFromCloud(operation.projectId, operationId).catch((err) =>
      console.warn('Trash cloud permanent delete warning:', err)
    );
  };

  const emptyTrash = async () => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') {
      alert('Chỉ ADMIN được dọn sạch Thùng rác.');
      return;
    }
    const ids = trashOperationsRef.current.map((item) => item.id);
    for (const id of ids) await purgeTrashOperation(id);
  };

  // Sync Lock Ref to avoid circular loops
  const syncLockRef = React.useRef(false);

  // Helper to push state changes to history (max 30 steps) and stamp item updatedAt
  const updateAppData = (updater: (prev: AppData) => AppData) => {
    if (FIREBASE_ONLY_RUNTIME && businessDataSource === 'legacy-migration-fallback') {
      console.warn('[Firebase-only] Legacy local cache is read-only. Import/validate it online before editing.');
      alert('Dữ liệu đang hiển thị từ bộ nhớ legacy chỉ để cứu dữ liệu. Hãy kết nối mạng và Import/Khôi phục vào Firestore trước khi chỉnh sửa.');
      return;
    }
    if (!isProjectRoleResolved || !canEditProjectData(currentUserRole)) {
      console.warn('[RBAC] Thao tác bị từ chối: Quyền VIEWER (Chỉ xem) không được phép sửa đổi dữ liệu.');
      return;
    }
    const mutationActor = getCurrentRealFirebaseUser();
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    setPresent((prev) => {
      const rawNext = updater(prev);
      if (rawNext === prev) return prev;

      const now = Date.now();
      const collections: (keyof AppData)[] = [
        'roomProgressList', 'inventory', 'workVolumes', 'floorPlans',
        'defects', 'checklist', 'crewRecords', 'teams', 'materialNorms'
      ];

      let stampedNext = rawNext;
      let hasStamped = false;
      const changedSummaries: string[] = [];
      const trashDeletedItems: TrashOperation['deletedItems'] = [];
      const trashRelatedBefore: Partial<Record<TrashCollectionKey, any[]>> = {};

      collections.forEach((col) => {
        const prevList = prev[col] || [];
        const nextList = rawNext[col] || [];

        if (prevList !== nextList) {
          markLocalCollectionDirty(col);
          if (col === 'crewRecords' || col === 'defects') priorityCloudSyncRevisionRef.current += 1;
          const prevMap = new Map<string, any>();
          (prevList as any[]).forEach(item => { if (item?.id) prevMap.set(String(item.id), item); });
          const nextMap = new Map<string, any>();
          (nextList as any[]).forEach(item => { if (item?.id) nextMap.set(String(item.id), item); });

          const addedIds = Array.from(nextMap.keys()).filter((id) => !prevMap.has(id));
          const deletedIds = Array.from(prevMap.keys()).filter((id) => !nextMap.has(id));
          deletedIds.forEach((id) => {
            recordLocalTombstone(col, id, now);
            if (trashSettingsRef.current.enabled && !trashCaptureSuppressedRef.current) {
              const snapshot = prevMap.get(id);
              if (snapshot) {
                const label = String(snapshot.roomName || snapshot.floorName || snapshot.description || snapshot.title || snapshot.materialName || snapshot.teamName || snapshot.name || snapshot.date || id);
                trashDeletedItems.push({
                  collection: col as TrashCollectionKey,
                  entityId: id,
                  label: `${getTrashCollectionLabel(col as TrashCollectionKey)}: ${label}`,
                  snapshot: sanitizeTrashSnapshot(snapshot),
                });
              }
            }
          });
          addedIds.forEach((id) => clearLocalTombstone(col, id));
          const modifiedDetails: string[] = [];
          const relatedSnapshots: any[] = [];
          for (const [id, nextItem] of nextMap.entries()) {
            const prevItem = prevMap.get(id);
            if (!prevItem || prevItem === nextItem) continue;
            const changedFields = Array.from(new Set([...Object.keys(prevItem), ...Object.keys(nextItem)]))
              .filter((key) => key !== 'updatedAt' && prevItem[key] !== nextItem[key])
              .slice(0, 6);
            if (modifiedDetails.length < 3) modifiedDetails.push(`${id}${changedFields.length ? ` [${changedFields.join(', ')}]` : ''}`);
            if (trashSettingsRef.current.enabled && !trashCaptureSuppressedRef.current) relatedSnapshots.push(sanitizeTrashSnapshot(prevItem));
          }
          // Capture side-effect changes so restoring a deleted room/floor can safely
          // reconnect untouched Defect/Checklist/work links without storing any binary.
          if (relatedSnapshots.length > 0) trashRelatedBefore[col as TrashCollectionKey] = relatedSnapshots;
          const auditParts: string[] = [];
          if (addedIds.length) auditParts.push(`thêm ${addedIds.slice(0, 3).join(', ')}${addedIds.length > 3 ? ` +${addedIds.length - 3}` : ''}`);
          if (deletedIds.length) auditParts.push(`xóa ${deletedIds.slice(0, 3).join(', ')}${deletedIds.length > 3 ? ` +${deletedIds.length - 3}` : ''}`);
          if (modifiedDetails.length) auditParts.push(`sửa ${modifiedDetails.join('; ')}`);
          if (auditParts.length) changedSummaries.push(`${String(col)}: ${auditParts.join(' · ')}`);

          const newColList = nextList.map(item => {
            if (!item || !item.id) return item;
            const prevItem = prevMap.get(String(item.id));
            // App updates are immutable: unchanged records preserve object identity. Avoid
            // JSON.stringify on every record because it causes noticeable mobile input lag.
            if (!prevItem || prevItem !== item) {
              const previousRevision = Number(prevItem?.revision || 0);
              const incomingRevision = Number((item as any)?.revision || 0);
              return {
                ...item,
                updatedAt: now,
                revision: Math.max(previousRevision, incomingRevision, 0) + 1,
                ...(mutationActor?.uid ? { updatedByUid: mutationActor.uid } : {}),
                ...(!prevItem && mutationActor?.uid ? { createdByUid: mutationActor.uid } : {}),
                deleted: false,
                deletedAt: null,
                deletedByUid: null,
                deletedBy: null,
              };
            }
            return item;
          });

          if (!hasStamped) {
            stampedNext = { ...rawNext };
            hasStamped = true;
          }
          stampedNext[col] = newColList;
        }
      });

      const next = stampedNext;

      let trashOperationToAppend: TrashOperation | null = null;
      if (trashDeletedItems.length > 0 && trashSettingsRef.current.enabled && !trashCaptureSuppressedRef.current) {
        const user = getCurrentRealFirebaseUser();
        const retentionDays = trashSettingsRef.current.retentionDays || 7;
        const operationBase: TrashOperation = {
          id: createEntityId('TRASH'),
          projectId: activeProjectIdRef.current || activeProjectId,
          deletedAt: now,
          expiresAt: now + retentionDays * 24 * 60 * 60 * 1000,
          retentionDays,
          deletedByUid: user?.uid,
          deletedByEmail: user?.email || undefined,
          deletedByName: user?.displayName || undefined,
          deletedItems: trashDeletedItems,
          relatedBefore: trashRelatedBefore,
        };
        trashOperationToAppend = { ...operationBase, approxBytes: estimateTrashBytes(operationBase) };
      }

      // Safe asynchronous scheduling to prevent React from warning about nested state updates during rendering
      setTimeout(() => {
        if (trashOperationToAppend) appendTrashOperation(trashOperationToAppend);
        setPast((p) => { const limit = typeof window !== 'undefined' && window.innerWidth < 768 ? 6 : 15; return [...p.slice(-(limit - 1)), prev]; });
        setFuture([]);

        // Update local modified timestamp on any UI action
        if (!syncLockRef.current) {
          setLastUpdatedAt(now);
          localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
          if (changedSummaries.length > 0) {
            saveProjectAuditLog(activeProjectIdRef.current, {
              timestamp: now,
              action: 'DATA_CHANGE',
              details: changedSummaries.join(' | '),
              actorRole: currentUserRole,
            }).catch((err) => console.warn('Cloud audit log warning:', err));
          }
        }
      }, 0);

      return next;
    });
  };

  const stampStateChanges = (targetState: AppData, currentState: AppData, now: number): AppData => {
    const mutationActor = getCurrentRealFirebaseUser();
    const collections: (keyof AppData)[] = [
      'roomProgressList', 'inventory', 'workVolumes', 'floorPlans',
      'defects', 'checklist', 'crewRecords', 'teams', 'materialNorms'
    ];
    let stampedTarget = targetState;
    let hasStamped = false;

    collections.forEach((col) => {
      const curList = currentState[col] || [];
      const targetList = targetState[col] || [];

      const curMap = new Map<string, any>();
      curList.forEach(item => { if (item?.id) curMap.set(item.id, item); });
      const targetMap = new Map<string, any>();
      targetList.forEach(item => { if (item?.id) targetMap.set(item.id, item); });
      for (const id of curMap.keys()) {
        if (!targetMap.has(id)) recordLocalTombstone(col, id, now);
      }
      for (const id of targetMap.keys()) {
        if (!curMap.has(id)) clearLocalTombstone(col, id);
      }

      const newColList = targetList.map(item => {
        if (!item || !item.id) return item;
        const curItem = curMap.get(item.id);
        if (!curItem) {
          // Undo/redo can re-add a previously deleted floor after its cloud binary was
          // already cleaned up. Never reuse the old Drive/Firestore image identifiers;
          // force the normal image-sync pipeline to upload a fresh copy for this floor ID.
          if (col === 'floorPlans') {
            return {
              ...item,
              driveFileId: undefined,
              driveUrl: undefined,
              cloudFileId: undefined,
              storageProvider: undefined,
              imageCloudRevision: 0,
              imageCloudSyncedAt: undefined,
              imageRevision: now,
              updatedAt: now,
              revision: Math.max(Number((item as any).revision || 0), 0) + 1,
              ...(mutationActor?.uid ? { updatedByUid: mutationActor.uid, createdByUid: mutationActor.uid } : {}),
              deleted: false,
              deletedAt: null,
              deletedByUid: null,
                deletedBy: null,
            };
          }
          return {
            ...item,
            updatedAt: now,
            revision: Math.max(Number((item as any).revision || 0), 0) + 1,
            ...(mutationActor?.uid ? { updatedByUid: mutationActor.uid, createdByUid: mutationActor.uid } : {}),
            deleted: false,
            deletedAt: null,
            deletedByUid: null,
                deletedBy: null,
          };
        } else {
          const { updatedAt: _cu, ...curRest } = curItem;
          const { updatedAt: _tu, ...targetRest } = item;
          if (JSON.stringify(curRest) !== JSON.stringify(targetRest)) {
            return {
              ...item,
              updatedAt: now,
              revision: Math.max(Number(curItem.revision || 0), Number((item as any).revision || 0), 0) + 1,
              ...(mutationActor?.uid ? { updatedByUid: mutationActor.uid } : {}),
              deleted: false,
              deletedAt: null,
              deletedByUid: null,
                deletedBy: null,
            };
          }
        }
        return item;
      });

      if (!hasStamped) {
        stampedTarget = { ...targetState };
        hasStamped = true;
      }
      stampedTarget[col] = newColList;
    });
    return stampedTarget;
  };

  const handleUndo = () => {
    if (!isProjectRoleResolved || !canUseGlobalUndoRedo(currentUserRole)) return;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const now = Date.now();
    const stampedPrevious = stampStateChanges(previous, present, now);

    setPast(newPast);
    setFuture((f) => [present, ...f]);
    setPresent(stampedPrevious);
    markAllLocalCollectionsDirty();

    // Update modified timestamp
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
  };

  const handleRedo = () => {
    if (!isProjectRoleResolved || !canUseGlobalUndoRedo(currentUserRole)) return;
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const now = Date.now();
    const stampedNext = stampStateChanges(next, present, now);

    setPast((p) => [...p, present]);
    setPresent(stampedNext);
    markAllLocalCollectionsDirty();
    setFuture(newFuture);

    // Update modified timestamp
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
  };

  useEffect(() => {
    // Fire-and-forget: cleanup huge images on boot
    cleanupAndCompressOldImages();
  }, []);

  // Keyboard shortcut listener for Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTextTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [past, present, future]);

  // Create the Cloud project automatically once a real Google account is connected.
  // Without this bootstrap, a new project can get stuck waiting for Cloud snapshots
  // before the first Firestore write is ever allowed.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing) return;
    if (!isOnline || projectRoleSource === 'offline-cache') return;
    if (switchingProjectRef.current || !cloudUserKey || cloudInitialReady) return;

    const user = getCurrentRealFirebaseUser();
    if (!user || !activeProjectId) return;

    const projectId = activeProjectId;
    const attemptKey = `${projectId}:${cloudUserKey}`;
    if (cloudBootstrapAttemptsRef.current.has(attemptKey)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || cloudInitialReady || switchingProjectRef.current) return;
      cloudBootstrapAttemptsRef.current.add(attemptKey);

      try {
        const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        if (roleInfo.verification !== 'verified') return;

        if (roleInfo.allowed || roleInfo.isCloudSynced) {
          if (roleInfo.role) {
            setCurrentUserRole(roleInfo.role);
            setCurrentUserRoleState(roleInfo.role);
          }
          setCloudBootstrapVersion((v) => v + 1);
          return;
        }

        const payload = buildCloudProjectPayload();
        await saveProjectToCloud({
          id: projectId,
          name: projectName || `Du an ${projectId}`,
          contractorName,
          inspectorName,
          syncCode: projectId.slice(0, 8).toUpperCase(),
          payload
        });

        if (cancelled || activeProjectIdRef.current !== projectId) return;
        setCurrentUserRole('ADMIN');
        setCurrentUserRoleState('ADMIN');
        lastSyncedPresentRef.current = null;
        lastSyncedMetadataRef.current = null;
        receivedInitialSubcollectionsRef.current.clear();
        setCloudInitialReady(false);
        setCloudBootstrapVersion((v) => v + 1);
      } catch (err) {
        console.warn('Cloud project bootstrap skipped:', err);
      }
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeProjectId,
    cloudUserKey,
    cloudInitialReady,
    isHydrated,
    isLoadingProject,
    isRestoring,
    isInitializing,
    projectName,
    contractorName,
    inspectorName,
    present,
    lastUpdatedAt,
    isOnline,
    projectRoleSource
  ]);

  // Firebase Realtime Subcollection-Based Multi-Device Sync Listener
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !isProjectRoleResolved) return;
    if (!isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed) {
      setCloudInitialReady(false);
      setCloudDefectIndex(null);
      return;
    }
    if (!cloudUserKey) {
      setCloudInitialReady(false);
      return;
    }

    const subscribedProjectId = activeProjectId;
    setCloudInitialReady(false);
    setCloudDefectIndex(null);
    receivedInitialSubcollectionsRef.current.clear();

    const unsubscribe = subscribeToProjectRealtime(
      subscribedProjectId,
      (meta) => {
        if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return;

        // 1. Update project metadata (projectName, contractorName, inspectorName) if newer than local
        const serverTime = meta.updatedAt || 0;
        lastServerMetadataUpdatedAtRef.current = serverTime;

        const localTimeStr = localStorage.getItem(getKey('construction_updated_at', subscribedProjectId)) || '0';
        const localTime = parseInt(localTimeStr, 10);

        if (serverTime > localTime) {
          syncLockRef.current = true;
          if (meta.projectName) setProjectName(meta.projectName);
          if (meta.contractorName) setContractorName(meta.contractorName);
          if (meta.inspectorName) setInspectorName(meta.inspectorName);
          
          localStorage.setItem(getKey('construction_project_name', subscribedProjectId), meta.projectName);
          localStorage.setItem(getKey('construction_contractor', subscribedProjectId), meta.contractorName);
          localStorage.setItem(getKey('construction_inspector', subscribedProjectId), meta.inspectorName);
          
          setLastUpdatedAt(serverTime);
          localStorage.setItem(getKey('construction_updated_at', subscribedProjectId), String(serverTime));
          
          setTimeout(() => {
            syncLockRef.current = false;
          }, 50);
        }
      },
      (stateKey, cloudItems, isInitial, isPatch = false) => {
        if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return;

        if (stateKey === 'defects') {
          setCloudDefectIndex((prevIndex) => {
            if (!isPatch || !prevIndex || prevIndex.projectId !== subscribedProjectId) {
              return {
                projectId: subscribedProjectId,
                ids: new Set(
                  cloudItems
                    .filter((item: any) => item?.id && !item.deleted)
                    .map((item: any) => String(item.id))
                )
              };
            }
            const nextIds = new Set(prevIndex.ids);
            cloudItems.forEach((raw: any) => {
              if (!raw?.id) return;
              if (raw.deleted || raw.__firestoreChangeType === 'removed') nextIds.delete(String(raw.id));
              else nextIds.add(String(raw.id));
            });
            return { projectId: subscribedProjectId, ids: nextIds };
          });
        }

        receivedInitialSubcollectionsRef.current.add(stateKey);
        if (receivedInitialSubcollectionsRef.current.size >= 9) {
          setCloudInitialReady(true);
          setBusinessDataSource('cloud');
        }

        // 2. Perform distributed reconciliation to resolve conflicts and sync cleanly
        setPresent((prev: AppData) => {
          if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return prev;

          const localList = prev[stateKey as keyof AppData] || [];
          const viewerCloudTruth = isProjectRoleResolved && currentUserRole === 'VIEWER';
          const tombstoneKeyFor = (id: string) => `${String(stateKey)}_${id}`;
          const getLocalTombstoneTime = (id: string) => Number(localTombstonesRef.current[tombstoneKeyFor(id)] || 0);

          if (isPatch) {
            const byId = new Map<string, any>();
            localList.forEach((item: any) => {
              if (!item?.id) return;
              const localTime = parseLegacyTimestamp(item.updatedAt, 0);
              const tombTime = getLocalTombstoneTime(item.id);
              if (tombTime >= localTime && tombTime > 0) return;
              byId.set(item.id, item);
            });
            let changed = byId.size !== localList.length;

            for (const cloudItemRaw of cloudItems) {
              if (!cloudItemRaw?.id) continue;
              const { __firestoreChangeType: _changeType, ...cloudItem } = cloudItemRaw;
              const localItem = byId.get(cloudItem.id);
              const localTime = parseLegacyTimestamp(localItem?.updatedAt, 0);
              const cloudTime = parseLegacyTimestamp(cloudItem.updatedAt, 0);
              const localTombstoneTime = getLocalTombstoneTime(cloudItem.id);

              if (cloudItem.deleted) {
                const deletionTime = cloudTime > 0 ? cloudTime : Date.now();
                recordLocalTombstone(stateKey, cloudItem.id, deletionTime, subscribedProjectId);
                if (localItem && cloudTime >= localTime) {
                  byId.delete(cloudItem.id);
                  changed = true;
                }
              } else if (localTombstoneTime > 0 && localTombstoneTime >= cloudTime) {
                // A local/offline deletion is newer than the cloud copy. Keep it deleted;
                // lastSyncedPresentRef still tracks the cloud copy below so the next cloud
                // diff publishes the deletion tombstone instead of resurrecting the item.
                if (localItem) {
                  byId.delete(cloudItem.id);
                  changed = true;
                }
              } else {
                if (localTombstoneTime > 0 && cloudTime > localTombstoneTime) {
                  clearLocalTombstone(stateKey, cloudItem.id, subscribedProjectId);
                }
                if (!localItem || cloudTime > localTime) {
                  byId.set(cloudItem.id, localItem ? restoreLocalOmittedImages(cloudItem, localItem) : cloudItem);
                  changed = true;
                }
              }
            }

            if (!changed) return prev;
            const mergedPatchList = Array.from(byId.values());
            if (stateKey === 'floorPlans') mergedPatchList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

            if (!lastSyncedPresentRef.current) {
              lastSyncedPresentRef.current = { materialNorms: [], inventory: [], workVolumes: [], floorPlans: [], defects: [], roomProgressList: [], checklist: [], crewRecords: [], teams: [] };
            }
            const syncedMap = new Map<string, any>();
            (lastSyncedPresentRef.current[stateKey as keyof AppData] || []).forEach((item: any) => { if (item?.id) syncedMap.set(item.id, item); });
            cloudItems.forEach((raw: any) => {
              if (!raw?.id) return;
              const { __firestoreChangeType: _ct, ...cloudItem } = raw;
              if (cloudItem.deleted) syncedMap.delete(cloudItem.id);
              else syncedMap.set(cloudItem.id, cloudItem);
            });
            lastSyncedPresentRef.current[stateKey as keyof AppData] = Array.from(syncedMap.values());

            const dbKey = getKey(`construction_${stateKey === 'roomProgressList' ? 'room_progress' : stateKey.replace(/([A-Z])/g, '_$1').toLowerCase()}`, subscribedProjectId);
            // For a verified VIEWER, present state follows Firestore exactly, but do not
            // overwrite the editor's older local cache. If that account later becomes an
            // EDITOR/ADMIN, V6.2.22 can reconcile any unsent local-only records instead
            // of silently losing them.
            if (!viewerCloudTruth) {
              if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
                setAsyncItem(dbKey, mergedPatchList).catch(err => console.warn('Legacy patch cache write warning:', err));
              }
            }
            return { ...prev, [stateKey]: mergedPatchList };
          }
          
          const localMap = new Map<string, any>();
          localList.forEach(item => {
            if (item && item.id) localMap.set(item.id, item);
          });

          const cloudMap = new Map<string, any>();
          cloudItems.forEach(item => {
            if (item && item.id) cloudMap.set(item.id, item);
          });

          const mergedList: any[] = [];
          let listHasChanges = false;

          // Process items from cloud with local tombstone protection.
          cloudItems.forEach(cloudItem => {
            if (!cloudItem || !cloudItem.id) return;

            const localItem = localMap.get(cloudItem.id);
            const localTime = localItem ? parseLegacyTimestamp(localItem.updatedAt, 0) : 0;
            const cloudTime = parseLegacyTimestamp(cloudItem.updatedAt, 0);
            const localTombstoneTime = getLocalTombstoneTime(cloudItem.id);

            if (cloudItem.deleted) {
              // Cloud item is a soft-deleted tombstone. Mirror the deletion locally so
              // reconnect/reload cannot restore an older IndexedDB copy.
              recordLocalTombstone(stateKey, cloudItem.id, cloudTime > 0 ? cloudTime : Date.now(), subscribedProjectId);
              if (localItem) {
                if (cloudTime >= localTime) {
                  listHasChanges = true;
                } else if (localTombstoneTime < localTime) {
                  // Local item was explicitly re-created/edited after the cloud delete.
                  mergedList.push(localItem);
                }
              }
            } else if (localTombstoneTime > 0 && localTombstoneTime >= cloudTime) {
              // Offline/local deletion wins over the older cloud copy. Do not resurrect it.
              listHasChanges = true;
            } else {
              if (localTombstoneTime > 0 && cloudTime > localTombstoneTime) {
                // A genuinely newer cloud recreation may revive the ID.
                clearLocalTombstone(stateKey, cloudItem.id, subscribedProjectId);
              }
              if (!localItem) {
                mergedList.push(cloudItem);
                listHasChanges = true;
              } else if (cloudTime > localTime) {
                mergedList.push(restoreLocalOmittedImages(cloudItem, localItem));
                listHasChanges = true;
              } else {
                mergedList.push(localItem);
                if (cloudTime < localTime) listHasChanges = true;
              }
            }
          });

          // Process local-only items. A locally tombstoned record must stay deleted even
          // if an old IndexedDB copy is still present.
          localList.forEach(localItem => {
            if (!localItem?.id || cloudMap.has(localItem.id)) return;
            const localTime = parseLegacyTimestamp(localItem.updatedAt, 0);
            const tombTime = getLocalTombstoneTime(localItem.id);
            if (tombTime > 0 && tombTime >= localTime) {
              listHasChanges = true;
              return;
            }
            if (viewerCloudTruth) {
              // A VIEWER must not see browser-only rows as shared project data. Keep the
              // original IndexedDB cache untouched for lossless future editor recovery.
              listHasChanges = true;
              return;
            }
            mergedList.push(localItem);
          });

          if (!lastSyncedPresentRef.current) {
            lastSyncedPresentRef.current = { materialNorms: [], inventory: [], workVolumes: [], floorPlans: [], defects: [], roomProgressList: [], checklist: [], crewRecords: [], teams: [] };
          }
          // Only track active non-deleted items in lastSyncedPresentRef
          lastSyncedPresentRef.current[stateKey as keyof AppData] = cloudItems.filter(ci => ci && !ci.deleted);

          if (!listHasChanges) return prev;

          const updatedState = {
            ...prev,
            [stateKey]: mergedList
          };

          // Persist the specific table to IndexedDB asynchronously
          const dbKey = getKey(`construction_${stateKey === 'roomProgressList' ? 'room_progress' : stateKey.replace(/([A-Z])/g, '_$1').toLowerCase()}`, subscribedProjectId);
          if (!viewerCloudTruth) {
            if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
              setAsyncItem(dbKey, mergedList).catch(err => console.warn('Legacy sync cache write warning:', err));
            }
          }

          return updatedState;
        });
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeProjectId, cloudUserKey, cloudBootstrapVersion, isHydrated, isLoadingProject, isRestoring, isInitializing, isProjectRoleResolved, currentUserRole, isOnline, projectRoleSource, projectRoleAllowed]);

  // Photo metadata is realtime; binary image chunks are downloaded lazily only when an image is displayed.
  // This keeps multi-device image sync complete without loading every photo into phone RAM at startup.
  useEffect(() => {
    const photoTabActive = activeTab === 'floorplan' || activeTab === 'crew' || activeTab === 'chat';
    if (!photoTabActive || !isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || !isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed) {
      setPhotoCloudStatus({ phase: 'idle', pending: 0 });
      return;
    }
    const projectId = activeProjectId;
    const unsubscribePhotos = subscribeProjectPhotosRealtime(projectId, (status) => {
      if (activeProjectIdRef.current === projectId) setPhotoCloudStatus(status);
    });
    return () => unsubscribePhotos();
  }, [activeProjectId, activeTab, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing, isOnline, projectRoleSource, projectRoleAllowed]);

  const handleUpdateProjectName = (val: string) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    localMetadataDirtyRevisionRef.current += 1;
    setProjectName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateContractorName = (val: string) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    localMetadataDirtyRevisionRef.current += 1;
    setContractorName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateInspectorName = (val: string) => {
    if (!isProjectRoleResolved || currentUserRole !== 'ADMIN') return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    localMetadataDirtyRevisionRef.current += 1;
    setInspectorName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  // Persistence to localStorage
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || syncLockRef.current) return;
    localStorage.setItem(getKey('construction_project_name'), projectName);
    
    const list = getProjectsList();
    const activeId = getActiveProjectId();
    const project = list.find(p => p.id === activeId);
    if (project && project.name !== projectName) {
      project.name = projectName;
      project.updatedAt = Date.now();
      saveProjectsList(list);
    }
  }, [projectName, isHydrated, isLoadingProject, isRestoring]);

  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || syncLockRef.current) return;
    localStorage.setItem(getKey('construction_contractor'), contractorName);
  }, [contractorName, isHydrated, isLoadingProject, isRestoring]);

  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || syncLockRef.current) return;
    localStorage.setItem(getKey('construction_inspector'), inspectorName);
  }, [inspectorName, isHydrated, isLoadingProject, isRestoring]);

  useEffect(() => {
    if (!isHydrated || isLoadingProject) return;
    localStorage.setItem(getKey('construction_drive_auto_sync_enabled', activeProjectId), String(autoSyncEnabled));
    if (isProjectRoleResolved && currentUserRole === 'ADMIN' && getCurrentRealFirebaseUser()) {
      saveProjectSharedSettings(activeProjectId, { driveAutoSyncEnabled: autoSyncEnabled })
        .catch((err) => console.warn('Project setting sync warning:', err));
    }
  }, [autoSyncEnabled, activeProjectId, isHydrated, isLoadingProject, isProjectRoleResolved, currentUserRole]);

  const handleRestoreData = async (rawData: any, targetProjectId?: string) => {
    if (!rawData) return;
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) {
      alert('Chỉ ADMIN được khôi phục/ghi đè dữ liệu dự án từ bản sao lưu.');
      return;
    }
    const operationProjectId = targetProjectId || activeProjectIdRef.current || getActiveProjectId();

    if (switchingProjectRef.current) {
      console.warn('[RESTORE CANCELLED] Project switching in progress');
      return;
    }

    const isCurrentActive = (activeProjectIdRef.current === operationProjectId);
    if (isCurrentActive) {
      setIsRestoring(true);
    }
    console.log('[RESTORE START]', operationProjectId, 'isCurrentActive:', isCurrentActive);
    const data = normalizeImportedData(rawData, operationProjectId);
    syncLockRef.current = true;
    try {
      const pid = operationProjectId;
      if (data.projectName) {
        if (isCurrentActive) setProjectName(data.projectName);
        if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) await setAsyncItem(getKey('construction_project_name', pid), data.projectName);
        safeSetLocalStorageItem(getKey('construction_project_name', pid), data.projectName);
      }
      if (data.contractorName !== undefined) {
        if (isCurrentActive) setContractorName(data.contractorName || '');
        if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) await setAsyncItem(getKey('construction_contractor', pid), data.contractorName || '');
        safeSetLocalStorageItem(getKey('construction_contractor', pid), data.contractorName || '');
      }
      if (data.inspectorName !== undefined) {
        if (isCurrentActive) setInspectorName(data.inspectorName || '');
        if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) await setAsyncItem(getKey('construction_inspector', pid), data.inspectorName || '');
        safeSetLocalStorageItem(getKey('construction_inspector', pid), data.inspectorName || '');
      }
      const nextState = {
        materialNorms: Array.isArray(data.materialNorms) ? data.materialNorms : (isCurrentActive ? present.materialNorms : []),
        inventory: Array.isArray(data.inventory) ? data.inventory : (isCurrentActive ? present.inventory : []),
        workVolumes: Array.isArray(data.workVolumes) ? data.workVolumes : (isCurrentActive ? present.workVolumes : []),
        floorPlans: Array.isArray(data.floorPlans) 
          ? [...data.floorPlans].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((fp, idx) => ({ ...fp, order: idx }))
          : (isCurrentActive ? present.floorPlans : []),
        defects: Array.isArray(data.defects) ? data.defects : (isCurrentActive ? present.defects : []),
        roomProgressList: Array.isArray(data.roomProgressList) ? data.roomProgressList : (isCurrentActive ? present.roomProgressList : []),
        checklist: Array.isArray(data.checklist) ? data.checklist : (isCurrentActive ? present.checklist : []),
        crewRecords: Array.isArray(data.crewRecords) ? data.crewRecords : (isCurrentActive ? present.crewRecords : []),
        teams: Array.isArray(data.teams) ? data.teams : (isCurrentActive ? present.teams : []),
      };
      if (isCurrentActive) {
        setPresent(nextState);
      }

      if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
        await Promise.all([
          setAsyncItem(getKey('construction_material_norms', pid), nextState.materialNorms),
          setAsyncItem(getKey('construction_inventory', pid), nextState.inventory),
          setAsyncItem(getKey('construction_work_volumes', pid), nextState.workVolumes),
          setAsyncItem(getKey('construction_floor_plans', pid), nextState.floorPlans),
          setAsyncItem(getKey('construction_defects', pid), nextState.defects),
          setAsyncItem(getKey('construction_room_progress', pid), nextState.roomProgressList),
          setAsyncItem(getKey('construction_checklist', pid), nextState.checklist),
          setAsyncItem(getKey('construction_crew_records', pid), nextState.crewRecords),
          setAsyncItem(getKey('construction_teams', pid), nextState.teams),
        ]);
      }

      if (FIREBASE_ONLY_RUNTIME) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('Import Firebase-only cần có mạng để kiểm tra revision và ghi an toàn vào Firestore. Tệp chưa bị xóa; hãy thử lại khi online.');
        }
        await saveProjectToCloud({
          id: pid,
          name: data.projectName || projectName || `Dự án ${pid}`,
          contractorName: data.contractorName || '',
          inspectorName: data.inspectorName || '',
          syncCode: pid.slice(0, 8).toUpperCase(),
          payload: nextState,
        });
      }

      const parsedSourceTime = parseLegacyTimestamp(data.updatedAt, 0);
      let updatedTime = parsedSourceTime > 0 ? parsedSourceTime : 0;
      if (updatedTime === 0) {
        let maxTime = 0;
        const scanArray = (arr: any[]) => {
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            if (item && typeof item === 'object') {
              const t = parseLegacyTimestamp(item.updatedAt || item.date, 0);
              if (t > maxTime) maxTime = t;
            }
          }
        };
        scanArray(nextState.materialNorms);
        scanArray(nextState.inventory);
        scanArray(nextState.workVolumes);
        scanArray(nextState.floorPlans);
        scanArray(nextState.defects);
        scanArray(nextState.roomProgressList);
        scanArray(nextState.checklist);
        scanArray(nextState.crewRecords);
        scanArray(nextState.teams);
        if (maxTime > 0) {
          updatedTime = maxTime;
        }
      }

      if (isCurrentActive) setLastUpdatedAt(updatedTime);
      if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) await setAsyncItem(getKey('construction_updated_at', pid), String(updatedTime));
      safeSetLocalStorageItem(getKey('construction_updated_at', pid), String(updatedTime));

      console.log('[RESTORE SUCCESS]', pid);
      if (isCurrentActive) setIsHydrated(true);
    } catch (err) {
      console.error('[RESTORE FAILED]', err);
      throw err;
    } finally {
      if (isCurrentActive) {
        setIsRestoring(false);
      }
      setTimeout(() => {
        syncLockRef.current = false;
      }, 500);
    }
  };

  const handleRestoreAllStorageData = async (parsedData: any) => {
    if (!parsedData) return;
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) {
      alert('Chỉ ADMIN được khôi phục toàn bộ dữ liệu hệ thống.');
      return;
    }
    if (FIREBASE_ONLY_RUNTIME) {
      alert('Firebase-only không phục hồi database bằng cách ghi đè localStorage/IndexedDB. Hãy dùng Import Backup theo từng dự án để dữ liệu được kiểm tra ID/revision và ghi vào Firestore.');
      return;
    }
    try {
      syncLockRef.current = true;
      for (const key in parsedData) {
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          const val = typeof parsedData[key] === 'object' ? JSON.stringify(parsedData[key]) : parsedData[key];
          const isLargeKey = [
            'material_norms', 'inventory', 'work_volumes', 'floor_plans',
            'defects', 'room_progress', 'checklist', 'crew_records', 'teams'
          ].some(b => key.includes(`construction_${b}`));

          if (isLargeKey) {
            await setAsyncItem(key, val);
          } else {
            safeSetLocalStorageItem(key, val);
          }
        }
      }
      alert('🎉 Phục hồi toàn bộ dữ liệu hệ thống từ tệp thành công! Ứng dụng sẽ tự động tải lại.');
      window.location.reload();
    } catch (err) {
      console.error('Restore all storage data error:', err);
      alert('Có lỗi xảy ra khi phục hồi dữ liệu hệ thống.');
      syncLockRef.current = false;
    }
  };

  // Google Drive Sync Up
  const handleDriveSyncUp = async (customFolderId?: string) => {
    if (FIREBASE_ONLY_RUNTIME) return { success: false, error: 'Google Drive runtime đã tắt trong Firebase-only. Drive chỉ còn dùng để đọc/migrate dữ liệu legacy.' };
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return { success: false, error: 'Chỉ ADMIN được đồng bộ/sao lưu dữ liệu dự án lên Drive.' };
    const operationProjectId = activeProjectIdRef.current || activeProjectId;
    if (!googleServerBackendAvailable) {
      setDriveSyncStatus('idle');
      return {
        success: false,
        error: 'Đồng bộ Google Drive cần backend riêng. Bản Firebase Hosting hiện chạy tĩnh nên chức năng này đang tắt.',
      };
    }
    if (switchingProjectRef.current) return { success: false, message: 'Đang chuyển dự án.' };

    try {
      setDriveSyncStatus('syncing');
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const localUpdatedAtStr = localStorage.getItem(getKey('construction_updated_at', operationProjectId));
      const localUpdatedAt = localUpdatedAtStr ? parseInt(localUpdatedAtStr, 10) : (lastUpdatedAt || 0);

      // Get individual backup category toggles
      const syncNorms = localStorage.getItem('construction_sync_opt_norms') !== 'false';
      const syncInventory = localStorage.getItem('construction_sync_opt_inventory') !== 'false';
      const syncWorkVolumes = localStorage.getItem('construction_sync_opt_workVolumes') !== 'false';
      const syncFloorPlans = localStorage.getItem('construction_sync_opt_floorPlans') !== 'false';
      const syncDefects = localStorage.getItem('construction_sync_opt_defects') !== 'false';
      const syncRoomProgress = localStorage.getItem('construction_sync_opt_roomProgress') !== 'false';
      const syncChecklist = localStorage.getItem('construction_sync_opt_checklist') !== 'false';
      const syncCrew = localStorage.getItem('construction_sync_opt_crew') !== 'false';

      const res = await apiFetch('/api/drive/sync-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId,
          projectId: operationProjectId,
          projectName,
          contractorName,
          inspectorName,
          ...(syncInventory ? { inventory } : {}),
          ...(syncWorkVolumes ? { workVolumes } : {}),
          ...(syncChecklist ? { checklist } : {}),
          ...(syncDefects ? { defects } : {}),
          ...(syncFloorPlans ? { floorPlans } : {}),
          ...(syncRoomProgress ? { roomProgressList } : {}),
          ...(syncNorms ? { materialNorms } : {}),
          ...(syncCrew ? { crewRecords, teams } : {}),
          updatedAt: localUpdatedAt
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAuthenticated(false);
          setDriveSyncStatus('idle');
          return {
            success: false,
            error: errorData.error || 'Chưa kết nối tài khoản Google. Vui lòng kết nối tài khoản Google trong Cấu Hình Google.'
          };
        }
        throw new Error(errorData.error || 'Đăng tải lên Google Drive không thành công');
      }

      const result = await res.json();
      if (switchingProjectRef.current || activeProjectIdRef.current !== operationProjectId) {
        console.warn('[DRIVE SYNC UP CANCELLED] Project changed during sync up');
        return { success: false, message: 'Dự án đã bị thay đổi trong quá trình đăng tải Drive.' };
      }

      if (result.success) {
        setDriveSyncStatus('synced');
        const timeStr = new Date().toISOString();
        setDriveLastSyncTime(timeStr);
        localStorage.setItem(getKey('construction_drive_last_sync', operationProjectId), timeStr);
        
        // Save individual category last backup timestamps
        if (syncNorms) localStorage.setItem(getKey('construction_last_backup_norms', operationProjectId), timeStr);
        if (syncInventory) localStorage.setItem(getKey('construction_last_backup_inventory', operationProjectId), timeStr);
        if (syncWorkVolumes) localStorage.setItem(getKey('construction_last_backup_workVolumes', operationProjectId), timeStr);
        if (syncFloorPlans) localStorage.setItem(getKey('construction_last_backup_floorPlans', operationProjectId), timeStr);
        if (syncDefects) localStorage.setItem(getKey('construction_last_backup_defects', operationProjectId), timeStr);
        if (syncRoomProgress) localStorage.setItem(getKey('construction_last_backup_roomProgress', operationProjectId), timeStr);
        if (syncChecklist) localStorage.setItem(getKey('construction_last_backup_checklist', operationProjectId), timeStr);
        if (syncCrew) localStorage.setItem(getKey('construction_last_backup_crew', operationProjectId), timeStr);
        
        // Safely update ONLY image URLs converted by Drive processing (e.g. floorPlans / defects)
        // Never restore business state (inventory, workVolumes, checklist, etc.) during Sync Up to prevent race conditions
        if (result.data) {
          if (Array.isArray(result.data.floorPlans) || Array.isArray(result.data.defects)) {
            updateAppData((prev) => {
              let updatedFloorPlans = prev.floorPlans;
              let updatedDefects = prev.defects;

              if (Array.isArray(result.data.floorPlans) && prev.floorPlans.length > 0) {
                const drivePlanMap = new Map(result.data.floorPlans.map((p: any) => [p.id, p]));
                updatedFloorPlans = prev.floorPlans.map((p) => {
                  const match = drivePlanMap.get(p.id) as any;
                  if (match && match.imageUrl && match.imageUrl.startsWith('http')) {
                    return {
                      ...p,
                      imageUrl: match.imageUrl,
                      driveFileId: match.driveFileId || p.driveFileId,
                      driveUrl: match.driveUrl || p.driveUrl
                    };
                  }
                  return p;
                });
              }

              if (Array.isArray(result.data.defects) && prev.defects.length > 0) {
                const driveDefectMap = new Map(result.data.defects.map((d: any) => [d.id, d]));
                updatedDefects = prev.defects.map((d) => {
                  const match = driveDefectMap.get(d.id) as any;
                  if (match) {
                    let changes: Partial<typeof d> = {};
                    if (match.imageUrl && match.imageUrl.startsWith('http')) changes.imageUrl = match.imageUrl;
                    if (match.afterImageUrl && match.afterImageUrl.startsWith('http')) changes.afterImageUrl = match.afterImageUrl;
                    if (Object.keys(changes).length > 0) return { ...d, ...changes };
                  }
                  return d;
                });
              }

              return {
                ...prev,
                floorPlans: updatedFloorPlans,
                defects: updatedDefects
              };
            });
          }
        }

        return { success: true, message: result.message };
      } else {
        throw new Error(result.error || 'Lỗi lưu Drive không xác định');
      }
    } catch (err: any) {
      console.warn('Drive Auto Sync Up Warning:', err.message);
      setDriveSyncStatus('error');
      return { success: false, error: err.message };
    }
  };

  const handleDriveSyncUpAll = async (customFolderId?: string) => {
    if (FIREBASE_ONLY_RUNTIME) return { success: false, error: 'Google Drive runtime đã tắt trong Firebase-only. Chỉ migration legacy được phép đọc Drive.' };
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return { success: false, error: 'Chỉ ADMIN được sao lưu toàn bộ dự án lên Drive.' };
    if (!googleServerBackendAvailable) {
      return {
        success: false,
        error: 'Đồng bộ Google Drive cần backend riêng. Bản Firebase Hosting hiện chạy tĩnh nên chức năng này đang tắt.',
      };
    }

    try {
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const allData = await buildAllProjectsBackupObject();

      const res = await apiFetch('/api/drive/sync-up-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, allData }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAuthenticated(false);
          return {
            success: false,
            error: errorData.error || 'Chưa kết nối tài khoản Google. Vui lòng kết nối tài khoản Google trong mục Cấu Hình Google.'
          };
        }
        console.warn('Drive Sync Up All Notice:', errorData);
        throw new Error(errorData.error || `Failed to upload all data (Status: ${res.status})`);
      }
      const result = await res.json();
      if (result.success) return { success: true, message: result.message };
      else throw new Error(result.error);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const handleDriveSyncDownAll = async (customFolderId?: string) => {
    if (FIREBASE_ONLY_RUNTIME) return { success: false, error: 'Drive restore/sync hai chiều đã tắt. Dùng Import Backup thủ công hoặc migration legacy có kiểm chứng.' };
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return { success: false, error: 'Chỉ ADMIN được phục hồi toàn bộ dự án từ Drive.' };
    if (!googleServerBackendAvailable) {
      return {
        success: false,
        error: 'Đồng bộ Google Drive cần backend riêng. Bản Firebase Hosting hiện chạy tĩnh nên chức năng này đang tắt.',
      };
    }

    try {
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const res = await apiFetch('/api/drive/sync-down-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setIsAuthenticated(false);
          return {
            success: false,
            error: errorData.error || 'Chưa kết nối tài khoản Google. Vui lòng kết nối tài khoản Google.'
          };
        }
        throw new Error('Failed to download all data');
      }
      const result = await res.json();
      if (result.success && result.found && result.data) {
        await restoreAllProjectsBackupObject(result.data);
        window.location.reload();
        return { success: true, message: result.message };
      }
      return { success: false, error: result.message };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Local All File Link
  const handleLinkLocalAllFile = async () => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) { alert('Chỉ ADMIN được liên kết tệp backup toàn bộ dự án.'); return; }
    try {
      if (isAndroidAutoSaveAvailable()) {
        if (!hasAndroidAutoSaveFolder()) {
          await pickAndroidAutoSaveFolder();
        }
        const allData = await buildAllProjectsBackupObject();
        const jsonStr = JSON.stringify(allData, null, 2);
        const fileName = getAllAutoSaveFileName();
        await saveTextFileToAndroidAutoFolder(jsonStr, fileName);

        localStorage.setItem(ANDROID_ALL_AUTOSAVE_ENABLED_KEY, 'true');
        const folderName = getAndroidAutoSaveFolderName();
        const displayName = folderName ? `${folderName}/${fileName}` : fileName;
        setLocalAllFileHandle(makeAndroidAutoSaveHandle('ALL', displayName));
        setLocalAllFileName(displayName);
        setLocalAllSyncPermissionNeeded(false);
        setLocalAllSyncStatus('synced');
        lastSavedLocalAllSnapshotRef.current = jsonStr;
        hasUnsavedAllBackupChangesRef.current = false;
        alert(`Da lien ket thu muc Android autosave JSON: ${displayName}`);
        return;
      }
      if (window.self !== window.top) {
        alert(
          `⚠️ Không thể sử dụng tính năng liên kết tệp trực tiếp trong khung xem trước.\n` +
          `Hãy "Mở trong Tab Mới" để chạy ứng dụng độc lập.`
        );
        return;
      }
      if (!('showSaveFilePicker' in window)) {
        alert('Trình duyệt không hỗ trợ. Hãy dùng Chrome mới nhất.');
        return;
      }
      const opt = {
        suggestedName: `[Toan_Bo_Du_An]_Backup.json`,
        types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }],
      };
      const handle = await (window as any).showSaveFilePicker(opt);
      if (handle) {
        const file = await handle.getFile();
        const allData = await buildAllProjectsBackupObject();
        const jsonStr = JSON.stringify(allData, null, 2);
        if (file.size === 0) {
          const writable = await handle.createWritable();
          await writable.write(jsonStr);
          await writable.close();
        }
        await saveFileHandle(handle, 'ALL');
        setLocalAllFileHandle(handle);
        setLocalAllFileName(handle.name);
        setLocalAllSyncPermissionNeeded(false);

        lastSavedLocalAllSnapshotRef.current = jsonStr;
        setLocalAllSyncStatus('synced');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('Link file error:', err);
    }
  };

  const handleUnlinkLocalAllFile = async () => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return;
    if (isAndroidAutoSaveHandle(localAllFileHandle)) {
      localStorage.removeItem(ANDROID_ALL_AUTOSAVE_ENABLED_KEY);
      setLocalAllFileHandle(null);
      setLocalAllFileName('');
      setLocalAllSyncStatus('idle');
      setLocalAllSyncPermissionNeeded(false);
      return;
    }
    await removeFileHandle('ALL');
    setLocalAllFileHandle(null);
    setLocalAllFileName('');
    setLocalAllSyncStatus('idle');
    setLocalAllSyncPermissionNeeded(false);
  };

  const handleRequestLocalAllFilePermission = async () => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return;
    if (!localAllFileHandle) return;
    try {
      if (isAndroidAutoSaveHandle(localAllFileHandle)) {
        if (!hasAndroidAutoSaveFolder()) {
          await pickAndroidAutoSaveFolder();
        }
        setLocalAllSyncPermissionNeeded(false);
        setLocalAllSyncStatus('saving');
        const allData = await buildAllProjectsBackupObject();
        const jsonStr = JSON.stringify(allData, null, 2);
        await saveTextFileToAndroidAutoFolder(jsonStr, getAllAutoSaveFileName());
        lastSavedLocalAllSnapshotRef.current = jsonStr;
        hasUnsavedAllBackupChangesRef.current = false;
        setLocalAllSyncStatus('synced');
        return;
      }
      const options = { mode: 'readwrite' as const };
      const permission = await localAllFileHandle.requestPermission(options);
      if (permission === 'granted') {
        setLocalAllSyncPermissionNeeded(false);
        setLocalAllSyncStatus('saving');
        const writable = await localAllFileHandle.createWritable();
        const allData = await buildAllProjectsBackupObject();
        await writable.write(JSON.stringify(allData, null, 2));
        await writable.close();
        setLocalAllSyncStatus('synced');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Google Drive Sync Down
  const handleDriveSyncDown = async (customFolderId?: string, forceOverwrite = false) => {
    if (FIREBASE_ONLY_RUNTIME) return { success: false, error: 'Drive sync-down runtime đã tắt trong Firebase-only. Drive legacy không còn là nguồn realtime.' };
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return { success: false, error: 'Chỉ ADMIN được phục hồi dữ liệu dự án từ Drive.' };
    if (syncLockRef.current || switchingProjectRef.current) return { success: false, message: 'Hệ thống đang đồng bộ dữ liệu.' };
    if (!googleServerBackendAvailable) {
      setDriveSyncStatus('idle');
      return {
        success: false,
        error: 'Đồng bộ Google Drive cần backend riêng. Bản Firebase Hosting hiện chạy tĩnh nên chức năng này đang tắt.',
      };
    }
    const operationProjectId = activeProjectIdRef.current || activeProjectId;

    try {
      syncLockRef.current = true;
      setDriveSyncStatus('syncing');
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';

      const res = await apiFetch('/api/drive/sync-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, projectId: operationProjectId }),
      });

      if (!res.ok) {
        throw new Error('Không thể tải file đồng bộ từ Google Drive');
      }

      const result = await res.json();
      if (switchingProjectRef.current || activeProjectIdRef.current !== operationProjectId) {
        console.warn('[DRIVE SYNC DOWN CANCELLED] Project changed during sync down');
        return { success: false, message: 'Dự án đã thay đổi trong khi tải Drive.' };
      }

      if (result.success && result.found && result.data) {
        const remoteData = result.data;
        if (remoteData.projectId && remoteData.projectId !== operationProjectId) {
          throw new Error(`Dữ liệu Drive (${remoteData.projectId}) không thuộc dự án hiện tại (${operationProjectId})`);
        }
        const remoteUpdatedAt = remoteData.updatedAt || 0;
        const localUpdatedAt = parseInt(localStorage.getItem(getKey('construction_updated_at', operationProjectId)) || '0', 10);

        if (forceOverwrite || remoteUpdatedAt > localUpdatedAt) {
          const pid = operationProjectId;
          if (activeProjectIdRef.current === pid) {
            if (remoteData.projectName) setProjectName(remoteData.projectName);
            if (remoteData.contractorName) setContractorName(remoteData.contractorName);
            if (remoteData.inspectorName) setInspectorName(remoteData.inspectorName);
            setLastUpdatedAt(remoteUpdatedAt);
          }
          if (remoteData.projectName) {
            safeSetLocalStorageItem(getKey('construction_project_name', pid), remoteData.projectName);
            try {
              const projsStr = localStorage.getItem('construction_projects');
              if (projsStr) {
                const projs = JSON.parse(projsStr);
                const pIdx = projs.findIndex((p: any) => p.id === pid);
                if (pIdx >= 0 && projs[pIdx].name !== remoteData.projectName) {
                  projs[pIdx].name = remoteData.projectName;
                  localStorage.setItem('construction_projects', JSON.stringify(projs));
                }
              }
            } catch (_) {}
          }
          if (remoteData.contractorName) safeSetLocalStorageItem(getKey('construction_contractor', pid), remoteData.contractorName);
          if (remoteData.inspectorName) safeSetLocalStorageItem(getKey('construction_inspector', pid), remoteData.inspectorName);

          const nextPresent = {
            materialNorms: Array.isArray(remoteData.materialNorms) ? remoteData.materialNorms : present.materialNorms,
            inventory: Array.isArray(remoteData.inventory) ? remoteData.inventory : present.inventory,
            workVolumes: Array.isArray(remoteData.workVolumes) ? remoteData.workVolumes : present.workVolumes,
            floorPlans: Array.isArray(remoteData.floorPlans) ? remoteData.floorPlans : present.floorPlans,
            defects: Array.isArray(remoteData.defects) ? remoteData.defects : present.defects,
            roomProgressList: Array.isArray(remoteData.roomProgressList) ? remoteData.roomProgressList : present.roomProgressList,
            checklist: Array.isArray(remoteData.checklist) ? remoteData.checklist : present.checklist,
            crewRecords: Array.isArray(remoteData.crewRecords) ? remoteData.crewRecords : present.crewRecords,
            teams: Array.isArray(remoteData.teams) ? remoteData.teams : present.teams,
          };

          await Promise.all([
            setAsyncItem(getKey('construction_material_norms', pid), nextPresent.materialNorms),
            setAsyncItem(getKey('construction_inventory', pid), nextPresent.inventory),
            setAsyncItem(getKey('construction_work_volumes', pid), nextPresent.workVolumes),
            setAsyncItem(getKey('construction_floor_plans', pid), nextPresent.floorPlans),
            setAsyncItem(getKey('construction_defects', pid), nextPresent.defects),
            setAsyncItem(getKey('construction_room_progress', pid), nextPresent.roomProgressList),
            setAsyncItem(getKey('construction_checklist', pid), nextPresent.checklist),
            setAsyncItem(getKey('construction_crew_records', pid), nextPresent.crewRecords),
            setAsyncItem(getKey('construction_teams', pid), nextPresent.teams)
          ]);

          if (activeProjectIdRef.current === pid) {
            setPresent(nextPresent);
          }

          if (Array.isArray(remoteData.teams)) {
            localStorage.setItem(getKey('construction_teams', pid), JSON.stringify(remoteData.teams));
          }

          const timeStr = formatDateTime(remoteUpdatedAt || Date.now());
          setDriveLastSyncTime(timeStr);
          localStorage.setItem(getKey('construction_drive_last_sync', pid), timeStr);
          localStorage.setItem(getKey('construction_updated_at', pid), String(remoteUpdatedAt));
          
          // Save all individual category last backup timestamps
          localStorage.setItem(getKey('construction_last_backup_norms', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_inventory', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_workVolumes', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_floorPlans', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_defects', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_roomProgress', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_checklist', pid), timeStr);
          localStorage.setItem(getKey('construction_last_backup_crew', pid), timeStr);
          setDriveSyncStatus('synced');
          return { success: true, updated: true, message: 'Đã tải và khôi phục dữ liệu mới nhất từ Drive!' };
        } else if (remoteUpdatedAt < localUpdatedAt) {
          // Local is newer - auto push to cloud
          setDriveSyncStatus('synced');
          if (autoSyncEnabled) {
            syncLockRef.current = false;
            await handleDriveSyncUp(folderId);
            syncLockRef.current = true;
          }
          return { success: true, updated: false, message: 'Thiết bị hiện tại mới nhất, đã đẩy lên Drive.' };
        } else {
          setDriveSyncStatus('synced');
          return { success: true, updated: false, message: 'Dữ liệu thiết bị đã trùng khớp hoàn toàn.' };
        }
      } else {
        // No backup file yet, perform a first upload if enabled
        if (autoSyncEnabled) {
          syncLockRef.current = false;
          await handleDriveSyncUp(folderId);
          syncLockRef.current = true;
        }
        setDriveSyncStatus('idle');
        return { success: false, found: false, message: result.message || 'Chưa tìm thấy dữ liệu sao lưu.' };
      }
    } catch (err: any) {
      console.error('Drive Auto Sync Down Error:', err);
      setDriveSyncStatus('error');
      return { success: false, error: err.message };
    } finally {
      setTimeout(() => {
        syncLockRef.current = false;
      }, 500);
    }
  };

  // Check auth and auto sync on mount
  useEffect(() => {
    if (!isHydrated) return;
    if (!googleServerBackendAvailable) return;
    const checkAuthAndAutoSync = async () => {
      try {
        const res = await apiFetch('/api/auth/status');
        if (res.ok) {
          const authData = await res.json();
          if (authData.authenticated) {
            setIsAuthenticated(true);
            if (!FIREBASE_ONLY_RUNTIME && autoSyncEnabled) {
              await handleDriveSyncDown(undefined, false);
            }
          }
        }
      } catch (err) {
        console.warn('Authentication status query warning:', err);
      }
    };
    checkAuthAndAutoSync();
  }, [isHydrated]);

  // Debounced auto-save to Google Drive & Cloud on local changes (using Subcollection Diffs)
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing) return;
    if (!isProjectRoleResolved) return;
    if (!projectRoleAllowed) return;
    if (projectRoleSource !== 'cloud' && projectRoleSource !== 'offline-cache') return;
    if (!canEditProjectData(currentUserRole)) return;
    if (syncLockRef.current || switchingProjectRef.current) return;
    if (!cloudUserKey) return;

    // Online writes wait for the full 9-dataset bootstrap. Offline writes are different:
    // once the project was hydrated from Firestore cache and the exact user+project role
    // lease is verified, mutations must be queued immediately into Firestore persistence.
    // Otherwise an offline edit could exist only in React RAM and disappear on reload.
    const canQueueOfflineFirestoreWrite = FIREBASE_ONLY_RUNTIME
      && !isOnline
      && (projectRoleSource === 'offline-cache' || projectRoleSource === 'cloud')
      && (businessDataSource === 'firestore-cache' || businessDataSource === 'cloud');
    const canWriteOnline = isOnline && projectRoleSource === 'cloud' && cloudInitialReady;
    if (!canWriteOnline && !canQueueOfflineFirestoreWrite) return;

    const projectIdForThisSave = activeProjectId;
    const priorityRevisionAtSchedule = priorityCloudSyncRevisionRef.current;
    const hasPriorityRealtimeChange = priorityRevisionAtSchedule > flushedPriorityCloudSyncRevisionRef.current;
    const cloudSaveDelayMs = canQueueOfflineFirestoreWrite ? 0 : (hasPriorityRealtimeChange ? 300 : 6000);

    if (hasPriorityRealtimeChange) {
      setDataCloudStatus({ phase: 'syncing', message: 'Đang đồng bộ thay đổi quan trọng...' });
    }

    const timer = setTimeout(() => {
      if (!syncLockRef.current && !switchingProjectRef.current && activeProjectIdRef.current === projectIdForThisSave) {
        if (!FIREBASE_ONLY_RUNTIME && autoSyncEnabled && googleServerBackendAvailable) {
          handleDriveSyncUp().catch(err => console.warn('Auto drive sync warning:', err));
        }
        
        // Realtime Cloud Auto Save (Subcollections)
        try {
          const activeId = projectIdForThisSave;
          
          // Compute added/modified and deleted diffs relative to lastSyncedPresentRef
          const prev = lastSyncedPresentRef.current || {
            materialNorms: [], inventory: [], workVolumes: [], floorPlans: [],
            defects: [], roomProgressList: [], checklist: [], crewRecords: [], teams: []
          };
          
          const keys = REALTIME_STATE_KEYS as (keyof AppData)[];

          const addedOrModified: Record<string, any[]> = {};
          const deletedIds: Record<string, Array<{ id: string; deletedAt: number; revision: number }>> = {};
          let hasChanges = false;

          for (const k of keys) {
            const prevList = prev[k] || [];
            const nextList = present[k] || [];
            const cloudName = STATE_KEY_TO_CLOUD_NAME[k as keyof typeof STATE_KEY_TO_CLOUD_NAME];

            const prevMap = new Map<string, any>();
            prevList.forEach((item: any) => {
              if (item && item.id) prevMap.set(item.id, item);
            });

            const nextMap = new Map<string, any>();
            const addedList: any[] = [];
            nextList.forEach((item: any) => {
              if (!item || !item.id) return;
              nextMap.set(item.id, item);
              const prevItem = prevMap.get(item.id);
              if (!prevItem || Number(prevItem.updatedAt || 0) !== Number(item.updatedAt || 0)) {
                // Ensure item has updatedAt so conflict reconciliation knows which is newer
                const updatedItem = {
                  ...item,
                  updatedAt: item.updatedAt || Date.now()
                };
                addedList.push(updatedItem);
              }
            });

            const deleted: Array<{ id: string; deletedAt: number; revision: number }> = [];
            prevList.forEach((item: any) => {
              if (item && item.id && !nextMap.has(item.id)) {
                // Preserve the timestamp of the actual user delete. Reconnect time must
                // never become the tombstone time, otherwise an old offline device can
                // make a stale deletion appear newer than a legitimate Cloud edit.
                const deletedAt = Number(localTombstonesRef.current[`${String(k)}_${String(item.id)}`] || item.deletedAt || item.updatedAt || Date.now());
                deleted.push({
                  id: String(item.id),
                  deletedAt,
                  revision: Math.max(Number(item.revision || 0) + 1, 1),
                });
              }
            });

            if (addedList.length > 0) {
              addedOrModified[cloudName] = addedList;
              hasChanges = true;
            }
            if (deleted.length > 0) {
              deletedIds[cloudName] = deleted;
              hasChanges = true;
            }
          }

          const metadataChanged = !lastSyncedMetadataRef.current ||
            lastSyncedMetadataRef.current.projectName !== projectName ||
            lastSyncedMetadataRef.current.contractorName !== contractorName ||
            lastSyncedMetadataRef.current.inspectorName !== inspectorName;

          if (hasChanges || metadataChanged || !lastSyncedPresentRef.current) {
            // Save metadata and only changed records
            const snapshotForSave = present;

            if (canQueueOfflineFirestoreWrite) {
              const queued = queueProjectDiffsToFirestoreOffline(activeId, projectName, contractorName, inspectorName, {
                addedOrModified,
                deletedIds
              }, {
                touchProjectMetadata: currentUserRole === 'ADMIN' && (metadataChanged || !lastSyncedPresentRef.current),
              });

              if (queued.queuedRecords > 0 || metadataChanged) {
                // Advance the local diff baseline after the SDK accepts the mutations into
                // its persistence layer. This prevents repeatedly enqueuing the same local
                // revision while offline; server rejection is reconciled by realtime later.
                lastSyncedPresentRef.current = snapshotForSave;
                lastSyncedMetadataRef.current = { projectName, contractorName, inspectorName };
                flushedPriorityCloudSyncRevisionRef.current = Math.max(flushedPriorityCloudSyncRevisionRef.current, priorityRevisionAtSchedule);
                if (queued.queuedRecords > 0) adjustFirestorePendingWriteCount(queued.queuedRecords);
                setDataCloudStatus({
                  phase: 'syncing',
                  message: queued.queuedRecords > 0
                    ? `Offline · ${queued.queuedRecords} thay đổi đã vào hàng chờ Firestore.`
                    : 'Offline · thay đổi cấu hình đã vào hàng chờ Firestore.',
                });

                if (queued.commitPromises.length > 0) {
                  void Promise.allSettled(queued.commitPromises).then((results) => {
                    adjustFirestorePendingWriteCount(-queued.queuedRecords);
                    if (switchingProjectRef.current || activeProjectIdRef.current !== activeId) return;
                    const rejected = results.filter((result) => result.status === 'rejected');
                    if (rejected.length > 0) {
                      const firstReason: any = (rejected[0] as PromiseRejectedResult).reason;
                      const code = String(firstReason?.code || '');
                      setDataCloudStatus({
                        phase: code === 'permission-denied' ? 'conflict' : 'error',
                        message: code === 'permission-denied'
                          ? 'Pending offline bị Rules/revision từ chối. Dữ liệu Cloud mới hơn sẽ được realtime hòa giải; không tự ghi đè.'
                          : `Có pending offline không gửi được: ${firstReason?.message || String(firstReason)}`,
                      });
                    } else if (firestorePendingWriteCountRef.current === 0) {
                      setDataCloudStatus({ phase: 'synced', lastSyncAt: Date.now(), message: 'Các thay đổi offline đã được Firebase xác nhận.' });
                    }
                  });
                }
              }
              return;
            }

            queueCloudSave(async () => {
              await saveProjectDiffsToCloud(activeId, projectName, contractorName, inspectorName, {
                addedOrModified,
                deletedIds
              }, {
                touchProjectMetadata: currentUserRole === 'ADMIN' && (metadataChanged || !lastSyncedPresentRef.current),
                allowRootMetadataWrite: currentUserRole === 'ADMIN',
                rootTouchIntervalMs: 60000,
                auditDetailLimit: 20,
              });
              // A single FIFO queue prevents an older request finishing after a newer one.
              if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                lastSyncedPresentRef.current = snapshotForSave;
                lastSyncedMetadataRef.current = { projectName, contractorName, inspectorName };
                flushedPriorityCloudSyncRevisionRef.current = Math.max(flushedPriorityCloudSyncRevisionRef.current, priorityRevisionAtSchedule);
                cloudDataRetryAttemptRef.current = 0;
                if (cloudDataRetryTimerRef.current !== null) {
                  window.clearTimeout(cloudDataRetryTimerRef.current);
                  cloudDataRetryTimerRef.current = null;
                }
                setDataCloudStatus({ phase: 'synced', lastSyncAt: Date.now() });
              }
            }).catch(err => {
              console.warn('Cloud auto save notice:', err);
              if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                const errorCode = String((err as any)?.code || '');
                const errorMessage = err instanceof Error ? err.message : 'Không thể đồng bộ dữ liệu lên Firebase.';
                const looksLikeConflict = errorCode === 'permission-denied' && canEditProjectData(currentUserRole);
                setDataCloudStatus({
                  phase: looksLikeConflict ? 'conflict' : 'error',
                  message: looksLikeConflict
                    ? 'Có xung đột revision hoặc Rules từ chối bản ghi cũ. Ứng dụng giữ dữ liệu Cloud mới hơn và chờ realtime hòa giải.'
                    : errorMessage
                });
                const shouldRetry = typeof navigator === 'undefined' || navigator.onLine;
                if (shouldRetry && errorCode !== 'permission-denied' && cloudDataRetryTimerRef.current === null) {
                  const attempt = Math.min(5, cloudDataRetryAttemptRef.current + 1);
                  cloudDataRetryAttemptRef.current = attempt;
                  const delay = Math.min(20000, 1500 * Math.pow(2, attempt - 1));
                  cloudDataRetryTimerRef.current = window.setTimeout(() => {
                    cloudDataRetryTimerRef.current = null;
                    if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                      setCloudDataRetryTick((tick) => tick + 1);
                    }
                  }, delay);
                }
              }
            });
          }
        } catch (e) {
          console.warn('Cloud auto save exception:', e);
        }
      }
    }, cloudSaveDelayMs); // V6.2.25: Defect/crew priority flush 300ms; other edits retain 6s batching.

    return () => clearTimeout(timer);
  }, [present, projectName, contractorName, inspectorName, autoSyncEnabled, isHydrated, isLoadingProject, isRestoring, isInitializing, activeProjectId, cloudUserKey, cloudInitialReady, currentUserRole, isProjectRoleResolved, cloudDataRetryTick, isOnline, projectRoleSource, projectRoleAllowed, businessDataSource]);

  // Local File Auto-Save Debounced Effect
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring) return;
    if (!localFileHandle) return;
    if (syncLockRef.current) return;
    if (!hasUserEditedSinceHydrateRef.current) return;

    const timer = setTimeout(async () => {
      try {
        const jsonString = await buildSingleProjectBackupJson();

        // Skip writing if data has not changed since link / last save
        if (jsonString === lastSavedLocalSnapshotRef.current) {
          setLocalSyncStatus('synced');
          setLocalSyncPermissionNeeded(false);
          return;
        }

        if (isAndroidAutoSaveHandle(localFileHandle)) {
          if (!hasAndroidAutoSaveFolder()) {
            setLocalSyncPermissionNeeded(true);
            setLocalSyncStatus('idle');
            return;
          }
          setLocalSyncStatus('saving');
          await saveTextFileToAndroidAutoFolder(jsonString, getSingleAutoSaveFileName());
          lastSavedLocalSnapshotRef.current = jsonString;
          setLocalSyncStatus('synced');
          setLocalSyncPermissionNeeded(false);
          return;
        }

        const options = { mode: 'readwrite' as const };
        const permissionStatus = await localFileHandle.queryPermission(options);
        
        if (permissionStatus !== 'granted') {
          setLocalSyncPermissionNeeded(true);
          setLocalSyncStatus('idle');
          return;
        }

        setLocalSyncStatus('saving');
        const writable = await localFileHandle.createWritable();

        await writable.write(jsonString);
        await writable.close();
        lastSavedLocalSnapshotRef.current = jsonString;
        setLocalSyncStatus('synced');
        setLocalSyncPermissionNeeded(false);
      } catch (err) {
        console.error('Error auto-saving to local file:', err);
        setLocalSyncStatus('error');
      }
    }, 2000); // 2 seconds debounce for local file updates

    return () => clearTimeout(timer);
  }, [localFileHandle, present, projectName, contractorName, inspectorName, lastUpdatedAt, activeProjectId]);

  const saveAutoSaveVersion = async (allData: any) => {
    try {
      const now = Date.now();
      const dateObj = new Date(now);
      
      const year = dateObj.getFullYear();
      const month = dateObj.getMonth() + 1; // 1-12
      const date = dateObj.getDate();
      const hour = dateObj.getHours();

      // Get week number
      const tempDate = new Date(dateObj.getTime());
      tempDate.setHours(0, 0, 0, 0);
      tempDate.setDate(tempDate.getDate() + 3 - (tempDate.getDay() + 6) % 7);
      const week1 = new Date(tempDate.getFullYear(), 0, 4);
      const weekNum = 1 + Math.round(((tempDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

      const hourKey = `${year}-${month}-${date} H${hour}`;
      const dayKey = `${year}-${month}-${date}`;
      const weekKey = `${year}-W${weekNum}`;
      const monthKey = `${year}-${month}`;

      // Check if we already have backups for these keys in our history
      const hasHour = autosaveVersions.some(v => v.hourKey === hourKey);
      const hasDay = autosaveVersions.some(v => v.dayKey === dayKey);
      const hasWeek = autosaveVersions.some(v => v.weekKey === weekKey);
      const hasMonth = autosaveVersions.some(v => v.monthKey === monthKey);

      let typeLabel = 'Thủ Công';
      let tag: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual' = 'manual';

      if (!hasMonth) {
        tag = 'monthly';
        typeLabel = 'Theo Tháng';
      } else if (!hasWeek) {
        tag = 'weekly';
        typeLabel = 'Theo Tuần';
      } else if (!hasDay) {
        tag = 'daily';
        typeLabel = 'Theo Ngày';
      } else if (!hasHour) {
        tag = 'hourly';
        typeLabel = 'Theo Giờ';
      } else {
        const lastVer = autosaveVersions[0];
        if (lastVer && (now - lastVer.timestamp < 10 * 60 * 1000)) {
          // Less than 10 mins ago, let's skip to save space
          return;
        }
        tag = 'hourly';
        typeLabel = 'Theo Giờ';
      }

      // Read max versions from localStorage (default 15)
      const maxStr = localStorage.getItem('construction_max_autosave_versions') || '15';
      const maxVersions = parseInt(maxStr, 10) || 15;

      let statsText = '';
      try {
        const rawPresent = allData['construction_present'] || allData[getKey('construction_present')];
        if (rawPresent) {
          const pres = JSON.parse(rawPresent);
          const checklistCount = Array.isArray(pres.checklist) ? pres.checklist.length : 0;
          const defectCount = Array.isArray(pres.defects) ? pres.defects.length : 0;
          const volCount = Array.isArray(pres.workVolumes) ? pres.workVolumes.length : 0;
          statsText = `${checklistCount} tiêu chí, ${defectCount} lỗi, ${volCount} khối lượng`;
        }
      } catch (e) {
        statsText = 'Dữ liệu dự án';
      }

      const newVersion: BackupVersion = {
        id: `ver_${now}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: now,
        type: tag,
        typeLabel,
        hourKey,
        dayKey,
        weekKey,
        monthKey,
        stats: statsText,
        projectName: projectName || 'Dự án hiện tại',
        data: allData
      };

      const updated = await saveBackupVersion(newVersion, maxVersions);
      setAutosaveVersions(updated);
    } catch (err) {
      console.error('Error saving autosave version history:', err);
    }
  };

  const handleCreateManualBackup = async () => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) { alert('Chỉ ADMIN được tạo điểm backup thủ công.'); return; }
    const allData = await buildAllProjectsBackupObject();

    try {
      const now = Date.now();
      
      let statsText = '';
      try {
        const rawPresent = allData['construction_present'] || allData[getKey('construction_present')];
        if (rawPresent) {
          const pres = JSON.parse(rawPresent);
          const checklistCount = Array.isArray(pres.checklist) ? pres.checklist.length : 0;
          const defectCount = Array.isArray(pres.defects) ? pres.defects.length : 0;
          const volCount = Array.isArray(pres.workVolumes) ? pres.workVolumes.length : 0;
          statsText = `${checklistCount} tiêu chí, ${defectCount} lỗi, ${volCount} khối lượng`;
        }
      } catch (e) {
        statsText = 'Dữ liệu thủ công';
      }

      const maxStr = localStorage.getItem('construction_max_autosave_versions') || '15';
      const maxVersions = parseInt(maxStr, 10) || 15;

      const newVersion: BackupVersion = {
        id: `ver_${now}_manual`,
        timestamp: now,
        type: 'manual',
        typeLabel: 'Thủ Công (Bút bấm)',
        stats: statsText,
        projectName: projectName || 'Dự án hiện tại',
        data: allData
      };

      const updated = await saveBackupVersion(newVersion, maxVersions);
      setAutosaveVersions(updated);

      if (!FIREBASE_ONLY_RUNTIME) {
        try {
          const driveBackup = await buildPrimaryDriveBackupObject();
          await uploadProjectBackupToPrimaryDrive(activeProjectIdRef.current, driveBackup, 'manual');
          lastPrimaryDriveBackupAtRef.current = Date.now();
        } catch (driveErr) {
          console.warn('[Primary Drive] legacy manual backup mirror skipped:', driveErr);
        }
      }
      alert('Đã tạo điểm phục hồi dự án thành công!');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAutoSaveVersion = async (id: string) => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return;
    try {
      const updated = await deleteBackupVersion(id);
      setAutosaveVersions(updated);
    } catch (e) {
      console.error('Error deleting backup version:', e);
    }
  };

  const handleRestoreAutoSaveVersion = async (versionData: any) => {
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) { alert('Chỉ ADMIN được phục hồi phiên bản backup.'); return; }
    if (!versionData || typeof versionData !== 'object') {
      alert('Dữ liệu bản sao lưu không hợp lệ!');
      return;
    }
    
    if (await confirmAsync('⚠️ Chú ý: Việc phục hồi phiên bản này sẽ ghi dữ liệu sao lưu trở lại dự án hiện tại. Bạn có muốn tiếp tục?')) {
      syncLockRef.current = true;
      try {
        if (FIREBASE_ONLY_RUNTIME) {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('Khôi phục backup Firebase-only cần online để kiểm tra revision và ghi Firestore/Storage an toàn.');
          }
          const projectId = activeProjectIdRef.current || activeProjectId;
          const normalized = normalizeImportedData(versionData, projectId, projectId);
          await handleRestoreData(normalized, projectId);
          await restorePhotoBackupBundle(versionData);
          const photoResult = await syncProjectPhotosToCloud(projectId);
          if (Number(photoResult.failed || 0) > 0) {
            throw new Error(`Còn ${photoResult.failed} ảnh backup chưa tải lên Firebase Storage.`);
          }
        } else {
          await restoreAllProjectsBackupObject(versionData);
        }
        alert('🎉 Phục hồi phiên bản sao lưu thành công!');
        window.location.reload();
      } catch (err) {
        console.error('Restore version error:', err);
        alert(err instanceof Error ? err.message : 'Có lỗi xảy ra khi phục hồi phiên bản.');
        syncLockRef.current = false;
      }
    }
  };

  // Local All File Auto-Save Debounced Effect
  useEffect(() => {
    if (FIREBASE_ONLY_RUNTIME) return; // JSON is manual Backup/Export/Import only.
    if (!isHydrated || isLoadingProject || isRestoring) return;
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) return;
    if (!localAllFileHandle) return;
    if (syncLockRef.current) return;
    if (!hasUnsavedAllBackupChangesRef.current) return;

    const timer = setTimeout(async () => {
      try {
        const allData = await buildAllProjectsBackupObject();
        
        const jsonString = JSON.stringify(allData, null, 2);

        // Skip writing if data has not changed since link / last save
        if (jsonString === lastSavedLocalAllSnapshotRef.current) {
          setLocalAllSyncStatus('synced');
          setLocalAllSyncPermissionNeeded(false);
          return;
        }

        if (isAndroidAutoSaveHandle(localAllFileHandle)) {
          if (!hasAndroidAutoSaveFolder()) {
            setLocalAllSyncPermissionNeeded(true);
            setLocalAllSyncStatus('idle');
            return;
          }
          setLocalAllSyncStatus('saving');
          await saveTextFileToAndroidAutoFolder(jsonString, getAllAutoSaveFileName());
          lastSavedLocalAllSnapshotRef.current = jsonString;
          hasUnsavedAllBackupChangesRef.current = false;
          saveAutoSaveVersion(allData);
          setLocalAllSyncStatus('synced');
          setLocalAllSyncPermissionNeeded(false);
          return;
        }

        const options = { mode: 'readwrite' as const };
        const permissionStatus = await localAllFileHandle.queryPermission(options);
        
        if (permissionStatus !== 'granted') {
          setLocalAllSyncPermissionNeeded(true);
          setLocalAllSyncStatus('idle');
          return;
        }

        setLocalAllSyncStatus('saving');
        const writable = await localAllFileHandle.createWritable();

        await writable.write(jsonString);
        await writable.close();
        
        lastSavedLocalAllSnapshotRef.current = jsonString;
        hasUnsavedAllBackupChangesRef.current = false;
        saveAutoSaveVersion(allData);

        setLocalAllSyncStatus('synced');
        setLocalAllSyncPermissionNeeded(false);
      } catch (err) {
        console.error('Error auto-saving all to local file:', err);
        setLocalAllSyncStatus('error');
      }
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timer);
  }, [localAllFileHandle, present, projectName, contractorName, inspectorName, lastUpdatedAt, isProjectRoleResolved, currentUserRole]);

  // Background version backup: gate cheaply BEFORE building any backup object.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing) return;
    if (syncLockRef.current || switchingProjectRef.current) return;
    if (!lastUpdatedAt || !hasUserEditedSinceHydrateRef.current) return;

    const rawInterval = localStorage.getItem('construction_backup_interval_ms') || '3600000';
    const intervalMs = Number(rawInterval);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return; // 0 = Tắt

    const now = Date.now();
    if (now - lastLocalVersionBackupAtRef.current < intervalMs) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const projectIdForBackup = activeProjectIdRef.current;
    const timer = window.setTimeout(async () => {
      if (syncLockRef.current || switchingProjectRef.current) return;
      if (activeProjectIdRef.current !== projectIdForBackup) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const checkNow = Date.now();
      if (checkNow - lastLocalVersionBackupAtRef.current < intervalMs) return;

      try {
        // Local version history is scoped to the CURRENT project only.
        // Never serialize every project for a routine background snapshot.
        const currentProjectData = await buildCurrentProjectVersionBackupObject();
        await saveAutoSaveVersion(currentProjectData);
        lastLocalVersionBackupAtRef.current = Date.now();

        // Drive backup is legacy-only. Firebase-only runtime never writes runtime/backup
        // data to Drive; existing Drive data remains read-only until migration verification.
        if (!FIREBASE_ONLY_RUNTIME && Date.now() - lastPrimaryDriveBackupAtRef.current >= intervalMs && await isPrimaryDriveReady().catch(() => false)) {
          try {
            const driveBackup = await buildPrimaryDriveBackupObject();
            await uploadProjectBackupToPrimaryDrive(projectIdForBackup, driveBackup, 'auto');
            lastPrimaryDriveBackupAtRef.current = Date.now();
          } catch (driveErr) {
            console.warn('[Primary Drive] auto backup skipped:', driveErr);
          }
        }
      } catch (err) {
        console.error('Error in background auto-saving version:', err);
      }
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [lastUpdatedAt, isHydrated, isLoadingProject, isRestoring, isInitializing, activeProjectId]);

  // Link local JSON file for auto sync
  const handleLinkLocalFile = async () => {
    if (FIREBASE_ONLY_RUNTIME) {
      alert('Firebase-only: tự đồng bộ JSON đã tắt. JSON chỉ dùng Backup / Export / Import thủ công.');
      return;
    }
    try {
      if (isAndroidAutoSaveAvailable()) {
        if (!hasAndroidAutoSaveFolder()) {
          await pickAndroidAutoSaveFolder();
        }
        const jsonString = await buildSingleProjectBackupJson();
        const fileName = getSingleAutoSaveFileName();
        await saveTextFileToAndroidAutoFolder(jsonString, fileName);

        localStorage.setItem(getAndroidSingleAutosaveKey(activeProjectId), 'true');
        const folderName = getAndroidAutoSaveFolderName();
        const displayName = folderName ? `${folderName}/${fileName}` : fileName;
        setLocalFileHandle(makeAndroidAutoSaveHandle(activeProjectId, displayName));
        setLocalFileName(displayName);
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('synced');
        lastSavedLocalSnapshotRef.current = jsonString;
        alert(`Da lien ket thu muc Android autosave JSON: ${displayName}`);
        return;
      }
      if (window.self !== window.top) {
        alert(
          `⚠️ Không thể sử dụng tính năng liên kết tệp trực tiếp trong khung xem trước (Iframe) của AI Studio.\n\n` +
          `👉 Cách khắc phục:\n` +
          `1. Hãy bấm vào biểu tượng "Mở trong Tab Mới" (mũi tên góc trên bên phải khung xem trước) để chạy ứng dụng độc lập.\n` +
          `2. Sau đó, bạn có thể liên kết tự động lưu tệp JSON bình thường.`
        );
        return;
      }

      if (!('showSaveFilePicker' in window)) {
        alert('Trình duyệt của bạn không hỗ trợ ghi tệp trực tiếp. Vui lòng sử dụng Chrome, Edge hoặc Safari mới nhất.');
        return;
      }

      const opt = {
        suggestedName: `[Auto_Sync_Backup]_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
        types: [{
          description: 'Cấu hình dự án JSON',
          accept: {
            'application/json': ['.json'],
          },
        }],
      };

      const handle = await (window as any).showSaveFilePicker(opt);
      if (handle) {
        const file = await handle.getFile();
        const jsonString = await buildSingleProjectBackupJson();

        if (file.size === 0) {
          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();
        } else {
          try {
            const existingText = await file.text();
            const parsed = JSON.parse(existingText);
            const fileProjectId = parsed.schemaVersion === 3 
              ? (parsed.project?.id || parsed.projectId) 
              : (parsed.projectId || parsed.id);
            if (fileProjectId && fileProjectId !== activeProjectId) {
              const fileProjName = parsed.project?.name || parsed.projectName || fileProjectId;
              alert(
                `⚠️ Tệp này đang chứa dữ liệu của dự án khác: "${fileProjName}" (Mã: ${fileProjectId}).\n\n` +
                `Vui lòng chọn một tệp JSON riêng biệt cho dự án "${projectName || activeProjectId}" để tránh ghi đè làm mất dữ liệu.`
              );
              return;
            }
          } catch (pe) {
            console.warn('Could not inspect existing file content during link:', pe);
          }
        }

        lastSavedLocalSnapshotRef.current = jsonString;
        await saveFileHandle(handle, activeProjectId);
        setLocalFileHandle(handle);
        setLocalFileName(handle.name);
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('synced');
        alert(`🎉 Đã liên kết thành công với tệp: ${handle.name}\nTự động lưu sẽ cập nhật vào tệp này khi có thay đổi.`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Error linking local file:', err);
        
        // Check for cross-origin iframe security restrictions
        const isIframeErr = err.message && (
          err.message.toLowerCase().includes('cross origin') ||
          err.message.toLowerCase().includes('sub frame') ||
          err.message.toLowerCase().includes('security')
        );

        if (isIframeErr || window.self !== window.top) {
          alert(
            `⚠️ Trình duyệt chặn quyền ghi file do ứng dụng đang chạy bên trong khung xem trước (Iframe) bảo mật của AI Studio.\n\n` +
            `👉 Cách khắc phục đơn giản:\n` +
            `1. Bấm nút "Mở trong Tab Mới" (Biểu tượng mũi tên chếch lên ở góc trên cùng bên phải màn hình preview).\n` +
            `2. Hoặc truy cập trực tiếp bằng liên kết phát triển ngoài.\n` +
            `3. Sau khi mở tab độc lập, tính năng Tự Động Lưu này sẽ hoạt động mượt mà!`
          );
        } else {
          alert('Lỗi khi thiết lập liên kết tệp: ' + err.message);
        }
      }
    }
  };

  // Unlink local file
  const handleUnlinkLocalFile = async () => {
    try {
      if (isAndroidAutoSaveHandle(localFileHandle)) {
        localStorage.removeItem(getAndroidSingleAutosaveKey(activeProjectId));
        setLocalFileHandle(null);
        setLocalFileName('');
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('idle');
        alert('Da huy lien ket autosave JSON tren Android.');
        return;
      }
      await removeFileHandle(activeProjectId);
      setLocalFileHandle(null);
      setLocalFileName('');
      setLocalSyncPermissionNeeded(false);
      setLocalSyncStatus('idle');
      alert('Đã hủy liên kết tệp tự động lưu.');
    } catch (err: any) {
      console.error('Error unlinking local file:', err);
    }
  };

  // Request/grant write permission for local file
  const handleRequestLocalFilePermission = async () => {
    if (!localFileHandle) return;
    try {
      if (isAndroidAutoSaveHandle(localFileHandle)) {
        if (!hasAndroidAutoSaveFolder()) {
          await pickAndroidAutoSaveFolder();
        }
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('saving');
        const jsonString = await buildSingleProjectBackupJson();
        await saveTextFileToAndroidAutoFolder(jsonString, getSingleAutoSaveFileName());
        lastSavedLocalSnapshotRef.current = jsonString;
        setLocalSyncStatus('synced');
        return;
      }
      const options = { mode: 'readwrite' as const };
      const permission = await localFileHandle.requestPermission(options);
      if (permission === 'granted') {
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('saving');
        
        // Immediately trigger a save to make sure it's updated
        const writable = await localFileHandle.createWritable();
        const jsonString = await buildSingleProjectBackupJson();

        await writable.write(jsonString);
        await writable.close();
        lastSavedLocalSnapshotRef.current = jsonString;
        setLocalSyncStatus('synced');
      } else {
        alert('Hệ thống cần quyền ghi để có thể tự động lưu dữ liệu vào tệp.');
      }
    } catch (err: any) {
      console.error('Error requesting local file permission:', err);
      alert('Không thể kích hoạt quyền ghi: ' + err.message);
    }
  };

  // Sync to Google Sheets API
  const handleSyncAll = async () => {
    if (FIREBASE_ONLY_RUNTIME) {
      return { success: false, message: 'Đồng bộ Google Sheets/Drive hai chiều đã tắt trong Firebase-only. Firestore là nguồn dữ liệu duy nhất; dùng Export Excel/JSON thủ công khi cần.' };
    }
    if (!isProjectRoleResolved || !canManageBackups(currentUserRole)) {
      return { success: false, message: 'Chỉ ADMIN được đồng bộ dữ liệu sang Google Sheets/Drive.' };
    }
    if (!googleServerBackendAvailable) {
      return {
        success: false,
        message: 'Đồng bộ Google Sheets cần backend riêng. Bản web hiện dùng Firebase Auth/Firestore và sao lưu cục bộ.',
      };
    }

    try {
      setIsSyncing(true);
      
      // Perform Sheet Sync
      const res = await apiFetch('/api/sheets/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          inventory,
          workVolumes,
          floorChecklists: checklist,
          defects,
          floorPlans,
          roomProgressList,
          materialNorms,
        }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || 'Phản hồi không hợp lệ' };
      }

      if (!res.ok) {
        alert(data.error || 'Đồng bộ thất bại. Vui lòng kết nối tài khoản Google.');
        return { success: false };
      }

      // Perform a Drive Backup sync up as well
      await handleDriveSyncUp();

      return {
        success: true,
        url: data.spreadsheetUrl,
        message: 'Đồng bộ Google Sheets & tự động lưu bản sao lưu lên Google Drive thành công!',
      };
    } catch (err: any) {
      alert(`Lỗi đồng bộ: ${err.message}`);
      return { success: false };
    } finally {
      setIsSyncing(false);
    }
  };

  // Handlers for Material Norms (Auto updates material names in inventory if norm is renamed)
  const handleAddNorm = (normData: Omit<MaterialNorm, 'id'>) => {
    if (!isProjectRoleResolved || !canManageMaterialNorms(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được thêm định mức vật tư.'); return; }
    const newId = createEntityId('NORM');
    updateAppData((prev) => {
      const normalizedUnit = normalizeUnit(normData.unit) || normData.unit;
      const materialKey = `${normalizeMaterialNameKey(normData.materialName)}|${normalizedUnit}`;
      const existingMaterial = prev.materialNorms.find((norm) =>
        `${normalizeMaterialNameKey(norm.materialName)}|${normalizeUnit(norm.unit) || norm.unit}` === materialKey
      );
      const materialId = normData.materialId || resolveNormMaterialId(existingMaterial) || `MAT-${newId}`;
      return {
        ...prev,
        materialNorms: [{
          ...normData,
          materialId,
          unit: normalizedUnit,
          normBasisUnit: normData.normBasisUnit ? (normalizeUnit(normData.normBasisUnit) || normData.normBasisUnit) : undefined,
          id: newId,
        }, ...prev.materialNorms],
      };
    });
  };

  const handleUpdateNorm = (id: string, updated: Omit<MaterialNorm, 'id'>) => {
    if (!isProjectRoleResolved || !canManageMaterialNorms(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được sửa định mức vật tư.'); return; }
    updateAppData((prev) => {
      const oldNorm = prev.materialNorms.find((n) => n.id === id);
      const stableMaterialId = oldNorm?.materialId || `MAT-${id}`;
      const normalizedUpdated = {
        ...updated,
        materialId: updated.materialId || stableMaterialId,
        unit: normalizeUnit(updated.unit) || updated.unit,
        normBasisUnit: updated.normBasisUnit ? (normalizeUnit(updated.normBasisUnit) || updated.normBasisUnit) : undefined,
      };
      const newNorms = prev.materialNorms.map((norm) =>
        norm.id === id ? { ...norm, ...normalizedUpdated, id: norm.id } : norm
      );

      // Inventory is an immutable transaction ledger in Firebase-only. Renaming a
      // material master must not rewrite historical stock transactions or their balance
      // effect. Screens resolve the current material label by materialId where needed.
      return {
        ...prev,
        materialNorms: newNorms,
      };
    });
  };

  const handleDeleteNorm = (id: string) => {
    if (!isProjectRoleResolved || !canManageMaterialNorms(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa định mức vật tư.'); return; }
    updateAppData((prev) => ({
      ...prev,
      materialNorms: prev.materialNorms.filter((norm) => norm.id !== id),
    }));
  };

  const handleDeleteMultipleNorms = (ids: string[]) => {
    if (!isProjectRoleResolved || !canManageMaterialNorms(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa định mức vật tư.'); return; }
    updateAppData((prev) => ({
      ...prev,
      materialNorms: prev.materialNorms.filter((norm) => !ids.includes(norm.id)),
    }));
  };

  const handleImportNorms = (importedNorms: MaterialNorm[]) => {
    if (!isProjectRoleResolved || !canManageMaterialNorms(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được nhập định mức vật tư.'); return; }
    updateAppData((prev) => {
      const materialIdByNameUnit = new Map<string, string>();
      // Reuse current material identities first so importing norms cannot split one physical
      // material into several stock buckets merely because each norm row has a different ID.
      (prev.materialNorms || []).forEach((norm) => {
        const key = `${normalizeMaterialNameKey(norm.materialName)}|${normalizeUnit(norm.unit) || norm.unit}`;
        const resolvedId = resolveNormMaterialId(norm);
        if (key && resolvedId && !materialIdByNameUnit.has(key)) materialIdByNameUnit.set(key, resolvedId);
      });

      const normalizedNorms = importedNorms.map((norm) => {
        const normalizedUnit = normalizeUnit(norm.unit) || norm.unit;
        const key = `${normalizeMaterialNameKey(norm.materialName)}|${normalizedUnit}`;
        const materialId = norm.materialId || materialIdByNameUnit.get(key) || `MAT-${norm.id}`;
        if (key && materialId && !materialIdByNameUnit.has(key)) materialIdByNameUnit.set(key, materialId);
        return {
          ...norm,
          materialId,
          unit: normalizedUnit,
          normBasisUnit: norm.normBasisUnit ? (normalizeUnit(norm.normBasisUnit) || norm.normBasisUnit) : undefined,
        };
      });

      return { ...prev, materialNorms: normalizedNorms };
    });
  };

  // Handlers for Inventory. In Firebase-only runtime the inventory collection is an
  // immutable ledger and every manual/room-auto mutation must pass through the atomic
  // Firestore transaction service that updates inventory_balances in the same commit.
  // React state is then refreshed by the normal Firestore realtime listener; this avoids
  // a second local write path racing the server transaction.
  const handleAddInventory = async (item: Omit<InventoryItem, 'id'> & { id?: string }) => {
    if (!isProjectRoleResolved || !canEditWarehouseData(currentUserRole)) throw new Error('Tài khoản không có quyền tạo giao dịch kho.');
    const newId = item.id || createEntityId(item.type === 'in' ? 'NK' : 'XK');
    const normalized = { ...item, unit: normalizeUnit(item.unit) || item.unit, id: newId } as InventoryItem;

    if (FIREBASE_ONLY_RUNTIME) {
      const existing = present.inventory.find((inv) => inv.id === newId);
      if (existing) {
        await updateWarehouseTransactionAtomic(activeProjectIdRef.current, newId, {
          ...existing,
          ...normalized,
          id: newId,
          // room-auto IDs are deterministic and represent one cumulative ledger row.
          quantity: normalized.sourceType === 'room-auto'
            ? Math.max(Number(existing.quantity || 0), Number(normalized.quantity || 0))
            : Number(normalized.quantity || 0),
        });
      } else {
        await commitWarehouseTransactionAtomic(activeProjectIdRef.current, normalized);
      }
      return;
    }

    updateAppData((prev) => {
      const existingIndex = prev.inventory.findIndex((inv) => inv.id === newId);
      if (existingIndex >= 0) {
        const existing = prev.inventory[existingIndex];
        const merged = normalized.sourceType === 'room-auto'
          ? { ...existing, ...normalized, quantity: Math.max(Number(existing.quantity || 0), Number(normalized.quantity || 0)) }
          : { ...existing, ...normalized };
        return { ...prev, inventory: prev.inventory.map((inv, idx) => idx === existingIndex ? merged : inv) };
      }
      return { ...prev, inventory: [normalized, ...prev.inventory] };
    });
  };

  const handleUpdateInventory = async (id: string, item: Omit<InventoryItem, 'id'>) => {
    if (!isProjectRoleResolved || !canEditWarehouseData(currentUserRole)) throw new Error('Tài khoản không có quyền sửa giao dịch kho.');
    if (FIREBASE_ONLY_RUNTIME) {
      const current = present.inventory.find((inv) => inv.id === id);
      if (!current) throw new Error('Không tìm thấy giao dịch kho hiện tại. Hãy chờ đồng bộ Firestore rồi thử lại.');
      await updateWarehouseTransactionAtomic(activeProjectIdRef.current, id, {
        ...current,
        ...item,
        unit: normalizeUnit(item.unit) || item.unit,
        id,
      });
      return;
    }
    updateAppData((prev) => ({
      ...prev,
      inventory: prev.inventory.map((existing) => existing.id === id ? { ...existing, ...item, unit: normalizeUnit(item.unit) || item.unit, id } : existing),
    }));
  };

  const handleDeleteInventory = async (id: string) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) throw new Error('Chỉ ADMIN được xóa giao dịch kho.');
    if (FIREBASE_ONLY_RUNTIME) {
      await softDeleteWarehouseTransactionAtomic(activeProjectIdRef.current, id);
      return;
    }
    updateAppData((prev) => ({ ...prev, inventory: prev.inventory.filter((i) => i.id !== id) }));
  };

  const handleDeleteMultipleInventory = async (ids: string[]) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) throw new Error('Chỉ ADMIN được xóa giao dịch kho.');
    if (FIREBASE_ONLY_RUNTIME) {
      for (const id of ids) await softDeleteWarehouseTransactionAtomic(activeProjectIdRef.current, id);
      return;
    }
    updateAppData((prev) => ({ ...prev, inventory: prev.inventory.filter((i) => !ids.includes(i.id)) }));
  };

  const handleImportInventory = async (importedInventory: InventoryItem[]) => {
    if (!isProjectRoleResolved || !canImportData(currentUserRole)) throw new Error('Chỉ ADMIN được nhập dữ liệu kho hàng loạt.');
    const normalizedItems = importedInventory.map((item) => ({ ...item, unit: normalizeUnit(item.unit) || item.unit }));
    if (FIREBASE_ONLY_RUNTIME) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Import kho cần online để cập nhật ledger + tồn kho bằng Firestore transaction an toàn.');
      }
      const existingIds = new Set(present.inventory.map((item) => item.id));
      // UPSERT only: an import never infers deletion merely because a row is absent.
      for (const item of normalizedItems) {
        if (existingIds.has(item.id)) await updateWarehouseTransactionAtomic(activeProjectIdRef.current, item.id, item);
        else await commitWarehouseTransactionAtomic(activeProjectIdRef.current, item);
      }
      return;
    }
    updateAppData((prev) => ({ ...prev, inventory: normalizedItems }));
  };

  // Handlers for Work Volume
  const handleAddWorkVolume = (item: Omit<WorkVolume, 'id'>) => {
    if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
      console.warn('[RBAC] Chỉ ADMIN được tạo hạng mục khối lượng.');
      return;
    }
    const newId = createEntityId('HM');
    updateAppData((prev) => ({
      ...prev,
      workVolumes: [...prev.workVolumes, { ...item, unit: normalizeUnit(item.unit) || item.unit, id: newId }],
    }));
  };

  const handleSaveWorkVolume = (item: Omit<WorkVolume, 'id'> & { id?: string }) => {
    if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
      console.warn('[RBAC] Chỉ ADMIN được sửa định nghĩa hạng mục khối lượng.');
      return;
    }
    updateAppData((prev) => {
      if (item.id) {
        const oldItem = prev.workVolumes.find((w) => w.id === item.id);
        const oldTitle = oldItem?.title;
        const newTitle = item.title;

        let updatedRooms = prev.roomProgressList;
        let updatedNorms = prev.materialNorms;

        if (oldTitle && newTitle && oldTitle !== newTitle) {
          // Migrate room progress category names & keys
          updatedRooms = prev.roomProgressList.map(room => {
            let catVols = room.categoryVolumes ? { ...room.categoryVolumes } : undefined;
            if (catVols && catVols[oldTitle] !== undefined) {
              const val = catVols[oldTitle];
              delete catVols[oldTitle];
              catVols[newTitle] = val;
            }
            let subItems = room.subItems;
            if (subItems) {
              subItems = subItems.map(s => (s.category === oldTitle ? { ...s, category: newTitle } : s));
            }
            const workCat = room.workCategory === oldTitle ? newTitle : room.workCategory;
            return {
              ...room,
              workCategory: workCat,
              categoryVolumes: catVols,
              subItems
            };
          });

          // Migrate material norms category names
          updatedNorms = prev.materialNorms.map(norm => {
            const workCat = norm.workCategory === oldTitle ? newTitle : norm.workCategory;
            const workCats = norm.workCategories?.map(c => (c === oldTitle ? newTitle : c));
            let workCategoryNorms = norm.workCategoryNorms ? { ...norm.workCategoryNorms } : undefined;
            if (workCategoryNorms && workCategoryNorms[oldTitle] !== undefined) {
              const oldFactor = workCategoryNorms[oldTitle];
              delete workCategoryNorms[oldTitle];
              workCategoryNorms[newTitle] = oldFactor;
            }
            return {
              ...norm,
              workCategory: workCat,
              workCategories: workCats,
              workCategoryNorms
            };
          });
        }

        const normalizedItem = { ...item, unit: normalizeUnit(item.unit) || item.unit };
        const newWorkVolumes = prev.workVolumes.map((w) => w.id === item.id ? { ...w, ...normalizedItem, id: w.id } as WorkVolume : w);
        const { materialNorms: reconciledNorms } = reconcileMaterialNormWorkCategoryLinks(updatedNorms, newWorkVolumes);

        return {
          ...prev,
          roomProgressList: updatedRooms,
          materialNorms: reconciledNorms,
          workVolumes: newWorkVolumes
        };
      } else {
        const newId = createEntityId('HM');
        return {
          ...prev,
          workVolumes: [...prev.workVolumes, { ...item, unit: normalizeUnit(item.unit) || item.unit, id: newId }]
        };
      }
    });
  };

  const handleUpdateActualVolume = (id: string, newActual: number) => {
    if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
      console.warn('[RBAC] Không ghi trực tiếp actual vào hạng mục master; Kỹ sư cập nhật tiến độ tại Mặt bằng.');
      return;
    }
    updateAppData((prev) => ({
      ...prev,
      workVolumes: prev.workVolumes.map((item) => {
        if (item.id === id) {
          const updatedActual = Math.max(0, newActual);
          return {
            ...item,
            actual: updatedActual,
            status: updatedActual >= item.planned ? 'Đã hoàn thành' : updatedActual > 0 ? 'Đang thi công' : 'Chưa thi công',
          };
        }
        return item;
      }),
    }));
  };

  const handleDeleteWorkVolume = (id: string) => {
    if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
      console.warn('[RBAC] Chỉ ADMIN được xóa hạng mục khối lượng.');
      return;
    }
    updateAppData((prev) => {
      const targetVolume = prev.workVolumes.find((item) => item.id === id);
      const remainingVolumes = prev.workVolumes.filter((item) => item.id !== id);
      if (!targetVolume) return { ...prev, workVolumes: remainingVolumes };

      const replacementByTitle = remainingVolumes.find((item) =>
        item.title.trim().toLocaleLowerCase('vi-VN') === targetVolume.title.trim().toLocaleLowerCase('vi-VN')
      );
      const targetLinkIds = new Set([targetVolume.id, targetVolume.workCategoryId].filter((value): value is string => Boolean(value)));

      // Deleting the master WorkVolume must never erase field history from a room.
      // Keep category names, volumes and sub-items; only detach/remap the deleted foreign key.
      const updatedRoomProgressList = (prev.roomProgressList || []).map((room) => {
        let changed = false;
        let workCategoryId = room.workCategoryId;
        let categoryVolumes = room.categoryVolumes ? { ...room.categoryVolumes } : undefined;

        if (workCategoryId && targetLinkIds.has(workCategoryId)) {
          workCategoryId = replacementByTitle?.workCategoryId || replacementByTitle?.id;
          changed = true;
        }

        if (categoryVolumes) {
          for (const linkId of targetLinkIds) {
            if (!Object.prototype.hasOwnProperty.call(categoryVolumes, linkId)) continue;
            const preservedValue = Number(categoryVolumes[linkId] || 0);
            const stableName = targetVolume.title || room.workCategory || 'Hạng mục đã xóa khỏi danh mục';
            if (categoryVolumes[stableName] === undefined) categoryVolumes[stableName] = preservedValue;
            else categoryVolumes[stableName] = Math.max(Number(categoryVolumes[stableName] || 0), preservedValue);
            delete categoryVolumes[linkId];
            changed = true;
          }
        }

        const subItems = room.subItems?.map((sub) => {
          if (!sub.workCategoryId || !targetLinkIds.has(sub.workCategoryId)) return sub;
          changed = true;
          const replacement = remainingVolumes.find((item) =>
            item.title.trim().toLocaleLowerCase('vi-VN') === String(sub.category || room.workCategory || targetVolume.title).trim().toLocaleLowerCase('vi-VN')
          );
          return { ...sub, workCategoryId: replacement?.workCategoryId || replacement?.id };
        });

        return changed ? { ...room, workCategoryId, categoryVolumes, subItems } : room;
      });

      const { materialNorms: reconciledNorms } = reconcileMaterialNormWorkCategoryLinks(prev.materialNorms || [], remainingVolumes);
      return {
        ...prev,
        workVolumes: remainingVolumes,
        roomProgressList: updatedRoomProgressList,
        materialNorms: reconciledNorms,
      };
    });
  };

  const handleDeleteMultipleWorkVolumes = (ids: string[]) => {
    if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
      console.warn('[RBAC] Chỉ ADMIN được xóa nhiều hạng mục khối lượng.');
      return;
    }
    updateAppData((prev) => {
      const deleteIdSet = new Set(ids);
      const targetVolumes = prev.workVolumes.filter((item) => deleteIdSet.has(item.id));
      const remainingVolumes = prev.workVolumes.filter((item) => !deleteIdSet.has(item.id));
      if (targetVolumes.length === 0) return { ...prev, workVolumes: remainingVolumes };

      const deletedLinkIds = new Set<string>();
      const deletedByLinkId = new Map<string, WorkVolume>();
      targetVolumes.forEach((item) => {
        [item.id, item.workCategoryId].filter((value): value is string => Boolean(value)).forEach((linkId) => {
          deletedLinkIds.add(linkId);
          deletedByLinkId.set(linkId, item);
        });
      });
      const findReplacement = (categoryName?: string) => {
        const normalized = String(categoryName || '').trim().toLocaleLowerCase('vi-VN');
        if (!normalized) return undefined;
        return remainingVolumes.find((item) => item.title.trim().toLocaleLowerCase('vi-VN') === normalized);
      };

      const updatedRoomProgressList = (prev.roomProgressList || []).map((room) => {
        let changed = false;
        let workCategoryId = room.workCategoryId;
        let categoryVolumes = room.categoryVolumes ? { ...room.categoryVolumes } : undefined;

        if (workCategoryId && deletedLinkIds.has(workCategoryId)) {
          const replacement = findReplacement(room.workCategory);
          workCategoryId = replacement?.workCategoryId || replacement?.id;
          changed = true;
        }

        if (categoryVolumes) {
          for (const deleted of targetVolumes) {
            const linkIds = [deleted.id, deleted.workCategoryId].filter((value): value is string => Boolean(value));
            for (const linkId of linkIds) {
              if (!Object.prototype.hasOwnProperty.call(categoryVolumes, linkId)) continue;
              const preservedValue = Number(categoryVolumes[linkId] || 0);
              const stableName = deleted.title || room.workCategory || 'Hạng mục đã xóa khỏi danh mục';
              if (categoryVolumes[stableName] === undefined) categoryVolumes[stableName] = preservedValue;
              else categoryVolumes[stableName] = Math.max(Number(categoryVolumes[stableName] || 0), preservedValue);
              delete categoryVolumes[linkId];
              changed = true;
            }
          }
        }

        const subItems = room.subItems?.map((sub) => {
          if (!sub.workCategoryId || !deletedLinkIds.has(sub.workCategoryId)) return sub;
          changed = true;
          const deleted = deletedByLinkId.get(sub.workCategoryId);
          const replacement = findReplacement(sub.category || room.workCategory || deleted?.title);
          return { ...sub, workCategoryId: replacement?.workCategoryId || replacement?.id };
        });

        return changed ? { ...room, workCategoryId, categoryVolumes, subItems } : room;
      });

      const { materialNorms: reconciledNorms } = reconcileMaterialNormWorkCategoryLinks(prev.materialNorms || [], remainingVolumes);
      return {
        ...prev,
        workVolumes: remainingVolumes,
        roomProgressList: updatedRoomProgressList,
        materialNorms: reconciledNorms,
      };
    });
  };

  // Handlers for Floor Plans & Defects
  const handleAddFloorPlan = (plan: Omit<FloorPlan, 'id'> & { id?: string }) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    const newId = plan.id || createEntityId('fp');
    const imageRevision = Number(plan.imageRevision || Date.now());
    updateAppData((prev) => {
      const nextPlans = [...prev.floorPlans, { ...plan, id: newId, imageRevision, imageCloudRevision: 0 }];
      return {
        ...prev,
        floorPlans: nextPlans.map((fp, idx) => ({ ...fp, order: idx })),
      };
    });
  };

  const handleUpdateFloorPlan = (id: string, updates: Partial<FloorPlan>) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === id ? { ...fp, ...updates } : fp)),
    }));
  };

  const handleUpdateFloorPlanImage = (id: string, imageUrl: string) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    const imageRevision = Date.now();
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === id ? {
        ...fp,
        imageUrl,
        imageRevision,
        imageCloudRevision: 0,
        driveFileId: undefined,
        driveUrl: undefined,
        cloudFileId: undefined,
        storageProvider: undefined,
      } : fp)),
    }));
  };

  const handleRenameFloorPlan = (id: string, newName: string) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const targetPlan = floorPlans.find((fp) => fp.id === id);
    const oldName = targetPlan?.floorName;
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === id ? { ...fp, floorName: trimmed } : fp)),
      roomProgressList: prev.roomProgressList.map((r) => (r.floorId === id || (oldName && r.floorName === oldName) ? { ...r, floorId: id, floorName: trimmed } : r)),
      defects: prev.defects.map((d) => (!d.archivedAt && (d.floorId === id || (oldName && d.floorName === oldName)) ? { ...d, floorId: id, floorName: trimmed } : d)),
      checklist: prev.checklist.map((c) => {
        if (!c.archivedAt && (c.floorId === id || (oldName && c.floorName === oldName))) {
          return { ...c, floorId: id, floorName: trimmed };
        }
        return c;
      }),
      workVolumes: (prev.workVolumes || []).map((w) => {
        const floorNames = String(w.floor || '').split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean);
        const hasFloorId = w.floorId === id || (w.floorIds || []).includes(id);
        const hasOldName = Boolean(oldName && floorNames.includes(oldName));
        if (!hasFloorId && !hasOldName) return w;
        return {
          ...w,
          floorId: w.floorId === id ? id : w.floorId,
          floor: floorNames.length > 0
            ? floorNames.map((name) => oldName && name === oldName ? trimmed : name).join(', ')
            : trimmed,
        };
      }),
      crewRecords: (prev.crewRecords || []).map((cr) => {
        const floorNames = String(cr.floorName || '').split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean);
        const hasOldName = Boolean(oldName && floorNames.includes(oldName));
        const hasNestedFloor = (cr.floorWorks || []).some((fw) => fw.floorId === id || (oldName && fw.floorName === oldName));
        if (cr.floorId !== id && !hasOldName && !hasNestedFloor) return cr;
        return {
          ...cr,
          floorName: floorNames.length > 0
            ? floorNames.map((name) => oldName && name === oldName ? trimmed : name).join(', ')
            : (cr.floorId === id ? trimmed : cr.floorName),
          floorWorks: (cr.floorWorks || []).map((fw) =>
            fw.floorId === id || (oldName && fw.floorName === oldName)
              ? { ...fw, floorId: id, floorName: trimmed }
              : fw
          ),
        };
      }),
    }));
  };

  const handleDeleteFloorPlan = (id: string) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    if (floorPlans.length <= 1) {
      alert('Dự án cần duy trì ít nhất 1 mặt bằng tầng!');
      return;
    }
    const targetPlan = floorPlans.find((fp) => fp.id === id);
    const archivedAt = new Date().toISOString();
    updateAppData((prev) => {
      const deletedNames = new Set([targetPlan?.floorName].filter((v): v is string => Boolean(v)));
      const remaining = prev.floorPlans.filter((fp) => fp.id !== id).map((fp, idx) => ({ ...fp, order: idx }));

      const workVolumesAfterFloorDelete = (prev.workVolumes || []).map((w) => {
        const nextFloorIds = (w.floorIds || []).filter((floorId) => floorId !== id);
        const nextFloorNames = String(w.floor || '')
          .split(/[,;\n]+/)
          .map((name) => name.trim())
          .filter(Boolean)
          .filter((name) => !deletedNames.has(name));
        const hadDeletedLink = w.floorId === id || (w.floorIds || []).includes(id) || [...deletedNames].some((name) => String(w.floor || '').split(/[,;\n]+/).map(v => v.trim()).includes(name));
        if (!hadDeletedLink) return w;
        return {
          ...w,
          floorId: w.floorId === id ? (nextFloorIds[0] || undefined) : w.floorId,
          floorIds: nextFloorIds,
          floor: nextFloorNames.length > 0 ? nextFloorNames.join(', ') : 'Chưa gán tầng',
        };
      });

      const crewRecordsAfterFloorDelete = (prev.crewRecords || []).map((record) => {
        const nextFloorWorks = (record.floorWorks || []).filter((fw) => fw.floorId !== id && !deletedNames.has(fw.floorName));
        const nextFloorNames = String(record.floorName || '')
          .split(/[,;\n]+/)
          .map((name) => name.trim())
          .filter(Boolean)
          .filter((name) => !deletedNames.has(name));
        const hadDeletedLink = record.floorId === id || (record.floorWorks || []).some((fw) => fw.floorId === id || deletedNames.has(fw.floorName));
        if (!hadDeletedLink && nextFloorNames.length === String(record.floorName || '').split(/[,;\n]+/).map(v => v.trim()).filter(Boolean).length) return record;
        return {
          ...record,
          floorId: record.floorId === id ? (nextFloorWorks[0]?.floorId || undefined) : record.floorId,
          floorName: nextFloorNames.length > 0 ? nextFloorNames.join(', ') : undefined,
          floorWorks: nextFloorWorks,
        };
      });

      return {
        ...prev,
        floorPlans: remaining,
        roomProgressList: prev.roomProgressList.filter((r) => r.floorId !== id),
        // Preserve QA history when deleting a drawing/floor. Detach it from the active
        // floor so old Defects/Checklist do not count as current work.
        defects: prev.defects.map((d) =>
          d.floorId === id || (targetPlan && d.floorName === targetPlan.floorName)
            ? { ...d, archivedFloorId: id, archivedFloorName: d.floorName || targetPlan?.floorName, archivedAt, floorId: '', roomId: undefined }
            : d
        ),
        checklist: prev.checklist.map((c) =>
          c.floorId === id || (targetPlan && c.floorName === targetPlan.floorName)
            ? { ...c, archivedFloorId: id, archivedFloorName: c.floorName || targetPlan?.floorName, archivedAt, floorId: undefined, roomId: undefined }
            : c
        ),
        workVolumes: workVolumesAfterFloorDelete,
        crewRecords: crewRecordsAfterFloorDelete,
      };
    });

    if (targetPlan) {
      if (trashSettingsRef.current.enabled && floorPlanNeedsCloudUpload(targetPlan)) {
        // Trash does not duplicate Base64/blob data. Ensure a pending local drawing gets a
        // recoverable cloud binary before its active floor record disappears.
        void syncFloorPlanImageToCloud(activeProjectIdRef.current, targetPlan).catch((err) =>
          console.warn('Trash pre-delete floor-plan upload warning:', err)
        );
      } else if (!trashSettingsRef.current.enabled) {
        void deleteFloorPlanImageFromCloud(activeProjectIdRef.current, targetPlan).catch((err) =>
          console.warn('Delete floor-plan cloud image warning:', err)
        );
      }
    }
  };

  const handleDeleteMultipleFloorPlans = (ids: string[]) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    const requestedIdsOuter = new Set(ids);
    let cloudPlansToDelete = floorPlans.filter((fp) => requestedIdsOuter.has(fp.id));
    if (cloudPlansToDelete.length >= floorPlans.length && floorPlans.length > 0) {
      cloudPlansToDelete = cloudPlansToDelete.filter((fp) => fp.id !== floorPlans[0].id);
    }
    const archivedAt = new Date().toISOString();

    updateAppData((prev) => {
      const requestedIds = new Set(ids);
      let idsToReallyDelete = ids;
      let remainingPlans = prev.floorPlans.filter((fp) => !requestedIds.has(fp.id));

      // Luôn giữ ít nhất một mặt bằng để project không rơi vào trạng thái không hợp lệ.
      if (remainingPlans.length === 0 && prev.floorPlans.length > 0) {
        const keepId = prev.floorPlans[0].id;
        idsToReallyDelete = ids.filter((id) => id !== keepId);
        remainingPlans = prev.floorPlans.filter((fp) => fp.id === keepId);
      }

      const deleteIdSet = new Set(idsToReallyDelete);
      const targetPlans = prev.floorPlans.filter((fp) => deleteIdSet.has(fp.id));
      const deletedNames = new Set(targetPlans.map((fp) => fp.floorName));

      const workVolumesAfterFloorDelete = (prev.workVolumes || []).map((w) => {
        const oldFloorIds = w.floorIds || [];
        const nextFloorIds = oldFloorIds.filter((floorId) => !deleteIdSet.has(floorId));
        const oldFloorNames = String(w.floor || '').split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean);
        const nextFloorNames = oldFloorNames.filter((name) => !deletedNames.has(name));
        const hadDeletedLink = (w.floorId ? deleteIdSet.has(w.floorId) : false) || oldFloorIds.some((floorId) => deleteIdSet.has(floorId)) || oldFloorNames.some((name) => deletedNames.has(name));
        if (!hadDeletedLink) return w;
        return {
          ...w,
          floorId: w.floorId && deleteIdSet.has(w.floorId) ? (nextFloorIds[0] || undefined) : w.floorId,
          floorIds: nextFloorIds,
          floor: nextFloorNames.length > 0 ? nextFloorNames.join(', ') : 'Chưa gán tầng',
        };
      });

      const crewRecordsAfterFloorDelete = (prev.crewRecords || []).map((record) => {
        const oldFloorNames = String(record.floorName || '').split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean);
        const nextFloorNames = oldFloorNames.filter((name) => !deletedNames.has(name));
        const nextFloorWorks = (record.floorWorks || []).filter((fw) => !deleteIdSet.has(fw.floorId) && !deletedNames.has(fw.floorName));
        const hadDeletedLink = (record.floorId ? deleteIdSet.has(record.floorId) : false) || oldFloorNames.some((name) => deletedNames.has(name)) || (record.floorWorks || []).some((fw) => deleteIdSet.has(fw.floorId) || deletedNames.has(fw.floorName));
        if (!hadDeletedLink) return record;
        return {
          ...record,
          floorId: record.floorId && deleteIdSet.has(record.floorId) ? (nextFloorWorks[0]?.floorId || undefined) : record.floorId,
          floorName: nextFloorNames.length > 0 ? nextFloorNames.join(', ') : undefined,
          floorWorks: nextFloorWorks,
        };
      });

      return {
        ...prev,
        floorPlans: remainingPlans.map((fp, idx) => ({ ...fp, order: idx })),
        roomProgressList: prev.roomProgressList.filter((r) => !deleteIdSet.has(r.floorId)),
        defects: prev.defects.map((d) =>
          deleteIdSet.has(d.floorId) || deletedNames.has(d.floorName)
            ? { ...d, archivedFloorId: d.floorId || undefined, archivedFloorName: d.floorName, archivedAt, floorId: '', roomId: undefined }
            : d
        ),
        checklist: prev.checklist.map((c) =>
          deleteIdSet.has(c.floorId || '') || deletedNames.has(c.floorName)
            ? { ...c, archivedFloorId: c.floorId, archivedFloorName: c.floorName, archivedAt, floorId: undefined, roomId: undefined }
            : c
        ),
        workVolumes: workVolumesAfterFloorDelete,
        crewRecords: crewRecordsAfterFloorDelete,
      };
    });

    cloudPlansToDelete.forEach((plan) => {
      if (trashSettingsRef.current.enabled && floorPlanNeedsCloudUpload(plan)) {
        void syncFloorPlanImageToCloud(activeProjectIdRef.current, plan).catch((err) =>
          console.warn('Trash pre-delete floor-plan upload warning:', err)
        );
      } else if (!trashSettingsRef.current.enabled) {
        void deleteFloorPlanImageFromCloud(activeProjectIdRef.current, plan).catch((err) =>
          console.warn('Delete floor-plan cloud image warning:', err)
        );
      }
    });
  };

  const handleDuplicateFloorPlan = (id: string, customName?: string) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => {
      const sourcePlan = prev.floorPlans.find((fp) => fp.id === id);
      if (!sourcePlan) return prev;

      const newId = createEntityId('fp');
      const newFloorName = customName?.trim() || `${sourcePlan.floorName} (Bản sao)`;
      const now = Date.now();

      const newPlan: FloorPlan = {
        ...sourcePlan,
        id: newId,
        floorName: newFloorName,
        uploadedAt: new Date().toISOString().split('T')[0],
        // The copied Base64/blob URL may be reused locally, but cloud identifiers belong
        // to the source floor and must never be reused under a new floorId. Reset cloud
        // metadata so the normal image-sync effect uploads a fresh file for the clone.
        driveFileId: undefined,
        driveUrl: undefined,
        cloudFileId: undefined,
        storageProvider: undefined,
        imageCloudRevision: 0,
        imageCloudSyncedAt: undefined,
        imageRevision: now,
        updatedAt: now,
      };

      // Safe duplicate: copy geometry, categories, quantities and assignments, but
      // reset all actual construction / inspection results. A new floor must never
      // inherit completed work or Defects from the source floor.
      const sourceRooms = prev.roomProgressList.filter((r) => r.floorId === id || (!r.floorId && r.floorName === sourcePlan.floorName));
      const roomIdMap: Record<string, string> = {};
      const clonedRooms: RoomProgressItem[] = sourceRooms.map((r) => {
        const cloned = JSON.parse(JSON.stringify(r)) as RoomProgressItem;
        const newRoomId = createEntityId('ROOM');
        roomIdMap[r.id] = newRoomId;
        return {
          ...cloned,
          id: newRoomId,
          floorId: newId,
          floorName: newFloorName,
          frameStatus: 'Chưa làm',
          boardStatus: 'Chưa làm',
          frameInspectionStatus: 'Chưa nghiệm thu',
          boardInspectionStatus: 'Chưa nghiệm thu',
          inspectionStatus: 'Chưa nghiệm thu',
          inspectorName: '',
          notes: '',
          targetFrameDate: '',
          targetBoardDate: '',
          subItems: cloned.subItems?.map((sub) => ({
            ...sub,
            id: createEntityId('sub'),
            status: 'Chưa làm',
            inspectionStatus: 'Chưa nghiệm thu',
            targetDate: '',
          })),
          createdAt: now,
          updatedAt: now,
        };
      });

      // Checklist criteria are useful as a template, but all result/history fields
      // are reset for the new floor. Defects are intentionally NOT duplicated.
      const sourceChecklist = prev.checklist.filter((c) => (c.floorId && c.floorId === id) || (!c.floorId && c.floorName === sourcePlan.floorName));
      const clonedChecklist = sourceChecklist.map((c) => ({
        ...c,
        id: createEntityId('CHK'),
        floorId: newId,
        floorName: newFloorName,
        roomId: c.roomId ? roomIdMap[c.roomId] : undefined,
        status: 'pending' as const,
        notes: '',
        inspectedBy: undefined,
        inspectedAt: undefined,
      }));

      const index = prev.floorPlans.findIndex((fp) => fp.id === id);
      const nextPlans = [...prev.floorPlans];
      if (index !== -1) nextPlans.splice(index + 1, 0, newPlan);
      else nextPlans.push(newPlan);

      return {
        ...prev,
        floorPlans: nextPlans.map((fp, idx) => ({ ...fp, order: idx })),
        roomProgressList: [...clonedRooms, ...prev.roomProgressList],
        checklist: [...prev.checklist, ...clonedChecklist],
        // Never clone defects: a duplicate floor starts with zero actual defects.
        defects: prev.defects,
      };
    });
  };

  const handleMoveFloorPlan = (id: string, direction: 'left' | 'right') => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => {
      const index = prev.floorPlans.findIndex((fp) => fp.id === id);
      if (index < 0) return prev;
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.floorPlans.length) return prev;

      const newPlans = [...prev.floorPlans];
      const [moved] = newPlans.splice(index, 1);
      newPlans.splice(targetIndex, 0, moved);
      return {
        ...prev,
        floorPlans: newPlans.map((fp, idx) => ({ ...fp, order: idx })),
      };
    });
  };

  const handleAddDefect = (defect: Omit<DefectItem, 'id' | 'createdAt'> & { id?: string }) => {
    if (!isProjectRoleResolved || !canEditDefectData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền tạo Defect.'); return; }
    updateAppData((prev) => {
      // Find the highest numeric ID in current defects to increment sequentially
      let nextNum = 101;
      const numbers = (prev.defects || [])
        .map((d) => {
          const match = d.id.match(/^DEF-(\d+)/i);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((n): n is number => n !== null);
      if (numbers.length > 0) {
        const maxNum = Math.max(...numbers);
        nextNum = maxNum + 1;
      }

      const uniqueDefectSuffix = createShortToken(6);
      const newId = defect.id || `DEF-${nextNum}-${uniqueDefectSuffix}`;
      
      const actor = getCurrentRealFirebaseUser();
      const rememberedActor = getRememberedVerifiedAuthIdentity();
      const actorLabel = resolveVerifiedIdentityLabel(actor, rememberedActor);
      const actorUid = actor?.uid || rememberedActor?.uid || '';
      if (!actorLabel) {
        console.warn('[Defect] Không xác định được tài khoản tạo Defect; bỏ qua thao tác để tránh ghi sai Người Tạo.');
        return prev;
      }
      const newDefect: DefectItem = {
        ...defect,
        id: newId,
        createdAt: new Date().toISOString(),
        createdBy: actorLabel,
        ...(actorUid ? { createdByUid: actorUid } : {}),
      };

      return {
        ...prev,
        defects: [newDefect, ...prev.defects],
      };
    });
  };

  const handleUpdateDefectStatus = (id: string, status: DefectStatus) => {
    if (!isProjectRoleResolved || !canEditDefectData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền cập nhật Defect.'); return; }
    const todayStr = new Date().toISOString().split('T')[0];
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.map((d) =>
        d.id === id
          ? {
              ...d,
              status,
              completedAt: status === 'Đã khắc phục' || status === 'Đã nghiệm thu'
                ? (d.completedAt || todayStr)
                : undefined,
            }
          : d
      ),
    }));
  };

  const handleUpdateDefect = (updatedDefect: DefectItem) => {
    if (!isProjectRoleResolved || !canEditDefectData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền cập nhật Defect.'); return; }
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.map((d) => (d.id === updatedDefect.id ? updatedDefect : d)),
    }));
  };

  const handleDeleteDefect = (id: string) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa Defect.'); return; }
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.filter((d) => d.id !== id),
    }));
    if (!trashSettingsRef.current.enabled) {
      void deleteEntityPhotos(activeProjectIdRef.current, 'defect', id).catch(() => {});
    }
  };

  const handleDeleteMultipleDefects = (ids: string[]) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa Defect.'); return; }
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.filter((d) => !ids.includes(d.id)),
    }));
    if (!trashSettingsRef.current.enabled) {
      ids.forEach((id) => void deleteEntityPhotos(activeProjectIdRef.current, 'defect', id).catch(() => {}));
    }
  };

  // Handlers for Room Progress / Acceptance
  // RC2.2.5: EDITOR can update operational field progress on an existing room but
  // cannot mutate the room/floor structural identity or geometry. Firestore Rules
  // enforce the same boundary server-side; this sanitizer keeps the client fail-safe.
  const applyEditorRoomOperationalUpdate = (existing: RoomProgressItem, incoming: Partial<RoomProgressItem>): RoomProgressItem => {
    const operationalKeys: (keyof RoomProgressItem)[] = [
      'frameStatus', 'boardStatus', 'frameInspectionStatus', 'boardInspectionStatus',
      'inspectionStatus', 'inspectorName', 'notes', 'assignedTeam', 'teamId',
      'targetFrameDate', 'targetBoardDate', 'subItems'
    ];
    const next: RoomProgressItem = { ...existing };
    for (const key of operationalKeys) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) (next as any)[key] = (incoming as any)[key];
    }
    return next;
  };

  const handleSaveRoomProgress = (
    room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }
  ) => {
    const updatedAt = Date.now();
    updateAppData((prev) => {
      const existing = room.id ? prev.roomProgressList.find((r) => r.id === room.id) : undefined;
      if (existing) {
        const nextRoom = canManageFloorPlanStructure(currentUserRole)
          ? { ...existing, ...room, id: existing.id, createdAt: existing.createdAt || updatedAt, updatedAt }
          : { ...applyEditorRoomOperationalUpdate(existing, room), updatedAt };
        return {
          ...prev,
          roomProgressList: prev.roomProgressList.map((r) => (r.id === existing.id ? nextRoom : r)),
        };
      }
      if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return prev;
      const newId = room.id || createEntityId('ROOM');
      return {
        ...prev,
        roomProgressList: [{ ...room, id: newId, createdAt: updatedAt, updatedAt }, ...prev.roomProgressList],
      };
    });
  };

  const handleBatchSaveRooms = (rooms: RoomProgressItem[]) => {
    if (!rooms || rooms.length === 0) return;
    const updatedAt = Date.now();
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    updateAppData((prev) => ({
      ...prev,
      roomProgressList: prev.roomProgressList.map((r) => {
        const updated = roomMap.get(r.id);
        if (!updated) return r;
        return canManageFloorPlanStructure(currentUserRole)
          ? { ...r, ...updated, updatedAt }
          : { ...applyEditorRoomOperationalUpdate(r, updated), updatedAt };
      }),
    }));
  };

  const handleCreateMultipleRoomProgress = (rooms: RoomProgressItem[]) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    if (!rooms || rooms.length === 0) return;
    const now = Date.now();
    updateAppData((prev) => {
      const existingIds = new Set(prev.roomProgressList.map((room) => room.id));
      const uniqueNewRooms = rooms
        .filter((room) => room.id && !existingIds.has(room.id))
        .map((room) => ({ ...room, createdAt: room.createdAt || now, updatedAt: now }));
      if (uniqueNewRooms.length === 0) return prev;
      return { ...prev, roomProgressList: [...uniqueNewRooms, ...prev.roomProgressList] };
    });
  };

  const handleDeleteRoomProgress = (id: string) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => {
      const deletedRoom = prev.roomProgressList.find((r) => r.id === id);
      const deletedLabel = deletedRoom?.roomName || id;
      return {
        ...prev,
        roomProgressList: prev.roomProgressList.filter((r) => r.id !== id),
        // Giữ Defect/Checklist để không mất lịch sử, nhưng bỏ khóa ngoại roomId đã bị xóa.
        defects: prev.defects.map((d) => d.roomId === id
          ? { ...d, roomId: undefined, positionDetail: d.positionDetail || `Căn / Phòng đã xóa: ${deletedLabel}` }
          : d),
        checklist: prev.checklist.map((c) => c.roomId === id
          ? { ...c, roomId: undefined, notes: c.notes || `Căn / Phòng đã xóa: ${deletedLabel}` }
          : c),
      };
    });
  };

  const handleDeleteMultipleRoomProgress = (ids: string[]) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => {
      const deleteSet = new Set(ids);
      const roomNameById = new Map(
        prev.roomProgressList.filter((r) => deleteSet.has(r.id)).map((r) => [r.id, r.roomName])
      );
      return {
        ...prev,
        roomProgressList: prev.roomProgressList.filter((r) => !deleteSet.has(r.id)),
        defects: prev.defects.map((d) => d.roomId && deleteSet.has(d.roomId)
          ? { ...d, roomId: undefined, positionDetail: d.positionDetail || `Căn / Phòng đã xóa: ${roomNameById.get(d.roomId) || d.roomId}` }
          : d),
        checklist: prev.checklist.map((c) => c.roomId && deleteSet.has(c.roomId)
          ? { ...c, roomId: undefined, notes: c.notes || `Căn / Phòng đã xóa: ${roomNameById.get(c.roomId) || c.roomId}` }
          : c),
      };
    });
  };

  const handleReorderRoomProgressList = (reorderedList: RoomProgressItem[]) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    if (reorderedList.length === 0) return;
    const activeFloorId = reorderedList[0].floorId;
    updateAppData((prev) => {
      const otherFloorRooms = prev.roomProgressList.filter(r => r.floorId !== activeFloorId);
      return {
        ...prev,
        roomProgressList: [...reorderedList, ...otherFloorRooms],
      };
    });
  };

  const handleReorderFloorPlans = (reorderedList: FloorPlan[]) => {
    if (!isProjectRoleResolved || !canManageFloorPlanStructure(currentUserRole)) return;
    updateAppData((prev) => ({
      ...prev,
      floorPlans: reorderedList.map((fp, idx) => ({ ...fp, order: idx })),
    }));
  };

  // Handlers for Checklist
  const handleUpdateChecklistStatus = (
    id: string,
    status: ChecklistStatus,
    notes?: string,
    inspectedBy?: string
  ) => {
    if (!isProjectRoleResolved || !canEditChecklistData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền cập nhật nghiệm thu Checklist.'); return; }
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            status,
            notes: notes !== undefined ? notes : item.notes,
            inspectedBy: status === 'pending' ? undefined : (inspectedBy || item.inspectedBy),
            inspectedAt: status === 'pending' ? undefined : new Date().toISOString(),
          };
        }
        return item;
      }),
    }));
  };

  const handleAddChecklistItem = (item: Omit<ChecklistItem, 'id'>) => {
    if (!isProjectRoleResolved || !canManageChecklistStructure(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được thêm tiêu chí Checklist.'); return; }
    const newId = createEntityId('CHK');
    updateAppData((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { ...item, id: newId }],
    }));
  };

  const handleUpdateChecklistItem = (updatedItem: ChecklistItem) => {
    if (!isProjectRoleResolved || !canManageChecklistStructure(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được sửa định nghĩa Checklist.'); return; }
    const normalizedItem: ChecklistItem = updatedItem.status === 'pending'
      ? { ...updatedItem, inspectedBy: undefined, inspectedAt: undefined }
      : updatedItem;
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item) => (item.id === normalizedItem.id ? normalizedItem : item)),
    }));
  };

  const handleDeleteChecklistItem = (id: string) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa Checklist.'); return; }
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((item) => item.id !== id),
    }));
  };

  const handleDeleteMultipleChecklistItems = (ids: string[]) => {
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa Checklist.'); return; }
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((item) => !ids.includes(item.id)),
    }));
  };

  // Handlers for Crew/Quân số
  const handleAddCrewRecord = (record: Omit<CrewRecord, 'id'> & { id?: string }) => {
    if (!isProjectRoleResolved || !canEditCrewData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền chấm công/quân số.'); return; }
    const newId = record.id || createEntityId('crew');
    const actorUid = getCurrentRealFirebaseUser()?.uid || '';
    updateAppData((prev) => ({
      ...prev,
      crewRecords: [...prev.crewRecords, {
        ...record,
        id: newId,
        createdAt: Number(record.createdAt || Date.now()),
        ...(actorUid && !record.createdByUid ? { createdByUid: actorUid } : {}),
      }],
    }));
  };

  const handleUpdateCrewRecord = (id: string, record: Partial<CrewRecord>) => {
    if (!isProjectRoleResolved || !canEditCrewData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền sửa chấm công/quân số.'); return; }
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.map((r) => (r.id === id ? { ...r, ...record } : r)),
    }));
  };

  const handleDeleteCrewRecord = (id: string) => {
    const actorUid = getCurrentRealFirebaseUser()?.uid || '';
    const target = crewRecords.find((r) => r.id === id);
    if (!isProjectRoleResolved || !target || !canDeleteCrewRecord(currentUserRole, actorUid, target.createdByUid)) {
      console.warn('[RBAC] Chỉ ADMIN hoặc người tạo nhật ký được xóa bản ghi này.');
      return;
    }
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.filter((r) => r.id !== id),
    }));
  };

  const handleDeleteMultipleCrewRecords = (ids: string[]) => {
    // Bulk delete remains ADMIN-only to prevent an EDITOR from accidentally removing
    // another person's daily logs. EDITOR still has per-record delete for own entries.
    if (!isProjectRoleResolved || !canDeleteBusinessData(currentUserRole)) { console.warn('[RBAC] Chỉ ADMIN được xóa nhiều nhật ký quân số.'); return; }
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.filter((r) => !ids.includes(r.id)),
    }));
  };

  const handleCopyCrewRecordsFromDate = (sourceDate: string, targetDate: string) => {
    if (!isProjectRoleResolved || !canEditCrewData(currentUserRole)) { console.warn('[RBAC] Tài khoản không có quyền sao chép nhật ký quân số.'); return; }
    const actorUid = getCurrentRealFirebaseUser()?.uid || '';
    const clonedAt = Date.now();
    updateAppData((prev) => {
      const sourceRecords = prev.crewRecords.filter((r) => r.date === sourceDate);
      const keptRecords = prev.crewRecords.filter((r) => r.date !== targetDate);
      const cloned = sourceRecords.map((r) => ({
        ...r,
        id: createEntityId('crew'),
        date: targetDate,
        createdAt: clonedAt,
        ...(actorUid ? { createdByUid: actorUid } : {}),
        updatedAt: undefined,
        updatedByUid: undefined,
      }));
      return {
        ...prev,
        crewRecords: [...keptRecords, ...cloned],
      };
    });
  };

  const floorNames = Array.from(new Set(floorPlans.map((fp) => fp.floorName)));
  const unhandledDefectsCount = activeDefects.filter((d) => d.status !== 'Đã nghiệm thu').length;

  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [floatingAlertsEnabled, setFloatingAlertsEnabled] = useState(true);

  const floatingAlertPreferenceKey = useMemo(() => {
    const userScope = cloudUserKey || 'signed-out';
    return `construction_floating_alerts_enabled_${activeProjectId}_${userScope}`;
  }, [activeProjectId, cloudUserKey]);

  useEffect(() => {
    try {
      setFloatingAlertsEnabled(localStorage.getItem(floatingAlertPreferenceKey) !== 'false');
    } catch (_) {
      setFloatingAlertsEnabled(true);
    }
  }, [floatingAlertPreferenceKey]);

  const updateFloatingAlertsEnabled = (enabled: boolean) => {
    setFloatingAlertsEnabled(enabled);
    try {
      localStorage.setItem(floatingAlertPreferenceKey, enabled ? 'true' : 'false');
    } catch (_) {}
  };

  const [chatLastMessageAt, setChatLastMessageAt] = useState(0);
  const [chatLastReadAt, setChatLastReadAt] = useState(0);
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const [chatLastReadMessageCount, setChatLastReadMessageCount] = useState(0);
  const [chatLastMentions, setChatLastMentions] = useState<string[]>([]);
  const [chatLastSenderUid, setChatLastSenderUid] = useState('');
  const [chatToast, setChatToast] = useState<{ sender: string; text: string } | null>(null);
  const lastChatToastTimestampRef = useRef(0);
  const chatUnreadCount = Math.max(0, chatMessageCount - chatLastReadMessageCount) || (chatLastMessageAt > chatLastReadAt ? 1 : 0);
  const currentChatUid = getCurrentRealFirebaseUser()?.uid || '';
  const chatMentioned = chatUnreadCount > 0 && chatLastSenderUid !== currentChatUid && (chatLastMentions.includes(currentChatUid) || chatLastMentions.includes('everyone'));

  useEffect(() => {
    if (!activeProjectId || !getCurrentRealFirebaseUser()) {
      setChatLastMessageAt(0);
      setChatLastReadAt(0);
      setChatMessageCount(0);
      setChatLastReadMessageCount(0);
      setChatLastMentions([]);
      setChatLastSenderUid('');
      return;
    }

    let disposed = false;
    let unsubSummary: (() => void) | null = null;
    let unsubRead: (() => void) | null = null;
    let debounceTimer: number | null = null;
    let initialSummary = true;
    let pendingSummary: any = null;
    let pendingRead: { millis: number; count: number } | null = null;

    const flushBadgeState = () => {
      debounceTimer = null;
      if (disposed) return;
      if (pendingSummary) {
        const summary = pendingSummary;
        pendingSummary = null;
        const timestamp = summary?.lastMessageAtMillis || 0;
        setChatLastMessageAt(timestamp);
        setChatMessageCount(Number(summary?.messageCount || 0));
        setChatLastMentions(summary?.lastMentions || []);
        setChatLastSenderUid(summary?.lastSenderUid || '');
        const me = getCurrentRealFirebaseUser();
        if (initialSummary) {
          initialSummary = false;
          lastChatToastTimestampRef.current = timestamp;
        } else if (timestamp > lastChatToastTimestampRef.current && summary?.lastSenderUid && summary.lastSenderUid !== me?.uid) {
          lastChatToastTimestampRef.current = timestamp;
          setChatToast({ sender: summary.lastSenderName || 'Thành viên', text: summary.lastMessageText || 'Đã gửi một tin nhắn' });
          window.setTimeout(() => setChatToast(null), 5000);
        }
      }
      if (pendingRead) {
        setChatLastReadAt(pendingRead.millis);
        setChatLastReadMessageCount(Number(pendingRead.count || 0));
        pendingRead = null;
      }
    };

    const scheduleFlush = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(flushBadgeState, 180);
    };

    const stopBadgeListeners = (clearPending = false) => {
      unsubSummary?.();
      unsubRead?.();
      unsubSummary = null;
      unsubRead = null;
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (clearPending) {
        pendingSummary = null;
        pendingRead = null;
      }
    };

    const startBadgeListeners = () => {
      stopBadgeListeners(true);
      if (disposed || document.visibilityState !== 'visible') return;
      initialSummary = true;
      unsubSummary = subscribeConversationSummary(activeProjectId, (summary) => {
        pendingSummary = summary;
        scheduleFlush();
      });
      unsubRead = subscribeConversationReadState(activeProjectId, (millis, count) => {
        pendingRead = { millis, count: Number(count || 0) };
        scheduleFlush();
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') startBadgeListeners();
      else stopBadgeListeners(true);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startBadgeListeners();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      stopBadgeListeners(true);
    };
  }, [activeProjectId, cloudUserKey]);


  const dueDateAlerts = useMemo(() => {
    return collectDueDateAlerts(workVolumes, checklist, activeDefects);
  }, [workVolumes, checklist, activeDefects]);

  const handleNavigateFromAlert = (alertItem: DueDateAlertItem) => {
    if (alertItem.type === 'workVolume') {
      setActiveTab('volume');
    } else if (alertItem.type === 'checklist') {
      setActiveTab('checklist');
    } else if (alertItem.type === 'defect') {
      const defect = alertItem.originalItem as DefectItem;
      const navigationRequest = {
        projectId: activeProjectId,
        defectId: defect.id,
        floorId: defect.floorId,
        x: defect.x,
        y: defect.y,
        requestedAt: Date.now(),
      };
      try {
        sessionStorage.setItem('qlct_pending_defect_navigation', JSON.stringify(navigationRequest));
      } catch (_) {}
      appendRuntimeDiagnostic({
        level: 'info',
        area: 'defect-navigation',
        projectId: activeProjectId,
        code: 'REQUEST',
        message: `request defect=${defect.id} floor=${defect.floorId || ''} x=${Number(defect.x || 0)} y=${Number(defect.y || 0)}`,
      });
      setActiveTab('floorplan');
      // sessionStorage covers the not-yet-mounted FloorPlan tab. The event covers the
      // important case where the user is ALREADY on Mặt bằng: setActiveTab('floorplan')
      // does not remount the component, so storage-only navigation previously did nothing.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('qlct-defect-navigation-request', { detail: navigationRequest }));
      }, 50);
    }
  };

  const handleExportExcel = () => {
    setIsExportPdfOpen(true);
  };

  const hasExcelExport = ['warehouse', 'volume', 'floorplan', 'checklist', 'crew'].includes(activeTab);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans selection:bg-blue-200">
      {/* Mobile & Responsive Shell Frame */}
      <div
        className="w-full max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto bg-slate-50 min-h-screen shadow-2xl relative border-x border-slate-200 overflow-x-hidden"
        style={{ paddingBottom: isSoftKeyboardOpen ? '0px' : 'calc(5rem + env(safe-area-inset-bottom))' }}
      >
        {/* Sticky Top Header */}
        <GoogleAuthHeader
          projectName={projectName}
              appDisplayName={superAdminUiSettings.appDisplayName}
              logoUrl={superAdminUiSettings.logoUrl}
          projectId={activeProjectId}
          lastUpdatedAt={lastUpdatedAt}
          setProjectName={handleUpdateProjectName}
          onSyncAll={handleSyncAll}
          isSyncing={isSyncing}
          onOpenExportPdf={() => setIsExportPdfOpen(true)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && past.length > 0}
          canRedo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && future.length > 0}
          onOpenProjectManager={handleOpenProjectManager}
          onOpenSecurity={() => setIsSecurityModalOpen(true)}
          dueDateAlertCount={dueDateAlerts.length}
          onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
          userRole={currentUserRole}
        />

        {pendingFileRestorePrompt && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-xs text-amber-900 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 font-bold">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-amber-950">Tệp tự động lưu có dữ liệu mới hơn: </span>
                <span className="text-amber-800">
                  "{pendingFileRestorePrompt.handleName}" (Cập nhật: {formatDateTime(pendingFileRestorePrompt.fileUpdatedAt)})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (pendingFileRestorePrompt.isAll) {
                    handleRestoreAllStorageData(pendingFileRestorePrompt.fileData);
                  } else {
                    handleRestoreData(pendingFileRestorePrompt.fileData);
                  }
                  setPendingFileRestorePrompt(null);
                }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Phục hồi từ Tệp
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingFileRestorePrompt(null);
                }}
                className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg font-semibold transition-all cursor-pointer"
              >
                Bỏ qua
              </button>
            </div>
          </div>
        )}
        
        <ProjectManagerModal 
          isOpen={isProjectManagerOpen} 
          onClose={() => setIsProjectManagerOpen(false)} 
          activeProjectId={activeProjectId}
          initialTab={projectManagerInitialTab}
          userRole={currentUserRole}
          autoSyncEnabled={autoSyncEnabled}
          setAutoSyncEnabled={setAutoSyncEnabled}
          onDriveSyncUpAll={!FIREBASE_ONLY_RUNTIME && googleServerBackendAvailable ? handleDriveSyncUpAll : undefined}
          onDriveSyncDownAll={!FIREBASE_ONLY_RUNTIME && googleServerBackendAvailable ? handleDriveSyncDownAll : undefined}
          localAllSyncStatus={localAllSyncStatus}
          localAllFileName={localAllFileName}
          localAllFileHandle={localAllFileHandle}
          onLinkLocalAllFile={handleLinkLocalAllFile}
          onUnlinkLocalAllFile={handleUnlinkLocalAllFile}
          onRequestLocalAllFilePermission={handleRequestLocalAllFilePermission}
          autosaveVersions={autosaveVersions}
          onRestoreAutoSaveVersion={handleRestoreAutoSaveVersion}
          onCreateManualBackup={handleCreateManualBackup}
          onDeleteAutoSaveVersion={handleDeleteAutoSaveVersion}
          fullAppData={{
            projectName,
            contractorName,
            inspectorName,
            materialNorms,
            inventory,
            workVolumes,
            floorPlans,
            defects,
            roomProgressList,
            checklist,
            crewRecords,
            teams,
            updatedAt: lastUpdatedAt,
          }}
          onRestoreData={handleRestoreData}
          onSwitchProject={switchProject}
          onFlushCurrentProject={async () => await saveCurrentProject(activeProjectId)}
          dataCloudStatus={dataCloudStatus}
          photoCloudStatus={photoCloudStatus}
        />

        {/* Offline & Sync Status Banner */}
        <OfflineSyncBanner onAutoSync={!FIREBASE_ONLY_RUNTIME && googleServerBackendAvailable ? handleSyncAll : undefined} isSyncing={isSyncing} userRole={currentUserRole} roleResolved={isProjectRoleResolved} roleSource={projectRoleSource} firestorePendingWriteCount={firestorePendingWriteCount} firebaseOnly={FIREBASE_ONLY_RUNTIME} />

        {/* Tab Content */}
        <main className="animate-in fade-in duration-150">
          <React.Suspense fallback={<div className="p-8 text-center text-sm text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Đang tải mục...</div>}>
          {activeTab === 'warehouse' && (
            <WarehouseTab
              inventory={inventory}
              userRole={currentUserRole}
              roleResolved={isProjectRoleResolved}
              onAddInventory={handleAddInventory}
              onUpdateInventory={handleUpdateInventory}
              onDeleteInventory={handleDeleteInventory}
              onDeleteMultipleInventory={handleDeleteMultipleInventory}
              onSyncSheets={!FIREBASE_ONLY_RUNTIME && googleServerBackendAvailable ? handleSyncAll : undefined}
              materialNorms={computedMaterialNorms}
              onOpenNormModal={() => setIsMaterialNormOpen(true)}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && past.length > 0}
              canRedo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && future.length > 0}
              workVolumes={computedWorkVolumes}
              onImportInventory={handleImportInventory}
              onImportNorms={handleImportNorms}
              onImportWorkVolumes={(importedVolumes) => {
                if (!isProjectRoleResolved || !canManageWorkVolumeStructure(currentUserRole)) {
                  console.warn('[RBAC] Chỉ ADMIN được nhập thay đổi cấu trúc hạng mục khối lượng.');
                  return;
                }
                updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes.map((item) => ({ ...item, unit: normalizeUnit(item.unit) || item.unit })) }));
              }}
            />
          )}

          {activeTab === 'volume' && (
            <WorkVolumeTab
              workVolumes={computedWorkVolumes}
              floorPlans={floorPlans}
              roomProgressList={roomProgressList}
              projectName={projectName}
              userRole={currentUserRole}
              onAddWorkVolume={handleAddWorkVolume}
              onSaveWorkVolume={handleSaveWorkVolume}
              onUpdateActualVolume={handleUpdateActualVolume}
              onDeleteWorkVolume={handleDeleteWorkVolume}
              onDeleteMultipleWorkVolumes={handleDeleteMultipleWorkVolumes}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && past.length > 0}
              canRedo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && future.length > 0}
            />
          )}

          {activeTab === 'floorplan' && (
            <FloorPlanDefectTab
              projectId={activeProjectId}
              floorPlans={floorPlans}
              defects={activeDefects}
              roomProgressList={roomProgressList}
              checklistItems={activeChecklist}
              teams={teams}
              materialNorms={computedMaterialNorms}
              inventory={inventory}
              workVolumes={computedWorkVolumes}
              userRole={currentUserRole}
              roleResolved={isProjectRoleResolved}
              inspectorName={inspectorName}
              onAddInventory={handleAddInventory}
              onAddFloorPlan={handleAddFloorPlan}
              onUpdateFloorPlan={handleUpdateFloorPlan}
              onUpdateFloorPlanImage={handleUpdateFloorPlanImage}
              onRenameFloorPlan={handleRenameFloorPlan}
              onDeleteFloorPlan={handleDeleteFloorPlan}
              onDeleteMultipleFloorPlans={handleDeleteMultipleFloorPlans}
              onDuplicateFloorPlan={handleDuplicateFloorPlan}
              onMoveFloorPlan={handleMoveFloorPlan}
              onAddDefect={handleAddDefect}
              onUpdateDefectStatus={handleUpdateDefectStatus}
              onUpdateDefect={handleUpdateDefect}
              onDeleteDefect={handleDeleteDefect}
              onDeleteMultipleDefects={handleDeleteMultipleDefects}
              onSaveRoomProgress={handleSaveRoomProgress}
              onBatchSaveRooms={handleBatchSaveRooms}
              onCreateMultipleRoomProgress={handleCreateMultipleRoomProgress}
              onDeleteRoomProgress={handleDeleteRoomProgress}
              onDeleteMultipleRoomProgress={handleDeleteMultipleRoomProgress}
              onReorderRoomProgressList={handleReorderRoomProgressList}
              onReorderFloorPlans={handleReorderFloorPlans}
              onActiveFloorChange={setActiveFloorViewId}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && past.length > 0}
              canRedo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && future.length > 0}
            />
          )}

          {activeTab === 'checklist' && (
            <ChecklistTab
              checklist={activeChecklist}
              userRole={currentUserRole}
              roleResolved={isProjectRoleResolved}
              floors={floorNames}
              floorPlans={floorPlans}
              inspectorName={inspectorName}
              workVolumes={computedWorkVolumes}
              onUpdateChecklistStatus={handleUpdateChecklistStatus}
              onAddChecklistItem={handleAddChecklistItem}
              onUpdateChecklistItem={handleUpdateChecklistItem}
              onDeleteChecklistItem={handleDeleteChecklistItem}
              onDeleteMultipleChecklistItems={handleDeleteMultipleChecklistItems}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && past.length > 0}
              canRedo={isProjectRoleResolved && canUseGlobalUndoRedo(currentUserRole) && future.length > 0}
            />
          )}

          {activeTab === 'crew' && (
            <CrewTab
              projectId={activeProjectId}
              userRole={currentUserRole}
              roleResolved={isProjectRoleResolved}
              currentUserUid={getCurrentRealFirebaseUser()?.uid || ''}
              projectName={projectName}
              crewRecords={crewRecords}
              floorPlans={floorPlans}
              roomProgressList={roomProgressList}
              defects={activeDefects}
              onAddCrewRecord={handleAddCrewRecord}
              onUpdateCrewRecord={handleUpdateCrewRecord}
              onDeleteCrewRecord={handleDeleteCrewRecord}
              onDeleteMultipleCrewRecords={handleDeleteMultipleCrewRecords}
              onCopyCrewRecordsFromDate={handleCopyCrewRecordsFromDate}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              teams={teams}
              onUpdateTeams={(newTeams) => {
                if (!isProjectRoleResolved || !canManageTeams(currentUserRole)) {
                  console.warn('[RBAC] Chỉ ADMIN được quản lý danh sách đội thi công.');
                  return;
                }
                updateAppData((prev) => {
                  const currentTeams = prev.teams || [];
                  const deletedTeamNames = currentTeams
                    .filter(t => !newTeams.some(nt => nt.id === t.id))
                    .map(t => t.name);

                  // Map renamed teams
                  const teamNameMap: Record<string, string> = {};
                  currentTeams.forEach(ct => {
                    const matched = newTeams.find(nt => nt.id === ct.id);
                    if (matched && matched.name !== ct.name) {
                      teamNameMap[ct.name] = matched.name;
                    }
                  });

                  let updatedRoomProgressList = (prev.roomProgressList || []).map(room => {
                    let assignedTeam = room.assignedTeam;
                    let teamId = room.teamId;

                    if (assignedTeam && teamNameMap[assignedTeam]) {
                      assignedTeam = teamNameMap[assignedTeam];
                    } else if (assignedTeam && deletedTeamNames.some(name => assignedTeam === name || assignedTeam.trim() === name.trim())) {
                      assignedTeam = '';
                      teamId = undefined;
                    }

                    const subItems = room.subItems?.map(sub => {
                      let subTeam = sub.assignedTeam;
                      if (subTeam && teamNameMap[subTeam]) {
                        return { ...sub, assignedTeam: teamNameMap[subTeam] };
                      } else if (subTeam && deletedTeamNames.some(name => subTeam === name || subTeam.trim() === name.trim())) {
                        return { ...sub, assignedTeam: '', teamId: undefined };
                      }
                      return sub;
                    });

                    return { ...room, assignedTeam, teamId, subItems };
                  });

                  let updatedDefects = (prev.defects || []).map(defect => {
                    let assignedTo = defect.assignedTo;
                    if (assignedTo && teamNameMap[assignedTo]) {
                      return { ...defect, assignedTo: teamNameMap[assignedTo] };
                    } else if (assignedTo && deletedTeamNames.some(name => assignedTo === name || assignedTo.trim() === name.trim())) {
                      return { ...defect, assignedTo: '', teamId: undefined };
                    }
                    return defect;
                  });

                  let updatedCrewRecords = (prev.crewRecords || []).map(record => {
                    let teamName = record.teamName;
                    if (teamName && teamNameMap[teamName]) {
                      const matched = newTeams.find(nt => nt.name === teamNameMap[teamName]);
                      return {
                        ...record,
                        teamName: teamNameMap[teamName],
                        leaderName: matched?.leader || record.leaderName,
                        teamId: matched?.id || record.teamId
                      };
                    }
                    return record;
                  });

                  let updatedChecklist = (prev.checklist || []).map(item => {
                    if (item.teamId && !newTeams.some(nt => nt.id === item.teamId)) {
                      return { ...item, teamId: undefined };
                    }
                    return item;
                  });

                  return {
                    ...prev,
                    teams: newTeams,
                    roomProgressList: updatedRoomProgressList,
                    defects: updatedDefects,
                    crewRecords: updatedCrewRecords,
                    checklist: updatedChecklist,
                  };
                });
              }}
            />
          )}


          {activeTab === 'chat' && (
            <ChatTab
              activeProjectId={activeProjectId}
              projectName={projectName}
              projects={authorizedChatProjects}
              onSwitchProject={switchProject}
              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
              userRole={currentUserRole}
            />
          )}

          {activeTab === 'superadmin' && isCurrentSuperAdmin && (
            <SuperAdminCenter
              userEmail={currentIdentityEmail || undefined}
              userRole={currentUserRole}
              projectName={projectName}
              projectId={activeProjectId}
              defectCount={activeDefects.length}
              pendingPhotoCount={Number(photoCloudStatus.pending || 0)}
              showChecklist={showChecklistModule}
              onOpenProjectManager={() => handleOpenProjectManager('sync')}
              onOpenSecurity={() => setIsSecurityModalOpen(true)}
              onOpenConfig={() => setActiveTab('config')}
              onOpenHiddenHistory={() => {
                setActiveTab('config');
                let attempts = 0;
                const focusTrash = () => {
                  const target = document.getElementById('trash-recovery-card');
                  if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    target.classList.add('ring-2', 'ring-indigo-300');
                    window.setTimeout(() => target.classList.remove('ring-2', 'ring-indigo-300'), 1800);
                    return;
                  }
                  attempts += 1;
                  if (attempts < 25) window.setTimeout(focusTrash, 100);
                };
                window.setTimeout(focusTrash, 0);
              }}
              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
              uiSettings={superAdminUiSettings}
              onPreviewUiSettings={previewSuperAdminUiSettings}
              onSaveUiSettings={saveSuperAdminUiSettings}
              onResetUiSettings={resetSuperAdminUiSettings}
            />
          )}

          {HNL_AI_ENABLED && activeTab === 'ai' && (
            <AiAssistantPage
              projectId={activeProjectId}
              projectName={projectName}
              role={currentUserRole}
              accessVerified={isProjectRoleResolved && projectRoleAllowed}
              online={isOnline}
              rooms={roomProgressList}
              defects={defects}
              crewRecords={crewRecords}
              teams={teams}
              floors={floorPlans}
              workVolumes={workVolumes}
              inventory={inventory}
              materialNorms={materialNorms}
              checklist={checklist}
            />
          )}

          {activeTab === 'config' && (
            <GoogleConfigTab
              projectName={projectName}
              setProjectName={handleUpdateProjectName}
              contractorName={contractorName}
              setContractorName={handleUpdateContractorName}
              inspectorName={inspectorName}
              setInspectorName={handleUpdateInspectorName}
              floorPlans={floorPlans}
              onUpdateFloorPlan={handleUpdateFloorPlan}
              onSyncAll={handleSyncAll}
              isSyncing={isSyncing}
              onRestoreData={handleRestoreData}
              driveSyncStatus={driveSyncStatus}
              driveLastSyncTime={driveLastSyncTime}
              autoSyncEnabled={autoSyncEnabled}
              setAutoSyncEnabled={setAutoSyncEnabled}
              onDriveSyncUp={!FIREBASE_ONLY_RUNTIME ? handleDriveSyncUp : undefined}
              onDriveSyncDown={!FIREBASE_ONLY_RUNTIME ? handleDriveSyncDown : undefined}
              activeProjectId={activeProjectId}
              localFileHandle={localFileHandle}
              localSyncStatus={localSyncStatus}
              localSyncPermissionNeeded={localSyncPermissionNeeded}
              localFileName={localFileName}
              onLinkLocalFile={handleLinkLocalFile}
              onUnlinkLocalFile={handleUnlinkLocalFile}
              onRequestLocalFilePermission={handleRequestLocalFilePermission}
              onOpenProjectManager={() => handleOpenProjectManager('sync')}
              userRole={currentUserRole}
              trashSettings={trashSettings}
              trashOperations={trashOperations}
              onTrashSettingsChange={handleTrashSettingsChange}
              onRestoreTrashOperation={restoreTrashOperation}
              onPurgeTrashOperation={purgeTrashOperation}
              onEmptyTrash={emptyTrash}
              syncDiagnostics={{
                cloudInitialReady,
                snapshotReadyCount: receivedInitialSubcollectionsRef.current.size,
                roleResolved: isProjectRoleResolved,
                roleSource: projectRoleSource,
                online: isOnline,
                dataCloudPhase: dataCloudStatus.phase,
                pendingData: syncDiagnosticPendingData,
                photoPending: Number(photoCloudStatus.pending || 0),
                photoPhase: String(photoCloudStatus.phase || 'idle'),
                pendingDriveUploads: Number(photoCloudStatus.pending || 0) + floorPlanImageSyncPendingRef.current.size + floorPlanImageSyncInFlightRef.current.size,
                lastSyncAt: Math.max(Number(dataCloudStatus.lastSyncAt || 0), Number(photoCloudStatus.lastSyncAt || 0)),
                lastSyncError: (dataCloudStatus.phase === 'error' || dataCloudStatus.phase === 'conflict') ? String(dataCloudStatus.message || 'Lỗi/xung đột đồng bộ dữ liệu') : photoCloudStatus.phase === 'error' ? String(photoCloudStatus.message || 'Lỗi đồng bộ ảnh') : '',
                dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
                firebaseUserEmail: getCurrentRealFirebaseUser()?.email || (!isOnline ? getRememberedVerifiedAuthIdentity()?.email : undefined),
                duplicateProjectIds: authorizedChatProjects
                  .filter((project) => project.id !== activeProjectId && String(project.name || '').trim().toLocaleLowerCase('vi-VN') === String(projectName || '').trim().toLocaleLowerCase('vi-VN'))
                  .map((project) => project.id),
                recordCounts: {
                  rooms: roomProgressList.length,
                  inventory: inventory.length,
                  defects: defects.length,
                  workVolumes: workVolumes.length,
                  floorPlans: floorPlans.length,
                  checklist: checklist.length,
                  crewRecords: crewRecords.length,
                  teams: teams.length,
                  materialNorms: materialNorms.length,
                },
              }}
              fullAppData={{
                projectName,
                contractorName,
                inspectorName,
                materialNorms,
                inventory,
                workVolumes,
                floorPlans,
                defects,
                roomProgressList,
                checklist,
                crewRecords,
                teams,
                updatedAt: lastUpdatedAt,
              }}
            />
          )}
          </React.Suspense>
        </main>

        {/* PDF Export Modal */}
        <ExportPdfModal
          isOpen={isExportPdfOpen}
          onClose={() => setIsExportPdfOpen(false)}
          projectName={projectName}
          contractorName={contractorName}
          inspectorName={inspectorName}
          activeProjectId={activeProjectId}
          userRole={currentUserRole}
          inventory={inventory}
          materialNorms={computedMaterialNorms}
          workVolumes={computedWorkVolumes}
          defects={activeDefects}
          checklist={activeChecklist}
          floorPlans={floorPlans}
          roomProgressList={roomProgressList}
          crewRecords={crewRecords}
          teams={teams}
        />

        {/* Material Norms Modal */}
        <MaterialNormModal
          isOpen={isMaterialNormOpen}
          userRole={currentUserRole}
          roleResolved={isProjectRoleResolved}
          onClose={() => setIsMaterialNormOpen(false)}
          materialNorms={computedMaterialNorms}
          onAddNorm={handleAddNorm}
          onUpdateNorm={handleUpdateNorm}
          onDeleteNorm={handleDeleteNorm}
          onDeleteMultipleNorms={handleDeleteMultipleNorms}
          onImportNorms={handleImportNorms}
          inventory={inventory}
          workVolumes={computedWorkVolumes}
          onImportInventory={handleImportInventory}
          onImportWorkVolumes={(importedVolumes) => {
            if (!isProjectRoleResolved || !canImportData(currentUserRole) || !canManageWorkVolumeStructure(currentUserRole)) {
              console.warn('[RBAC] Chỉ ADMIN được nhập cấu trúc hạng mục khối lượng.');
              return;
            }
            updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes }));
          }}
        />

        {/* Floating alerts never compete with the chat composer / soft keyboard. */}
        {floatingAlertsEnabled && activeTab !== 'chat' && !isSoftKeyboardOpen && (
          <DueDateToastNotifier
            workVolumes={workVolumes}
            checklist={activeChecklist}
            defects={activeDefects}
            onNavigateToItem={handleNavigateFromAlert}
            onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
            onDisableFloating={() => updateFloatingAlertsEnabled(false)}
          />
        )}

        {/* Full Notification Center Modal */}
        <NotificationCenterModal
          isOpen={isNotificationCenterOpen}
          onClose={() => setIsNotificationCenterOpen(false)}
          workVolumes={workVolumes}
          checklist={activeChecklist}
          defects={activeDefects}
          onNavigateToItem={handleNavigateFromAlert}
          chatUnreadCount={chatUnreadCount}
          chatMentioned={chatMentioned}
          onOpenChat={() => { setIsNotificationCenterOpen(false); setActiveTab('chat'); }}
          floatingAlertsEnabled={floatingAlertsEnabled}
          onFloatingAlertsEnabledChange={updateFloatingAlertsEnabled}
        />

        {chatToast && activeTab !== 'chat' && !isSoftKeyboardOpen && (
          <button
            type="button"
            onClick={() => { setChatToast(null); setActiveTab('chat'); }}
            className="fixed z-50 right-3 left-3 sm:left-auto sm:w-80 bottom-20 sm:bottom-20 rounded-2xl border border-indigo-200 bg-white p-3 shadow-2xl text-left animate-in slide-in-from-bottom-2"
          >
            <div className="text-[11px] font-extrabold text-indigo-700">{chatToast.sender}</div>
            <div className="mt-0.5 text-xs text-slate-700 line-clamp-2">“{chatToast.text}”</div>
          </button>
        )}

        {/* Fixed navigation is hidden while the OS keyboard owns the visual viewport. */}
        {!isSoftKeyboardOpen && (
          <BottomNav
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            defectBadgeCount={unhandledDefectsCount}
            chatBadgeCount={chatUnreadCount}
            showChecklist={showChecklistModule}
            showAi={HNL_AI_ENABLED}
            showSuperAdmin={isCurrentSuperAdmin}
          />
        )}

        {/* Security & Access Control Modal */}
        <SecurityModal
          isOpen={isSecurityModalOpen}
          onClose={() => setIsSecurityModalOpen(false)}
          onLockNow={() => setIsAppLocked(true)}
          activeProjectId={activeProjectId}
          projects={securityModalProjects}
        />

        {/* PIN App Lock Fullscreen Overlay */}
        <AppLockOverlay
          isLocked={isAppLocked}
          onUnlock={() => setIsAppLocked(false)}
        />

        {/* Global custom confirm modal for async deletes */}
        <GlobalConfirmModal />
      </div>
    </div>
  );
}
