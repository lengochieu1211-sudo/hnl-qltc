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
    if (typeof val === 'string' && val.includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]')) {
      if (localItem[key] && typeof localItem[key] === 'string' && !localItem[key].includes('[IMAGE_OMITTED_FOR_CLOUD_SIZE_LIMIT]')) {
        merged[key] = localItem[key];
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
import { subscribeToProjectRealtime, saveProjectDiffsToCloud, saveProjectToCloud, getCloudPayload } from './lib/firebase';
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
import { 
  INITIAL_INVENTORY, 
  INITIAL_WORK_VOLUMES, 
  INITIAL_FLOOR_PLANS, 
  INITIAL_DEFECTS, 
  INITIAL_CHECKLIST,
  INITIAL_MATERIAL_NORMS,
  INITIAL_ROOM_PROGRESS,
  INITIAL_CREW_RECORDS,
  INITIAL_TEAMS
} from './data/initialData';
import { GoogleAuthHeader } from './components/GoogleAuthHeader';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { WarehouseTab } from './components/WarehouseTab';
import { WorkVolumeTab } from './components/WorkVolumeTab';
import { FloorPlanDefectTab } from './components/FloorPlanDefectTab';
import { ChecklistTab } from './components/ChecklistTab';
import { CrewTab } from './components/CrewTab';
import { GoogleConfigTab } from './components/GoogleConfigTab';
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
import { getSubItemEffectiveWeight } from './utils/teamUtils';
import { reconcileMaterialNormWorkCategoryLinks } from './utils/projectReconciliation';
import { apiFetch, hasApiBackend } from './utils/api';
import {
  getAndroidAutoSaveFolderName,
  hasAndroidAutoSaveFolder,
  isAndroidAutoSaveAvailable,
  pickAndroidAutoSaveFolder,
  saveTextFileToAndroidAutoFolder
} from './utils/fileExport';

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
    return localStorage.getItem('active_project_id') || 'default';
  }
  return 'default';
};

export const getKey = (baseKey: string, pid?: string) => {
  const p = pid || getActiveProjectId();
  return p === 'default' ? baseKey : `${baseKey}_${p}`;
};

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string | number;
  updatedAt?: number;
}

export const getProjectsList = (): ProjectInfo[] => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('construction_projects_list');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
  }
  return [{ id: 'default', name: 'Tòa Nhà HH2 Sunrise Tower', createdAt: new Date().toISOString() }];
};

export const setActiveProject = (id: string) => {
  safeSetLocalStorageItem('active_project_id', id);
};

