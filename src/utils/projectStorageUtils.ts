import { getKey } from '../App';
import localforage from 'localforage';
import { getStorageKeys, removeAsyncItem, setAsyncItem } from './asyncStorage';

/**
 * Standard project domain key suffixes
 */
export const STANDARD_PROJECT_KEY_BASES = [
  'construction_project_name',
  'construction_contractor',
  'construction_inspector',
  'construction_material_norms',
  'construction_inventory',
  'construction_work_volumes',
  'construction_floor_plans',
  'construction_defects',
  'construction_room_progress',
  'construction_checklist',
  'construction_crew_records',
  'construction_teams',
  'construction_photos',
  'construction_updated_at',
  'construction_tombstones',
  'construction_project_members',
  'construction_sync_state',
  'construction_drive_sync_file',
  'construction_drive_sync_time'
];

/**
 * Extract exact projectId from any storage key without false positive partial matches.
 * Returns null if the key is global or does not belong to any specific project.
 */
export function extractProjectIdFromStorageKey(key: string): string | null {
  if (!key || typeof key !== 'string') return null;

  // Global system keys that do not belong to any specific project
  const globalKeys = [
    'construction_projects_list',
    'active_project_id',
    'construction_pin_lock_config',
    'construction_audit_logs',
    'construction_user_role',
    'construction_user_pin',
    'construction_deleted_projects',
    'construction_google_auth',
    'construction_format_settings',
    'construction_app_settings'
  ];

  if (globalKeys.includes(key)) {
    return null;
  }

  // 1. Exact base keys (legacy / default project without suffix)
  if (STANDARD_PROJECT_KEY_BASES.includes(key)) {
    return 'default';
  }

  // 2. Specific project name key
  if (key.startsWith('construction_project_name_')) {
    const pid = key.substring('construction_project_name_'.length).trim();
    return pid || null;
  }

  // 3. Project-scoped keys with exact suffix: <baseKey>_<projectId>
  for (const base of STANDARD_PROJECT_KEY_BASES) {
    if (key.startsWith(`${base}_`)) {
      const pid = key.substring(base.length + 1).trim();
      if (pid) return pid;
    }
  }

  // 4. Regex match for explicit proj_<id> pattern at the end of key
  const match = key.match(/_proj_([a-zA-Z0-9_-]+)$/);
  if (match && match[1]) {
    return `proj_${match[1]}`;
  }

  return null;
}

/**
 * Checks whether a given storage key strictly belongs to the specified projectId.
 */
export function isStorageKeyOwnedByProject(key: string, projectId: string): boolean {
  if (!key || !projectId) return false;
  const extracted = extractProjectIdFromStorageKey(key);
  if (extracted === projectId) return true;

  if (projectId === 'default') {
    return STANDARD_PROJECT_KEY_BASES.includes(key);
  }

  // Exact suffix match
  if (key.endsWith(`_${projectId}`)) {
    return true;
  }

  return false;
}

/**
 * Returns all storage keys owned by a specific project from an in-memory list of keys.
 */
export function getAllKeysForProjectSync(projectId: string, allKeys: string[]): string[] {
  if (!projectId || !Array.isArray(allKeys)) return [];
  const result: string[] = [];
  for (const k of allKeys) {
    if (isStorageKeyOwnedByProject(k, projectId)) {
      result.push(k);
    }
  }
  return result;
}

/**
 * Scans all storage layers (localStorage + localforage / IndexedDB) and returns
 * all existing keys belonging to the given projectId.
 */
export async function getProjectStorageKeys(projectId: string): Promise<string[]> {
  if (!projectId) return [];
  const keysSet = new Set<string>();

  // 1. Scan from async abstraction
  try {
    const allKeys = await getStorageKeys();
    for (const k of allKeys) {
      if (isStorageKeyOwnedByProject(k, projectId)) {
        keysSet.add(k);
      }
    }
  } catch (_) {}

  // 2. Scan localforage
  try {
    const lfKeys = await localforage.keys();
    for (const k of lfKeys) {
      if (isStorageKeyOwnedByProject(k, projectId)) {
        keysSet.add(k);
      }
    }
  } catch (_) {}

  // 3. Scan localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isStorageKeyOwnedByProject(k, projectId)) {
        keysSet.add(k);
      }
    }
  } catch (_) {}

  // 4. Ensure standard keys for this project are included if they might exist
  STANDARD_PROJECT_KEY_BASES.forEach(base => {
    const k = getKey(base, projectId);
    if (localStorage.getItem(k) !== null) {
      keysSet.add(k);
    }
  });

  return Array.from(keysSet);
}

/**
 * Returns a standard list of expected storage keys for a project.
 */
export function getStandardProjectKeyList(projectId: string): string[] {
  return STANDARD_PROJECT_KEY_BASES.map(base => getKey(base, projectId));
}
