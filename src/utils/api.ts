const API_BASE_STORAGE_KEY = 'qlct_api_base_url';

function envValue(name: string) {
  return ((import.meta as any).env?.[name] || '').trim();
}

export function normalizeApiBaseUrl(url: string) {
  return (url || '').trim().replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const envUrl = normalizeApiBaseUrl(envValue('VITE_API_BASE_URL'));
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

function isLocalExpressDevServer() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (host === 'localhost' || host === '127.0.0.1' || host === '::1') && window.location.port === '3000';
}

export function hasApiBackend() {
  if (getApiBaseUrl() !== '') return true;
  if (envValue('VITE_ENABLE_SERVER_API') === 'true') return true;
  return isLocalExpressDevServer();
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function apiFetch(path: string, init?: RequestInit) {
  if (!hasApiBackend()) {
    throw new Error('Tinh nang Google Drive/Sheets can backend server. Firebase Hosting mien phi dang chay static-only nen tinh nang nay duoc tat de tranh loi va tranh phat sinh chi phi.');
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
