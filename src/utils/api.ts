const API_BASE_STORAGE_KEY = 'qlct_api_base_url';

export function normalizeApiBaseUrl(url: string) {
  return (url || '').trim().replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const envUrl = normalizeApiBaseUrl((import.meta as any).env?.VITE_API_BASE_URL || '');
  if (envUrl) return envUrl;

  try {
    return normalizeApiBaseUrl(localStorage.getItem(API_BASE_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

export function setApiBaseUrl(url: string) {
  const normalized = normalizeApiBaseUrl(url);
  if (normalized) {
    localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
  }
  return normalized;
}

export function hasApiBackend() {
  return getApiBaseUrl() !== '' || window.location.protocol !== 'file:';
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function apiFetch(path: string, init?: RequestInit) {
  if (!hasApiBackend()) {
    throw new Error('Chua cau hinh dia chi backend Google. Vao tab Cau Hinh va nhap URL server dang chay server.ts.');
  }

  return fetch(apiUrl(path), init);
}

export function openExternalUrl(url: string) {
  const androidBridge = (window as any).AndroidExport;
  if (typeof androidBridge?.openExternalUrl === 'function') {
    androidBridge.openExternalUrl(url);
    return true;
  }

  return false;
}
