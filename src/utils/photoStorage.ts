import localforage from 'localforage';
import { getAsyncItem, setAsyncItem, removeAsyncItem } from './asyncStorage';
import { compressImage, compressImageToBlob } from './imageCompressor';
import { getImageQualityProfile } from './imageQualitySettings';
import { apiUrl, hasApiBackend } from './api';
import { FIREBASE_ONLY_RUNTIME, LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED, LEGACY_LOCAL_IMPORT_ENABLED } from '../config/runtimeArchitecture';

export interface PhotoAttachment {
  id: string; // UUID photo ID
  projectId: string;
  entityType: 'crewRecord' | 'defect' | 'chat';
  entityId: string;
  teamId?: string;
  floorId?: string;
  roomId?: string;
  category?: 'crew_progress' | 'defect_before' | 'defect_after' | 'chat_attachment' | 'chat_attachment';
  fileName: string;
  mimeType: string;
  localBlobKey?: string;
  localUri?: string;
  base64?: string;
  dataUrl?: string;
  cloudFileId?: string;
  cloudUrl?: string;
  storageProvider?: 'firebase-storage' | 'google-drive-primary' | 'firestore-fallback' | string;
  storagePath?: string;
  thumbnailPath?: string;
  storageMd5Hash?: string;
  storageGeneration?: string;
  driveOwnerEmail?: string;
  driveFolderPath?: string;
  chunkCount?: number;
  width?: number;
  height?: number;
  fileSize?: number;
  caption?: string;
  takenAt?: number;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  updatedByUid?: string;
  revision?: number;
  deleted?: boolean;
  deletedAt?: number | null;
  deletedByUid?: string | null;
  deletedBy?: string | null;
}

const getPhotoListKey = (projectId: string) => `construction_photos_${projectId}`;
const getPhotoBlobKey = (photoId: string) => `photo_blob_${photoId}`;
const getPhotoThumbKey = (photoId: string) => `photo_thumb_${photoId}`;
const getPhotoPendingMetaKey = (photoId: string) => `photo_pending_meta_${photoId}`;

const projectPhotoListMemoryCache = new Map<string, PhotoAttachment[]>();


const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh.'));
  reader.readAsDataURL(blob);
});

function dataURItoBlob(dataURI: string): Blob {
  try {
    const parts = dataURI.split(',');
    const byteString = atob(parts[1] || parts[0]);
    const mimeString = parts[0]?.split(':')[1]?.split(';')[0] || 'image/jpeg';
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  } catch (err) {
    return new Blob([], { type: 'image/jpeg' });
  }
}

