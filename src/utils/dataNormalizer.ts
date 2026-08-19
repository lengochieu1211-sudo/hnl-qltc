import { parseLegacyTimestamp } from './dateFormatter';
import { reconcileMaterialNormWorkCategoryLinks } from './projectReconciliation';

/**
 * Creates a unique Project ID using UUID v4 if available, fallback to timestamp + random string
 * Guaranteed format: proj_<uuid>
 */
export function createProjectId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `proj_${crypto.randomUUID()}`;
  }
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generates project-scoped key cleanly without duplicating proj_
 */
export function projectKey(base: string, projectId?: string): string {
  if (!projectId || projectId === 'default') return base;
  if (projectId.startsWith('proj_')) return `${base}_${projectId}`;
  return `${base}_proj_${projectId}`;
}

/**
 * Checks if rawInput is a full system storage dump
 */
export function isStorageDump(rawInput: any): boolean {
  if (!rawInput) return false;
  let obj = rawInput;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return false; }
  }
  if (typeof obj !== 'object' || obj === null) return false;
  const keys = Object.keys(obj);
  return keys.some(k => k.startsWith('construction_') || k === 'active_project_id');
}

/**
 * Extracts list of projects contained inside a storage dump.
 * Strictly prioritizes construction_projects_list when valid projects exist.
 */
export function getProjectsFromStorageDump(rawInput: any): { id: string; name: string }[] {
  if (!rawInput) return [];
  let obj = rawInput;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return []; }
  }
  if (typeof obj !== 'object' || obj === null) return [];

  // 1. Strictly check construction_projects_list first
  const rawList = obj.construction_projects_list || obj['construction_projects_list'];
  if (rawList) {
    try {
      const parsedList = typeof rawList === 'string' ? JSON.parse(rawList) : rawList;
      if (Array.isArray(parsedList) && parsedList.length > 0) {
        const validList = parsedList
          .filter((p: any) => p && p.id && p.name)
          .map((p: any) => ({ id: String(p.id).trim(), name: String(p.name).trim() }));
        if (validList.length > 0) {
          return validList;
        }
      }
    } catch (e) {}
  }

  // 2. Only fallback to scanning keys if construction_projects_list is absent / empty
  const projectsMap = new Map<string, string>();
  for (const k of Object.keys(obj)) {
    if (k.startsWith('construction_project_name_')) {
      const pid = k.substring('construction_project_name_'.length);
      const val = obj[k];
      if (pid && typeof val === 'string' && val.trim()) {
        projectsMap.set(pid, val.trim());
      }
    } else if (k === 'construction_project_name') {
      const val = obj[k];
      if (typeof val === 'string' && val.trim()) {
        projectsMap.set('default', val.trim());
      }
    }
  }

  if (projectsMap.size === 0) {
    projectsMap.set('default', 'Dự án Mặc định');
  }

  return Array.from(projectsMap.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * Inspects a parsed JSON backup object to determine its exact structure and metadata.
 */
export function detectBackupStructure(rawInput: any): {
  isSingleProject: boolean;
  isStorageDump: boolean;
  projectId?: string;
  projectName?: string;
  schemaVersion?: number;
  categoryUpdatedAt?: Record<string, number>;
  sourceData?: any;
} {
  if (!rawInput) return { isSingleProject: false, isStorageDump: false };
  let obj = rawInput;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return { isSingleProject: false, isStorageDump: false }; }
  }
  if (typeof obj !== 'object' || obj === null) {
    return { isSingleProject: false, isStorageDump: false };
  }

  // Schema v3 Single Project Backup
  if (obj.schemaVersion === 3 || obj.backupType === 'single-project') {
    return {
      isSingleProject: true,
      isStorageDump: false,
      projectId: obj.project?.id || obj.projectId,
      projectName: obj.project?.name || obj.projectName,
      schemaVersion: 3,
      categoryUpdatedAt: obj.categoryUpdatedAt,
      sourceData: obj.data || obj
    };
  }

  // Legacy Single Project with projectId
  if (obj.projectId && typeof obj.projectId === 'string' && !isStorageDump(obj)) {
    return {
      isSingleProject: true,
      isStorageDump: false,
      projectId: obj.projectId,
      projectName: obj.projectName || obj.name,
      schemaVersion: obj.schemaVersion || 2,
      categoryUpdatedAt: obj.categoryUpdatedAt,
      sourceData: obj
    };
  }

  const isDump = isStorageDump(obj);
  return {
    isSingleProject: false,
    isStorageDump: isDump,
    schemaVersion: obj.schemaVersion || 1,
    sourceData: obj
  };
}

