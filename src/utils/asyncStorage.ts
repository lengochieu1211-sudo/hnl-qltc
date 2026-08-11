import localforage from 'localforage';

localforage.config({
  name: 'ConstructionAppDB',
  storeName: 'app_data'
});

export const getAsyncItem = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const val = await localforage.getItem<string>(key);
    if (val !== null) {
      return JSON.parse(val);
    }
    // Migration: try to get from localStorage if not in localforage yet
    const localVal = localStorage.getItem(key);
    if (localVal !== null) {
      const parsed = JSON.parse(localVal);
      await localforage.setItem(key, localVal); // migrate
      return parsed;
    }
    return fallback;
  } catch (err) {
    console.error(`Error reading async item ${key}:`, err);
    return fallback;
  }
};

export const setAsyncItem = async (key: string, value: any): Promise<void> => {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    await localforage.setItem(key, str);
    // Delete from localStorage to free up space
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`Error setting async item ${key}:`, err);
  }
};

export const removeAsyncItem = async (key: string): Promise<void> => {
  try {
    await localforage.removeItem(key);
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`Error removing async item ${key}:`, err);
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

  // 2. Get all from localforage
  try {
    const keys = await localforage.keys();
    for (const key of keys) {
      const val = await localforage.getItem<string>(key);
      if (val) {
        data[key] = val;
      }
    }
  } catch (err) {
    console.error('Error getting localforage keys:', err);
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
