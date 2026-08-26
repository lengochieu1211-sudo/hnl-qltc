import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import { cachePhotoBlob, getPhotoBlob, type PhotoAttachment } from '../utils/photoStorage';
import { LEGACY_DRIVE_READ_FALLBACK, LEGACY_DRIVE_WRITE_ENABLED } from '../config/runtimeArchitecture';

export const PRIMARY_DRIVE_OWNER_EMAIL = 'lengochieu1211@gmail.com';
export const PRIMARY_DRIVE_CONFIG_PATH = 'app_config/drive_primary';

export interface PrimaryDriveConfig {
  enabled: boolean;
  ownerEmail: string;
  webAppUrl: string;
  updatedAt?: number;
  updatedByUid?: string;
  updatedByEmail?: string;
}

export interface PrimaryDriveUploadResult {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  folderPath?: string;
  ownerEmail?: string;
  modifiedTime?: string;
  contentHash?: string;
  reused?: boolean;
}


export interface PrimaryDriveInventoryFile {
  fileId: string;
  fileName?: string;
  fileSize?: number;
  modifiedTime?: string;
  photoId?: string;
  floorPlanId?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
}

export interface PrimaryDriveProjectInventory {
  projectId: string;
  projectName?: string;
  folderId?: string;
  folderName?: string;
  folderCandidates?: Array<{ id: string; name: string }>;
  photos: PrimaryDriveInventoryFile[];
  floorPlans: PrimaryDriveInventoryFile[];
}

export interface PrimaryDriveQuota {
  ownerEmail: string;
  displayName?: string;
  usageBytes: number;
  limitBytes: number;
  usageInDriveBytes?: number;
  trashBytes?: number;
}

let cachedConfig: PrimaryDriveConfig | null | undefined;
let cachedAt = 0;
const CONFIG_CACHE_MS = 60_000;

function normalizeBridgeUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/i.test(trimmed)) {
    throw new Error('URL Apps Script không hợp lệ. URL phải có dạng https://script.google.com/macros/s/.../exec');
  }
  return trimmed;
}

function configRef() {
  return doc(db, 'app_config', 'drive_primary');
}

export async function getPrimaryDriveConfig(force = false): Promise<PrimaryDriveConfig | null> {
  if (!force && cachedConfig !== undefined && Date.now() - cachedAt < CONFIG_CACHE_MS) return cachedConfig;
  try {
    const snap = await getDoc(configRef());
    cachedAt = Date.now();
    if (!snap.exists()) {
      cachedConfig = null;
      return null;
    }
    const data = snap.data() as any;
    cachedConfig = {
      enabled: data.enabled !== false,
      ownerEmail: String(data.ownerEmail || PRIMARY_DRIVE_OWNER_EMAIL).toLowerCase(),
      webAppUrl: String(data.webAppUrl || '').trim(),
      updatedAt: Number(data.updatedAt || 0),
      updatedByUid: data.updatedByUid || '',
      updatedByEmail: data.updatedByEmail || '',
    };
    return cachedConfig;
  } catch (err) {
    console.warn('[Primary Drive] config read warning:', err);
    return cachedConfig || null;
  }
}

export function subscribePrimaryDriveConfig(onChange: (config: PrimaryDriveConfig | null) => void): () => void {
  return onSnapshot(configRef(), (snap) => {
    cachedAt = Date.now();
    if (!snap.exists()) {
      cachedConfig = null;
      onChange(null);
      return;
    }
    const data = snap.data() as any;
    cachedConfig = {
      enabled: data.enabled !== false,
      ownerEmail: String(data.ownerEmail || PRIMARY_DRIVE_OWNER_EMAIL).toLowerCase(),
      webAppUrl: String(data.webAppUrl || '').trim(),
      updatedAt: Number(data.updatedAt || 0),
      updatedByUid: data.updatedByUid || '',
      updatedByEmail: data.updatedByEmail || '',
    };
    onChange(cachedConfig);
  }, (err) => {
    console.warn('[Primary Drive] config listener warning:', err);
    onChange(cachedConfig || null);
  });
}

export async function savePrimaryDriveConfig(webAppUrl: string, enabled = true): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user || user.isAnonymous) throw new Error('Bạn phải đăng nhập Google để cấu hình Drive chính.');
  if (email !== PRIMARY_DRIVE_OWNER_EMAIL) {
    throw new Error(`Chỉ tài khoản Drive chính ${PRIMARY_DRIVE_OWNER_EMAIL} được thay đổi cấu hình này.`);
  }
  const normalizedUrl = normalizeBridgeUrl(webAppUrl);
  if (!normalizedUrl) throw new Error('Chưa nhập URL Web App của Apps Script.');
  const payload: PrimaryDriveConfig = {
    enabled,
    ownerEmail: PRIMARY_DRIVE_OWNER_EMAIL,
    webAppUrl: normalizedUrl,
    updatedAt: Date.now(),
    updatedByUid: user.uid,
    updatedByEmail: email,
  };
  await setDoc(configRef(), payload, { merge: true });
  cachedConfig = payload;
  cachedAt = Date.now();
}