/**
 * Utility to normalize imported JSON data from any version of the app,
 * storage dumps, legacy structures, or nested wrappers.
 */

export function normalizeImportedData(rawInput: any, activeProjectId?: string, sourceProjectId?: string): any {
  if (!rawInput) return {};

  let obj = rawInput;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return {};
    }
  }

  if (typeof obj !== 'object' || obj === null) return {};

  const structure = detectBackupStructure(obj);
  const effectiveProjectId = sourceProjectId || structure.projectId || activeProjectId || (typeof window !== 'undefined' ? localStorage.getItem('active_project_id') || undefined : undefined);

  // Unwrap nested structures like { data: { ... } }, { backup: { ... } }, { payload: { ... } }
  let targetObj = { ...obj };
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    targetObj = { ...targetObj, ...obj.data };
  }
  if (obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)) {
    targetObj = { ...targetObj, ...obj.payload };
  }
  if (obj.projectData && typeof obj.projectData === 'object' && !Array.isArray(obj.projectData)) {
    targetObj = { ...targetObj, ...obj.projectData };
  }
  if (obj.project && typeof obj.project === 'object') {
    if (obj.project.name && !targetObj.projectName) targetObj.projectName = obj.project.name;
    if (obj.project.contractorName && !targetObj.contractorName) targetObj.contractorName = obj.project.contractorName;
    if (obj.project.inspectorName && !targetObj.inspectorName) targetObj.inspectorName = obj.project.inspectorName;
  }

  const isDump = structure.isStorageDump;

  const targetSuffix = effectiveProjectId && effectiveProjectId !== 'default'
    ? (effectiveProjectId.startsWith('proj_') ? `_${effectiveProjectId}` : `_proj_${effectiveProjectId}`)
    : '';

  const sourceUpdatedAt = parseLegacyTimestamp(targetObj.updatedAt, 0);

  // Helper to extract array from multiple candidate keys or stringified JSON
  const extractArray = (candidateKeys: string[]): any[] | null => {
    // 1. Direct project-scoped match if effectiveProjectId is provided
    if (effectiveProjectId) {
      for (const cand of candidateKeys) {
        const scopedKey = projectKey(cand, effectiveProjectId);
        if (scopedKey in targetObj && targetObj[scopedKey] !== undefined && targetObj[scopedKey] !== null) {
          let val = targetObj[scopedKey];
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch (e) {}
          }
          if (Array.isArray(val)) return normalizeTimestampsInList(val);
        }
      }
    }

    // 2. Direct match on candidate keys (only if not a dump or if default project)
    for (const key of candidateKeys) {
      if (key in targetObj && targetObj[key] !== undefined && targetObj[key] !== null) {
        // If storage dump and active project is not default, skip base unsuffixed key to avoid cross pollution
        if (isDump && effectiveProjectId && effectiveProjectId !== 'default') {
          continue;
        }
        let val = targetObj[key];
        if (typeof val === 'string') {
          try {
            val = JSON.parse(val);
          } catch (e) {}
        }
        if (Array.isArray(val)) {
          return normalizeTimestampsInList(val);
        }
      }
    }

    // 3. Fuzzy / substring match on keys, strictly avoiding foreign project keys
    for (const k of Object.keys(targetObj)) {
      if (isDump) {
        // If effectiveProjectId is default or unsuffixed, any key containing _proj_ is a foreign project key!
        if ((!effectiveProjectId || effectiveProjectId === 'default') && k.includes('_proj_')) {
          continue;
        }
        // If effectiveProjectId is a specific project, skip keys containing _proj_ that don't match targetSuffix
        if (effectiveProjectId && effectiveProjectId !== 'default' && targetSuffix && k.includes('_proj_') && !k.endsWith(targetSuffix)) {
          continue;
        }
      } else if (k.includes('_proj_') && effectiveProjectId && targetSuffix && !k.endsWith(targetSuffix)) {
        continue;
      }

      const lowerK = k.toLowerCase();
      for (const cand of candidateKeys) {
        const lowerCand = cand.toLowerCase();
        if (lowerK === lowerCand || lowerK.endsWith(lowerCand) || lowerK.includes(lowerCand)) {
          let val = targetObj[k];
          if (typeof val === 'string') {
            try {
              val = JSON.parse(val);
            } catch (e) {}
          }
          if (Array.isArray(val)) {
            return normalizeTimestampsInList(val);
          }
        }
      }
    }
    return null;
  };

  const normalizeTimestampsInList = (list: any[]): any[] => {
    return list.map(item => {
      if (item && typeof item === 'object') {
        return {
          ...item,
          updatedAt: parseLegacyTimestamp(item.updatedAt, sourceUpdatedAt)
        };
      }
      return item;
    });
  };

  // Helper to extract string
  const extractString = (candidateKeys: string[]): string | null => {
    if (effectiveProjectId) {
      for (const cand of candidateKeys) {
        const scopedKey = projectKey(cand, effectiveProjectId);
        if (scopedKey in targetObj && targetObj[scopedKey] !== undefined && targetObj[scopedKey] !== null) {
          const val = targetObj[scopedKey];
          if (typeof val === 'string' && val.trim()) return val.trim();
        }
      }
    }

    for (const key of candidateKeys) {
      if (key in targetObj && targetObj[key] !== undefined && targetObj[key] !== null) {
        if (isDump && effectiveProjectId && effectiveProjectId !== 'default') {
          continue;
        }
        const val = targetObj[key];
        if (typeof val === 'string' && val.trim()) {
          return val.trim();
        }
      }
    }
    for (const k of Object.keys(targetObj)) {
      if (isDump) {
        if ((!effectiveProjectId || effectiveProjectId === 'default') && k.includes('_proj_')) {
          continue;
        }
        if (effectiveProjectId && effectiveProjectId !== 'default' && targetSuffix && k.includes('_proj_') && !k.endsWith(targetSuffix)) {
          continue;
        }
      } else if (k.includes('_proj_') && effectiveProjectId && targetSuffix && !k.endsWith(targetSuffix)) {
        continue;
      }

      const lowerK = k.toLowerCase();
      for (const cand of candidateKeys) {
        const lowerCand = cand.toLowerCase();
        if (lowerK.includes(lowerCand)) {
          const val = targetObj[k];
          if (typeof val === 'string' && val.trim()) {
            return val.trim();
          }
        }
      }
    }
    return null;
  };

  const normalized: any = { ...targetObj };

  // Collection normalization
  const defects = extractArray(['defects', 'defectList', 'defectsList', 'construction_defects']);
  if (defects !== null) normalized.defects = defects;

  const inventory = extractArray(['inventory', 'inventoryList', 'construction_inventory']);
  if (inventory !== null) normalized.inventory = inventory;

  const workVolumes = extractArray(['workVolumes', 'work_volumes', 'volumes', 'workVolumeList', 'construction_work_volumes']);
  if (workVolumes !== null) normalized.workVolumes = workVolumes;

  const floorPlans = extractArray(['floorPlans', 'floor_plans', 'floors', 'construction_floor_plans']);
  if (floorPlans !== null) normalized.floorPlans = floorPlans;

  const roomProgressList = extractArray(['roomProgressList', 'roomProgress', 'room_progress', 'rooms', 'construction_room_progress']);
  if (roomProgressList !== null) normalized.roomProgressList = roomProgressList;

  const checklist = extractArray(['checklist', 'checklists', 'checklistItems', 'construction_checklist']);
  if (checklist !== null) normalized.checklist = checklist;

  const crewRecords = extractArray(['crewRecords', 'crew_records', 'construction_crew_records']);
  if (crewRecords !== null) normalized.crewRecords = crewRecords;

  const teams = extractArray(['teams', 'teamList', 'construction_teams']);
  if (teams !== null) normalized.teams = teams;

  const photos = extractArray(['photos', 'photoList', 'construction_photos']);
  if (photos !== null) normalized.photos = photos;

  const materialNorms = extractArray(['materialNorms', 'material_norms', 'norms', 'construction_material_norms']);
  if (materialNorms !== null) {
    const recResult = reconcileMaterialNormWorkCategoryLinks(materialNorms, normalized.workVolumes || []);
    normalized.materialNorms = recResult.materialNorms;
  }

  // Metadata normalization
  const projectName = extractString(['projectName', 'project_name', 'name', 'construction_project_name']);
  if (projectName !== null) normalized.projectName = projectName;

  const contractorName = extractString(['contractorName', 'contractor_name', 'contractor', 'construction_contractor']);
  if (contractorName !== null) normalized.contractorName = contractorName;

  const inspectorName = extractString(['inspectorName', 'inspector_name', 'inspector', 'construction_inspector']);
  if (inspectorName !== null) normalized.inspectorName = inspectorName;

  return normalized;
}