export const saveProjectsList = (list: ProjectInfo[]) => {
  safeSetLocalStorageItem('construction_projects_list', JSON.stringify(list));
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('floorplan');
  const [activeProjectId, setActiveProjectId] = useState<string>(() => getActiveProjectId());
  const [isExportPdfOpen, setIsExportPdfOpen] = useState(false);
  const [isMaterialNormOpen, setIsMaterialNormOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [projectManagerInitialTab, setProjectManagerInitialTab] = useState<'projects' | 'sync'>('projects');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [currentUserRole, setCurrentUserRoleState] = useState<UserRole>(() => getCurrentUserRole());
  const googleServerBackendAvailable = hasApiBackend();

  useEffect(() => {
    let isMounted = true;
    async function syncUserRole() {
      try {
        const { getCurrentFirebaseUser, fetchProjectUserRoleFromCloud } = await import('./lib/firebase');
        const user = getCurrentFirebaseUser();
        if (user && activeProjectId) {
          const res = await fetchProjectUserRoleFromCloud(activeProjectId, user);
          if (isMounted && res.role) {
            setCurrentUserRole(res.role);
            setCurrentUserRoleState(res.role);
          }
        } else {
          const localRole = getCurrentUserRole();
          if (isMounted) setCurrentUserRoleState(localRole);
        }
      } catch (_) {}
    }

    syncUserRole();

    let unsub: (() => void) | null = null;
    import('./lib/firebase').then(({ onAuthUserChanged }) => {
      unsub = onAuthUserChanged(() => {
        syncUserRole();
      });
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unsub) unsub();
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
  const [projectName, setProjectName] = useState<string>('Tòa Nhà HH2 Sunrise Tower');

  const [contractorName, setContractorName] = useState<string>('Công Ty Cổ Phần Xây Dựng & Thạch Cao Hà Nội');
  const [inspectorName, setInspectorName] = useState<string>('KS. Nguyễn Văn Bình');
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
            id = `${itemPrefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${idx}`;
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
        parseSaved('construction_floor_plans', isDefault ? INITIAL_FLOOR_PLANS : []),
        parseSaved('construction_room_progress', isDefault ? INITIAL_ROOM_PROGRESS : []),
        parseSaved('construction_defects', isDefault ? INITIAL_DEFECTS : []),
        parseSaved('construction_checklist', isDefault ? INITIAL_CHECKLIST : []),
        parseSaved('construction_crew_records', isDefault ? INITIAL_CREW_RECORDS : []),
        parseSaved('construction_material_norms', isDefault ? INITIAL_MATERIAL_NORMS : []),
        parseSaved('construction_inventory', isDefault ? INITIAL_INVENTORY : []),
        parseSaved('construction_work_volumes', isDefault ? INITIAL_WORK_VOLUMES : []),
        parseSaved('construction_teams', isDefault ? INITIAL_TEAMS : []),
      ]);

      if (currentGeneration !== loadGenerationRef.current) {
        console.log('[STALE LOAD DISCARDED]', projectId);
        return;
      }

      const floorPlans = deduplicateById(rawFloorPlans || [], 'FP');
      floorPlans.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      floorPlans.forEach((fp, idx) => { fp.order = idx; });
      const roomProgressList = deduplicateById(rawRooms || [], 'ROOM');
      const defects = deduplicateById(rawDefects || [], 'DEF');
      const checklist = deduplicateById(rawChecklist || [], 'CHK');
      const crewRecords = deduplicateById(rawCrew || [], 'CREW');
      const materialNorms = deduplicateById(rawMaterialNorms || [], 'NORM');
      const inventory = deduplicateById(rawInventory || [], 'INV');
      const workVolumes = deduplicateById(rawWorkVolumes || [], 'VOL');
      const teams = deduplicateById(rawTeams || [], 'TEAM');

      const loadedProjectName = localStorage.getItem(getKey('construction_project_name', projectId)) || (isDefault ? 'Tòa Nhà HH2 Sunrise Tower' : `Dự án ${projectId}`);
      const loadedContractor = localStorage.getItem(getKey('construction_contractor', projectId)) || (isDefault ? 'Công Ty Cổ Phần Xây Dựng & Thạch Cao Hà Nội' : '');
      const loadedInspector = localStorage.getItem(getKey('construction_inspector', projectId)) || (isDefault ? 'KS. Nguyễn Văn Bình' : '');
      const loadedUpdatedAt = Number(localStorage.getItem(getKey('construction_updated_at', projectId))) || 0;

      setProjectName(loadedProjectName);
      setContractorName(loadedContractor);
      setInspectorName(loadedInspector);
      setLastUpdatedAt(Number(loadedUpdatedAt) || 0);

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

    setIsSaving(true);
    try {
      await saveCurrentProject(oldId);
    } catch (e) {
      console.warn('Save before switch failed:', e);
      alert('⚠️ Không thể lưu dữ liệu dự án hiện tại trước khi chuyển. Vui lòng thử lại.');
      setIsSaving(false);
      switchingProjectRef.current = false;
      return;
    }

    setIsHydrated(false);
    setActiveProject(newProjectId);
    activeProjectIdRef.current = newProjectId;
    lastSyncedPresentRef.current = null;
    lastSyncedMetadataRef.current = null;
    lastServerMetadataUpdatedAtRef.current = 0;
    setCloudInitialReady(false);
    receivedInitialSubcollectionsRef.current.clear();
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
        return item; // Fallback to raw item if no matching rooms in the floor plans
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
        if (room.inspectionStatus === 'Đạt nghiệm thu') {
          totalActual += roomVol;
        } else if (subItemsInCat.length > 0) {
          // Weighted progress calculation using getSubItemEffectiveWeight
          const totalWeight = subItemsInCat.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);

          const completedWeight = subItemsInCat.reduce((sum, s) => {
            const isDone = s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu';
            if (!isDone) return sum;
            return sum + getSubItemEffectiveWeight(s);
          }, 0);

          const ratio = totalWeight > 0 ? Math.min(1, completedWeight / totalWeight) : 0;
          totalActual += roomVol * ratio;
        } else {
          const titleLower = item.title.toLowerCase();
          const isFrame = titleLower.includes('khung') || titleLower.includes('xương');
          const isBoard = titleLower.includes('tấm');

          if (room.inspectionStatus === 'Đạt nghiệm thu') {
            totalActual += roomVol;
          } else if (isFrame && room.frameStatus === 'Đã hoàn thành') {
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

  // Dynamically compute materialNorms quantity (Số lượng định mức) based on matching work category volumes
  const computedMaterialNorms = useMemo(() => {
    return materialNorms.map(norm => {
      const categories = norm.workCategories || (norm.workCategory ? [norm.workCategory] : []);
      const categoryIds = (norm as any).workCategoryIds || ((norm as any).workCategoryId ? [(norm as any).workCategoryId] : []);
      
      if (categories.length > 0 || categoryIds.length > 0) {
        // Compute total volume multiplied by corresponding norm (either specific or general)
        let totalQuota = 0;
        let hasNorms = false;
        
        // Match by categories (names)
        categories.forEach(cat => {
          const catVolume = computedWorkVolumes
            .filter(v => v.title === cat || v.category === cat)
            .reduce((sum, v) => sum + (v.planned || 0), 0);
          
          if (catVolume > 0) {
            let factor = 0;
            if (norm.workCategoryNorms && norm.workCategoryNorms[cat] !== undefined) {
              factor = norm.workCategoryNorms[cat];
              hasNorms = true;
            } else if (norm.unitNormPerM2 && norm.unitNormPerM2 > 0) {
              factor = norm.unitNormPerM2;
              hasNorms = true;
            }
            totalQuota += catVolume * factor;
          }
        });

        // Match by categoryIds (IDs)
        categoryIds.forEach((catId: string) => {
          const catVolume = computedWorkVolumes
            .filter(v => (v.id === catId || v.workCategoryId === catId) && !categories.includes(v.title))
            .reduce((sum, v) => sum + (v.planned || 0), 0);

          if (catVolume > 0) {
            let factor = 0;
            const normAny = norm as any;
            if (normAny.workCategoryIdNorms && normAny.workCategoryIdNorms[catId] !== undefined) {
              factor = normAny.workCategoryIdNorms[catId];
              hasNorms = true;
            } else if (norm.unitNormPerM2 && norm.unitNormPerM2 > 0) {
              factor = norm.unitNormPerM2;
              hasNorms = true;
            }
            totalQuota += catVolume * factor;
          }
        });
        
        if (hasNorms && totalQuota > 0) {
          return {
            ...norm,
            quotaQuantity: Math.round(totalQuota * 100) / 100
          };
        }
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

  const getSafeProjectFileName = () => (projectName || activeProjectId || 'Du_An')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
  const getSingleAutoSaveFileName = () => `[Auto_Sync_Backup]_${getSafeProjectFileName()}.json`;
  const getAllAutoSaveFileName = () => '[Toan_Bo_Du_An]_Backup.json';
  const buildSingleProjectBackupJson = () => JSON.stringify({
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
      floorPlans,
      defects,
      roomProgressList,
      checklist,
      crewRecords,
      teams,
      updatedAt: lastUpdatedAt,
    }
  }, null, 2);

  const switchingProjectRef = useRef<boolean>(false);
  const activeProjectIdRef = useRef<string>(activeProjectId);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  const [cloudInitialReady, setCloudInitialReady] = useState<boolean>(false);
  const receivedInitialSubcollectionsRef = useRef<Set<string>>(new Set());

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

      collections.forEach((col) => {
        const prevList = prev[col] || [];
        const nextList = rawNext[col] || [];

        if (prevList !== nextList) {
          const prevMap = new Map<string, any>();
          prevList.forEach(item => { if (item?.id) prevMap.set(item.id, item); });

          const newColList = nextList.map(item => {
            if (!item || !item.id) return item;
            const prevItem = prevMap.get(item.id);
            if (!prevItem) {
              return { ...item, updatedAt: now };
            } else {
              const { updatedAt: _pu, ...prevRest } = prevItem;
              const { updatedAt: _nu, ...nextRest } = item;
              if (JSON.stringify(prevRest) !== JSON.stringify(nextRest)) {
                return { ...item, updatedAt: now };
              }
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
        setPast((p) => [...p.slice(-29), prev]);
        setFuture([]);

        // Update local modified timestamp on any UI action
        if (!syncLockRef.current) {
          setLastUpdatedAt(now);
          localStorage.setItem(getKey('construction_updated_at', activeProjectIdRef.current), String(now));
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

      const newColList = targetList.map(item => {
        if (!item || !item.id) return item;
        const curItem = curMap.get(item.id);
        if (!curItem) {
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [past, present, future]);

  // Firebase Realtime Subcollection-Based Multi-Device Sync Listener
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring || isInitializing) return;

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
      (stateKey, cloudItems, isInitial) => {
        if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return;

        receivedInitialSubcollectionsRef.current.add(stateKey);
        if (receivedInitialSubcollectionsRef.current.size >= 9) {
          setCloudInitialReady(true);
        }

        // 2. Perform distributed reconciliation to resolve conflicts and sync cleanly
        setPresent((prev: AppData) => {
          if (switchingProjectRef.current || activeProjectIdRef.current !== subscribedProjectId) return prev;

          const localList = prev[stateKey as keyof AppData] || [];
          
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

          // Process items from cloud
          cloudItems.forEach(cloudItem => {
            if (!cloudItem || !cloudItem.id) return;

            const localItem = localMap.get(cloudItem.id);
            const localTime = localItem ? parseLegacyTimestamp(localItem.updatedAt, 0) : 0;
            const cloudTime = parseLegacyTimestamp(cloudItem.updatedAt, 0);

            if (cloudItem.deleted) {
              // Cloud item is a soft-deleted tombstone
              if (localItem) {
                if (cloudTime >= localTime) {
                  // Deletion on cloud is newer or equal -> delete locally
                  listHasChanges = true;
                } else {
                  // Local item was re-created/edited after deletion -> keep localItem
                  mergedList.push(localItem);
                }
              }
              // If localItem doesn't exist, omit it
            } else {
              // Active cloud item
              if (!localItem) {
                mergedList.push(cloudItem);
                listHasChanges = true;
              } else {
                if (cloudTime > localTime) {
                  // Cloud is newer -> use cloudItem, restoring local Base64 images if omitted for cloud size limit
                  mergedList.push(restoreLocalOmittedImages(cloudItem, localItem));
                  listHasChanges = true;
                } else {
                  // Local is newer or equal -> keep localItem
                  mergedList.push(localItem);
                  if (cloudTime < localTime) {
                    listHasChanges = true;
                  }
                }
              }
            }
          });

          // Process local-only items (keep them safely without assuming deletion by another device unless tombstoned)
          localList.forEach(localItem => {
            if (localItem && localItem.id && !cloudMap.has(localItem.id)) {
              mergedList.push(localItem);
            }
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
  }, [activeProjectId, isHydrated, isLoadingProject, isRestoring, isInitializing]);

  const handleUpdateProjectName = (val: string) => {
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    setProjectName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateContractorName = (val: string) => {
    hasUserEditedSinceHydrateRef.current = true;
    hasUnsavedAllBackupChangesRef.current = true;
    setContractorName(val);
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleUpdateInspectorName = (val: string) => {
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
    const operationProjectId = activeProjectIdRef.current || activeProjectId;
    if (!googleServerBackendAvailable) {
      setDriveSyncStatus('idle');
      return {
        success: false,
        error: 'Google Drive sync can server backend. Firebase Hosting mien phi dang chay static-only nen da tat tinh nang nay.',
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
        const timeStr = new Date().toLocaleString('vi-VN');
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
    if (!googleServerBackendAvailable) {
      return {
        success: false,
        error: 'Google Drive sync can server backend. Firebase Hosting mien phi dang chay static-only nen da tat tinh nang nay.',
      };
    }

    try {
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const allData: Record<string, string> = {};
      const storageData = await getAllStorageData();
      for (const key in storageData) {
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = storageData[key] || '';
        }
      }

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
        error: 'Google Drive sync can server backend. Firebase Hosting mien phi dang chay static-only nen da tat tinh nang nay.',
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
        for (const key in result.data) {
          if (key.startsWith('construction_') || key.startsWith('active_project_id')) {
            const val = result.data[key];
            const isLargeKey = [
              'material_norms',
              'inventory',
              'work_volumes',
              'floor_plans',
              'defects',
              'room_progress',
              'checklist',
              'crew_records',
              'teams'
            ].some(x => key.includes(`construction_${x}`));

            if (isLargeKey) {
              await setAsyncItem(key, typeof val === 'string' ? JSON.parse(val) : val);
            } else {
              localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
            }
          }
        }
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
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
        for (const key in storageData) {
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = storageData[key] || '';
          }
        }
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
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
        for (const key in storageData) {
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = storageData[key] || '';
          }
        }
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
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
        for (const key in storageData) {
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = storageData[key] || '';
          }
        }
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
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
      for (const key in storageData) {
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = storageData[key] || '';
        }
      }
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
        error: 'Google Drive sync can server backend. Firebase Hosting mien phi dang chay static-only nen da tat tinh nang nay.',
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
    if (syncLockRef.current || switchingProjectRef.current) return;
    if (!cloudInitialReady) return;

    const projectIdForThisSave = activeProjectId;

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
              if (!prevItem || JSON.stringify(prevItem) !== JSON.stringify(item)) {
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
            saveProjectDiffsToCloud(activeId, projectName, contractorName, inspectorName, {
              addedOrModified,
              deletedIds
            }).then(() => {
              // Update references only after successful commit
              if (!switchingProjectRef.current && activeProjectIdRef.current === activeId) {
                lastSyncedPresentRef.current = JSON.parse(JSON.stringify(present));
                lastSyncedMetadataRef.current = { projectName, contractorName, inspectorName };
              }
            }).catch(err => console.warn('Cloud auto save notice:', err));
          }
        } catch (e) {
          console.warn('Cloud auto save exception:', e);
        }
      }
    }, 2000); // 2 seconds debounce after input changes

    return () => clearTimeout(timer);
  }, [present, projectName, contractorName, inspectorName, autoSyncEnabled, isHydrated, isLoadingProject, isRestoring, isInitializing, activeProjectId, cloudInitialReady]);

  // Local File Auto-Save Debounced Effect
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring) return;
    if (!localFileHandle) return;
    if (syncLockRef.current) return;
    if (!hasUserEditedSinceHydrateRef.current) return;

    const timer = setTimeout(async () => {
      try {
        const jsonString = JSON.stringify({
          schemaVersion: 3,
          backupType: 'single-project',
          project: {
            id: activeProjectId,
            name: projectName,
          },
          data: {
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
          }
        }, null, 2);

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
    const allData: Record<string, string> = {};
    const storageData = await getAllStorageData();
      for (const key in storageData) {
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = storageData[key] || '';
        }
      }

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
        for (const key in versionData) {
          const val = versionData[key];
          
          const isLargeKey = [
            'material_norms',
            'inventory',
            'work_volumes',
            'floor_plans',
            'defects',
            'room_progress',
            'checklist',
            'crew_records',
            'teams'
          ].some(x => key.includes(`construction_${x}`));

          if (isLargeKey) {
            await setAsyncItem(key, typeof val === 'string' ? JSON.parse(val) : val);
          } else {
            safeSetLocalStorageItem(key, typeof val === 'string' ? val : JSON.stringify(val));
          }
        }
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
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
        for (const key in storageData) {
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = storageData[key] || '';
          }
        }
        
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

  // General Auto-Save Versioning debounced effect on any data change
  useEffect(() => {
    if (!isHydrated || isLoadingProject || isRestoring) return;
    if (syncLockRef.current) return;
    if (!lastUpdatedAt) return;

    const timer = setTimeout(async () => {
      try {
        const allData: Record<string, string> = {};
        const storageData = await getAllStorageData();
      for (const key in storageData) {
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = storageData[key] || '';
        }
      }
        
        // Save to version history automatically
        await saveAutoSaveVersion(allData);
      } catch (err) {
        console.error('Error in background auto-saving version:', err);
      }
    }, 4000); // 4 seconds debounce for automatic background saving

    return () => clearTimeout(timer);
  }, [lastUpdatedAt]);

  // Link local JSON file for auto sync
  const handleLinkLocalFile = async () => {
    try {
      if (isAndroidAutoSaveAvailable()) {
        if (!hasAndroidAutoSaveFolder()) {
          await pickAndroidAutoSaveFolder();
        }
        const jsonString = buildSingleProjectBackupJson();
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
        const jsonString = JSON.stringify({
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
            floorPlans,
            defects,
            roomProgressList,
            checklist,
            crewRecords,
            teams,
            updatedAt: lastUpdatedAt,
          }
        }, null, 2);

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
        const jsonString = buildSingleProjectBackupJson();
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
        const jsonString = JSON.stringify({
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
            floorPlans,
            defects,
            roomProgressList,
            checklist,
            crewRecords,
            teams,
            updatedAt: lastUpdatedAt,
          }
        }, null, 2);

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
        message: 'Google Sheets sync can server backend. Ban web mien phi hien dung Firebase Auth/Firestore va local backup.',
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
    const newId = `NORM-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    updateAppData((prev) => ({
      ...prev,
      materialNorms: [{ ...normData, id: newId }, ...prev.materialNorms],
    }));
  };

  const handleUpdateNorm = (id: string, updated: Omit<MaterialNorm, 'id'>) => {
    updateAppData((prev) => {
      const oldNorm = prev.materialNorms.find((n) => n.id === id);
      const oldName = oldNorm?.materialName;
      const newName = updated.materialName;

      const newNorms = prev.materialNorms.map((norm) =>
        norm.id === id ? { ...norm, ...updated, id: norm.id } : norm
      );

      let newInventory = prev.inventory;
      if (oldName && oldName.trim().toLocaleLowerCase('vi-VN') !== newName.trim().toLocaleLowerCase('vi-VN')) {
        const oldKey = oldName.trim().toLocaleLowerCase('vi-VN');
        newInventory = prev.inventory.map((inv) => {
          const isMatch = (inv.materialId && (inv.materialId === id || (oldNorm && inv.materialId === oldNorm.materialId))) || (inv.materialName && inv.materialName.trim().toLocaleLowerCase('vi-VN') === oldKey);
          return isMatch
            ? { ...inv, materialId: inv.materialId || id, materialName: newName, unit: updated.unit }
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
    updateAppData((prev) => ({
      ...prev,
      materialNorms: importedNorms,
    }));
  };

  // Handlers for Inventory
  const handleAddInventory = (item: Omit<InventoryItem, 'id'>) => {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newId = item.type === 'in' 
      ? `NK-${Date.now().toString().slice(-6)}-${randomSuffix}` 
      : `XK-${Date.now().toString().slice(-6)}-${randomSuffix}`;
    updateAppData((prev) => ({
      ...prev,
      inventory: [{ ...item, id: newId }, ...prev.inventory],
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
      inventory: importedInventory,
    }));
  };

  // Handlers for Work Volume
  const handleAddWorkVolume = (item: Omit<WorkVolume, 'id'>) => {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newId = `HM-${Date.now().toString().slice(-6)}-${randomSuffix}`;
    updateAppData((prev) => ({
      ...prev,
      workVolumes: [...prev.workVolumes, { ...item, id: newId }],
    }));
  };

  const handleSaveWorkVolume = (item: Omit<WorkVolume, 'id'> & { id?: string }) => {
    updateAppData((prev) => {
      const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
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
            return {
              ...norm,
              workCategory: workCat,
              workCategories: workCats
            };
          });
        }

        const newWorkVolumes = prev.workVolumes.map((w) => w.id === item.id ? { ...w, ...item, id: w.id } as WorkVolume : w);
        const { materialNorms: reconciledNorms } = reconcileMaterialNormWorkCategoryLinks(updatedNorms, newWorkVolumes);

        return {
          ...prev,
          roomProgressList: updatedRooms,
          materialNorms: reconciledNorms,
          workVolumes: newWorkVolumes
        };
      } else {
        const newId = `HM-${Date.now().toString().slice(-6)}-${randomSuffix}`;
        return {
          ...prev,
          workVolumes: [...prev.workVolumes, { ...item, id: newId }]
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

      if (!targetVolume) {
        return {
          ...prev,
          workVolumes: remainingVolumes,
        };
      }

      const titleStillUsed = remainingVolumes.some(
        (item) => item.title.trim().toLowerCase() === targetVolume.title.trim().toLowerCase()
      );

      // Cascading updates for roomProgressList only if title is no longer present in any work volume
      const updatedRoomProgressList = (prev.roomProgressList || []).map((room) => {
        if (titleStillUsed) return room;

        let hasChange = false;
        let workCategory = room.workCategory;
        let categoryVolumes = room.categoryVolumes ? { ...room.categoryVolumes } : undefined;

        if (workCategory && workCategory.trim().toLowerCase() === targetVolume.title.trim().toLowerCase()) {
          workCategory = '';
          hasChange = true;
        }

        if (categoryVolumes) {
          for (const key of Object.keys(categoryVolumes)) {
            if (key.trim().toLowerCase() === targetVolume.title.trim().toLowerCase()) {
              delete categoryVolumes[key];
              hasChange = true;
            }
          }
        }

        const subItems = room.subItems?.map((sub) => {
          if (sub.category && sub.category.trim().toLowerCase() === targetVolume.title.trim().toLowerCase()) {
            return { ...sub, category: '' };
          }
          return sub;
        });

        if (room.subItems && JSON.stringify(subItems) !== JSON.stringify(room.subItems)) {
          hasChange = true;
        }

        return hasChange ? { ...room, workCategory, categoryVolumes, subItems } : room;
      });

      // Reconcile and clean material norms work category links against remaining work volumes
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
      const targetVolumes = prev.workVolumes.filter((item) => ids.includes(item.id));
      const remainingVolumes = prev.workVolumes.filter((item) => !ids.includes(item.id));

      if (targetVolumes.length === 0) {
        return {
          ...prev,
          workVolumes: remainingVolumes,
        };
      }

      const deletedCats: string[] = [];
      targetVolumes.forEach(item => {
        if (item.category) deletedCats.push(item.category);
        if (item.title) deletedCats.push(item.title);
      });

      const uniqueDeletedCats = Array.from(new Set(deletedCats));

      // Cascading updates for roomProgressList
      const updatedRoomProgressList = (prev.roomProgressList || []).map(room => {
        let hasChange = false;
        let workCategory = room.workCategory;
        let categoryVolumes = room.categoryVolumes ? { ...room.categoryVolumes } : undefined;

        if (workCategory && uniqueDeletedCats.some(cat => workCategory === cat || workCategory.trim() === cat.trim())) {
          workCategory = '';
          hasChange = true;
        }

        if (categoryVolumes) {
          uniqueDeletedCats.forEach(cat => {
            if (categoryVolumes && cat in categoryVolumes) {
              delete categoryVolumes[cat];
              hasChange = true;
            }
          });
        }

        const subItems = room.subItems?.map(sub => {
          if (sub.category && uniqueDeletedCats.some(cat => sub.category === cat || sub.category.trim() === cat.trim())) {
            return { ...sub, category: '' };
          }
          return sub;
        });

        if (room.subItems && JSON.stringify(subItems) !== JSON.stringify(room.subItems)) {
          hasChange = true;
        }

        return hasChange ? { ...room, workCategory, categoryVolumes, subItems } : room;
      });

      // Reconcile and clean material norms against remaining work volumes
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
    const newId = plan.id || `fp-${Date.now()}`;
    updateAppData((prev) => {
      const nextPlans = [...prev.floorPlans, { ...plan, id: newId }];
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
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === id ? { ...fp, imageUrl } : fp)),
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
      defects: prev.defects.map((d) => (d.floorId === id || (oldName && d.floorName === oldName) ? { ...d, floorId: id, floorName: trimmed } : d)),
      checklist: prev.checklist.map((c) => {
        if (c.floorId === id || (oldName && c.floorName === oldName)) {
          return { ...c, floorId: id, floorName: trimmed };
        }
        return c;
      }),
      workVolumes: (prev.workVolumes || []).map((w) => {
        if (w.floorId === id || (oldName && w.floor === oldName)) {
          return { ...w, floorId: id, floor: trimmed };
        }
        return w;
      }),
      crewRecords: (prev.crewRecords || []).map((cr) => {
        if (cr.floorId === id || (oldName && cr.floorName === oldName)) {
          return { ...cr, floorId: id, floorName: trimmed };
        }
        return cr;
      }),
    }));
  };

  const handleDeleteFloorPlan = (id: string) => {
    if (floorPlans.length <= 1) {
      alert('Dự án cần duy trì ít nhất 1 mặt bằng tầng!');
      return;
    }
    const targetPlan = floorPlans.find((fp) => fp.id === id);
    updateAppData((prev) => {
      const remaining = prev.floorPlans.filter((fp) => fp.id !== id).map((fp, idx) => ({ ...fp, order: idx }));
      return {
        ...prev,
        floorPlans: remaining,
        roomProgressList: prev.roomProgressList.filter((r) => r.floorId !== id),
        defects: prev.defects.filter((d) => d.floorId !== id),
        checklist: prev.checklist.filter((c) => c.floorId !== id && (!targetPlan || c.floorName !== targetPlan.floorName)),
      };
    });
  };

  const handleDeleteMultipleFloorPlans = (ids: string[]) => {
    updateAppData((prev) => {
      const remainingPlans = prev.floorPlans.filter((fp) => !ids.includes(fp.id));
      if (remainingPlans.length === 0) {
        const firstId = prev.floorPlans[0]?.id;
        const keptPlans = prev.floorPlans.filter((fp) => fp.id === firstId).map((fp, idx) => ({ ...fp, order: idx }));
        const idsToReallyDelete = ids.filter(id => id !== firstId);
        const targetPlans = prev.floorPlans.filter((fp) => idsToReallyDelete.includes(fp.id));
        const targetPlanNames = targetPlans.map(fp => fp.floorName);
        return {
          ...prev,
          floorPlans: keptPlans,
          roomProgressList: prev.roomProgressList.filter((r) => !idsToReallyDelete.includes(r.floorId)),
          defects: prev.defects.filter((d) => !idsToReallyDelete.includes(d.floorId)),
          checklist: prev.checklist.filter((c) => !idsToReallyDelete.includes(c.floorId || '') && !targetPlanNames.includes(c.floorName)),
        };
      }
      
      const targetPlans = prev.floorPlans.filter((fp) => ids.includes(fp.id));
      const targetPlanNames = targetPlans.map(fp => fp.floorName);
      return {
        ...prev,
        floorPlans: remainingPlans.map((fp, idx) => ({ ...fp, order: idx })),
        roomProgressList: prev.roomProgressList.filter((r) => !ids.includes(r.floorId)),
        defects: prev.defects.filter((d) => !ids.includes(d.floorId)),
        checklist: prev.checklist.filter((c) => !ids.includes(c.floorId || '') && !targetPlanNames.includes(c.floorName)),
      };
    });
  };

  const handleDuplicateFloorPlan = (id: string, customName?: string) => {
    updateAppData((prev) => {
      const sourcePlan = prev.floorPlans.find((fp) => fp.id === id);
      if (!sourcePlan) return prev;

      const uniqueFloorSuffix = Math.random().toString(36).substring(2, 7);
      const newId = `fp-${Date.now()}-${uniqueFloorSuffix}`;
      const newFloorName = customName?.trim() || `${sourcePlan.floorName} (Bản sao)`;

      const newPlan: FloorPlan = {
        ...sourcePlan,
        id: newId,
        floorName: newFloorName,
        uploadedAt: new Date().toLocaleDateString('vi-VN'),
      };

      const sourceRooms = prev.roomProgressList.filter((r) => r.floorId === id || (!r.floorId && r.floorName === sourcePlan.floorName));
      const roomIdMap: Record<string, string> = {};
      const clonedRooms: RoomProgressItem[] = sourceRooms.map((r, index) => {
        const uniqueRoomSuffix = Math.random().toString(36).substring(2, 7);
        const cloned = JSON.parse(JSON.stringify(r)) as RoomProgressItem;
        const newRoomId = `ROOM-${Date.now()}-${index}-${uniqueRoomSuffix}`;
        roomIdMap[r.id] = newRoomId;
        return {
          ...cloned,
          id: newRoomId,
          floorId: newId,
          floorName: newFloorName,
          updatedAt: Date.now(),
        };
      });

      const sourceChecklist = prev.checklist.filter((c) => (c.floorId && c.floorId === id) || (!c.floorId && c.floorName === sourcePlan.floorName));
      const clonedChecklist = sourceChecklist.map((c, index) => {
        const uniqueChecklistSuffix = Math.random().toString(36).substring(2, 7);
        return {
          ...c,
          id: `CHK-${Date.now()}-${index}-${uniqueChecklistSuffix}`,
          floorId: newId,
          floorName: newFloorName,
          roomId: c.roomId ? roomIdMap[c.roomId] || c.roomId : undefined,
          status: 'pending' as const,
          notes: '',
          inspectedBy: undefined,
          inspectedAt: undefined,
        };
      });

      const sourceDefects = (prev.defects || []).filter((d) => d.floorId === id || (!d.floorId && d.floorName === sourcePlan.floorName));
      const clonedDefects = sourceDefects.map((d, index) => {
        const uniqueDefectSuffix = Math.random().toString(36).substring(2, 7);
        return {
          ...d,
          id: `DEF-${Date.now()}-${index}-${uniqueDefectSuffix}`,
          floorId: newId,
          floorName: newFloorName,
          roomId: d.roomId ? roomIdMap[d.roomId] || d.roomId : undefined,
          status: 'Mới phát hiện' as const,
          createdAt: new Date().toLocaleDateString('vi-VN'),
        };
      });

      const index = prev.floorPlans.findIndex((fp) => fp.id === id);
      const nextPlans = [...prev.floorPlans];
      if (index !== -1) {
        nextPlans.splice(index + 1, 0, newPlan);
      } else {
        nextPlans.push(newPlan);
      }

      return {
        ...prev,
        floorPlans: nextPlans.map((fp, idx) => ({ ...fp, order: idx })),
        roomProgressList: [...clonedRooms, ...prev.roomProgressList],
        checklist: [...prev.checklist, ...clonedChecklist],
        defects: [...(prev.defects || []), ...clonedDefects],
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

      const uniqueDefectSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
      const newId = defect.id || `DEF-${nextNum}-${uniqueDefectSuffix}`;
      
      const newDefect: DefectItem = {
        ...defect,
        id: newId,
        createdAt: new Date().toLocaleString('vi-VN'),
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
              completedAt: status === 'Đã khắc phục' || status === 'Đã nghiệm thu' ? (d.completedAt || todayStr) : d.completedAt,
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
          roomProgressList: prev.roomProgressList.map((r) => (r.id === room.id ? { ...room, id: room.id, updatedAt } : r)),
        };
      } else {
        const uniqueRoomSuffix = Math.random().toString(36).substring(2, 7);
        const newId = room.id || `ROOM-${Date.now()}-${uniqueRoomSuffix}`;
        return {
          ...prev,
          roomProgressList: [{ ...room, id: newId, updatedAt }, ...prev.roomProgressList],
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

  const handleDeleteRoomProgress = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      roomProgressList: prev.roomProgressList.filter((r) => r.id !== id),
    }));
  };

  const handleDeleteMultipleRoomProgress = (ids: string[]) => {
    updateAppData((prev) => ({
      ...prev,
      roomProgressList: prev.roomProgressList.filter((r) => !ids.includes(r.id)),
    }));
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
            inspectedBy: inspectedBy || item.inspectedBy,
            inspectedAt: new Date().toLocaleString('vi-VN'),
          };
        }
        return item;
      }),
    }));
  };

  const handleAddChecklistItem = (item: Omit<ChecklistItem, 'id'>) => {
    const newId = `CHK-${Date.now().toString().slice(-4)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    updateAppData((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { ...item, id: newId }],
    }));
  };

  const handleUpdateChecklistItem = (updatedItem: ChecklistItem) => {
    updateAppData((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
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
    const newId = record.id || `crew-${Date.now()}`;
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
      const cloned = sourceRecords.map((r, index) => ({
        ...r,
        id: `crew-${Date.now()}-${index}`,
        date: targetDate,
      }));
      return {
        ...prev,
        crewRecords: [...keptRecords, ...cloned],
      };
    });
  };

  const floorNames = Array.from(new Set(floorPlans.map((fp) => fp.floorName)));
  const unhandledDefectsCount = defects.filter((d) => d.status !== 'Đã nghiệm thu').length;

  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);

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

  const handleCompleteFromAlert = (alertItem: DueDateAlertItem) => {
    const originalId = alertItem.originalItem.id;
    if (alertItem.type === 'workVolume') {
      updateAppData((prev) => ({
        ...prev,
        workVolumes: prev.workVolumes.map((wv) =>
          wv.id === originalId ? { ...wv, status: 'Đã hoàn thành', actual: wv.planned } : wv
        ),
      }));
    } else if (alertItem.type === 'checklist') {
      updateAppData((prev) => ({
        ...prev,
        checklist: prev.checklist.map((chk) =>
          chk.id === originalId ? { ...chk, status: 'passed' } : chk
        ),
      }));
    } else if (alertItem.type === 'defect') {
      updateAppData((prev) => ({
        ...prev,
        defects: prev.defects.map((def) =>
          def.id === originalId ? { ...def, status: 'Đã nghiệm thu' } : def
        ),
      }));
    }
  };

  const handleExportExcel = () => {
    setIsExportPdfOpen(true);
  };

  const hasExcelExport = ['warehouse', 'volume', 'floorplan', 'checklist', 'crew'].includes(activeTab);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans selection:bg-blue-200">
      {/* Mobile & Responsive Shell Frame */}
      <div className="w-full max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto bg-slate-50 min-h-screen shadow-2xl relative border-x border-slate-200 overflow-x-hidden pb-20">
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
        />

        {/* Offline & Sync Status Banner */}
        <OfflineSyncBanner onAutoSync={googleServerBackendAvailable ? handleSyncAll : undefined} isSyncing={isSyncing} />

        {/* Tab Content */}
        <main className="animate-in fade-in duration-150">
          {activeTab === 'warehouse' && (
            <WarehouseTab
              inventory={inventory}
              onAddInventory={handleAddInventory}
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
              onImportWorkVolumes={(importedVolumes) => updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes }))}
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
              defects={defects}
              roomProgressList={roomProgressList}
              checklistItems={checklist}
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
              checklist={checklist}
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
              defects={defects}
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
          defects={defects}
          checklist={checklist}
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
          checklist={checklist}
          defects={defects}
          onNavigateToItem={handleNavigateFromAlert}
          onCompleteItem={handleCompleteFromAlert}
          onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
        />

        {/* Full Notification Center Modal */}
        <NotificationCenterModal
          isOpen={isNotificationCenterOpen}
          onClose={() => setIsNotificationCenterOpen(false)}
          workVolumes={workVolumes}
          checklist={checklist}
          defects={defects}
          onNavigateToItem={handleNavigateFromAlert}
          onCompleteItem={handleCompleteFromAlert}
        />

        {/* Fixed Mobile Bottom Navigation Bar */}
        <BottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          defectBadgeCount={unhandledDefectsCount}
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
