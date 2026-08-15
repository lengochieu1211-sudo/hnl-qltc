import localforage from 'localforage';

localforage.config({
  name: 'ConstructionAppDB',
  storeName: 'app_data'
});

export const isMetadataKey = (key: string): boolean => {
  return (
    key.includes('construction_project_name') ||
    key.includes('construction_contractor') ||
    key.includes('construction_inspector') ||
    key.includes('construction_updated_at') ||
    key.includes('construction_drive_')
  );
};

export const getAsyncItem = async <T>(key: string, fallback: T): Promise<T> => {
  if (isMetadataKey(key)) {
    const localVal = localStorage.getItem(key);
    if (localVal !== null) {
      try { return JSON.parse(localVal); } catch { return localVal as unknown as T; }
    }
  }
  try {
    const val = await localforage.getItem<any>(key);
    if (val !== null && val !== undefined) {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val as unknown as T;
        }
      }
      return val as T;
    }
    // Migration: try to get from localStorage if not in localforage yet
    const localVal = localStorage.getItem(key);
    if (localVal !== null) {
      let parsed: any;
      try {
        parsed = JSON.parse(localVal);
      } catch {
        parsed = localVal;
      }
      await localforage.setItem(key, localVal).catch(() => {}); // migrate
      return parsed;
    }
    return fallback;
  } catch (err) {
    console.error(`Error reading async item ${key}:`, err);
    throw err; // Do not swallow DB read errors as fallback to prevent data overwrite
  }
};

export const setAsyncItem = async (key: string, value: any): Promise<void> => {
  try {
    if (isMetadataKey(key)) {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      // Remove metadata from localforage to prevent stale overwrites
      localforage.removeItem(key).catch(() => {});
      return;
    }
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    await localforage.setItem(key, str);
    // Delete domain collection data from localStorage to free up space
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`Error setting async item ${key}:`, err);
    throw err;
  }
};

export const removeAsyncItem = async (key: string): Promise<void> => {
  try {
    await localforage.removeItem(key);
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`Error removing async item ${key}:`, err);
    throw err;
  }
};

export const getAllStorageData = async (): Promise<Record<string, string>> => {
  const data: Record<string, string> = {};
  
  // 1. Get all from localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      data[key] = localStorage.getItem(key) || '';
    }
  }

  // 2. Get all from localforage (prioritizing localStorage for metadata & cleaning up localforage metadata)
  try {
    const keys = await localforage.keys();
    for (const key of keys) {
      if (isMetadataKey(key)) {
        const val = await localforage.getItem<string>(key);
        if (val !== null && val !== undefined) {
          if (!(key in data)) {
            data[key] = val;
            localStorage.setItem(key, val);
          }
          await localforage.removeItem(key);
        }
      } else {
        const val = await localforage.getItem<string>(key);
        if (val !== null && val !== undefined) {
          data[key] = val;
        }
      }
    }
  } catch (err) {
    console.error('Error getting localforage keys/data in getAllStorageData:', err);
    throw err;
  }

  return data;
};

export const getStorageKeys = async (): Promise<string[]> => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  try {
    const lfKeys = await localforage.keys();
    for (const k of lfKeys) {
      if (!keys.includes(k)) keys.push(k);
    }
  } catch (err) {}
  return keys;
};

export const getStorageItem = async (key: string): Promise<string | null> => {
  try {
    const lf = await localforage.getItem<string>(key);
    if (lf !== null) return lf;
  } catch (err) {}
  return localStorage.getItem(key);
};
