const DEVICE_ID_KEY = 'qlct_device_id_v1';
const DEVICE_NAME_KEY = 'qlct_device_name_v1';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch (_) {
    return 'device_unknown';
  }
}

export function getDeviceName(): string {
  if (typeof window === 'undefined') return 'Server';
  try {
    const custom = localStorage.getItem(DEVICE_NAME_KEY);
    if (custom) return custom;
  } catch (_) {}

  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Điện thoại Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Thiết bị iOS';
  if (/Windows/i.test(ua)) return 'Máy tính Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Máy tính Mac';
  return 'Thiết bị web';
}

export function setDeviceName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = name.trim().slice(0, 80);
    if (clean) localStorage.setItem(DEVICE_NAME_KEY, clean);
    else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch (_) {}
}
