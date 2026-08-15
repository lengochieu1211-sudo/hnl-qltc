import { MaterialNorm, WorkVolume, RoomProgressItem, FloorPlan, DefectItem, ChecklistItem, CrewRecord, TeamInfo, ProjectInfo } from '../types';
import localforage from 'localforage';
import { getStorageKeys, removeAsyncItem } from './asyncStorage';
import { extractProjectIdFromStorageKey, isStorageKeyOwnedByProject, getProjectStorageKeys } from './projectStorageUtils';
import { deleteProjectPhotos, scanAndCleanupPhotoOrphans } from './photoStorage';

/**
 * Normalizes and reconciles MaterialNorm work category links against current WorkVolumes.
 * 
 * Rules:
 * 1. workCategoryIds & workCategoryId are authoritative.
 * 2. If workCategoryIds exist, verify each ID exists in workVolumes.
 *    - Valid IDs -> rebuild workCategories from current workVolume.title.
 *    - Invalid IDs -> removed from workCategoryIds and workCategoryNormsById.
 * 3. If workCategoryIds do not exist (legacy data):
 *    - Match workCategories string array against workVolumes by title (case-insensitive trim).
 *    - Matched titles -> mapped to workVolume.id and stored in workCategoryIds.
 *    - Unmatched titles -> dropped (fixes stale badges!).
 * 4. Ensure workCategoryId & workCategory are synchronized with the primary link.
 */
export function reconcileMaterialNormWorkCategoryLinks(
  materialNorms: MaterialNorm[] = [],
  workVolumes: WorkVolume[] = []
): { materialNorms: MaterialNorm[]; cleanedCount: number } {
  if (!materialNorms || materialNorms.length === 0) {
    return { materialNorms: [], cleanedCount: 0 };
  }

  // Create lookups for work volumes
  const volumeById = new Map<string, WorkVolume>();
  const volumeByTitleLower = new Map<string, WorkVolume>();

  (workVolumes || []).forEach(wv => {
    if (wv.id) {
      volumeById.set(wv.id, wv);
    }
    if (wv.title && wv.title.trim()) {
      const key = wv.title.trim().toLowerCase();
      // Keep first or preferred
      if (!volumeByTitleLower.has(key)) {
        volumeByTitleLower.set(key, wv);
      }
    }
  });

  let cleanedCount = 0;

  const reconciledNorms = materialNorms.map(norm => {
    let hasChanges = false;
    let validCategoryIds: string[] = [];
    let validCategoryNames: string[] = [];
    const validNormsById: Record<string, number> = {};
    const validNormsByName: Record<string, number> = {};

    // 1. If norm already has workCategoryIds
    if (Array.isArray(norm.workCategoryIds) && norm.workCategoryIds.length > 0) {
      norm.workCategoryIds.forEach(id => {
        const wv = volumeById.get(id);
        if (wv) {
          if (!validCategoryIds.includes(id)) {
            validCategoryIds.push(id);
            validCategoryNames.push(wv.title);
          }
          if (norm.workCategoryNormsById && norm.workCategoryNormsById[id] !== undefined) {
            validNormsById[id] = norm.workCategoryNormsById[id];
            validNormsByName[wv.title] = norm.workCategoryNormsById[id];
          } else if (norm.workCategoryNorms && norm.workCategoryNorms[wv.title] !== undefined) {
            validNormsById[id] = norm.workCategoryNorms[wv.title];
            validNormsByName[wv.title] = norm.workCategoryNorms[wv.title];
          }
        } else {
          hasChanges = true;
          cleanedCount++;
        }
      });
    } else {
      // 2. Legacy fallback: workCategories (array of names) or workCategory (single string)
      const candidateNames: string[] = [];
      if (Array.isArray(norm.workCategories) && norm.workCategories.length > 0) {
        candidateNames.push(...norm.workCategories);
      } else if (norm.workCategory && norm.workCategory.trim()) {
        candidateNames.push(norm.workCategory.trim());
      }

      candidateNames.forEach(rawName => {
        if (!rawName || !rawName.trim()) return;
        const lower = rawName.trim().toLowerCase();
        const wv = volumeByTitleLower.get(lower);
        if (wv) {
          if (!validCategoryIds.includes(wv.id)) {
            validCategoryIds.push(wv.id);
            validCategoryNames.push(wv.title);
          }
          if (norm.workCategoryNorms && norm.workCategoryNorms[rawName] !== undefined) {
            validNormsById[wv.id] = norm.workCategoryNorms[rawName];
            validNormsByName[wv.title] = norm.workCategoryNorms[rawName];
          } else if (norm.workCategoryNormsById && norm.workCategoryNormsById[wv.id] !== undefined) {
            validNormsById[wv.id] = norm.workCategoryNormsById[wv.id];
            validNormsByName[wv.title] = norm.workCategoryNormsById[wv.id];
          }
        } else {
          // Stale name that does not exist in work volumes -> dropped
          hasChanges = true;
          cleanedCount++;
        }
      });
    }

    // Determine primary workCategoryId and workCategory
    let primaryId = norm.workCategoryId;
    let primaryName = norm.workCategory;

    if (validCategoryIds.length > 0) {
      if (!primaryId || !validCategoryIds.includes(primaryId)) {
        primaryId = validCategoryIds[0];
        const wv = volumeById.get(primaryId);
        primaryName = wv ? wv.title : validCategoryNames[0];
        hasChanges = true;
      } else {
        const wv = volumeById.get(primaryId);
        if (wv && primaryName !== wv.title) {
          primaryName = wv.title;
          hasChanges = true;
        }
      }
    } else {
      if (primaryId || primaryName) {
        primaryId = undefined;
        primaryName = undefined;
        hasChanges = true;
      }
    }

    // Check if workCategories or workCategoryIds array changed
    if (
      JSON.stringify(validCategoryIds) !== JSON.stringify(norm.workCategoryIds || []) ||
      JSON.stringify(validCategoryNames) !== JSON.stringify(norm.workCategories || [])
    ) {
      hasChanges = true;
    }

    if (!hasChanges) {
      return norm;
    }

    return {
      ...norm,
      workCategoryId: primaryId,
      workCategory: primaryName,
      workCategoryIds: validCategoryIds.length > 0 ? validCategoryIds : undefined,
      workCategories: validCategoryNames.length > 0 ? validCategoryNames : undefined,
      workCategoryNormsById: Object.keys(validNormsById).length > 0 ? validNormsById : undefined,
      workCategoryNorms: Object.keys(validNormsByName).length > 0 ? validNormsByName : undefined,
    };
  });

  return { materialNorms: reconciledNorms, cleanedCount };
}