export async function setPrimaryDriveEnabled(enabled: boolean): Promise<void> {
  const config = await getPrimaryDriveConfig(true);
  if (!config?.webAppUrl) throw new Error('Chưa cấu hình URL Apps Script cho Drive chính.');
  await savePrimaryDriveConfig(config.webAppUrl, enabled);
}

export async function isPrimaryDriveReady(): Promise<boolean> {
  const config = await getPrimaryDriveConfig();
  return Boolean(config?.enabled && config.webAppUrl);
}

function allowedMessageOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && (
      url.hostname === 'script.google.com' ||
      url.hostname.endsWith('.googleusercontent.com') ||
      url.hostname === 'googleusercontent.com'
    );
  } catch (_) {
    return false;
  }
}

async function callBridge<T = any>(action: string, payload: Record<string, any>, timeoutMs = 90_000): Promise<T> {
  const config = await getPrimaryDriveConfig();
  if (!config?.enabled || !config.webAppUrl) throw new Error('Drive chính chưa được cấu hình.');
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('Bạn phải đăng nhập Google để dùng Drive chính.');
  const idToken = await user.getIdToken();

  return new Promise<T>((resolve, reject) => {
    const requestId = `anphu_drive_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement('iframe');
    const frameName = `anphu_drive_frame_${Math.random().toString(36).slice(2)}`;
    iframe.name = frameName;
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = config.webAppUrl;
    form.target = frameName;
    form.enctype = 'application/x-www-form-urlencoded';
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const addField = (name: string, value: string) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };
    addField('action', action);
    addField('requestId', requestId);
    addField('idToken', idToken);
    addField('payload', JSON.stringify(payload || {}));

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      iframe.remove();
      form.remove();
    };
    const finishError = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => finishError('Drive chính phản hồi quá lâu. Hãy kiểm tra mạng hoặc Apps Script.'), timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (!allowedMessageOrigin(event.origin)) return;
      const data = event.data;
      if (!data || data.channel !== 'ANPHU_PRIMARY_DRIVE' || data.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      if (data.ok) resolve(data.result as T);
      else reject(new Error(data.error || 'Google Drive trả về lỗi không xác định.'));
    };

    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    try {
      form.submit();
    } catch (err: any) {
      window.clearTimeout(timer);
      finishError(err?.message || String(err));
    }
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'image/jpeg' });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) return null;
  try {
    return base64ToBlob(match[2] || '', match[1] || 'image/jpeg');
  } catch (_) {
    return null;
  }
}

async function imageSourceToBlob(source: string): Promise<Blob | null> {
  const value = String(source || '').trim();
  if (!value) return null;
  if (value.startsWith('data:image/')) return dataUrlToBlob(value);
  if (value.startsWith('blob:') || /^https?:\/\//i.test(value)) {
    try {
      const response = await fetch(value);
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size > 0 ? blob : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

export async function uploadFloorPlanToPrimaryDrive(
  projectId: string,
  plan: { id: string; floorName?: string; imageUrl: string; imageRevision?: number; updatedAt?: number },
): Promise<PrimaryDriveUploadResult | null> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return null;
  if (!projectId || !plan?.id || !plan.imageUrl) return null;
  if (!(await isPrimaryDriveReady())) return null;
  const blob = await imageSourceToBlob(plan.imageUrl);
  if (!blob || blob.size <= 0) throw new Error('Không đọc được dữ liệu ảnh mặt bằng trên thiết bị.');
  const base64 = await blobToBase64(blob);
  return callBridge<PrimaryDriveUploadResult>('uploadFloorPlan', {
    projectId,
    floorPlanId: plan.id,
    floorName: plan.floorName || plan.id,
    mimeType: blob.type || 'image/jpeg',
    updatedAt: Number(plan.imageRevision || plan.updatedAt || Date.now()),
    base64,
  }, 120_000);
}

export async function cleanupFloorPlanVersionsOnPrimaryDrive(
  projectId: string,
  floorPlanId: string,
  keepFileId: string,
  committedRevision: number,
): Promise<{ cleaned?: number; skipped?: boolean; reason?: string }> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return { skipped: true, reason: 'legacy-drive-write-disabled' };
  if (!projectId || !floorPlanId || !keepFileId) return { skipped: true, reason: 'missing-id' };
  if (!(await isPrimaryDriveReady())) return { skipped: true, reason: 'drive-not-ready' };
  return callBridge('cleanupFloorPlanVersions', {
    projectId,
    floorPlanId,
    keepFileId,
    committedRevision: Number(committedRevision || 0),
  });
}

export async function downloadFloorPlanFromPrimaryDrive(
  projectId: string,
  floorPlanId: string,
  fileId: string,
  mimeType = 'image/jpeg',
): Promise<Blob | null> {
  if (!LEGACY_DRIVE_READ_FALLBACK) return null;
  if (!projectId || !floorPlanId || !fileId) return null;
  if (!(await isPrimaryDriveReady())) return null;
  const result = await callBridge<{ base64: string; mimeType?: string; fileSize?: number }>('downloadFloorPlan', {
    projectId,
    floorPlanId,
    fileId,
  }, 120_000);
  if (!result?.base64) return null;
  const blob = base64ToBlob(result.base64, result.mimeType || mimeType);
  return blob.size > 0 ? blob : null;
}

export async function deleteFloorPlanFromPrimaryDrive(projectId: string, floorPlanId: string, fileId: string): Promise<void> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return;
  if (!projectId || !floorPlanId || !fileId) return;
  if (!(await isPrimaryDriveReady())) return;
  await callBridge('deleteFloorPlan', { projectId, floorPlanId, fileId });
}

export async function uploadPhotoToPrimaryDrive(projectId: string, photo: PhotoAttachment): Promise<PrimaryDriveUploadResult | null> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return null;
  if (!projectId || !photo?.id || photo.deleted) return null;
  if (!(await isPrimaryDriveReady())) return null;
  const blob = await getPhotoBlob(photo.id, false);
  if (!blob || blob.size <= 0) throw new Error('Không tìm thấy dữ liệu ảnh trên thiết bị để tải lên Drive chính.');
  const base64 = await blobToBase64(blob);
  return callBridge<PrimaryDriveUploadResult>('uploadPhoto', {
    projectId,
    photoId: photo.id,
    entityType: photo.entityType,
    entityId: photo.entityId,
    category: photo.category || '',
    teamId: photo.teamId || '',
    floorId: photo.floorId || '',
    roomId: photo.roomId || '',
    originalFileName: photo.fileName || `${photo.id}.jpg`,
    mimeType: blob.type || photo.mimeType || 'image/jpeg',
    createdAt: Number(photo.createdAt || photo.updatedAt || Date.now()),
    updatedAt: Number(photo.updatedAt || photo.createdAt || Date.now()),
    base64,
  }, 120_000);
}

export async function cleanupPhotoVersionsOnPrimaryDrive(
  projectId: string,
  photoId: string,
  keepFileId: string,
  committedUpdatedAt: number,
): Promise<{ cleaned?: number; skipped?: boolean; reason?: string }> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return { skipped: true, reason: 'legacy-drive-write-disabled' };
  if (!projectId || !photoId || !keepFileId) return { skipped: true, reason: 'missing-id' };
  if (!(await isPrimaryDriveReady())) return { skipped: true, reason: 'drive-not-ready' };
  return callBridge('cleanupPhotoVersions', {
    projectId,
    photoId,
    keepFileId,
    committedUpdatedAt: Number(committedUpdatedAt || 0),
  });
}

export async function downloadPhotoFromPrimaryDrive(projectId: string, photoId: string, fileId: string, mimeType = 'image/jpeg'): Promise<Blob | null> {
  if (!LEGACY_DRIVE_READ_FALLBACK) return null;
  if (!projectId || !photoId || !fileId) return null;
  if (!(await isPrimaryDriveReady())) return null;
  const result = await callBridge<{ base64: string; mimeType?: string; fileSize?: number }>('downloadPhoto', {
    projectId,
    photoId,
    fileId,
  }, 120_000);
  if (!result?.base64) return null;
  const blob = base64ToBlob(result.base64, result.mimeType || mimeType);
  if (blob.size <= 0) return null;
  await cachePhotoBlob(photoId, blob, true);
  return blob;
}

export async function deletePhotoFromPrimaryDrive(projectId: string, photoId: string, fileId: string): Promise<void> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) return;
  if (!projectId || !photoId || !fileId) return;
  if (!(await isPrimaryDriveReady())) return;
  await callBridge('deletePhoto', { projectId, photoId, fileId });
}


export async function uploadProjectBackupToPrimaryDrive(
  projectId: string,
  backupData: Record<string, any>,
  kind: 'auto' | 'manual' = 'auto',
): Promise<{ fileId: string; fileName: string; fileSize?: number; ownerEmail?: string }> {
  if (!LEGACY_DRIVE_WRITE_ENABLED) throw new Error('Drive write đã tắt trong Firebase-only runtime; chỉ dùng migration có chủ đích.');
  if (!projectId) throw new Error('Chưa chọn dự án.');
  if (!(await isPrimaryDriveReady())) throw new Error('Drive chính chưa được cấu hình.');
  return callBridge('uploadBackup', {
    projectId,
    kind,
    backupData,
    generatedAt: Date.now(),
  }, 120_000);
}

export async function getPrimaryDriveProjectInventory(projectId: string): Promise<PrimaryDriveProjectInventory> {
  if (!projectId) throw new Error('Chưa chọn dự án.');
  return callBridge<PrimaryDriveProjectInventory>('inventoryProject', { projectId }, 90_000);
}

export async function getPrimaryDriveQuota(projectId: string): Promise<PrimaryDriveQuota> {
  if (!projectId) throw new Error('Chưa chọn dự án.');
  return callBridge<PrimaryDriveQuota>('quota', { projectId }, 45_000);
}

export async function testPrimaryDriveConnection(projectId: string): Promise<{ ownerEmail: string; message?: string }> {
  if (!projectId) throw new Error('Chưa chọn dự án.');
  return callBridge('ping', { projectId }, 30_000);
}