export interface ProjectImportCandidate {
  id: string;
  name: string;
  contractorName?: string;
  inspectorName?: string;
  updatedAt: number;
  normalizedData: any;
  photoData?: Record<string, string>;
  photoDataMap?: Record<string, string>;
  itemCounts: {
    materialNorms: number;
    inventory: number;
    workVolumes: number;
    floorPlans: number;
    defects: number;
    roomProgressList: number;
    checklist: number;
    crewRecords: number;
    teams: number;
    total: number;
  };
}

/**
 * Extracts and categorizes all distinct projects contained inside an imported JSON backup.
 * Supports Schema v3, Storage Dumps, Multi-Project files, and legacy JSON backups.
 */
export function extractProjectsFromImportData(rawInput: any): ProjectImportCandidate[] {
  if (!rawInput) return [];
  let obj = rawInput;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return [];
    }
  }
  if (typeof obj !== 'object' || obj === null) return [];

  const structure = detectBackupStructure(obj);
  const candidates: ProjectImportCandidate[] = [];

  const countItems = (data: any) => {
    const norms = Array.isArray(data.materialNorms) ? data.materialNorms.length : 0;
    const inv = Array.isArray(data.inventory) ? data.inventory.length : 0;
    const vols = Array.isArray(data.workVolumes) ? data.workVolumes.length : 0;
    const plans = Array.isArray(data.floorPlans) ? data.floorPlans.length : 0;
    const defects = Array.isArray(data.defects) ? data.defects.length : 0;
    const rooms = Array.isArray(data.roomProgressList) ? data.roomProgressList.length : 0;
    const chk = Array.isArray(data.checklist) ? data.checklist.length : 0;
    const crew = Array.isArray(data.crewRecords) ? data.crewRecords.length : 0;
    const teams = Array.isArray(data.teams) ? data.teams.length : 0;
    const total = norms + inv + vols + plans + defects + rooms + chk + crew + teams;
    return {
      materialNorms: norms,
      inventory: inv,
      workVolumes: vols,
      floorPlans: plans,
      defects,
      roomProgressList: rooms,
      checklist: chk,
      crewRecords: crew,
      teams,
      total,
    };
  };

  // Case 1: Schema Version 3 Single Project
  if (structure.isSingleProject && structure.projectId) {
    const pid = structure.projectId;
    const normalized = normalizeImportedData(obj, pid, pid);
    const projName = structure.projectName || normalized.projectName || 'Dự án sao lưu';
    const updatedAt = parseLegacyTimestamp(structure.sourceData?.updatedAt || obj.updatedAt || normalized.updatedAt, Date.now());

    candidates.push({
      id: pid,
      name: projName,
      contractorName: normalized.contractorName,
      inspectorName: normalized.inspectorName,
      updatedAt,
      normalizedData: normalized,
      itemCounts: countItems(normalized),
    });
    return candidates;
  }

  // Case 2: Storage Dump / Multi-Project Backup
  if (structure.isStorageDump) {
    const dumpProjects = getProjectsFromStorageDump(obj);
    const seenIds = new Set<string>();

    for (const p of dumpProjects) {
      if (!p.id || seenIds.has(p.id)) continue;
      seenIds.add(p.id);

      const normalized = normalizeImportedData(obj, p.id, p.id);
      const projName = normalized.projectName || p.name || `Dự án (${p.id})`;
      const updatedAt = parseLegacyTimestamp(normalized.updatedAt, 0);

      candidates.push({
        id: p.id,
        name: projName,
        contractorName: normalized.contractorName,
        inspectorName: normalized.inspectorName,
        updatedAt,
        normalizedData: normalized,
        itemCounts: countItems(normalized),
      });
    }

    if (candidates.length > 0) return candidates;
  }

  // Case 3: Untyped or Legacy Single Project
  const fallbackId = obj.projectId || (typeof window !== 'undefined' ? localStorage.getItem('active_project_id') || 'default' : 'default');
  const normalized = normalizeImportedData(obj, fallbackId, fallbackId);
  const projName = normalized.projectName || obj.name || 'Dự án sao lưu';
  const updatedAt = parseLegacyTimestamp(obj.updatedAt || normalized.updatedAt, Date.now());

  candidates.push({
    id: fallbackId,
    name: projName,
    contractorName: normalized.contractorName,
    inspectorName: normalized.inspectorName,
    updatedAt,
    normalizedData: normalized,
    itemCounts: countItems(normalized),
  });

  return candidates;
}

