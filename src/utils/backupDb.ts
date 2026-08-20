export interface BackupVersion {
  id: string;
  timestamp: number;
  type: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  typeLabel: string;
  hourKey?: string;
  dayKey?: string;
  weekKey?: string;
  monthKey?: string;
  stats: string;
  projectName: string;
  projectId?: string;
  backupType?: 'single-project' | 'full-system';
  data: Record<string, string>;
}

const DB_NAME = 'BackupVersionDB';
const STORE_NAME = 'BackupVersions';


const appDataStore = localforage.createInstance({
  name: 'ConstructionAppDB',
  storeName: 'app_data',
});

let legacyAutosaveMigrationPromise: Promise<void> | null = null;

async function migrateLegacyAutosaveVersionsIfNeeded(): Promise<void> {
  if (legacyAutosaveMigrationPromise) return legacyAutosaveMigrationPromise;
  legacyAutosaveMigrationPromise = (async () => {
    // Capture the old key directly too, in case bootstrap migration was interrupted.
    const directRaw = typeof localStorage !== 'undefined'
      ? localStorage.getItem('construction_autosave_versions')
      : null;
    if (directRaw) {
      try {
        const existing = await appDataStore.getItem(LEGACY_AUTOSAVE_RAW_KEY);
        if (existing === null || existing === undefined) {
          await appDataStore.setItem(LEGACY_AUTOSAVE_RAW_KEY, directRaw);
        }
        const verify = await appDataStore.getItem(LEGACY_AUTOSAVE_RAW_KEY);
        if (verify !== null && verify !== undefined) localStorage.removeItem('construction_autosave_versions');
      } catch (err) {
        console.warn('[Backup migration] Could not move legacy autosave history out of localStorage yet:', err);
      }
    }

    const rawStored = await appDataStore.getItem<any>(LEGACY_AUTOSAVE_RAW_KEY);
    if (rawStored === null || rawStored === undefined) return;
    const raw = typeof rawStored === 'string' ? rawStored : JSON.stringify(rawStored);

    let parsed: BackupVersion[];
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) return;
      parsed = value.filter((item: any) => item && item.id && item.timestamp);
    } catch (err) {
      console.warn('[Backup migration] Legacy autosave JSON is not parseable; preserving raw IndexedDB copy:', err);
      return;
    }
    if (parsed.length === 0) {
      await appDataStore.removeItem(LEGACY_AUTOSAVE_RAW_KEY);
      return;
    }

    const db = await openBackupDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      parsed.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Lỗi nhập lịch sử sao lưu legacy'));
    });
    await appDataStore.removeItem(LEGACY_AUTOSAVE_RAW_KEY);
    console.info(`[Backup migration] Imported ${parsed.length} legacy autosave versions into IndexedDB.`);
  })().finally(() => { legacyAutosaveMigrationPromise = null; });
  return legacyAutosaveMigrationPromise;
}

function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB không được hỗ trợ trên trình duyệt này.'));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không thể mở IndexedDB'));
  });
}

export async function getAllBackupVersions(): Promise<BackupVersion[]> {
  await migrateLegacyAutosaveVersionsIfNeeded();
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = (request.result || []) as BackupVersion[];
      results.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error || new Error('Lỗi đọc danh sách phiên bản từ IndexedDB'));
  });
}

export async function getBackupVersionsForProject(projectId: string): Promise<BackupVersion[]> {
  const all = await getAllBackupVersions();
  return all.filter(v => v.projectId === projectId || (v.backupType === 'single-project' && v.projectId === projectId));
}

export async function saveBackupVersion(newVersion: BackupVersion, maxVersions: number = 20): Promise<BackupVersion[]> {
  const all = await getAllBackupVersions();

  // Filter versions by scope if project-scoped
  const pid = newVersion.projectId;
  const projectVersions = pid ? all.filter(v => v.projectId === pid) : all;
  projectVersions.unshift(newVersion);
  
  const toKeepForProject = projectVersions.slice(0, maxVersions);
  const toDeleteForProject = projectVersions.slice(maxVersions);

  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    store.put(newVersion);
    
    toDeleteForProject.forEach(item => {
      store.delete(item.id);
    });

    tx.oncomplete = () => {
      toKeepForProject.sort((a, b) => b.timestamp - a.timestamp);
      resolve(toKeepForProject);
    };
    tx.onerror = () => reject(tx.error || new Error('Lỗi ghi bản sao lưu vào IndexedDB'));
  });
}

export async function deleteBackupVersion(id: string): Promise<BackupVersion[]> {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = async () => {
      try {
        const updated = await getAllBackupVersions();
        resolve(updated);
      } catch (err) {
        resolve([]);
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteBackupVersionsForProject(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const all = await getAllBackupVersions();
    const targetVersions = all.filter(v => v.projectId === projectId);
    if (targetVersions.length === 0) return;

    const db = await openBackupDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      targetVersions.forEach(v => {
        store.delete(v.id);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Lỗi khi xóa lịch sử sao lưu của dự án:', err);
  }
}

