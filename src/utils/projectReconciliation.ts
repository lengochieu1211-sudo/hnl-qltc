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
 * 2. Explicit IDs are authoritative and are never deleted merely because the catalog
 *    record is temporarily missing; stale IDs are preserved for Health Center repair.
 * 3. Legacy name-only links migrate only when the title resolves uniquely. Ambiguous
 *    or unmatched names are preserved as legacy provenance instead of being guessed/dropped.
 * 4. Resolved IDs refresh display names/factor aliases without broadening category scope.
 */
export function reconcileMaterialNormWorkCategoryLinks(
  materialNorms: MaterialNorm[] = [],
  workVolumes: WorkVolume[] = []
): { materialNorms: MaterialNorm[]; cleanedCount: number } {
  if (!materialNorms || materialNorms.length === 0) {
    return { materialNorms: [], cleanedCount: 0 };
  }

  const activeWorkVolumes = (workVolumes || []).filter((wv) => wv.deletedAt === undefined || wv.deletedAt === null);
  const canonicalCategoryId = (wv: WorkVolume): string => String(wv.workCategoryId || wv.id || '').trim();
  const volumeByRecordId = new Map<string, WorkVolume>();
  const volumesByCanonicalId = new Map<string, WorkVolume[]>();
  const volumesByTitleLower = new Map<string, WorkVolume[]>();

  activeWorkVolumes.forEach((wv) => {
    const recordId = String(wv.id || '').trim();
    const canonicalId = canonicalCategoryId(wv);
    if (recordId) volumeByRecordId.set(recordId, wv);
    if (canonicalId) {
      const bucket = volumesByCanonicalId.get(canonicalId) || [];
      bucket.push(wv);
      volumesByCanonicalId.set(canonicalId, bucket);
    }
    const titleKey = String(wv.title || '').trim().toLocaleLowerCase('vi-VN');
    if (titleKey) {
      const bucket = volumesByTitleLower.get(titleKey) || [];
      bucket.push(wv);
      volumesByTitleLower.set(titleKey, bucket);
    }
  });

  const resolveById = (rawRef?: string): WorkVolume | undefined => {
    const ref = String(rawRef || '').trim();
    if (!ref) return undefined;
    const exactRecord = volumeByRecordId.get(ref);
    if (exactRecord) return exactRecord;
    const canonicalMatches = volumesByCanonicalId.get(ref) || [];
    const canonicalIds = new Set(canonicalMatches.map(canonicalCategoryId).filter(Boolean));
    return canonicalIds.size === 1 ? canonicalMatches[0] : undefined;
  };

  const resolveUniqueTitle = (rawTitle?: string): WorkVolume | undefined => {
    const key = String(rawTitle || '').trim().toLocaleLowerCase('vi-VN');
    if (!key) return undefined;
    const matches = volumesByTitleLower.get(key) || [];
    const canonicalIds = new Set(matches.map(canonicalCategoryId).filter(Boolean));
    return canonicalIds.size === 1 ? matches[0] : undefined;
  };

  let cleanedCount = 0;
  const reconciledNorms = materialNorms.map((norm) => {
    const explicitIds = Array.from(new Set(
      [...(norm.workCategoryIds || []), ...(norm.workCategoryId ? [norm.workCategoryId] : [])]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    const legacyNames = Array.from(new Set(
      [...(norm.workCategories || []), ...(norm.workCategory ? [norm.workCategory] : [])]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));

    const nextIds: string[] = [];
    const nextNames: string[] = [];
    const nextById: Record<string, number> = {};
    const nextByName: Record<string, number> = { ...(norm.workCategoryNorms || {}) };

    if (explicitIds.length > 0) {
      explicitIds.forEach((rawId, index) => {
        const resolved = resolveById(rawId);
        const canonicalId = resolved ? canonicalCategoryId(resolved) : rawId;
        if (!nextIds.includes(canonicalId)) nextIds.push(canonicalId);

        const oldName = (norm.workCategories || [])[index];
        const displayName = resolved?.title || oldName || (norm.workCategoryId === rawId ? norm.workCategory : undefined);
        if (displayName && !nextNames.includes(displayName)) nextNames.push(displayName);

        const factor = norm.workCategoryNormsById?.[canonicalId]
          ?? norm.workCategoryNormsById?.[rawId];
        if (factor !== undefined) nextById[canonicalId] = factor;

        if (resolved && factor === undefined && norm.workCategoryNorms?.[resolved.title] !== undefined) {
          // ID scope is authoritative, but legacy factor-by-name can be migrated once
          // when the ID itself proves the category relationship.
          nextById[canonicalId] = norm.workCategoryNorms[resolved.title];
        }
        if (resolved && nextById[canonicalId] !== undefined) {
          nextByName[resolved.title] = nextById[canonicalId];
        }
      });
    } else {
      // Legacy name-only links may migrate only when the title resolves uniquely.
      // Unmatched/ambiguous names are preserved verbatim so Health Center can report
      // and repair them; reconciliation must never erase provenance.
      legacyNames.forEach((rawName) => {
        const resolved = resolveUniqueTitle(rawName);
        if (!resolved) {
          if (!nextNames.includes(rawName)) nextNames.push(rawName);
          return;
        }
        const canonicalId = canonicalCategoryId(resolved);
        if (canonicalId && !nextIds.includes(canonicalId)) nextIds.push(canonicalId);
        if (!nextNames.includes(resolved.title)) nextNames.push(resolved.title);
        const factor = norm.workCategoryNormsById?.[canonicalId]
          ?? norm.workCategoryNorms?.[rawName]
          ?? norm.workCategoryNorms?.[resolved.title];
        if (factor !== undefined && canonicalId) nextById[canonicalId] = factor;
        if (factor !== undefined) nextByName[resolved.title] = factor;
      });
    }

    let primaryId = String(norm.workCategoryId || '').trim() || undefined;
    let primaryName = norm.workCategory;
    if (primaryId) {
      const resolved = resolveById(primaryId);
      if (resolved) {
        primaryId = canonicalCategoryId(resolved);
        primaryName = resolved.title;
      }
      // Unresolved explicit primary ID is intentionally preserved.
    } else if (nextIds.length > 0) {
      primaryId = nextIds[0];
      const resolved = resolveById(primaryId);
      if (resolved) primaryName = resolved.title;
    } else if (!primaryName && nextNames.length > 0) {
      primaryName = nextNames[0];
    }

    const next: MaterialNorm = {
      ...norm,
      workCategoryId: primaryId,
      workCategory: primaryName,
      workCategoryIds: nextIds.length > 0 ? nextIds : undefined,
      workCategories: nextNames.length > 0 ? nextNames : undefined,
      workCategoryNormsById: Object.keys(nextById).length > 0 ? nextById : undefined,
      workCategoryNorms: Object.keys(nextByName).length > 0 ? nextByName : undefined,
    };

    if (JSON.stringify(next) !== JSON.stringify(norm)) cleanedCount++;
    return next;
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
  const volumeByCanonicalId = new Map<string, WorkVolume>();
  const volumeByTitleLower = new Map<string, WorkVolume[]>();

  workVolumes.filter((wv) => wv.deletedAt === undefined || wv.deletedAt === null).forEach(wv => {
    if (wv.id) volumeById.set(wv.id, wv);
    if (wv.workCategoryId) volumeByCanonicalId.set(wv.workCategoryId, wv);
    if (wv.title) {
      const key = wv.title.trim().toLocaleLowerCase('vi-VN');
      volumeByTitleLower.set(key, [...(volumeByTitleLower.get(key) || []), wv]);
    }
  });

  const resolved: string[] = [];

  if (Array.isArray(norm.workCategoryIds) && norm.workCategoryIds.length > 0) {
    norm.workCategoryIds.forEach(id => {
      const wv = volumeById.get(id) || volumeByCanonicalId.get(id);
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
      const lower = name.trim().toLocaleLowerCase('vi-VN');
      const matches = volumeByTitleLower.get(lower) || [];
      const canonicalIds = new Set(matches.map((wv) => String(wv.workCategoryId || wv.id || '').trim()).filter(Boolean));
      const wv = canonicalIds.size === 1 ? matches[0] : undefined;
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
