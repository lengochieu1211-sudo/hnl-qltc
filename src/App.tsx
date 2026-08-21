import { GlobalConfirmModal } from './components/GlobalConfirmModal';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import { safeSetLocalStorageItem } from './utils/storage';
import { parseLegacyTimestamp } from './utils/dateFormatter';
import { AppLockOverlay } from './components/AppLockOverlay';
import { SecurityModal } from './components/SecurityModal';
import { getStoredPinLockConfig, logAuditAction, getCurrentUserRole, setCurrentUserRole, UserRole, canEditProjectData, canManageProjects } from './utils/securityUtils';

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
      const localCloudRevision = Number(localItem.imageCloudRevision || 0);
      const localImageRevision = Number(localItem.imageRevision || 0);
      const sameDriveFile = Boolean(cloudItem.driveFileId && localItem.driveFileId && cloudItem.driveFileId === localItem.driveFileId);
      const sameImageRevision = cloudImageRevision > 0 && (localCloudRevision === cloudImageRevision || localImageRevision === cloudImageRevision);
      const localHasNewerUnsyncedImage = localImageRevision > cloudImageRevision;
      if (localImageDisplayable && (key !== 'imageUrl' || !val.startsWith('cloud-floorplan:') || sameDriveFile || sameImageRevision || localHasNewerUnsyncedImage)) {
        merged[key] = localImage;
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
import { subscribeToProjectRealtime, saveProjectDiffsToCloud, saveProjectToCloud, getCloudPayload, getCurrentRealFirebaseUser, onAuthUserChanged, fetchProjectUserRoleFromCloud, subscribeProjectUserRoleRealtime, fetchCurrentUserProjectsFromCloud, subscribeCurrentUserProjectsRealtime, refreshCurrentUserProjectDiscovery, subscribeProjectSharedSettings, saveProjectSharedSettings, saveProjectAuditLog } from './lib/firebase';
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
import { BottomNav, TabType } from './components/BottomNav';
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
import { getProjectPhotos, getProjectPhotosWithBinary, restorePhotosFromBackup } from './utils/photoStorage';
import { subscribeProjectPhotosRealtime, syncProjectPhotosToCloud, PhotoCloudSyncStatus } from './lib/photoCloudSync';
import { isPrimaryDriveReady, PRIMARY_DRIVE_OWNER_EMAIL, uploadProjectBackupToPrimaryDrive } from './lib/primaryDriveBridge';
import { subscribeConversationReadState, subscribeConversationSummary } from './lib/chatService';
import { floorPlanNeedsCloudUpload, isDisplayableFloorPlanUrl, loadFloorPlanImageFromCloud, syncFloorPlanImageToCloud, deleteFloorPlanImageFromCloud } from './lib/floorPlanImageSync';

// Heavy screens are code-split so Android does not parse XLSX/PDF-heavy modules at startup.
const WarehouseTab = React.lazy(() => import('./components/WarehouseTab').then(m => ({ default: m.WarehouseTab })));
const WorkVolumeTab = React.lazy(() => import('./components/WorkVolumeTab').then(m => ({ default: m.WorkVolumeTab })));
const FloorPlanDefectTab = React.lazy(() => import('./components/FloorPlanDefectTab').then(m => ({ default: m.FloorPlanDefectTab })));
const ChecklistTab = React.lazy(() => import('./components/ChecklistTab').then(m => ({ default: m.ChecklistTab })));
const CrewTab = React.lazy(() => import('./components/CrewTab').then(m => ({ default: m.CrewTab })));
const GoogleConfigTab = React.lazy(() => import('./components/GoogleConfigTab').then(m => ({ default: m.GoogleConfigTab })));
const ChatTab = React.lazy(() => import('./features/chat/ChatTab').then(m => ({ default: m.ChatTab })));

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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('floorplan');
  const [activeProjectId, setActiveProjectId] = useState<string>(() => getActiveProjectId());
  const activeProjectIdRef = useRef<string>(activeProjectId);
  const [isExportPdfOpen, setIsExportPdfOpen] = useState(false);
  const [isMaterialNormOpen, setIsMaterialNormOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [projectManagerInitialTab, setProjectManagerInitialTab] = useState<'projects' | 'sync'>('projects');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [currentUserRole, setCurrentUserRoleState] = useState<UserRole>(() => getCurrentUserRole());
  const googleServerBackendAvailable = hasApiBackend();

  useEffect(() => {
    let isMounted = true;
    let roleUnsub: (() => void) | null = null;

    const attachRoleListener = () => {
      if (roleUnsub) { roleUnsub(); roleUnsub = null; }
      const user = getCurrentRealFirebaseUser();
      if (!user || !activeProjectId) {
        // Auth hydration after camera/background resume is not an authoritative role downgrade.
        // Keep the last verified role until Firebase returns a real role result.
        return;
      }
      roleUnsub = subscribeProjectUserRoleRealtime(activeProjectId, user, (res) => {
        if (!isMounted) return;
        const effectiveRole: UserRole = res.allowed ? res.role : 'VIEWER';
        setCurrentUserRole(effectiveRole);
        setCurrentUserRoleState(effectiveRole);
      });
    };

    attachRoleListener();
    const authUnsub = onAuthUserChanged(attachRoleListener);

    return () => {
      isMounted = false;
      if (roleUnsub) roleUnsub();
      authUnsub();
    };
  }, [activeProjectId]);
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

  const persistLocalTombstones = (projectId: string) => {
    const snapshot = { ...localTombstonesRef.current };
    setAsyncItem(getKey('construction_tombstones', projectId), snapshot).catch((err) =>
      console.warn('Tombstone cache save warning:', err)
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
    console.log('[LOAD PROJECT]', projectId, 'gen:', currentGeneration);
    try {
      await migrateAndCleanLocalStorage();
      
      const parseSaved = async <T,>(key: string, fallback: T): Promise<T> => {
        return await getAsyncItem(getKey(key, projectId), fallback);
      };

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

      const isDefault = projectId === 'default';
      const [
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

      const rawTombstones = await parseSaved<Record<string, number>>('construction_tombstones', {});
      const tombstoneMap = (rawTombstones && typeof rawTombstones === 'object' && !Array.isArray(rawTombstones)) ? rawTombstones : {};
      const filterTombstoned = <T extends { id?: string; updatedAt?: any }>(stateKey: keyof AppData, list: T[] | undefined | null): T[] =>
        (list || []).filter((item) => {
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
        // Only fill missing legacy identities. Explicit IDs remain authoritative, while
        // following legacy rows with the same physical name + unit can reuse the first ID.
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

      const loadedProjectName = localStorage.getItem(getKey('construction_project_name', projectId)) || (isDefault ? 'Dự án chưa đặt tên' : `Dự án ${projectId}`);
      const loadedContractor = localStorage.getItem(getKey('construction_contractor', projectId)) || '';
      const loadedInspector = localStorage.getItem(getKey('construction_inspector', projectId)) || '';
      const loadedUpdatedAt = Number(localStorage.getItem(getKey('construction_updated_at', projectId))) || 0;

      setProjectName(loadedProjectName);
      setContractorName(loadedContractor);
      setInspectorName(loadedInspector);
      setLastUpdatedAt(Number(loadedUpdatedAt) || 0);

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
      hasUserEditedSinceHydrateRef.current = false;
      setIsHydrated(true);
      console.log('[HYDRATED SUCCESS]', projectId);
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
    if (!canEditProjectData(currentUserRole)) return;
    const frozenProjectId = targetProjectId || activeProjectIdRef.current || activeProjectId;
    if (!frozenProjectId) return;
    setIsSaving(true);
    console.log('[SAVE START]', frozenProjectId);

    try {
      await queueSave(async () => {
        await Promise.all([
          setAsyncItem(getKey('construction_material_norms', frozenProjectId), materialNorms),
          setAsyncItem(getKey('construction_inventory', frozenProjectId), inventory),
          setAsyncItem(getKey('construction_work_volumes', frozenProjectId), workVolumes),
          setAsyncItem(getKey('construction_floor_plans', frozenProjectId), floorPlans),
          setAsyncItem(getKey('construction_defects', frozenProjectId), defects),
          setAsyncItem(getKey('construction_room_progress', frozenProjectId), roomProgressList),
          setAsyncItem(getKey('construction_checklist', frozenProjectId), checklist),
          setAsyncItem(getKey('construction_crew_records', frozenProjectId), crewRecords),
          setAsyncItem(getKey('construction_teams', frozenProjectId), teams),
          setAsyncItem(getKey('construction_tombstones', frozenProjectId), localTombstonesRef.current),
        ]);
        safeSetLocalStorageItem(getKey('construction_project_name', frozenProjectId), projectName);
        safeSetLocalStorageItem(getKey('construction_contractor', frozenProjectId), contractorName);
        safeSetLocalStorageItem(getKey('construction_inspector', frozenProjectId), inspectorName);
        safeSetLocalStorageItem(getKey('construction_updated_at', frozenProjectId), String(lastUpdatedAt));
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
    setDataCloudStatus({ phase: 'idle' });
    setActiveProjectId(newProjectId);
  };

  useEffect(() => {
    loadProject(activeProjectId);
  }, [activeProjectId]);

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
  const activeDefects = useMemo(() => defects.filter((item) => !item.archivedAt), [defects]);
  const activeChecklist = useMemo(() => checklist.filter((item) => !item.archivedAt), [checklist]);

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

    // Project-level setting follows the project across PC/Web/APK. LocalStorage is only the offline cache.
    const unsubscribe = subscribeProjectSharedSettings(activeProjectId, (settings) => {
      if (typeof settings.driveAutoSyncEnabled === 'boolean') {
        setAutoSyncEnabled(settings.driveAutoSyncEnabled);
        localStorage.setItem(getKey('construction_drive_auto_sync_enabled', activeProjectId), String(settings.driveAutoSyncEnabled));
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

  const collectProjectPhotoBackup = async (projectIds: string[]) => {
    const projectPhotos: Record<string, any[]> = {};
    const projectPhotoData: Record<string, Record<string, string>> = {};

    for (const projectId of projectIds) {
      const photos = await getProjectPhotosWithBinary(projectId);
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
        floorPlans: includePhotoBinary ? floorPlans : floorPlans.map((plan) => ({
          ...plan,
          imageUrl: plan.driveFileId
            ? `cloud-floorplan:drive:${activeProjectId}:${plan.driveFileId}`
            : (plan.storageProvider === 'firestore-fallback' || String(plan.cloudFileId || '').startsWith('firestore:'))
              ? `cloud-floorplan:firestore:${activeProjectId}:${plan.id}`
              : (String(plan.imageUrl || '').startsWith('data:image/') || String(plan.imageUrl || '').startsWith('blob:'))
                ? '[FLOOR_PLAN_IMAGE_BINARY_STORED_SEPARATELY]'
                : plan.imageUrl,
        })),
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
    const allData: Record<string, any> = {};
    const storageData = await getAllStorageData();
    for (const key in storageData) {
      if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
        allData[key] = storageData[key] || '';
      }
    }

    const projectList = getProjectsList();
    const projectIds = projectList.length > 0 ? projectList.map((project) => project.id) : [activeProjectId || 'default'];
    const { projectPhotos, projectPhotoData } = await collectProjectPhotoBackup(projectIds);
    if (Object.keys(projectPhotos).length > 0) {
      allData.projectPhotos = projectPhotos;
      allData.projectPhotoData = projectPhotoData;
    }
    return allData;
  };

  const buildCurrentProjectVersionBackupObject = async (): Promise<Record<string, string>> => {
    const currentId = activeProjectIdRef.current || activeProjectId || 'default';
    const suffix = currentId === 'default' ? '' : `_${currentId}`;
    const storageData = await getAllStorageData();
    const scoped: Record<string, string> = {};

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
  const floorPlanImageSyncInFlightRef = useRef<Set<string>>(new Set());
  const floorPlanImageHydrateInFlightRef = useRef<Set<string>>(new Set());

  const [cloudInitialReady, setCloudInitialReady] = useState<boolean>(false);
  const receivedInitialSubcollectionsRef = useRef<Set<string>>(new Set());
  const [dataCloudStatus, setDataCloudStatus] = useState<{ phase: 'idle' | 'syncing' | 'synced' | 'error'; lastSyncAt?: number; message?: string }>({ phase: 'idle' });
  const priorityCloudSyncRevisionRef = useRef(0);
  const flushedPriorityCloudSyncRevisionRef = useRef(0);
  const [cloudUserKey, setCloudUserKey] = useState<string>('');
  // Chat must only list projects currently authorized by Firestore. Local recovery
  // projects remain available in Project Manager, but are never treated as chat access.
  const [authorizedChatProjects, setAuthorizedChatProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudBootstrapVersion, setCloudBootstrapVersion] = useState<number>(0);
  const cloudBootstrapAttemptsRef = useRef<Set<string>>(new Set());

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
      if (!photoUser || photoUser.isAnonymous || switchingProjectRef.current) return;
      if (photoSyncTimerRef.current) window.clearTimeout(photoSyncTimerRef.current);
      const projectId = activeProjectIdRef.current;
      const mobilePhotoSyncDelay = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 1800 : 700;
      photoSyncTimerRef.current = window.setTimeout(() => {
        setPhotoCloudStatus({ phase: 'syncing' });
        syncProjectPhotosToCloud(projectId)
          .then(() => setPhotoCloudStatus({ phase: 'synced', pending: 0, lastSyncAt: Date.now() }))
          .catch((err) => setPhotoCloudStatus({ phase: 'error', message: err?.message || String(err) }));
      }, mobilePhotoSyncDelay);
    };
    window.addEventListener('qlct-photo-attachments-changed', handlePhotoAttachmentsChanged);
    return () => {
      window.removeEventListener('qlct-photo-attachments-changed', handlePhotoAttachmentsChanged);
      if (photoSyncTimerRef.current) window.clearTimeout(photoSyncTimerRef.current);
    };
  }, [activeProjectId]);

  // Floor-plan images use the same multi-device principle as Defect/Crew photos:
  // metadata stays in Firestore, while the binary goes to the primary Drive account
  // (Firestore chunks are retained as a safe zero-cost fallback until Drive is configured).
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || switchingProjectRef.current) return;
    const projectId = activeProjectId;
    let cancelled = false;

    const candidates = floorPlans.filter((plan) => floorPlanNeedsCloudUpload(plan));
    if (candidates.length === 0) return;

    const run = async () => {
      // Sequential upload avoids large simultaneous Base64 copies on Android.
      for (const plan of candidates) {
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        if (floorPlanImageSyncInFlightRef.current.has(plan.id)) continue;
        floorPlanImageSyncInFlightRef.current.add(plan.id);
        try {
          const metadata = await syncFloorPlanImageToCloud(projectId, plan);
          if (!metadata || cancelled || activeProjectIdRef.current !== projectId) continue;
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
            setAsyncItem(getKey('construction_floor_plans', projectId), nextPlans).catch((err) => console.warn('Floor-plan sync cache warning:', err));
            return { ...prev, floorPlans: nextPlans };
          });
        } catch (err) {
          console.warn('[Floor Plan Image] upload warning:', plan.floorName, err);
        } finally {
          floorPlanImageSyncInFlightRef.current.delete(plan.id);
        }
      }
    };

    const timer = window.setTimeout(run, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [floorPlans, activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing]);

  // Hydrate cloud-backed floor-plan binaries on another phone/PC. Run one-by-one so
  // opening a project does not allocate every large plan image in RAM at the same time.
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey || switchingProjectRef.current) return;
    const projectId = activeProjectId;
    let cancelled = false;
    const candidates = floorPlans.filter((plan) => (
      !isDisplayableFloorPlanUrl(plan.imageUrl) &&
      Boolean(plan.driveFileId || plan.cloudFileId || plan.storageProvider)
    ));
    if (candidates.length === 0) return;

    const run = async () => {
      for (const plan of candidates) {
        if (cancelled || activeProjectIdRef.current !== projectId) return;
        if (floorPlanImageHydrateInFlightRef.current.has(plan.id)) continue;
        floorPlanImageHydrateInFlightRef.current.add(plan.id);
        try {
          const imageUrl = await loadFloorPlanImageFromCloud(projectId, plan);
          if (!imageUrl || cancelled || activeProjectIdRef.current !== projectId) continue;
          setPresent((prev) => {
            const current = prev.floorPlans.find((item) => item.id === plan.id);
            if (!current || isDisplayableFloorPlanUrl(current.imageUrl)) return prev;
            const nextPlans = prev.floorPlans.map((item) => item.id === plan.id ? { ...item, imageUrl } : item);
            setAsyncItem(getKey('construction_floor_plans', projectId), nextPlans).catch((err) => console.warn('Floor-plan hydrate cache warning:', err));
            return { ...prev, floorPlans: nextPlans };
          });
        } catch (err) {
          console.warn('[Floor Plan Image] hydrate warning:', plan.floorName, err);
        } finally {
          floorPlanImageHydrateInFlightRef.current.delete(plan.id);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
    };
    const timer = window.setTimeout(run, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [floorPlans, activeProjectId, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing]);

  useEffect(() => {
    const refreshCloudUser = () => {
      const user = getCurrentRealFirebaseUser();
      setCloudUserKey(user ? `${user.uid}:${user.email || ''}` : '');
    };
    refreshCloudUser();
    return onAuthUserChanged(refreshCloudUser);
  }, []);

  useEffect(() => {
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
  }, [cloudUserKey]);

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

  // Sync Lock Ref to avoid circular loops
  const syncLockRef = React.useRef(false);

  // Helper to push state changes to history (max 30 steps) and stamp item updatedAt
  const updateAppData = (updater: (prev: AppData) => AppData) => {
    if (!canEditProjectData(currentUserRole)) {
      console.warn('[RBAC] Thao tác bị từ chối: Quyền VIEWER (Chỉ xem) không được phép sửa đổi dữ liệu.');
      return;
    }
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

      collections.forEach((col) => {
        const prevList = prev[col] || [];
        const nextList = rawNext[col] || [];

        if (prevList !== nextList) {
          if (col === 'crewRecords') priorityCloudSyncRevisionRef.current += 1;
          const prevMap = new Map<string, any>();
          (prevList as any[]).forEach(item => { if (item?.id) prevMap.set(String(item.id), item); });
          const nextMap = new Map<string, any>();
          (nextList as any[]).forEach(item => { if (item?.id) nextMap.set(String(item.id), item); });

          const addedIds = Array.from(nextMap.keys()).filter((id) => !prevMap.has(id));
          const deletedIds = Array.from(prevMap.keys()).filter((id) => !nextMap.has(id));
          deletedIds.forEach((id) => recordLocalTombstone(col, id, now));
          addedIds.forEach((id) => clearLocalTombstone(col, id));
          const modifiedDetails: string[] = [];
          for (const [id, nextItem] of nextMap.entries()) {
            const prevItem = prevMap.get(id);
            if (!prevItem || prevItem === nextItem) continue;
            const changedFields = Array.from(new Set([...Object.keys(prevItem), ...Object.keys(nextItem)]))
              .filter((key) => key !== 'updatedAt' && prevItem[key] !== nextItem[key])
              .slice(0, 6);
            modifiedDetails.push(`${id}${changedFields.length ? ` [${changedFields.join(', ')}]` : ''}`);
            if (modifiedDetails.length >= 3) break;
          }
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
              return { ...item, updatedAt: now };
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

      // Safe asynchronous scheduling to prevent React from warning about nested state updates during rendering
      setTimeout(() => {
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
            };
          }
          return { ...item, updatedAt: now };
        } else {
          const { updatedAt: _cu, ...curRest } = curItem;
          const { updatedAt: _tu, ...targetRest } = item;
          if (JSON.stringify(curRest) !== JSON.stringify(targetRest)) {
            return { ...item, updatedAt: now };
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
    if (!canEditProjectData(currentUserRole)) return;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const now = Date.now();
    const stampedPrevious = stampStateChanges(previous, present, now);

    setPast(newPast);
    setFuture((f) => [present, ...f]);
    setPresent(stampedPrevious);

    // Update modified timestamp
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
  };

  const handleRedo = () => {
    if (!canEditProjectData(currentUserRole)) return;
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const now = Date.now();
    const stampedNext = stampStateChanges(next, present, now);

    setPast((p) => [...p, present]);
    setPresent(stampedNext);
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
    lastUpdatedAt
  ]);

  // Firebase Realtime Subcollection-Based Multi-Device Sync Listener
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing) return;
    if (!cloudUserKey) {
      setCloudInitialReady(false);
      return;
    }

    const subscribedProjectId = activeProjectId;
    setCloudInitialReady(false);
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

        receivedInitialSubcollectionsRef.current.add(stateKey);
        if (receivedInitialSubcollectionsRef.current.size >= 9) {
          setCloudInitialReady(true);
        }

        // 2. Perform distributed reconciliation to resolve conflicts and sync cleanly
        setPresent((prev: AppData) => {
          if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return prev;

          const localList = prev[stateKey as keyof AppData] || [];
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
            setAsyncItem(dbKey, mergedPatchList).catch(err => console.warn('Patch sync save IndexedDB warning:', err));
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
          setAsyncItem(dbKey, mergedList).catch(err => console.warn('Sync save IndexedDB warning:', err));

          return updatedState;
        });
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeProjectId, cloudUserKey, cloudBootstrapVersion, isHydrated, isLoadingProject, isRestoring, isInitializing]);

  // Photo metadata is realtime; binary image chunks are downloaded lazily only when an image is displayed.
  // This keeps multi-device image sync complete without loading every photo into phone RAM at startup.
  useEffect(() => {
    const photoTabActive = activeTab === 'floorplan' || activeTab === 'crew' || activeTab === 'chat';
    if (!photoTabActive || !isHydrated || isLoadingProject || isRestoring || isInitializing || !cloudUserKey) {
      setPhotoCloudStatus({ phase: 'idle', pending: 0 });
      return;
    }
    const projectId = activeProjectId;
    const unsubscribePhotos = subscribeProjectPhotosRealtime(projectId, (status) => {
      if (activeProjectIdRef.current === projectId) setPhotoCloudStatus(status);
    });
    return () => unsubscribePhotos();
  }, [activeProjectId, activeTab, cloudUserKey, isHydrated, isLoadingProject, isRestoring, isInitializing]);

  const handleUpdateProjectName = (val: string) => {
    if (!canEditProjectData(currentUserRole)) return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    setProjectName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateContractorName = (val: string) => {
    if (!canEditProjectData(currentUserRole)) return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    setContractorName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateInspectorName = (val: string) => {
    if (!canEditProjectData(currentUserRole)) return;
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
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
    if (getCurrentRealFirebaseUser()) {
      saveProjectSharedSettings(activeProjectId, { driveAutoSyncEnabled: autoSyncEnabled })
        .catch((err) => console.warn('Project setting sync warning:', err));
    }
  }, [autoSyncEnabled, activeProjectId, isHydrated, isLoadingProject]);

  const handleRestoreData = async (rawData: any, targetProjectId?: string) => {
    if (!rawData) return;
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
        await setAsyncItem(getKey('construction_project_name', pid), data.projectName);
        safeSetLocalStorageItem(getKey('construction_project_name', pid), data.projectName);
      }
      if (data.contractorName !== undefined) {
        if (isCurrentActive) setContractorName(data.contractorName || '');
        await setAsyncItem(getKey('construction_contractor', pid), data.contractorName || '');
        safeSetLocalStorageItem(getKey('construction_contractor', pid), data.contractorName || '');
      }
      if (data.inspectorName !== undefined) {
        if (isCurrentActive) setInspectorName(data.inspectorName || '');
        await setAsyncItem(getKey('construction_inspector', pid), data.inspectorName || '');
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
      await setAsyncItem(getKey('construction_updated_at', pid), String(updatedTime));
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
    if (!canEditProjectData(currentUserRole)) return { success: false, error: 'Bạn chỉ có quyền xem dự án.' };
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
    if (!canEditProjectData(currentUserRole)) return { success: false, error: 'Bạn chỉ có quyền xem dự án.' };
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

          const timeStr = new Date(remoteUpdatedAt || Date.now()).toLocaleString('vi-VN');
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
            if (autoSyncEnabled) {
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
    if (!canEditProjectData(currentUserRole)) return;
    if (syncLockRef.current || switchingProjectRef.current) return;
    if (!cloudUserKey) return;
    if (!cloudInitialReady) return;

    const projectIdForThisSave = activeProjectId;
    const priorityRevisionAtSchedule = priorityCloudSyncRevisionRef.current;
    const hasPriorityCrewChange = priorityRevisionAtSchedule > flushedPriorityCloudSyncRevisionRef.current;
    const cloudSaveDelayMs = hasPriorityCrewChange ? 750 : 6000;

    if (hasPriorityCrewChange) {
      setDataCloudStatus({ phase: 'syncing', message: 'Đang đồng bộ quân số...' });
    }

    const timer = setTimeout(() => {
      if (!syncLockRef.current && !switchingProjectRef.current && activeProjectIdRef.current === projectIdForThisSave) {
        if (autoSyncEnabled && googleServerBackendAvailable) {
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
          
          const keys: (keyof AppData)[] = [
            'materialNorms', 'inventory', 'workVolumes', 'floorPlans',
            'defects', 'roomProgressList', 'checklist', 'crewRecords', 'teams'
          ];

          const stateKeyToCloudName: Record<keyof AppData, string> = {
            roomProgressList: 'rooms',
            inventory: 'inventory',
            defects: 'defects',
            workVolumes: 'work_volumes',
            floorPlans: 'floor_plans',
            checklist: 'checklist',
            crewRecords: 'crew_records',
            teams: 'teams',
            materialNorms: 'material_norms'
          };

          const addedOrModified: Record<string, any[]> = {};
          const deletedIds: Record<string, string[]> = {};
          let hasChanges = false;

          for (const k of keys) {
            const prevList = prev[k] || [];
            const nextList = present[k] || [];
            const cloudName = stateKeyToCloudName[k];

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

            const deleted: string[] = [];
            prevList.forEach((item: any) => {
              if (item && item.id && !nextMap.has(item.id)) {
                deleted.push(item.id);
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
            queueCloudSave(async () => {
              await saveProjectDiffsToCloud(activeId, projectName, contractorName, inspectorName, {
                addedOrModified,
                deletedIds
              }, {
                touchProjectMetadata: metadataChanged || !lastSyncedPresentRef.current,
                rootTouchIntervalMs: 60000,
                auditDetailLimit: 20,
              });
              // A single FIFO queue prevents an older request finishing after a newer one.
              if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                lastSyncedPresentRef.current = snapshotForSave;
                lastSyncedMetadataRef.current = { projectName, contractorName, inspectorName };
                flushedPriorityCloudSyncRevisionRef.current = Math.max(flushedPriorityCloudSyncRevisionRef.current, priorityRevisionAtSchedule);
                setDataCloudStatus({ phase: 'synced', lastSyncAt: Date.now() });
              }
            }).catch(err => {
              console.warn('Cloud auto save notice:', err);
              if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                setDataCloudStatus({ phase: 'error', message: err instanceof Error ? err.message : 'Không thể đồng bộ dữ liệu lên Firebase.' });
              }
            });
          }
        } catch (e) {
          console.warn('Cloud auto save exception:', e);
        }
      }
    }, cloudSaveDelayMs); // V6.2.13: crew priority flush 750ms; other edits retain the V6.2.11 6s batching.

    return () => clearTimeout(timer);
  }, [present, projectName, contractorName, inspectorName, autoSyncEnabled, isHydrated, isLoadingProject, isRestoring, isInitializing, activeProjectId, cloudUserKey, cloudInitialReady]);

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

      try {
        const driveBackup = await buildPrimaryDriveBackupObject();
        await uploadProjectBackupToPrimaryDrive(activeProjectIdRef.current, driveBackup, 'manual');
        lastPrimaryDriveBackupAtRef.current = Date.now();
      } catch (driveErr) {
        console.warn('[Primary Drive] manual backup mirror skipped:', driveErr);
      }
      alert('Đã tạo điểm phục hồi dự án thành công!');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAutoSaveVersion = async (id: string) => {
    try {
      const updated = await deleteBackupVersion(id);
      setAutosaveVersions(updated);
    } catch (e) {
      console.error('Error deleting backup version:', e);
    }
  };

  const handleRestoreAutoSaveVersion = async (versionData: any) => {
    if (!versionData || typeof versionData !== 'object') {
      alert('Dữ liệu bản sao lưu không hợp lệ!');
      return;
    }
    
    if (await confirmAsync('⚠️ Chú ý: Việc phục hồi phiên bản này sẽ ghi đè toàn bộ dữ liệu hiện tại của bạn. Bạn có muốn tiếp tục?')) {
      syncLockRef.current = true;
      try {
        await restoreAllProjectsBackupObject(versionData);
        alert('🎉 Phục hồi phiên bản sao lưu thành công!');
        window.location.reload();
      } catch (err) {
        console.error('Restore version error:', err);
        alert('Có lỗi xảy ra khi phục hồi phiên bản.');
        syncLockRef.current = false;
      }
    }
  };

  // Local All File Auto-Save Debounced Effect
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring) return;
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
  }, [localAllFileHandle, present, projectName, contractorName, inspectorName, lastUpdatedAt]);

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

        // Primary Drive is an additional lightweight project backup layer.
        if (Date.now() - lastPrimaryDriveBackupAtRef.current >= intervalMs && await isPrimaryDriveReady().catch(() => false)) {
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
    updateAppData((prev) => {
      const oldNorm = prev.materialNorms.find((n) => n.id === id);
      const oldName = oldNorm?.materialName;
      const stableMaterialId = oldNorm?.materialId || `MAT-${id}`;
      const normalizedUpdated = {
        ...updated,
        materialId: updated.materialId || stableMaterialId,
        unit: normalizeUnit(updated.unit) || updated.unit,
        normBasisUnit: updated.normBasisUnit ? (normalizeUnit(updated.normBasisUnit) || updated.normBasisUnit) : undefined,
      };
      const newName = normalizedUpdated.materialName;

      const newNorms = prev.materialNorms.map((norm) =>
        norm.id === id ? { ...norm, ...normalizedUpdated, id: norm.id } : norm
      );

      let newInventory = prev.inventory;
      if (oldName && oldName.trim().toLocaleLowerCase('vi-VN') !== newName.trim().toLocaleLowerCase('vi-VN')) {
        const oldKey = oldName.trim().toLocaleLowerCase('vi-VN');
        newInventory = prev.inventory.map((inv) => {
          const isMatch = (inv.materialId && (inv.materialId === id || inv.materialId === stableMaterialId || (oldNorm && inv.materialId === oldNorm.materialId)))
            || (inv.materialName && inv.materialName.trim().toLocaleLowerCase('vi-VN') === oldKey);
          return isMatch
            ? { ...inv, materialId: stableMaterialId, materialName: newName, unit: normalizedUpdated.unit }
            : inv;
        });
      }

      return {
        ...prev,
        materialNorms: newNorms,
        inventory: newInventory,
      };
    });
  };

  const handleDeleteNorm = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      materialNorms: prev.materialNorms.filter((norm) => norm.id !== id),
    }));
  };

  const handleDeleteMultipleNorms = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      materialNorms: prev.materialNorms.filter((norm) => !ids.includes(norm.id)),
    }));
  };

  const handleImportNorms = (importedNorms: MaterialNorm[]) => {
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

  // Handlers for Inventory
  const handleAddInventory = (item: Omit<InventoryItem, 'id'> & { id?: string }) => {
    const newId = item.id || createEntityId(item.type === 'in' ? 'NK' : 'XK');
    updateAppData((prev) => {
      const normalized = { ...item, unit: normalizeUnit(item.unit) || item.unit, id: newId } as InventoryItem;
      const existingIndex = prev.inventory.findIndex((inv) => inv.id === newId);
      if (existingIndex >= 0) {
        const existing = prev.inventory[existingIndex];
        // One deterministic room-auto record per room/material. Never let a stale
        // device lower the cumulative quantity already recorded.
        const merged = normalized.sourceType === 'room-auto'
          ? { ...existing, ...normalized, quantity: Math.max(Number(existing.quantity || 0), Number(normalized.quantity || 0)) }
          : { ...existing, ...normalized };
        return { ...prev, inventory: prev.inventory.map((inv, idx) => idx === existingIndex ? merged : inv) };
      }
      return { ...prev, inventory: [normalized, ...prev.inventory] };
    });
  };

  const handleUpdateInventory = (id: string, item: Omit<InventoryItem, 'id'>) => {
    updateAppData((prev) => ({
      ...prev,
      inventory: prev.inventory.map((existing) => existing.id === id ? { ...existing, ...item, unit: normalizeUnit(item.unit) || item.unit, id } : existing),
    }));
  };

  const handleDeleteInventory = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      inventory: prev.inventory.filter((i) => i.id !== id),
    }));
  };

  const handleDeleteMultipleInventory = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      inventory: prev.inventory.filter((i) => !ids.includes(i.id)),
    }));
  };

  const handleImportInventory = (importedInventory: InventoryItem[]) => {
    updateAppData((prev) => ({
      ...prev,
      inventory: importedInventory.map((item) => ({ ...item, unit: normalizeUnit(item.unit) || item.unit })),
    }));
  };

  // Handlers for Work Volume
  const handleAddWorkVolume = (item: Omit<WorkVolume, 'id'>) => {
    const newId = createEntityId('HM');
    updateAppData((prev) => ({
      ...prev,
      workVolumes: [...prev.workVolumes, { ...item, unit: normalizeUnit(item.unit) || item.unit, id: newId }],
    }));
  };

  const handleSaveWorkVolume = (item: Omit<WorkVolume, 'id'> & { id?: string }) => {
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
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === id ? { ...fp, ...updates } : fp)),
    }));
  };

  const handleUpdateFloorPlanImage = (id: string, imageUrl: string) => {
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
      void deleteFloorPlanImageFromCloud(activeProjectIdRef.current, targetPlan).catch((err) =>
        console.warn('Delete floor-plan cloud image warning:', err)
      );
    }
  };

  const handleDeleteMultipleFloorPlans = (ids: string[]) => {
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
      void deleteFloorPlanImageFromCloud(activeProjectIdRef.current, plan).catch((err) =>
        console.warn('Delete floor-plan cloud image warning:', err)
      );
    });
  };

  const handleDuplicateFloorPlan = (id: string, customName?: string) => {
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
      
      const newDefect: DefectItem = {
        ...defect,
        id: newId,
        createdAt: new Date().toISOString(),
      };

      return {
        ...prev,
        defects: [newDefect, ...prev.defects],
      };
    });
  };

  const handleUpdateDefectStatus = (id: string, status: DefectStatus) => {
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
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.map((d) => (d.id === updatedDefect.id ? updatedDefect : d)),
    }));
  };

  const handleDeleteDefect = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.filter((d) => d.id !== id),
    }));
  };

  const handleDeleteMultipleDefects = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.filter((d) => !ids.includes(d.id)),
    }));
  };

  // Handlers for Room Progress / Acceptance
  const handleSaveRoomProgress = (
    room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }
  ) => {
    const updatedAt = Date.now();
    updateAppData((prev) => {
      const exists = room.id ? prev.roomProgressList.some((r) => r.id === room.id) : false;
      if (room.id && exists) {
        return {
          ...prev,
          roomProgressList: prev.roomProgressList.map((r) => (r.id === room.id
            ? { ...r, ...room, id: room.id, createdAt: r.createdAt || updatedAt, updatedAt }
            : r)),
        };
      } else {
        const newId = room.id || createEntityId('ROOM');
        return {
          ...prev,
          roomProgressList: [{ ...room, id: newId, createdAt: updatedAt, updatedAt }, ...prev.roomProgressList],
        };
      }
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
        return updated ? { ...r, ...updated, updatedAt } : r;
      }),
    }));
  };

  const handleCreateMultipleRoomProgress = (rooms: RoomProgressItem[]) => {
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
    const newId = createEntityId('CHK');
    updateAppData((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { ...item, id: newId }],
    }));
  };

  const handleUpdateChecklistItem = (updatedItem: ChecklistItem) => {
    const normalizedItem: ChecklistItem = updatedItem.status === 'pending'
      ? { ...updatedItem, inspectedBy: undefined, inspectedAt: undefined }
      : updatedItem;
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item) => (item.id === normalizedItem.id ? normalizedItem : item)),
    }));
  };

  const handleDeleteChecklistItem = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((item) => item.id !== id),
    }));
  };

  const handleDeleteMultipleChecklistItems = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((item) => !ids.includes(item.id)),
    }));
  };

  // Handlers for Crew/Quân số
  const handleAddCrewRecord = (record: Omit<CrewRecord, 'id'> & { id?: string }) => {
    const newId = record.id || createEntityId('crew');
    updateAppData((prev) => ({
      ...prev,
      crewRecords: [...prev.crewRecords, { ...record, id: newId }],
    }));
  };

  const handleUpdateCrewRecord = (id: string, record: Partial<CrewRecord>) => {
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.map((r) => (r.id === id ? { ...r, ...record } : r)),
    }));
  };

  const handleDeleteCrewRecord = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.filter((r) => r.id !== id),
    }));
  };

  const handleDeleteMultipleCrewRecords = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      crewRecords: prev.crewRecords.filter((r) => !ids.includes(r.id)),
    }));
  };

  const handleCopyCrewRecordsFromDate = (sourceDate: string, targetDate: string) => {
    updateAppData((prev) => {
      const sourceRecords = prev.crewRecords.filter((r) => r.date === sourceDate);
      const keptRecords = prev.crewRecords.filter((r) => r.date !== targetDate);
      const cloned = sourceRecords.map((r) => ({
        ...r,
        id: createEntityId('crew'),
        date: targetDate,
      }));
      return {
        ...prev,
        crewRecords: [...keptRecords, ...cloned],
      };
    });
  };

  const floorNames = Array.from(new Set(floorPlans.map((fp) => fp.floorName)));
  const unhandledDefectsCount = defects.filter((d) => !d.archivedAt && d.status !== 'Đã nghiệm thu').length;

  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
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
    return collectDueDateAlerts(workVolumes, checklist, defects);
  }, [workVolumes, checklist, defects]);

  const handleNavigateFromAlert = (alertItem: DueDateAlertItem) => {
    if (alertItem.type === 'workVolume') {
      setActiveTab('volume');
    } else if (alertItem.type === 'checklist') {
      setActiveTab('checklist');
    } else if (alertItem.type === 'defect') {
      setActiveTab('floorplan');
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
        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      >
        {/* Sticky Top Header */}
        <GoogleAuthHeader
          projectName={projectName}
          lastUpdatedAt={lastUpdatedAt}
          setProjectName={handleUpdateProjectName}
          onSyncAll={handleSyncAll}
          isSyncing={isSyncing}
          onOpenExportPdf={() => setIsExportPdfOpen(true)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
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
                  "{pendingFileRestorePrompt.handleName}" (Cập nhật: {new Date(pendingFileRestorePrompt.fileUpdatedAt).toLocaleString('vi-VN')})
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
          autoSyncEnabled={autoSyncEnabled}
          setAutoSyncEnabled={setAutoSyncEnabled}
          onDriveSyncUpAll={googleServerBackendAvailable ? handleDriveSyncUpAll : undefined}
          onDriveSyncDownAll={googleServerBackendAvailable ? handleDriveSyncDownAll : undefined}
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
        <OfflineSyncBanner onAutoSync={googleServerBackendAvailable ? handleSyncAll : undefined} isSyncing={isSyncing} />

        {/* Tab Content */}
        <main className="animate-in fade-in duration-150">
          <React.Suspense fallback={<div className="p-8 text-center text-sm text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Đang tải mục...</div>}>
          {activeTab === 'warehouse' && (
            <WarehouseTab
              inventory={inventory}
              onAddInventory={handleAddInventory}
              onUpdateInventory={handleUpdateInventory}
              onDeleteInventory={handleDeleteInventory}
              onDeleteMultipleInventory={handleDeleteMultipleInventory}
              onSyncSheets={googleServerBackendAvailable ? handleSyncAll : undefined}
              materialNorms={computedMaterialNorms}
              onOpenNormModal={() => setIsMaterialNormOpen(true)}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              workVolumes={computedWorkVolumes}
              onImportInventory={handleImportInventory}
              onImportNorms={handleImportNorms}
              onImportWorkVolumes={(importedVolumes) => updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes.map((item) => ({ ...item, unit: normalizeUnit(item.unit) || item.unit })) }))}
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
              canUndo={past.length > 0}
              canRedo={future.length > 0}
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
              inspectorName={inspectorName}
              onAddInventory={handleAddInventory}
              onAddFloorPlan={handleAddFloorPlan}
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
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
            />
          )}

          {activeTab === 'checklist' && (
            <ChecklistTab
              checklist={activeChecklist}
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
              canUndo={past.length > 0}
              canRedo={future.length > 0}
            />
          )}

          {activeTab === 'crew' && (
            <CrewTab
              projectId={activeProjectId}
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
              onDriveSyncUp={handleDriveSyncUp}
              onDriveSyncDown={handleDriveSyncDown}
              activeProjectId={activeProjectId}
              localFileHandle={localFileHandle}
              localSyncStatus={localSyncStatus}
              localSyncPermissionNeeded={localSyncPermissionNeeded}
              localFileName={localFileName}
              onLinkLocalFile={handleLinkLocalFile}
              onUnlinkLocalFile={handleUnlinkLocalFile}
              onRequestLocalFilePermission={handleRequestLocalFilePermission}
              onOpenProjectManager={() => handleOpenProjectManager('sync')}
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
          onImportWorkVolumes={(importedVolumes) => updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes }))}
        />

        {/* Floating Due Date Toast Notification */}
        <DueDateToastNotifier
          workVolumes={workVolumes}
          checklist={activeChecklist}
          defects={activeDefects}
          onNavigateToItem={handleNavigateFromAlert}
          onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
        />

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
        />

        {chatToast && activeTab !== 'chat' && (
          <button
            type="button"
            onClick={() => { setChatToast(null); setActiveTab('chat'); }}
            className="fixed z-50 right-3 left-3 sm:left-auto sm:w-80 bottom-20 sm:bottom-20 rounded-2xl border border-indigo-200 bg-white p-3 shadow-2xl text-left animate-in slide-in-from-bottom-2"
          >
            <div className="text-[11px] font-extrabold text-indigo-700">{chatToast.sender}</div>
            <div className="mt-0.5 text-xs text-slate-700 line-clamp-2">“{chatToast.text}”</div>
          </button>
        )}

        {/* Fixed Mobile Bottom Navigation Bar */}
        <BottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          defectBadgeCount={unhandledDefectsCount}
          chatBadgeCount={chatUnreadCount}
        />

        {/* Security & Access Control Modal */}
        <SecurityModal
          isOpen={isSecurityModalOpen}
          onClose={() => setIsSecurityModalOpen(false)}
          onLockNow={() => setIsAppLocked(true)}
          activeProjectId={activeProjectId}
          projects={getProjectsList()}
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
