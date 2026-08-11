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
  data: Record<string, string>;
}

const DB_NAME = 'BackupVersionDB';
const STORE_NAME = 'BackupVersions';

function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllBackupVersions(): Promise<BackupVersion[]> {
  try {
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
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Error reading backup versions from IndexedDB:', err);
    return [];
  }
}

export async function saveBackupVersion(newVersion: BackupVersion, maxVersions: number = 15): Promise<BackupVersion[]> {
  const all = await getAllBackupVersions();
  all.unshift(newVersion);
  
  const trimmed = all.slice(0, maxVersions);
  const toDelete = all.slice(maxVersions);

  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    store.put(newVersion);
    
    toDelete.forEach(item => {
      store.delete(item.id);
    });

    tx.oncomplete = () => {
      trimmed.sort((a, b) => b.timestamp - a.timestamp);
      resolve(trimmed);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteBackupVersion(id: string): Promise<BackupVersion[]> {
  const db = await openBackupDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = async () => {
      const updated = await getAllBackupVersions();
      resolve(updated);
    };
    tx.onerror = () => reject(tx.error);
  });
}