/**
 * Returns live, resolved work category names for displaying badges in the UI.
 * Prevents showing stale or unlinked work categories.
 */
export function getResolvedNormWorkCategories(
  norm: MaterialNorm,
  workVolumes?: WorkVolume[]
): string[] {
  if (!norm) return [];
  if (!workVolumes || workVolumes.length === 0) {
    return norm.workCategories && norm.workCategories.length > 0
      ? norm.workCategories
      : norm.workCategory
      ? [norm.workCategory]
      : [];
  }

  const volumeById = new Map<string, WorkVolume>();
  const volumeByTitleLower = new Map<string, WorkVolume>();

  workVolumes.forEach(wv => {
    if (wv.id) volumeById.set(wv.id, wv);
    if (wv.title) volumeByTitleLower.set(wv.title.trim().toLowerCase(), wv);
  });

  const resolved: string[] = [];

  if (Array.isArray(norm.workCategoryIds) && norm.workCategoryIds.length > 0) {
    norm.workCategoryIds.forEach(id => {
      const wv = volumeById.get(id);
      if (wv && !resolved.includes(wv.title)) {
        resolved.push(wv.title);
      }
    });
  }

  if (resolved.length === 0) {
    const candidateNames = norm.workCategories && norm.workCategories.length > 0
      ? norm.workCategories
      : norm.workCategory
      ? [norm.workCategory]
      : [];

    candidateNames.forEach(name => {
      if (!name) return;
      const lower = name.trim().toLowerCase();
      const wv = volumeByTitleLower.get(lower);
      if (wv && !resolved.includes(wv.title)) {
        resolved.push(wv.title);
      }
    });
  }

  return resolved;
}