export function generatePhotoUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `photo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

async function getPendingPhotoMetadata(projectId: string): Promise<PhotoAttachment[]> {
  if (!projectId) return [];
  try {
    const keys = await localforage.keys();
    const pending: PhotoAttachment[] = [];
    for (const key of keys) {
      if (!key.startsWith('photo_pending_meta_')) continue;
      const item = await localforage.getItem<PhotoAttachment>(key);
      if (item?.id && item.projectId === projectId) pending.push(item);
    }
    return pending;
  } catch (_) {
    return [];
  }
}

async function savePendingPhotoMetadata(photo: PhotoAttachment): Promise<void> {
  if (!photo?.id || !photo?.projectId) return;
  const clean: PhotoAttachment = { ...photo, localUri: '', base64: undefined, dataUrl: undefined };
  await localforage.setItem(getPhotoPendingMetaKey(photo.id), clean);
}

export async function clearPendingPhotoMetadata(photoId: string): Promise<void> {
  if (!photoId) return;
  await localforage.removeItem(getPhotoPendingMetaKey(photoId)).catch(() => {});
}

export async function getProjectPhotos(projectId: string, includeDeleted = false): Promise<PhotoAttachment[]> {
  if (!projectId) return [];
  try {
    let list = projectPhotoListMemoryCache.get(projectId);
    if (!list) {
      // Firebase-only keeps synchronized metadata in Firestore. The old project photo
      // list is read only during the migration window; new pending media uses a small
      // dedicated outbox record next to its local Blob, not a second business database.
      const legacy = FIREBASE_ONLY_RUNTIME && !LEGACY_LOCAL_IMPORT_ENABLED
        ? []
        : await getAsyncItem<PhotoAttachment[]>(getPhotoListKey(projectId), []);
      const pending = FIREBASE_ONLY_RUNTIME ? await getPendingPhotoMetadata(projectId) : [];
      const merged = new Map<string, PhotoAttachment>();
      for (const item of Array.isArray(legacy) ? legacy : []) if (item?.id) merged.set(item.id, item);
      for (const item of pending) {
        const previous = merged.get(item.id);
        if (!previous || Number(item.updatedAt || 0) >= Number(previous.updatedAt || 0)) merged.set(item.id, item);
      }
      list = Array.from(merged.values());
      projectPhotoListMemoryCache.set(projectId, list);
    }
    if (includeDeleted) return list.slice();
    return list.filter(p => !p.deleted && !p.deletedAt);
  } catch (err) {
    console.error('Error reading project photos:', err);
    return [];
  }
}

export async function saveProjectPhotos(projectId: string, photos: PhotoAttachment[]): Promise<void> {
  if (!projectId) return;
  const cleanPhotos = photos.map(p => {
    if (p.localUri && p.localUri.startsWith('data:image/')) return { ...p, localUri: '' };
    return p;
  });
  projectPhotoListMemoryCache.set(projectId, cleanPhotos);
  if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED) {
    await setAsyncItem(getPhotoListKey(projectId), cleanPhotos);
  }
}

export async function getEntityPhotos(
  projectId: string,
  entityType: 'crewRecord' | 'defect' | 'chat',
  entityId: string,
  category?: 'crew_progress' | 'defect_before' | 'defect_after' | 'chat_attachment'
): Promise<PhotoAttachment[]> {
  const photos = await getProjectPhotos(projectId);
  return photos.filter(p => p.entityType === entityType && p.entityId === entityId && (!category || p.category === category));
}

export async function savePhotoAttachment(
  photo: Omit<PhotoAttachment, 'id' | 'createdAt' | 'updatedAt'>,
  imageSource: File | Blob | string
): Promise<PhotoAttachment> {
  const photoId = generatePhotoUUID();
  
  // 1. Compress camera/gallery input directly to a Blob. Never create a large
  // Base64 copy of the main photo before storing it; this is critical on Android.
  const photoKind = photo.entityType === 'defect' ? 'defect' : 'crew';
  const profile = getImageQualityProfile(photoKind);
  const mainBlob = await compressImageToBlob(imageSource, profile.maxDimension, profile.quality);
  if (!mainBlob || mainBlob.size <= 0) {
    throw new Error('Không đọc được ảnh đã chọn/chụp. Hãy dùng ảnh JPG, PNG hoặc WebP và thử lại.');
  }

  // 2. Build a tiny 320px thumbnail from the already-compressed Blob. This keeps
  // the immediate React preview small instead of holding a full-resolution data URL.
  let thumbBlob: Blob | null = null;
  let thumbDataUrl = '';
  try {
    thumbBlob = await compressImageToBlob(mainBlob, 320, 0.70);
    if (thumbBlob) thumbDataUrl = await blobToDataUrl(thumbBlob);
  } catch (_) {}

  const now = Date.now();

  // Save metadata WITHOUT large base64 data string
  const newPhotoMetadata: PhotoAttachment = {
    ...photo,
    id: photoId,
    createdAt: now,
    updatedAt: now,
    localBlobKey: getPhotoBlobKey(photoId),
    localUri: '', // Clean metadata
    fileSize: mainBlob.size,
    deleted: false
  };

  // Save binary blobs to localforage (IndexedDB)
  try {
    await localforage.setItem(getPhotoBlobKey(photoId), mainBlob);
    if (thumbBlob) {
      await localforage.setItem(getPhotoThumbKey(photoId), thumbBlob);
    }
  } catch (err) {
    console.warn('Could not store photo blob in localforage:', err);
    // Fallback to data URL if Blob storage fails
    try {
      await localforage.setItem(getPhotoBlobKey(photoId), mainBlob);
    } catch (_) {}
  }

  // Add photo metadata to list
  const existing = await getProjectPhotos(photo.projectId, true);
  const updatedList = [newPhotoMetadata, ...existing.filter(p => p.id !== photoId)];
  await saveProjectPhotos(photo.projectId, updatedList);
  if (FIREBASE_ONLY_RUNTIME) {
    await savePendingPhotoMetadata(newPhotoMetadata);
    // setDoc uses Firestore's official offline queue when the authenticated user is
    // offline. The binary itself remains in the media outbox until Storage succeeds.
    import('../lib/photoCloudSync').then(({ stagePhotoMetadataForCloud }) =>
      stagePhotoMetadataForCloud(photo.projectId, newPhotoMetadata).catch((err) =>
        console.warn('[Photo outbox] metadata will retry after auth/network recovery:', err)
      )
    ).catch(() => {});
  }

  // Return only the tiny thumbnail for immediate rendering. The full image stays as a Blob in IndexedDB.
  return { ...newPhotoMetadata, localUri: thumbDataUrl };
}


export async function getPhotoBlob(photoId: string, useThumbnail = false): Promise<Blob | null> {
  if (!photoId) return null;
  try {
    const key = useThumbnail ? getPhotoThumbKey(photoId) : getPhotoBlobKey(photoId);
    const val = await localforage.getItem<Blob | string>(key);
    if (val instanceof Blob) return val;
    if (typeof val === 'string' && val.startsWith('data:image/')) return dataURItoBlob(val);
  } catch (_) {}
  return null;
}

export async function cachePhotoBlob(photoId: string, blob: Blob, createThumbnail = true): Promise<void> {
  if (!photoId || !blob) return;
  await localforage.setItem(getPhotoBlobKey(photoId), blob);
  if (!createThumbnail) return;
  try {
    const thumbBlob = await compressImageToBlob(blob, 320, 0.70);
    if (thumbBlob) await localforage.setItem(getPhotoThumbKey(photoId), thumbBlob);
  } catch (_) {}
}

export async function mergeCloudPhotoMetadata(projectId: string, cloudPhotos: PhotoAttachment[], changedPhotos: PhotoAttachment[] = cloudPhotos): Promise<void> {
  if (!projectId || !Array.isArray(cloudPhotos)) return;
  const localPhotos = await getProjectPhotos(projectId, true);
  const localMap = new Map(localPhotos.filter(p => p?.id).map(p => [p.id, p]));
  const merged = new Map<string, PhotoAttachment>();

  for (const local of localPhotos) {
    if (local?.id) merged.set(local.id, local);
  }

  for (const cloud of cloudPhotos) {
    if (!cloud?.id) continue;
    const local = localMap.get(cloud.id);
    const localTime = Number(local?.updatedAt || local?.createdAt || 0);
    const cloudTime = Number(cloud.updatedAt || cloud.createdAt || 0);
    const cloudStorageChanged = Boolean(local && cloudTime === localTime && (
      String((cloud as any).cloudFileId || '') !== String((local as any).cloudFileId || '') ||
      String((cloud as any).cloudUrl || '') !== String((local as any).cloudUrl || '') ||
      String((cloud as any).storageProvider || '') !== String((local as any).storageProvider || '') ||
      Number((cloud as any).chunkCount || 0) !== Number((local as any).chunkCount || 0)
    ));
    if (!local || cloudTime > localTime || cloudStorageChanged || (cloudTime === localTime && cloud.deleted && !local.deleted)) {
      const cleanCloud: PhotoAttachment = {
        ...local,
        ...cloud,
        projectId,
        localBlobKey: getPhotoBlobKey(cloud.id),
        localUri: '',
        cloudFileId: cloud.cloudFileId || `firestore:${projectId}:${cloud.id}`,
        base64: undefined,
        dataUrl: undefined,
      };
      merged.set(cloud.id, cleanCloud);
      if (cloud.deleted || cloud.deletedAt) {
        await localforage.removeItem(getPhotoBlobKey(cloud.id)).catch(() => {});
        await localforage.removeItem(getPhotoThumbKey(cloud.id)).catch(() => {});
      }
      const pending = await localforage.getItem<PhotoAttachment>(getPhotoPendingMetaKey(cloud.id)).catch(() => null);
      const serverAcknowledged = !(cloud as any).__pendingWrite;
      if (serverAcknowledged && pending && cloudTime >= Number(pending.updatedAt || pending.createdAt || 0) && (cloud.deleted || cloud.deletedAt || cloud.storagePath || cloud.storageProvider === 'firebase-storage')) {
        await clearPendingPhotoMetadata(cloud.id);
      }
    }
  }

  await saveProjectPhotos(projectId, Array.from(merged.values()));
  if (typeof window !== 'undefined') {
    const entities = (changedPhotos || []).filter((p) => p?.entityId && p?.entityType).map((p) => ({
      entityType: p.entityType,
      entityId: p.entityId,
      category: p.category,
    }));
    window.dispatchEvent(new CustomEvent('qlct-photo-attachments-changed', {
      detail: { source: 'cloud', projectId, entities }
    }));
  }
}

export async function getPhotoDataUrl(photoId: string, fallbackDataUrl?: string, useThumbnail = false): Promise<string> {
  if (!photoId) return fallbackDataUrl || '';
  try {
    if (useThumbnail) {
      const thumbVal = await localforage.getItem<Blob | string>(getPhotoThumbKey(photoId));
      if (thumbVal) {
        if (thumbVal instanceof Blob) {
          return URL.createObjectURL(thumbVal);
        }
        if (typeof thumbVal === 'string' && thumbVal.length > 0) {
          return thumbVal;
        }
      }
    }
    const val = await localforage.getItem<Blob | string>(getPhotoBlobKey(photoId));
    if (val) {
      if (val instanceof Blob) {
        return URL.createObjectURL(val);
      }
      if (typeof val === 'string' && val.length > 0) {
        return val;
      }
    }

    // Cloud photo binaries (primary Drive or legacy Firestore chunks) are downloaded
    // lazily only when this image is actually displayed. The projectId is embedded
    // in the opaque cloud reference: provider:projectId:fileId/photoId.
    if (fallbackDataUrl && (fallbackDataUrl.startsWith('firestore:') || fallbackDataUrl.startsWith('drive:'))) {
      try {
        const parts = fallbackDataUrl.split(':');
        const projectId = parts[1] || '';
        const cloudPhotoId = fallbackDataUrl.startsWith('firestore:') ? (parts[2] || photoId) : photoId;
        const { downloadPhotoBlobFromCloud } = await import('../lib/photoCloudSync');
        const cloudBlob = await downloadPhotoBlobFromCloud(projectId, cloudPhotoId || photoId);
        if (cloudBlob) {
          if (useThumbnail) {
            const thumbVal = await localforage.getItem<Blob | string>(getPhotoThumbKey(photoId));
            if (thumbVal instanceof Blob) return URL.createObjectURL(thumbVal);
          }
          return URL.createObjectURL(cloudBlob);
        }
      } catch (_) {}
      return '';
    }

    // Lazy load & cache from remote cloudUrl or fallback link if missing in IndexedDB
    const targetUrl = fallbackDataUrl;
    const isApiUrl = Boolean(targetUrl?.startsWith('/api/'));
    const canFetchTarget = Boolean(targetUrl && (
      targetUrl.startsWith('http://') ||
      targetUrl.startsWith('https://') ||
      (isApiUrl && hasApiBackend())
    ));

    if (targetUrl && canFetchTarget) {
      const resolvedTargetUrl = isApiUrl ? apiUrl(targetUrl) : targetUrl;
      fetch(resolvedTargetUrl)
        .then(res => res.blob())
        .then(async (blob) => {
          if (blob && blob.size > 0) {
            await localforage.setItem(getPhotoBlobKey(photoId), blob);
            try {
              const reader = new FileReader();
              reader.onloadend = async () => {
                const dataUrl = reader.result as string;
                const thumbData = await compressImage(dataUrl, 320, 0.70);
                await localforage.setItem(getPhotoThumbKey(photoId), dataURItoBlob(thumbData));
              };
              reader.readAsDataURL(blob);
            } catch (_) {}
          }
        })
        .catch(() => {});
      return resolvedTargetUrl;
    }

    if (isApiUrl && !hasApiBackend()) {
      return '';
    }
  } catch (_) {}
  return fallbackDataUrl || '';
}

export async function getPhotoBase64(photoId: string): Promise<string> {
  if (!photoId) return '';
  try {
    const val = await localforage.getItem<Blob | string>(getPhotoBlobKey(photoId));
    if (val) {
      if (typeof val === 'string' && val.startsWith('data:image/')) {
        return val;
      }
      if (val instanceof Blob) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string) || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(val);
        });
      }
    }
  } catch (_) {}
  return '';
}

export async function getProjectPhotosWithBinary(projectId: string, requireBinary = false): Promise<PhotoAttachment[]> {
  const photos = await getProjectPhotos(projectId, false);

  // A backup must be self-contained. On a second phone/PC the photo metadata may
  // already be synchronized while the binary is still only on Firestore. Fetch
  // missing binaries lazily before building JSON so autosave/export never silently
  // produces a lightweight backup that cannot restore defect/crew photos.
  const results: PhotoAttachment[] = [];
  for (const p of photos) {
    let base64 = await getPhotoBase64(p.id);

    if (!base64 && (p.storagePath || p.storageProvider === 'firebase-storage' || p.cloudFileId?.startsWith('storage:') || p.cloudUrl?.startsWith('storage:') || p.cloudFileId?.startsWith('firestore:') || p.cloudUrl?.startsWith('firestore:') || p.cloudFileId?.startsWith('drive:') || p.cloudUrl?.startsWith('drive:'))) {
      try {
        const { downloadPhotoBlobFromCloud } = await import('../lib/photoCloudSync');
        const cloudBlob = await downloadPhotoBlobFromCloud(projectId, p.id, p.mimeType || 'image/jpeg');
        if (cloudBlob) {
          base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(cloudBlob);
          });
        }
      } catch (err) {
        console.warn('[Backup] Could not download cloud photo binary:', p.id, err);
      }
    }

    if (requireBinary && !String(base64 || '').startsWith('data:image/')) {
      throw new Error(`Không lấy được binary ảnh ${p.id} của dự án ${projectId}; từ chối tạo backup không đầy đủ.`);
    }

    results.push({
      ...p,
      localUri: base64 || '',
      base64: base64 || undefined,
    });
  }
  return results;
}

export async function restorePhotosFromBackup(
  projectId: string,
  photos: PhotoAttachment[],
  photoDataMap?: Record<string, string>
): Promise<{ restoredCount: number; missingCount: number }> {
  if (!projectId || !Array.isArray(photos)) return { restoredCount: 0, missingCount: 0 };
  let restoredCount = 0;
  let missingCount = 0;

  for (const photo of photos) {
    if (!photo.id) continue;
    const imgData = (photoDataMap && photoDataMap[photo.id]) || photo.base64 || photo.localUri || photo.dataUrl;
    if (imgData && imgData.startsWith('data:image/')) {
      try {
        const blob = dataURItoBlob(imgData);
        await localforage.setItem(getPhotoBlobKey(photo.id), blob);
        try {
          const thumbDataUrl = await compressImage(imgData, 320, 0.70);
          const thumbBlob = dataURItoBlob(thumbDataUrl);
          await localforage.setItem(getPhotoThumbKey(photo.id), thumbBlob);
        } catch (_) {}
        restoredCount++;
      } catch (e) {
        console.warn('Error restoring photo blob to localforage:', e);
        missingCount++;
      }
    } else if (photo.cloudUrl || photo.cloudFileId) {
      // Remote cloud reference exists
      restoredCount++;
    } else {
      missingCount++;
    }
  }
  const cleanPhotos = photos.map(p => {
    const copy = { ...p };
    delete copy.localUri;
    delete copy.base64;
    delete (copy as any).dataUrl;
    return copy;
  });
  const existing = await getProjectPhotos(projectId, true);
  const existingMap = new Map(existing.map(e => [e.id, e]));
  for (const cp of cleanPhotos) {
    existingMap.set(cp.id, cp);
    if (FIREBASE_ONLY_RUNTIME) await savePendingPhotoMetadata({ ...cp, projectId });
  }
  await saveProjectPhotos(projectId, Array.from(existingMap.values()));
  return { restoredCount, missingCount };
}

export async function deletePhotoAttachment(projectId: string, photoId: string): Promise<void> {
  const photos = await getProjectPhotos(projectId, true);
  const now = Date.now();
  const updated = photos.map(p => {
    if (p.id === photoId) {
      return { ...p, deleted: true, deletedAt: now, updatedAt: now, revision: Math.max(Number(p.revision || 0) + 1, 1) };
    }
    return p;
  });
  await saveProjectPhotos(projectId, updated);
  const tombstone = updated.find((p) => p.id === photoId);
  if (FIREBASE_ONLY_RUNTIME && tombstone) {
    await savePendingPhotoMetadata(tombstone);
    import('../lib/photoCloudSync').then(({ stagePhotoMetadataForCloud }) =>
      stagePhotoMetadataForCloud(projectId, tombstone).catch(() => {})
    ).catch(() => {});
  }
  try {
    await localforage.removeItem(getPhotoBlobKey(photoId));
    await localforage.removeItem(getPhotoThumbKey(photoId));
  } catch (_) {}
}

export async function updatePhotoAttachmentBlob(
  projectId: string,
  photoId: string,
  imageSource: File | Blob | string
): Promise<string> {
  const existingPhotos = await getProjectPhotos(projectId, true);
  const existingPhoto = existingPhotos.find((p) => p.id === photoId);
  const photoKind = existingPhoto?.entityType === 'defect' ? 'defect' : 'crew';
  const profile = getImageQualityProfile(photoKind);
  const mainBlob = await compressImageToBlob(imageSource, profile.maxDimension, profile.quality);
  if (!mainBlob || mainBlob.size <= 0) throw new Error('Không đọc được ảnh chỉnh sửa.');

  let thumbBlob: Blob | null = null;
  try {
    thumbBlob = await compressImageToBlob(mainBlob, 320, 0.70);
  } catch (_) {}

  const now = Date.now();
  await localforage.setItem(getPhotoBlobKey(photoId), mainBlob);
  if (thumbBlob) {
    await localforage.setItem(getPhotoThumbKey(photoId), thumbBlob);
  }

  const photos = existingPhotos;
  const updated = photos.map(p => {
    if (p.id === photoId) {
      return { ...p, updatedAt: now, revision: Math.max(Number(p.revision || 0) + 1, 1), fileSize: mainBlob.size };
    }
    return p;
  });
  await saveProjectPhotos(projectId, updated);
  const pending = updated.find((p) => p.id === photoId);
  if (FIREBASE_ONLY_RUNTIME && pending) {
    await savePendingPhotoMetadata(pending);
    import('../lib/photoCloudSync').then(({ stagePhotoMetadataForCloud }) =>
      stagePhotoMetadataForCloud(projectId, pending).catch(() => {})
    ).catch(() => {});
  }
  return thumbBlob ? await blobToDataUrl(thumbBlob) : '';
}

export async function deleteEntityPhotos(projectId: string, entityType: 'crewRecord' | 'defect' | 'chat', entityId: string): Promise<void> {
  if (!projectId || !entityId) return;
  const photos = await getProjectPhotos(projectId, true);
  const now = Date.now();
  const targets = photos.filter(p => p.entityType === entityType && p.entityId === entityId);
  
  for (const p of targets) {
    try {
      await localforage.removeItem(getPhotoBlobKey(p.id));
      await localforage.removeItem(getPhotoThumbKey(p.id));
    } catch (_) {}
  }

  const updated = photos.map(p => {
    if (p.entityType === entityType && p.entityId === entityId) {
      return { ...p, deleted: true, deletedAt: now, updatedAt: now, revision: Math.max(Number(p.revision || 0) + 1, 1) };
    }
    return p;
  });
  await saveProjectPhotos(projectId, updated);
  if (FIREBASE_ONLY_RUNTIME) {
    for (const p of updated.filter((item) => item.entityType === entityType && item.entityId === entityId)) {
      await savePendingPhotoMetadata(p);
      import('../lib/photoCloudSync').then(({ stagePhotoMetadataForCloud }) =>
        stagePhotoMetadataForCloud(projectId, p).catch(() => {})
      ).catch(() => {});
    }
  }
}

export async function deleteProjectPhotos(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const photos = await getProjectPhotos(projectId, true);
    for (const p of photos) {
      try {
        await localforage.removeItem(getPhotoBlobKey(p.id));
        await localforage.removeItem(getPhotoThumbKey(p.id));
      } catch (_) {}
    }
    await removeAsyncItem(getPhotoListKey(projectId));
    const keys = await localforage.keys().catch(() => [] as string[]);
    for (const key of keys) {
      if (!key.startsWith('photo_pending_meta_')) continue;
      const item = await localforage.getItem<PhotoAttachment>(key).catch(() => null);
      if (item?.projectId === projectId) await localforage.removeItem(key).catch(() => {});
    }
    projectPhotoListMemoryCache.delete(projectId);
    try {
      localStorage.removeItem(getPhotoListKey(projectId));
    } catch (_) {}
  } catch (err) {
    console.error('Error deleting project photos:', err);
  }
}

export interface PhotoOrphanScanResult {
  invalidProjectMetadatasRemoved: number;
  unlinkedEntityMetadatasRemoved: number;
  missingBlobMetadatasCleaned: number;
  unreferencedBlobsDeleted: number;
  totalCleaned: number;
}

/**
 * Dedicated Scanner for Photo Orphan Cleanup (4 cases)
 */
export async function scanAndCleanupPhotoOrphans(
  validProjects: { id: string }[] = []
): Promise<PhotoOrphanScanResult> {
  const validProjectIds = new Set(validProjects.map(p => p.id));
  if (validProjectIds.size === 0) {
    validProjectIds.add('default');
  }

  let invalidProjectMetadatasRemoved = 0;
  let unlinkedEntityMetadatasRemoved = 0;
  let missingBlobMetadatasCleaned = 0;
  let unreferencedBlobsDeleted = 0;

  const validPhotoIds = new Set<string>();

  // 1. Scan storage keys to find all construction_photos_{projectId}
  try {
    const allLfKeys = await localforage.keys();
    const photoListKeys = allLfKeys.filter(k => k.startsWith('construction_photos_'));

    for (const listKey of photoListKeys) {
      const pid = listKey.replace('construction_photos_', '');
      
      // CASE A: Photo metadata has projectId but Project does not exist in validProjects
      if (!validProjectIds.has(pid)) {
        const orphanPhotos = await getAsyncItem<PhotoAttachment[]>(listKey, []);
        if (Array.isArray(orphanPhotos)) {
          for (const p of orphanPhotos) {
            if (p.id) {
              await localforage.removeItem(getPhotoBlobKey(p.id)).catch(() => {});
              await localforage.removeItem(getPhotoThumbKey(p.id)).catch(() => {});
              invalidProjectMetadatasRemoved++;
            }
          }
        }
        await removeAsyncItem(listKey).catch(() => {});
        continue;
      }

      // Load project entity IDs (defects and crew_records) to check unlinked entity photos (CASE B)
      const defects = await getAsyncItem<any[]>(`construction_defects_${pid}`, []);
      const crewRecords = await getAsyncItem<any[]>(`construction_crew_records_${pid}`, []);
      const defectIds = new Set(Array.isArray(defects) ? defects.map(d => d.id) : []);
      const crewIds = new Set(Array.isArray(crewRecords) ? crewRecords.map(c => c.id) : []);

      const existingPhotos = await getProjectPhotos(pid, true);
      const cleanedPhotos: PhotoAttachment[] = [];
      let listHasChanges = false;

      for (const p of existingPhotos) {
        if (!p.id) continue;

        // CASE B: Photo entityType = defect/crewRecord but entityId does not exist in project
        let isUnlinkedEntity = false;
        if (p.entityType === 'defect' && p.entityId && !defectIds.has(p.entityId)) {
          isUnlinkedEntity = true;
        } else if (p.entityType === 'crewRecord' && p.entityId && !crewIds.has(p.entityId)) {
          isUnlinkedEntity = true;
        }

        if (isUnlinkedEntity) {
          await localforage.removeItem(getPhotoBlobKey(p.id)).catch(() => {});
          await localforage.removeItem(getPhotoThumbKey(p.id)).catch(() => {});
          unlinkedEntityMetadatasRemoved++;
          listHasChanges = true;
          continue; // Drop unlinked photo metadata
        }

        // CASE C: Photo metadata exists but photo_blob_{photoId} does not exist in localforage
        if (!p.deleted) {
          const blobExists = await localforage.getItem(getPhotoBlobKey(p.id));
          if (!blobExists) {
            // Blob missing locally -> If photo has cloudUrl or cloudFileId, it's a remote synced photo! Do NOT delete it!
            if (!p.cloudUrl && !p.cloudFileId) {
              missingBlobMetadatasCleaned++;
              listHasChanges = true;
              continue;
            }
          }
        }

        // Valid photo metadata!
        validPhotoIds.add(p.id);
        cleanedPhotos.push(p);
      }

      if (listHasChanges) {
        await saveProjectPhotos(pid, cleanedPhotos);
      }
    }
  } catch (err) {
    console.error('Error during photo orphan scan (metadata pass):', err);
  }

  // 4. CASE D: Scan localforage for photo_blob_{photoId} or photo_thumb_{photoId} where photoId not in validPhotoIds
  try {
    const allLfKeys = await localforage.keys();
    for (const key of allLfKeys) {
      if (key.startsWith('photo_blob_')) {
        const photoId = key.replace('photo_blob_', '');
        if (!validPhotoIds.has(photoId)) {
          await localforage.removeItem(key).catch(() => {});
          await localforage.removeItem(getPhotoThumbKey(photoId)).catch(() => {});
          unreferencedBlobsDeleted++;
        }
      } else if (key.startsWith('photo_thumb_')) {
        const photoId = key.replace('photo_thumb_', '');
        if (!validPhotoIds.has(photoId)) {
          await localforage.removeItem(key).catch(() => {});
          unreferencedBlobsDeleted++;
        }
      }
    }
  } catch (err) {
    console.error('Error during photo orphan scan (blob pass):', err);
  }

  return {
    invalidProjectMetadatasRemoved,
    unlinkedEntityMetadatasRemoved,
    missingBlobMetadatasCleaned,
    unreferencedBlobsDeleted,
    totalCleaned: invalidProjectMetadatasRemoved + unlinkedEntityMetadatasRemoved + missingBlobMetadatasCleaned + unreferencedBlobsDeleted
  };
}