/**
 * Merges two project data sets intelligently without losing newer local or incoming changes,
 * and strictly prevents resurrecting deleted items using tombstone timestamps.
 */
export function smartMergeProjectData(localData: any, incomingData: any): any {
  if (!localData && !incomingData) return {};
  if (!localData) return { ...incomingData };
  if (!incomingData) return { ...localData };

  const merged: any = { ...localData };

  // Project metadata
  if (incomingData.projectName && (!localData.projectName || localData.projectName === 'Dự án')) {
    merged.projectName = incomingData.projectName;
  }
  if (incomingData.contractorName && !localData.contractorName) {
    merged.contractorName = incomingData.contractorName;
  }
  if (incomingData.inspectorName && !localData.inspectorName) {
    merged.inspectorName = incomingData.inspectorName;
  }

  // Tombstones map (key -> deletion timestamp)
  const localTombstones = (localData.tombstones && typeof localData.tombstones === 'object' && !Array.isArray(localData.tombstones)) ? localData.tombstones : {};
  const incomingTombstones = (incomingData.tombstones && typeof incomingData.tombstones === 'object' && !Array.isArray(incomingData.tombstones)) ? incomingData.tombstones : {};
  const mergedTombstones: Record<string, number> = { ...localTombstones };

  Object.entries(incomingTombstones).forEach(([k, val]) => {
    const time = parseLegacyTimestamp(val, 0);
    const existing = parseLegacyTimestamp(mergedTombstones[k], 0);
    if (time > existing) {
      mergedTombstones[k] = time;
    }
  });

  // Merge list helper with timestamp & progress resolution & tombstone enforcement
  const mergeList = (keyName: string, idFields: string[] = ['id']) => {
    const localList = Array.isArray(localData[keyName]) ? localData[keyName] : [];
    const incomingList = Array.isArray(incomingData[keyName]) ? incomingData[keyName] : [];
    
    const map = new Map<string, any>();

    localList.forEach((item: any) => {
      const id = idFields.map(f => item?.[f]).find(Boolean) || String(item?.name || item?.code || Math.random());
      if (!id) return;
      const isDeleted = Boolean(item?.deleted || item?.isDeleted);
      const itemTime = parseLegacyTimestamp(item?.deletedAt || item?.updatedAt || item?.date, 0);
      
      const tombstoneTime = parseLegacyTimestamp(mergedTombstones[`${keyName}_${id}`] || mergedTombstones[id], 0);
      if (tombstoneTime > itemTime) {
        // Obsolete local item killed by newer tombstone
        return;
      }

      if (isDeleted) {
        mergedTombstones[`${keyName}_${id}`] = Math.max(tombstoneTime, itemTime);
      } else {
        map.set(id, { ...item });
      }
    });

    incomingList.forEach((incomingItem: any) => {
      const id = idFields.map(f => incomingItem?.[f]).find(Boolean) || String(incomingItem?.name || incomingItem?.code || Math.random());
      if (!id) return;

      const isIncomingDeleted = Boolean(incomingItem?.deleted || incomingItem?.isDeleted);
      const iTime = parseLegacyTimestamp(incomingItem?.deletedAt || incomingItem?.updatedAt || incomingItem?.date, 0);
      const tombstoneTime = parseLegacyTimestamp(mergedTombstones[`${keyName}_${id}`] || mergedTombstones[id], 0);

      if (isIncomingDeleted) {
        mergedTombstones[`${keyName}_${id}`] = Math.max(tombstoneTime, iTime);
        if (map.has(id)) {
          const localItem = map.get(id);
          const lTime = parseLegacyTimestamp(localItem?.updatedAt || localItem?.date, 0);
          if (iTime >= lTime) {
            // Incoming delete is newer -> remove from active list
            map.delete(id);
          }
        }
        return;
      }

      if (tombstoneTime > iTime) {
        // Incoming item was deleted locally/globally at a later time -> do NOT resurrect
        return;
      }

      if (!map.has(id)) {
        map.set(id, { ...incomingItem });
      } else {
        const localItem = map.get(id);
        const lTime = parseLegacyTimestamp(localItem?.updatedAt || localItem?.date, 0);

        if (iTime > lTime) {
          map.set(id, { ...incomingItem });
        } else if (lTime > iTime) {
          // Keep localItem
        } else {
          // Timestamps equal, check progress or merge props
          if (typeof incomingItem?.progress === 'number' && typeof localItem?.progress === 'number') {
            if (incomingItem.progress > localItem.progress) {
              map.set(id, { ...incomingItem });
            }
          } else {
            map.set(id, { ...localItem, ...incomingItem });
          }
        }
      }
    });

    // Final purge of any item marked deleted
    const finalList: any[] = [];
    map.forEach((item, id) => {
      if (!item.deleted && !item.isDeleted) {
        finalList.push(item);
      }
    });

    merged[keyName] = finalList;
  };

  mergeList('materialNorms', ['id', 'name']);
  mergeList('inventory', ['id', 'itemName']);
  mergeList('workVolumes', ['id', 'taskName']);
  mergeList('floorPlans', ['id', 'floorName']);
  mergeList('defects', ['id']);
  mergeList('roomProgressList', ['id', 'roomId']);
  mergeList('checklist', ['id']);
  mergeList('crewRecords', ['id']);
  mergeList('teams', ['id', 'name']);

  merged.tombstones = mergedTombstones;

  const localUpdated = parseLegacyTimestamp(localData.updatedAt, 0);
  const incomingUpdated = parseLegacyTimestamp(incomingData.updatedAt, 0);
  merged.updatedAt = Math.max(localUpdated, incomingUpdated, Date.now());

  return merged;
}