export interface OrphanProjectInfo {
  id: string;
  name: string;
  keys: string[];
  estimatedSizeBytes: number;
  lastUpdatedAt?: number;
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
  };
}

export interface OrphanScanResult {
  orphanProjects: OrphanProjectInfo[];
  totalOrphanKeys: number;
  totalOrphanSizeBytes: number;
}

/**
 * Scans all storage entries to detect any project data keys that belong to deleted
 * or non-existent projects (not listed in construction_projects_list).
 */
export function detectOrphanProjectData(
  allStorage: Record<string, any>,
  validProjects: ProjectInfo[] = []
): OrphanScanResult {
  const validProjectIds = new Set(validProjects.map(p => p.id));
  if (validProjectIds.size === 0) {
    validProjectIds.add('default');
  }

  const orphanProjectsMap = new Map<string, OrphanProjectInfo>();
  let totalOrphanKeys = 0;
  let totalOrphanSizeBytes = 0;

  const allKeys = Object.keys(allStorage || {});

  for (const key of allKeys) {
    if (!key.startsWith('construction_')) continue;

    // Use unified helper to extract exact project ID
    const projectId = extractProjectIdFromStorageKey(key);

    if (projectId && !validProjectIds.has(projectId)) {
      totalOrphanKeys++;
      const val = allStorage[key];
      const valStr = typeof val === 'string' ? val : JSON.stringify(val || '');
      const byteSize = new Blob([valStr]).size;
      totalOrphanSizeBytes += byteSize;

      let info = orphanProjectsMap.get(projectId);
      if (!info) {
        info = {
          id: projectId,
          name: `Dự án cũ (${projectId.slice(0, 12)}...)`,
          keys: [],
          estimatedSizeBytes: 0,
          itemCounts: {
            materialNorms: 0,
            inventory: 0,
            workVolumes: 0,
            floorPlans: 0,
            defects: 0,
            roomProgressList: 0,
            checklist: 0,
            crewRecords: 0,
            teams: 0,
          }
        };
        orphanProjectsMap.set(projectId, info);
      }

      info.keys.push(key);
      info.estimatedSizeBytes += byteSize;

      // Extract specific metadata
      if (key === `construction_project_name_${projectId}` && typeof val === 'string' && val.trim()) {
        info.name = val.trim();
      } else if (key === `construction_updated_at_${projectId}`) {
        const ts = parseInt(String(val), 10);
        if (!isNaN(ts)) info.lastUpdatedAt = ts;
      }

      // Count items if possible
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        if (Array.isArray(parsed)) {
          if (key.includes('material_norms')) info.itemCounts.materialNorms += parsed.length;
          else if (key.includes('inventory')) info.itemCounts.inventory += parsed.length;
          else if (key.includes('work_volumes')) info.itemCounts.workVolumes += parsed.length;
          else if (key.includes('floor_plans')) info.itemCounts.floorPlans += parsed.length;
          else if (key.includes('defects')) info.itemCounts.defects += parsed.length;
          else if (key.includes('room_progress')) info.itemCounts.roomProgressList += parsed.length;
          else if (key.includes('checklist')) info.itemCounts.checklist += parsed.length;
          else if (key.includes('crew_records')) info.itemCounts.crewRecords += parsed.length;
          else if (key.includes('teams')) info.itemCounts.teams += parsed.length;
        }
      } catch (_) {}
    }
  }

  return {
    orphanProjects: Array.from(orphanProjectsMap.values()),
    totalOrphanKeys,
    totalOrphanSizeBytes
  };
}

export interface CleanupOrphanResult {
  requestedKeys: string[];
  deletedKeys: string[];
  failedKeys: string[];
  remainingKeys: string[];
  success: boolean;
  errorDetails?: string[];
}

/**
 * Permanently removes all keys for specified orphan projects from both IndexedDB and localStorage,
 * and verifies that no remaining keys exist.
 */
