import React, { useState, useEffect, useMemo } from 'react';
import { safeSetLocalStorageItem } from './utils/storage';
import { subscribeToCloudProject, saveProjectToCloud, getCloudPayload } from './lib/firebase';
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
import { BottomNav, TabType } from './components/BottomNav';
import { 
  exportWarehouseToExcel, 
  exportWorkVolumesToExcel, 
  exportFloorPlanToExcel, 
  exportChecklistToExcel,
  exportCrewToExcel
} from './utils/excelExport';
import { getFileHandle, saveFileHandle, removeFileHandle } from './utils/localSyncDb';

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

export const getActiveProjectId = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('active_project_id') || 'default';
  }
  return 'default';
};

export const getKey = (baseKey: string) => {
  const pid = getActiveProjectId();
  return pid === 'default' ? baseKey : `${baseKey}_${pid}`;
};

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string;
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
  const [isExportPdfOpen, setIsExportPdfOpen] = useState(false);
  const [isMaterialNormOpen, setIsMaterialNormOpen] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [projectName, setProjectName] = useState<string>(() => {
    return localStorage.getItem(getKey('construction_project_name')) || 'Tòa Nhà HH2 Sunrise Tower';
  });

  // App Data State with Undo/Redo support
  const [past, setPast] = useState<AppData[]>([]);
  const [present, setPresent] = useState<AppData>(() => {
    const parseSaved = <T,>(key: string, fallback: T): T => {
      try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : fallback;
      } catch (e) {
        console.warn(`Error parsing localStorage key "${key}":`, e);
        return fallback;
      }
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

    const rawFloorPlans = parseSaved(getKey('construction_floor_plans'), INITIAL_FLOOR_PLANS) || [];
    const floorPlans = deduplicateById(rawFloorPlans, 'FP');

    const rawRooms = parseSaved(getKey('construction_room_progress'), INITIAL_ROOM_PROGRESS) || [];
    const validFloorIds = new Set(floorPlans.map((fp: any) => fp.id));
    const validFloorNames = new Set(floorPlans.map((fp: any) => fp.floorName));
    const filteredRooms = rawRooms.filter((r: any) => r.floorId && validFloorIds.has(r.floorId));
    const roomProgressList = deduplicateById(filteredRooms, 'ROOM');

    const rawDefects = parseSaved(getKey('construction_defects'), INITIAL_DEFECTS) || [];
    const filteredDefects = rawDefects.filter((d: any) => d.floorId && validFloorIds.has(d.floorId));
    const defects = deduplicateById(filteredDefects, 'DEF');

    const rawChecklist = parseSaved(getKey('construction_checklist'), INITIAL_CHECKLIST) || [];
    const filteredChecklist = rawChecklist.filter((c: any) => c.floorName && validFloorNames.has(c.floorName));
    const checklist = deduplicateById(filteredChecklist, 'CHK');

    const rawCrew = parseSaved(getKey('construction_crew_records'), INITIAL_CREW_RECORDS) || [];
    const filteredCrew = rawCrew.filter((c: any) => c.floorName && validFloorNames.has(c.floorName));
    const crewRecords = deduplicateById(filteredCrew, 'CREW');

    const rawMaterialNorms = parseSaved(getKey('construction_material_norms'), INITIAL_MATERIAL_NORMS) || [];
    const materialNorms = deduplicateById(rawMaterialNorms, 'NORM');

    const rawInventory = parseSaved(getKey('construction_inventory'), INITIAL_INVENTORY) || [];
    const inventory = deduplicateById(rawInventory, 'INV');

    const rawWorkVolumes = parseSaved(getKey('construction_work_volumes'), INITIAL_WORK_VOLUMES) || [];
    const workVolumes = deduplicateById(rawWorkVolumes, 'VOL');

    const rawTeams = parseSaved(getKey('construction_teams'), INITIAL_TEAMS) || [];
    const teams = deduplicateById(rawTeams, 'TEAM');

    return {
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
  });
  const [future, setFuture] = useState<AppData[]>([]);

  const [isSyncing, setIsSyncing] = useState(false);

  // Destructure current present state
  const { materialNorms, inventory, workVolumes, floorPlans, defects, roomProgressList, checklist, crewRecords, teams } = present;

  // Helper to match floor names
  const isFloorMatch = (volFloor: string, roomFloorName: string) => {
    if (!volFloor || !roomFloorName) return false;
    const vf = volFloor.toLowerCase().trim();
    const rf = roomFloorName.toLowerCase().trim();
    return rf.includes(vf) || vf.includes(rf);
  };

  // Dynamically compute workVolumes actual from room progress list
  const computedWorkVolumes = useMemo(() => {
    return workVolumes.map(item => {
      // Check if there are any rooms at all that match this item's floor and have this work category
      const matchingRooms = roomProgressList.filter(room => {
        const fp = floorPlans.find(f => f.id === room.floorId);
        const roomFloorName = fp?.floorName || room.floorName || '';
        const floorMatches = isFloorMatch(item.floor, roomFloorName);
        const hasCategory = room.categoryVolumes && room.categoryVolumes[item.title] !== undefined;
        return floorMatches && hasCategory;
      });

      if (matchingRooms.length === 0) {
        return item; // Fallback to raw item if no matching rooms in the floor plans
      }

      let totalActual = 0;
      matchingRooms.forEach(room => {
        const roomVol = room.categoryVolumes?.[item.title] || 0;
        if (roomVol <= 0) return;

        const subItemsInCat = room.subItems?.filter(s => s.category === item.title) || [];
        if (subItemsInCat.length > 0) {
          const completedCount = subItemsInCat.filter(
            s => s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu'
          ).length;
          totalActual += roomVol * (completedCount / subItemsInCat.length);
        } else {
          if (room.inspectionStatus === 'Đạt nghiệm thu') {
            totalActual += roomVol;
          }
        }
      });

      const actualVolume = Math.round(totalActual * 100) / 100;

      return {
        ...item,
        actual: actualVolume,
        status: actualVolume >= item.planned ? 'Đã hoàn thành' : actualVolume > 0 ? 'Đang thi công' : 'Chưa thi công'
      } as WorkVolume;
    });
  }, [workVolumes, roomProgressList, floorPlans]);

  // Dynamically compute materialNorms quantity (Số lượng định mức) based on matching work category volumes
  const computedMaterialNorms = useMemo(() => {
    return materialNorms.map(norm => {
      const categories = norm.workCategories || (norm.workCategory ? [norm.workCategory] : []);
      if (categories.length > 0 && norm.unitNormPerM2 && norm.unitNormPerM2 > 0) {
        // Sum up planned (quota) volume of all matching work categories
        const totalVolume = computedWorkVolumes
          .filter(v => categories.includes(v.title))
          .reduce((sum, v) => sum + (v.planned || 0), 0);
        
        if (totalVolume > 0) {
          return {
            ...norm,
            quotaQuantity: Math.round(totalVolume * norm.unitNormPerM2 * 100) / 100
          };
        }
      }
      return norm;
    });
  }, [materialNorms, computedWorkVolumes]);

  // Additional settings managed at top level for sync
  const [contractorName, setContractorName] = useState<string>(() => {
    return localStorage.getItem(getKey('construction_contractor')) || 'Công Ty Cổ Phần Xây Dựng & Thạch Cao Hà Nội';
  });

  const [inspectorName, setInspectorName] = useState<string>(() => {
    return localStorage.getItem(getKey('construction_inspector')) || 'KS. Nguyễn Văn Bình';
  });

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(() => {
    const saved = localStorage.getItem(getKey('construction_updated_at'));
    return saved ? parseInt(saved, 10) : Date.now();
  });

  // Google Drive Sync States
  const [driveSyncStatus, setDriveSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'idle'>('idle');
  const [driveLastSyncTime, setDriveLastSyncTime] = useState<string | null>(() => {
    return localStorage.getItem(getKey('construction_drive_last_sync'));
  });
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(getKey('construction_drive_auto_sync_enabled'));
    return saved !== 'false';
  });
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

  // Load local file handle on mount
  useEffect(() => {
    const loadStoredHandle = async () => {
      try {
        if (window.self !== window.top) return; // Prevent filesystem access in iframe sandbox
        const handle = await getFileHandle();
        if (handle) {
          setLocalFileHandle(handle);
          setLocalFileName(handle.name || 'Dữ liệu liên kết');
          
          const options = { mode: 'readwrite' as const };
          const permission = await handle.queryPermission(options);
          if (permission !== 'granted') {
            setLocalSyncPermissionNeeded(true);
            setLocalSyncStatus('idle');
          } else {
            setLocalSyncStatus('synced');
          }
        }
      } catch (err) {
        console.warn('Error loading stored local file handle:', err);
      }
    };
    loadStoredHandle();
  }, []);

  // Sync Lock Ref to avoid circular loops
  const syncLockRef = React.useRef(false);

  // Helper to push state changes to history (max 30 steps)
  const updateAppData = (updater: (prev: AppData) => AppData) => {
    setPresent((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        // Safe asynchronous scheduling to prevent React from warning about nested state updates during rendering
        setTimeout(() => {
          setPast((p) => [...p.slice(-29), prev]);
          setFuture([]);

          // Update local modified timestamp on any UI action
          if (!syncLockRef.current) {
            const now = Date.now();
            setLastUpdatedAt(now);
            localStorage.setItem(getKey('construction_updated_at'), String(now));
          }
        }, 0);
      }
      return next;
    });
  };

  const handleUndo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    setPast(newPast);
    setFuture((f) => [present, ...f]);
    setPresent(previous);

    // Update modified timestamp
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setPast((p) => [...p, present]);
    setPresent(next);
    setFuture(newFuture);

    // Update modified timestamp
    const now = Date.now();
    setLastUpdatedAt(now);
    localStorage.setItem(getKey('construction_updated_at'), String(now));
  };

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

  // Firebase Realtime Cloud Multi-Device Sync Listener
  useEffect(() => {
    const curId = getActiveProjectId();
    const unsubscribe = subscribeToCloudProject(curId, (record) => {
      const cloudData = getCloudPayload(record);
      if (cloudData) {
        let updatedAny = false;
        for (const k in cloudData) {
          if (localStorage.getItem(k) !== cloudData[k]) {
            safeSetLocalStorageItem(k, cloudData[k]);
            updatedAny = true;
          }
        }
        if (updatedAny) {
          console.log("⚡ Nhận dữ liệu đồng bộ Realtime từ Đám Mây cho dự án:", curId);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Persistence to localStorage
  useEffect(() => {
    localStorage.setItem(getKey('construction_project_name'), projectName);
    
    const list = getProjectsList();
    const activeId = getActiveProjectId();
    const project = list.find(p => p.id === activeId);
    if (project && project.name !== projectName) {
      project.name = projectName;
      saveProjectsList(list);
    }
    
    if (!syncLockRef.current) {
      const now = Date.now();
      setLastUpdatedAt(now);
      localStorage.setItem(getKey('construction_updated_at'), String(now));
    }
  }, [projectName]);

  useEffect(() => {
    localStorage.setItem(getKey('construction_contractor'), contractorName);
    if (!syncLockRef.current) {
      const now = Date.now();
      setLastUpdatedAt(now);
      localStorage.setItem(getKey('construction_updated_at'), String(now));
    }
  }, [contractorName]);

  useEffect(() => {
    localStorage.setItem(getKey('construction_inspector'), inspectorName);
    if (!syncLockRef.current) {
      const now = Date.now();
      setLastUpdatedAt(now);
      localStorage.setItem(getKey('construction_updated_at'), String(now));
    }
  }, [inspectorName]);

  useEffect(() => {
    localStorage.setItem(getKey('construction_drive_auto_sync_enabled'), String(autoSyncEnabled));
  }, [autoSyncEnabled]);

  useEffect(() => {
    safeSetLocalStorageItem(getKey('construction_material_norms'), JSON.stringify(materialNorms));
    safeSetLocalStorageItem(getKey('construction_inventory'), JSON.stringify(inventory));
    safeSetLocalStorageItem(getKey('construction_work_volumes'), JSON.stringify(workVolumes));
    safeSetLocalStorageItem(getKey('construction_floor_plans'), JSON.stringify(floorPlans));
    safeSetLocalStorageItem(getKey('construction_defects'), JSON.stringify(defects));
    safeSetLocalStorageItem(getKey('construction_room_progress'), JSON.stringify(roomProgressList));
    safeSetLocalStorageItem(getKey('construction_checklist'), JSON.stringify(checklist));
    safeSetLocalStorageItem(getKey('construction_crew_records'), JSON.stringify(crewRecords));
    safeSetLocalStorageItem(getKey('construction_teams'), JSON.stringify(teams));
  }, [present]);

  const handleRestoreData = (data: any) => {
    if (!data || typeof data !== 'object') return;
    syncLockRef.current = true;
    try {
      if (data.projectName) {
        setProjectName(data.projectName);
        localStorage.setItem(getKey('construction_project_name'), data.projectName);
      }
      if (data.contractorName) {
        setContractorName(data.contractorName);
        localStorage.setItem(getKey('construction_contractor'), data.contractorName);
      }
      if (data.inspectorName) {
        setInspectorName(data.inspectorName);
        localStorage.setItem(getKey('construction_inspector'), data.inspectorName);
      }
      setPresent({
        materialNorms: Array.isArray(data.materialNorms) ? data.materialNorms : present.materialNorms,
        inventory: Array.isArray(data.inventory) ? data.inventory : present.inventory,
        workVolumes: Array.isArray(data.workVolumes) ? data.workVolumes : present.workVolumes,
        floorPlans: Array.isArray(data.floorPlans) ? data.floorPlans : present.floorPlans,
        defects: Array.isArray(data.defects) ? data.defects : present.defects,
        roomProgressList: Array.isArray(data.roomProgressList) ? data.roomProgressList : present.roomProgressList,
        checklist: Array.isArray(data.checklist) ? data.checklist : present.checklist,
        crewRecords: Array.isArray(data.crewRecords) ? data.crewRecords : present.crewRecords,
        teams: Array.isArray(data.teams) ? data.teams : present.teams,
      });

      if (Array.isArray(data.teams)) {
        localStorage.setItem(getKey('construction_teams'), JSON.stringify(data.teams));
      }

      const updatedTime = data.updatedAt || Date.now();
      setLastUpdatedAt(updatedTime);
      localStorage.setItem(getKey('construction_updated_at'), String(updatedTime));
    } finally {
      setTimeout(() => {
        syncLockRef.current = false;
      }, 500);
    }
  };

  // Google Drive Sync Up
  const handleDriveSyncUp = async (customFolderId?: string) => {
    try {
      setDriveSyncStatus('syncing');
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const now = Date.now();

      const res = await fetch('/api/drive/sync-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId,
          projectName,
          contractorName,
          inspectorName,
          inventory,
          workVolumes,
          checklist,
          defects,
          floorPlans,
          roomProgressList,
          materialNorms,
          crewRecords,
          teams,
          updatedAt: now
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
      if (result.success) {
        setDriveSyncStatus('synced');
        const timeStr = new Date(now).toLocaleString('vi-VN');
        setDriveLastSyncTime(timeStr);
        localStorage.setItem(getKey('construction_drive_last_sync'), timeStr);
        localStorage.setItem(getKey('construction_updated_at'), String(now));
        
        // Restore returned processed data (replaces large Base64 strings with public direct Google Drive URLs)
        if (result.data) {
          handleRestoreData(result.data);
        }

        // Tự động lưu toàn bộ dữ liệu tất cả công trình lên Google Drive nếu đã xác thực
        if (isAuthenticated) {
          handleDriveSyncUpAll(folderId).catch(err => console.warn('Auto drive sync all projects error:', err));
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
    try {
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const allData: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
          allData[key] = localStorage.getItem(key) || '';
        }
      }

      const res = await fetch('/api/drive/sync-up-all', {
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
    try {
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';
      const res = await fetch('/api/drive/sync-down-all', {
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
            localStorage.setItem(key, result.data[key]);
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
        setLocalAllFileHandle(handle);
        setLocalAllFileName(handle.name);
        setLocalAllSyncPermissionNeeded(false);
        setLocalAllSyncStatus('saving');

        const allData: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = localStorage.getItem(key) || '';
          }
        }
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(allData, null, 2));
        await writable.close();
        setLocalAllSyncStatus('synced');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('Link file error:', err);
    }
  };

  const handleUnlinkLocalAllFile = async () => {
    setLocalAllFileHandle(null);
    setLocalAllFileName('');
    setLocalAllSyncStatus('idle');
    setLocalAllSyncPermissionNeeded(false);
  };

  const handleRequestLocalAllFilePermission = async () => {
    if (!localAllFileHandle) return;
    try {
      const options = { mode: 'readwrite' as const };
      const permission = await localAllFileHandle.requestPermission(options);
      if (permission === 'granted') {
        setLocalAllSyncPermissionNeeded(false);
        setLocalAllSyncStatus('saving');
        const writable = await localAllFileHandle.createWritable();
        const allData: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = localStorage.getItem(key) || '';
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
    if (syncLockRef.current) return { success: false, message: 'Hệ thống đang đồng bộ dữ liệu.' };
    try {
      syncLockRef.current = true;
      setDriveSyncStatus('syncing');
      const folderId = customFolderId || '1se6PAsmGQ2hwPqUCiQoueksEFPP_YMO6';

      const res = await fetch('/api/drive/sync-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });

      if (!res.ok) {
        throw new Error('Không thể tải file đồng bộ từ Google Drive');
      }

      const result = await res.json();
      if (result.success && result.found && result.data) {
        const remoteData = result.data;
        const remoteUpdatedAt = remoteData.updatedAt || 0;
        const localUpdatedAt = parseInt(localStorage.getItem(getKey('construction_updated_at')) || '0', 10);

        if (forceOverwrite || remoteUpdatedAt > localUpdatedAt) {
          if (remoteData.projectName) setProjectName(remoteData.projectName);
          if (remoteData.contractorName) setContractorName(remoteData.contractorName);
          if (remoteData.inspectorName) setInspectorName(remoteData.inspectorName);

          setPresent({
            materialNorms: Array.isArray(remoteData.materialNorms) ? remoteData.materialNorms : present.materialNorms,
            inventory: Array.isArray(remoteData.inventory) ? remoteData.inventory : present.inventory,
            workVolumes: Array.isArray(remoteData.workVolumes) ? remoteData.workVolumes : present.workVolumes,
            floorPlans: Array.isArray(remoteData.floorPlans) ? remoteData.floorPlans : present.floorPlans,
            defects: Array.isArray(remoteData.defects) ? remoteData.defects : present.defects,
            roomProgressList: Array.isArray(remoteData.roomProgressList) ? remoteData.roomProgressList : present.roomProgressList,
            checklist: Array.isArray(remoteData.checklist) ? remoteData.checklist : present.checklist,
            crewRecords: Array.isArray(remoteData.crewRecords) ? remoteData.crewRecords : present.crewRecords,
            teams: Array.isArray(remoteData.teams) ? remoteData.teams : present.teams,
          });

          if (Array.isArray(remoteData.teams)) {
            localStorage.setItem(getKey('construction_teams'), JSON.stringify(remoteData.teams));
          }

          const timeStr = new Date(remoteUpdatedAt || Date.now()).toLocaleString('vi-VN');
          setDriveLastSyncTime(timeStr);
          localStorage.setItem(getKey('construction_drive_last_sync'), timeStr);
          localStorage.setItem(getKey('construction_updated_at'), String(remoteUpdatedAt));
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
    const checkAuthAndAutoSync = async () => {
      try {
        const res = await fetch('/api/auth/status');
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
  }, []);

  // Debounced auto-save to Google Drive & Cloud on local changes
  useEffect(() => {
    if (syncLockRef.current) return;

    const timer = setTimeout(() => {
      if (!syncLockRef.current) {
        if (autoSyncEnabled) {
          handleDriveSyncUp().catch(err => console.warn('Auto drive sync warning:', err));
        }
        
        // Realtime Cloud Auto Save
        try {
          const activeId = getActiveProjectId();
          saveProjectToCloud({
            id: activeId,
            name: projectName,
            contractorName,
            inspectorName,
            ...present,
            updatedAt: Date.now()
          }).catch(err => console.warn('Cloud auto save notice:', err));
        } catch (e) {
          console.warn('Cloud auto save exception:', e);
        }
      }
    }, 2000); // 2 seconds debounce after input changes

    return () => clearTimeout(timer);
  }, [present, projectName, contractorName, inspectorName, autoSyncEnabled]);

  // Local File Auto-Save Debounced Effect
  useEffect(() => {
    if (!localFileHandle) return;
    if (syncLockRef.current) return;

    const timer = setTimeout(async () => {
      try {
        const options = { mode: 'readwrite' as const };
        const permissionStatus = await localFileHandle.queryPermission(options);
        
        if (permissionStatus !== 'granted') {
          setLocalSyncPermissionNeeded(true);
          setLocalSyncStatus('idle');
          return;
        }

        setLocalSyncStatus('saving');
        const writable = await localFileHandle.createWritable();
        const jsonString = JSON.stringify({
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
        }, null, 2);

        await writable.write(jsonString);
        await writable.close();
        setLocalSyncStatus('synced');
        setLocalSyncPermissionNeeded(false);
      } catch (err) {
        console.error('Error auto-saving to local file:', err);
        setLocalSyncStatus('error');
      }
    }, 2000); // 2 seconds debounce for local file updates

    return () => clearTimeout(timer);
  }, [localFileHandle, present, projectName, contractorName, inspectorName, lastUpdatedAt]);

  // Local All File Auto-Save Debounced Effect
  useEffect(() => {
    if (!localAllFileHandle) return;
    if (syncLockRef.current) return;

    const timer = setTimeout(async () => {
      try {
        const options = { mode: 'readwrite' as const };
        const permissionStatus = await localAllFileHandle.queryPermission(options);
        
        if (permissionStatus !== 'granted') {
          setLocalAllSyncPermissionNeeded(true);
          setLocalAllSyncStatus('idle');
          return;
        }

        setLocalAllSyncStatus('saving');
        const writable = await localAllFileHandle.createWritable();
        
        const allData: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('construction_') || key.startsWith('active_project_id'))) {
            allData[key] = localStorage.getItem(key) || '';
          }
        }
        
        const jsonString = JSON.stringify(allData, null, 2);

        await writable.write(jsonString);
        await writable.close();
        setLocalAllSyncStatus('synced');
        setLocalAllSyncPermissionNeeded(false);
      } catch (err) {
        console.error('Error auto-saving all to local file:', err);
        setLocalAllSyncStatus('error');
      }
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timer);
  }, [localAllFileHandle, present, projectName, contractorName, inspectorName, lastUpdatedAt]);

  // Link local JSON file for auto sync
  const handleLinkLocalFile = async () => {
    try {
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
        await saveFileHandle(handle);
        setLocalFileHandle(handle);
        setLocalFileName(handle.name);
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('saving');

        // Immediately write current state to the selected file
        const writable = await handle.createWritable();
        const jsonString = JSON.stringify({
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
        }, null, 2);

        await writable.write(jsonString);
        await writable.close();
        setLocalSyncStatus('synced');
        alert(`🎉 Đã liên kết và tự động đồng bộ thành công với tệp: ${handle.name}\nMọi thay đổi từ giờ sẽ tự động ghi đè cập nhật vào tệp này!`);
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
      await removeFileHandle();
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
      const options = { mode: 'readwrite' as const };
      const permission = await localFileHandle.requestPermission(options);
      if (permission === 'granted') {
        setLocalSyncPermissionNeeded(false);
        setLocalSyncStatus('saving');
        
        // Immediately trigger a save to make sure it's updated
        const writable = await localFileHandle.createWritable();
        const jsonString = JSON.stringify({
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
        }, null, 2);

        await writable.write(jsonString);
        await writable.close();
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
    try {
      setIsSyncing(true);
      
      // Perform Sheet Sync
      const res = await fetch('/api/sheets/sync-all', {
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
        norm.id === id ? { ...updated, id } : norm
      );

      let newInventory = prev.inventory;
      if (oldName && oldName !== newName) {
        newInventory = prev.inventory.map((inv) =>
          inv.materialName === oldName ? { ...inv, materialName: newName, unit: updated.unit } : inv
        );
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
        return {
          ...prev,
          workVolumes: prev.workVolumes.map((w) => w.id === item.id ? { ...w, ...item, id: w.id } as WorkVolume : w)
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
    updateAppData((prev) => ({
      ...prev,
      workVolumes: prev.workVolumes.filter((item) => item.id !== id),
    }));
  };

  // Handlers for Floor Plans & Defects
  const handleAddFloorPlan = (plan: Omit<FloorPlan, 'id'> & { id?: string }) => {
    const newId = plan.id || `fp-${Date.now()}`;
    updateAppData((prev) => ({
      ...prev,
      floorPlans: [...prev.floorPlans, { ...plan, id: newId }],
    }));
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
      roomProgressList: prev.roomProgressList.map((r) => (r.floorId === id ? { ...r, floorName: trimmed } : r)),
      defects: prev.defects.map((d) => (d.floorId === id ? { ...d, floorName: trimmed } : d)),
      checklist: oldName ? prev.checklist.map((c) => (c.floorName === oldName ? { ...c, floorName: trimmed } : c)) : prev.checklist,
    }));
  };

  const handleDeleteFloorPlan = (id: string) => {
    if (floorPlans.length <= 1) {
      alert('Dự án cần duy trì ít nhất 1 mặt bằng tầng!');
      return;
    }
    const targetPlan = floorPlans.find((fp) => fp.id === id);
    updateAppData((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.filter((fp) => fp.id !== id),
      roomProgressList: prev.roomProgressList.filter((r) => r.floorId !== id),
      defects: prev.defects.filter((d) => d.floorId !== id),
      checklist: targetPlan ? prev.checklist.filter((c) => c.floorName !== targetPlan.floorName) : prev.checklist,
    }));
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
      const clonedRooms: RoomProgressItem[] = sourceRooms.map((r, index) => {
        const uniqueRoomSuffix = Math.random().toString(36).substring(2, 7);
        const cloned = JSON.parse(JSON.stringify(r)) as RoomProgressItem;
        return {
          ...cloned,
          id: `ROOM-${Date.now()}-${index}-${uniqueRoomSuffix}`,
          floorId: newId,
          floorName: newFloorName,
          updatedAt: new Date().toLocaleString('vi-VN'),
        };
      });

      const sourceChecklist = prev.checklist.filter((c) => c.floorName === sourcePlan.floorName);
      const clonedChecklist = sourceChecklist.map((c, index) => {
        const uniqueChecklistSuffix = Math.random().toString(36).substring(2, 7);
        return {
          ...c,
          id: `CHK-${Date.now()}-${index}-${uniqueChecklistSuffix}`,
          floorName: newFloorName,
          status: 'pending' as const,
          notes: '',
          inspectedBy: undefined,
          inspectedAt: undefined,
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
        floorPlans: nextPlans,
        roomProgressList: [...clonedRooms, ...prev.roomProgressList],
        checklist: [...prev.checklist, ...clonedChecklist],
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
        floorPlans: newPlans,
      };
    });
  };

  const handleAddDefect = (defect: Omit<DefectItem, 'id' | 'createdAt'>) => {
    const uniqueDefectSuffix = Math.random().toString(36).substring(2, 7);
    const newId = `DEF-${Date.now()}-${uniqueDefectSuffix}`;
    const newDefect: DefectItem = {
      ...defect,
      id: newId,
      createdAt: new Date().toLocaleString('vi-VN'),
    };
    updateAppData((prev) => ({
      ...prev,
      defects: [newDefect, ...prev.defects],
    }));
  };

  const handleUpdateDefectStatus = (id: string, status: DefectStatus) => {
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.map((d) => (d.id === id ? { ...d, status } : d)),
    }));
  };

  const handleDeleteDefect = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      defects: prev.defects.filter((d) => d.id !== id),
    }));
  };

  // Handlers for Room Progress / Acceptance
  const handleSaveRoomProgress = (
    room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }
  ) => {
    const updatedAt = new Date().toLocaleString('vi-VN');
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

  const handleDeleteRoomProgress = (id: string) => {
    updateAppData((prev) => ({
      ...prev,
      roomProgressList: prev.roomProgressList.filter((r) => r.id !== id),
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

  // Handlers for Crew/Quân số
  const handleAddCrewRecord = (record: Omit<CrewRecord, 'id'>) => {
    const newId = `crew-${Date.now()}`;
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
          setProjectName={setProjectName}
          onSyncAll={handleSyncAll}
          isSyncing={isSyncing}
          onOpenExportPdf={() => setIsExportPdfOpen(true)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          onOpenProjectManager={() => setIsProjectManagerOpen(true)}
        />
        
        <ProjectManagerModal 
          isOpen={isProjectManagerOpen} 
          onClose={() => setIsProjectManagerOpen(false)} 
          onDriveSyncUpAll={handleDriveSyncUpAll}
          onDriveSyncDownAll={handleDriveSyncDownAll}
          localAllSyncStatus={localAllSyncStatus}
          localAllFileName={localAllFileName}
          localAllFileHandle={localAllFileHandle}
          onLinkLocalAllFile={handleLinkLocalAllFile}
          onUnlinkLocalAllFile={handleUnlinkLocalAllFile}
          onRequestLocalAllFilePermission={handleRequestLocalAllFilePermission}
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
        />

        {/* Offline & Sync Status Banner */}
        <OfflineSyncBanner onAutoSync={handleSyncAll} isSyncing={isSyncing} />

        {/* Tab Content */}
        <main className="animate-in fade-in duration-150">
          {activeTab === 'warehouse' && (
            <WarehouseTab
              inventory={inventory}
              onAddInventory={handleAddInventory}
              onDeleteInventory={handleDeleteInventory}
              onSyncSheets={handleSyncAll}
              materialNorms={computedMaterialNorms}
              onOpenNormModal={() => setIsMaterialNormOpen(true)}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              workVolumes={computedWorkVolumes}
              onImportNorms={handleImportNorms}
              onImportWorkVolumes={(importedVolumes) => updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes }))}
            />
          )}

          {activeTab === 'volume' && (
            <WorkVolumeTab
              workVolumes={computedWorkVolumes}
              floorPlans={floorPlans}
              onAddWorkVolume={handleAddWorkVolume}
              onSaveWorkVolume={handleSaveWorkVolume}
              onUpdateActualVolume={handleUpdateActualVolume}
              onDeleteWorkVolume={handleDeleteWorkVolume}
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
              onDuplicateFloorPlan={handleDuplicateFloorPlan}
              onMoveFloorPlan={handleMoveFloorPlan}
              onAddDefect={handleAddDefect}
              onUpdateDefectStatus={handleUpdateDefectStatus}
              onDeleteDefect={handleDeleteDefect}
              onSaveRoomProgress={handleSaveRoomProgress}
              onDeleteRoomProgress={handleDeleteRoomProgress}
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
              inspectorName={inspectorName}
              onUpdateChecklistStatus={handleUpdateChecklistStatus}
              onAddChecklistItem={handleAddChecklistItem}
              onUpdateChecklistItem={handleUpdateChecklistItem}
              onDeleteChecklistItem={handleDeleteChecklistItem}
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
              crewRecords={crewRecords}
              floorPlans={floorPlans}
              roomProgressList={roomProgressList}
              defects={defects}
              onAddCrewRecord={handleAddCrewRecord}
              onUpdateCrewRecord={handleUpdateCrewRecord}
              onDeleteCrewRecord={handleDeleteCrewRecord}
              onCopyCrewRecordsFromDate={handleCopyCrewRecordsFromDate}
              onOpenExportPdf={() => setIsExportPdfOpen(true)}
              onExportExcel={handleExportExcel}
              teams={teams}
              onUpdateTeams={(newTeams) => {
                updateAppData((prev) => ({
                  ...prev,
                  teams: newTeams,
                }));
              }}
            />
          )}

          {activeTab === 'config' && (
            <GoogleConfigTab
              projectName={projectName}
              setProjectName={setProjectName}
              contractorName={contractorName}
              setContractorName={setContractorName}
              inspectorName={inspectorName}
              setInspectorName={setInspectorName}
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
              localFileHandle={localFileHandle}
              localSyncStatus={localSyncStatus}
              localSyncPermissionNeeded={localSyncPermissionNeeded}
              localFileName={localFileName}
              onLinkLocalFile={handleLinkLocalFile}
              onUnlinkLocalFile={handleUnlinkLocalFile}
              onRequestLocalFilePermission={handleRequestLocalFilePermission}
              onOpenProjectManager={() => setIsProjectManagerOpen(true)}
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
          inventory={inventory}
          materialNorms={computedMaterialNorms}
          workVolumes={computedWorkVolumes}
          defects={defects}
          checklist={checklist}
          floorPlans={floorPlans}
          roomProgressList={roomProgressList}
          crewRecords={crewRecords}
        />

        {/* Material Norms Modal */}
        <MaterialNormModal
          isOpen={isMaterialNormOpen}
          onClose={() => setIsMaterialNormOpen(false)}
          materialNorms={computedMaterialNorms}
          onAddNorm={handleAddNorm}
          onUpdateNorm={handleUpdateNorm}
          onDeleteNorm={handleDeleteNorm}
          onImportNorms={handleImportNorms}
          inventory={inventory}
          workVolumes={computedWorkVolumes}
          onImportWorkVolumes={(importedVolumes) => updateAppData((prev) => ({ ...prev, workVolumes: importedVolumes }))}
        />

        {/* Fixed Mobile Bottom Navigation Bar */}
        <BottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          defectBadgeCount={unhandledDefectsCount}
        />
      </div>
    </div>
  );
}