export async function cleanupOrphanProjectData(
  orphanProjectIds: string[],
  specificKeys?: string[]
): Promise<CleanupOrphanResult> {
  if ((!orphanProjectIds || orphanProjectIds.length === 0) && (!specificKeys || specificKeys.length === 0)) {
    return {
      requestedKeys: [],
      deletedKeys: [],
      failedKeys: [],
      remainingKeys: [],
      success: true
    };
  }

  const idSet = new Set(orphanProjectIds || []);
  const keysToRemove = new Set<string>(specificKeys || []);

  // Delete all photos associated with orphan project IDs and run full photo orphan scanner
  for (const pid of idSet) {
    try {
      await deleteProjectPhotos(pid);
    } catch (_) {}
  }
  try {
    await scanAndCleanupPhotoOrphans();
  } catch (_) {}

  // 1. Scan all storage keys from abstraction layer
  try {
    const allKeys = await getStorageKeys();
    for (const key of allKeys) {
      if (!key || !key.startsWith('construction_')) continue;
      const extractedPid = extractProjectIdFromStorageKey(key);
      if (extractedPid && idSet.has(extractedPid)) {
        keysToRemove.add(key);
      }
    }
  } catch (err) {
    console.error('Error scanning storage keys in cleanupOrphanProjectData:', err);
  }

  // 2. Directly scan localforage keys (IndexedDB)
  try {
    const lfKeys = await localforage.keys();
    for (const key of lfKeys) {
      if (!key || !key.startsWith('construction_')) continue;
      const extractedPid = extractProjectIdFromStorageKey(key);
      if (extractedPid && idSet.has(extractedPid)) {
        keysToRemove.add(key);
      }
    }
  } catch (err) {
    console.error('Error scanning localforage keys in cleanupOrphanProjectData:', err);
  }

  // 3. Directly scan localStorage keys
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('construction_')) continue;
      const extractedPid = extractProjectIdFromStorageKey(key);
      if (extractedPid && idSet.has(extractedPid)) {
        keysToRemove.add(key);
      }
    }
  } catch (err) {
    console.error('Error scanning localStorage keys in cleanupOrphanProjectData:', err);
  }

  const requestedKeys = Array.from(keysToRemove);
  const deletedKeys: string[] = [];
  const failedKeys: string[] = [];
  const errorDetails: string[] = [];

  // 4. Execute atomic deletion from all storage layers
  for (const k of requestedKeys) {
    let hasError = false;
    try {
      await removeAsyncItem(k);
    } catch (err) {
      hasError = true;
      errorDetails.push(`Lỗi xóa key ${k} từ asyncStorage: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await localforage.removeItem(k);
    } catch (err) {
      hasError = true;
      errorDetails.push(`Lỗi xóa key ${k} từ IndexedDB: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      localStorage.removeItem(k);
    } catch (err) {
      hasError = true;
      errorDetails.push(`Lỗi xóa key ${k} từ localStorage: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!hasError) {
      deletedKeys.push(k);
    } else {
      failedKeys.push(k);
    }
  }

  // 5. Post-deletion verification scan
  const remainingKeys: string[] = [];
  let verificationErrorOccurred = false;

  try {
    const lfKeysAfter = new Set(await localforage.keys());
    for (const k of requestedKeys) {
      const existsInLf = lfKeysAfter.has(k);
      const existsInLs = localStorage.getItem(k) !== null;
      if (existsInLf || existsInLs) {
        if (!remainingKeys.includes(k)) {
          remainingKeys.push(k);
        }
      }
    }
  } catch (err) {
    verificationErrorOccurred = true;
    errorDetails.push(`Lỗi kiểm tra xác thực sau khi xóa (IndexedDB verification error): ${err instanceof Error ? err.message : String(err)}`);
  }

  // If verification failed with exception, mark any non-deleted keys as remaining/failed
  if (verificationErrorOccurred) {
    requestedKeys.forEach(k => {
      if (!deletedKeys.includes(k) && !remainingKeys.includes(k)) {
        remainingKeys.push(k);
      }
      if (!failedKeys.includes(k)) {
        failedKeys.push(k);
      }
    });
  }

  const isSuccess = !verificationErrorOccurred && remainingKeys.length === 0 && failedKeys.length === 0;

  return {
    requestedKeys,
    deletedKeys,
    failedKeys,
    remainingKeys,
    success: isSuccess,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined
  };
}
