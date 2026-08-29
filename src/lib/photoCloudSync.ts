import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import {
  PhotoAttachment,
  cachePhotoBlob,
  getPhotoBlob,
  getProjectPhotos,
  mergeCloudPhotoMetadata,
} from '../utils/photoStorage';
import { getDeviceId, getDeviceName } from '../utils/deviceIdentity';
import { downloadPhotoFromPrimaryDrive } from './primaryDriveBridge';
import { LEGACY_DRIVE_READ_FALLBACK } from '../config/runtimeArchitecture';
import { BINARY_STORAGE_PROVIDER, downloadBinaryBlob, uploadProjectBinaryToCloud } from './binaryStorage';

// RC2.2.6: Firestore remains the realtime source of truth; binary media is routed
// through a provider adapter. PROD uses private Cloudflare R2 via an authenticated
// Worker gateway, while Firebase Storage remains a switchable provider/emulator path.

export interface PhotoCloudSyncStatus {
  phase: 'idle' | 'syncing' | 'synced' | 'error';
  pending?: number;
  message?: string;
  lastSyncAt?: number;
}

function cleanPhotoMetadata(photo: PhotoAttachment) {
  const copy: Record<string, any> = { ...photo };
  delete copy.localUri;
  delete copy.base64;
  delete copy.dataUrl;
  delete copy.localBlobKey;
  delete copy.cloudUrl;
  return copy;
}

function parseDriveFileId(value?: string | null): string {
  const raw = String(value || '');
  if (!raw.startsWith('drive:')) return '';
  const parts = raw.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : parts[1] || '';
}

function isDriveCloudValue(value?: string | null): boolean {
  return String(value || '').startsWith('drive:');
}

function isStorageCloudValue(value?: string | null): boolean {
  const raw = String(value || '');
  return raw.startsWith('storage:') || raw.startsWith('r2:');
}

function parseStoragePointer(value?: string | null): { provider: string; path: string } {
  const raw = String(value || '').trim();
  if (raw.startsWith('r2:')) return { provider: 'r2', path: raw.slice(3) };
  if (raw.startsWith('storage:')) return { provider: 'firebase-storage', path: raw.slice('storage:'.length) };
  return { provider: '', path: raw };
}

/**
 * Legacy cleanup only. V6.2.27 never writes new binary chunks to Firestore, but
 * old projects can still contain nested `photos/{photoId}/chunks/*` documents.
 * Delete them only after a Drive upload/metadata write succeeds, or when a photo
 * is explicitly deleted. Batches stay below Firestore's 500-write limit.
 */
async function deletePhotoChunks(projectId: string, photoId: string): Promise<void> {
  if (!projectId || !photoId) return;
  const chunksRef = collection(db, 'projects', projectId, 'photos', photoId, 'chunks');
  const snap = await getDocs(chunksRef);
  if (snap.empty) return;

  let batch = writeBatch(db);
  let count = 0;
  for (const chunkDoc of snap.docs) {
    batch.delete(chunkDoc.ref);
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

/**
 * Stage photo metadata in Firestore immediately. setDoc participates in Firestore's
 * official offline write queue, while the actual binary remains in the dedicated local
 * media outbox until the configured object-storage provider is reachable.
 */
export async function stagePhotoMetadataForCloud(projectId: string, photo: PhotoAttachment): Promise<void> {
  if (!projectId || !photo?.id) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('PHOTO_AUTH_UNAVAILABLE');
  const now = Date.now();
  const updatedAt = Number(photo.updatedAt || photo.createdAt || now);
  const revision = Math.max(Number(photo.revision || 0), 1);
  const deleted = Boolean(photo.deleted || photo.deletedAt);
  await setDoc(doc(db, 'projects', projectId, 'photos', photo.id), {
    ...cleanPhotoMetadata(photo),
    id: photo.id,
    projectId,
    revision,
    deleted,
    deletedAt: deleted ? Number(photo.deletedAt || updatedAt) : null,
    deletedByUid: deleted ? (photo.deletedByUid || user.uid) : null,
    deletedBy: deleted ? (photo.deletedBy || photo.deletedByUid || user.uid) : null,
    binaryUploadState: deleted ? 'deleted' : (photo.storagePath ? 'ready' : 'pending'),
    updatedAt,
    updatedByUid: user.uid,
    updatedByEmail: user.email || '',
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
    ...(!photo.createdByUid ? { createdByUid: user.uid } : {}),
    createdAt: Number(photo.createdAt || updatedAt),
  }, { merge: true });
}

const photoUploadInFlight = new Map<string, Promise<void>>();

export async function uploadPhotoToCloud(projectId: string, photo: PhotoAttachment): Promise<void> {
  if (!projectId || !photo?.id) return;
  const revision = Number(photo.updatedAt || photo.createdAt || 0);
  const key = `${projectId}:${photo.id}:${revision}:${photo.deleted ? 'deleted' : 'active'}`;
  const existing = photoUploadInFlight.get(key);
  if (existing) return existing;

  const task = uploadPhotoToCloudOnce(projectId, photo).finally(() => {
    if (photoUploadInFlight.get(key) === task) photoUploadInFlight.delete(key);
  });
  photoUploadInFlight.set(key, task);
  return task;
}

async function uploadPhotoToCloudOnce(projectId: string, photo: PhotoAttachment): Promise<void> {
  if (!projectId || !photo?.id) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) return;

  const metaRef = doc(db, 'projects', projectId, 'photos', photo.id);
  const cloudSnap = await getDoc(metaRef).catch(() => null);
  const cloudData = cloudSnap?.exists() ? cloudSnap.data() : null;
  const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
  const cloudUpdatedAt = Number(cloudData?.updatedAt || 0);
  const cloudStorageBacked = Boolean(cloudData?.storagePath) || isStorageCloudValue(cloudData?.cloudFileId) || ['firebase-storage', 'r2'].includes(String(cloudData?.storageProvider || ''));
  const currentProviderBacked = cloudStorageBacked && String(cloudData?.storageProvider || '') === BINARY_STORAGE_PROVIDER;
  const cloudDriveBacked = isDriveCloudValue(cloudData?.cloudFileId) || cloudData?.storageProvider === 'google-drive-primary';
  const cloudFirestoreBacked = Number(cloudData?.chunkCount || 0) > 0;
  const cloudHasResolvedBinaryState = Boolean(cloudData?.deleted) || cloudStorageBacked || cloudDriveBacked || cloudFirestoreBacked;
  const cloudDeleteStateMatches = Boolean(cloudData?.deleted) === Boolean(photo.deleted);
  const cloudRevision = Number(cloudData?.revision || 0);
  const localRevision = Number(photo.revision || 0);
  const legacyMigrationMode = Boolean(cloudData && !photo.deleted && (!currentProviderBacked) && (cloudStorageBacked || cloudDriveBacked || cloudFirestoreBacked));
  const localIsStale = Boolean(cloudData) && (
    (cloudRevision > 0 && localRevision > 0 && localRevision <= cloudRevision) ||
    (cloudRevision <= 0 && cloudUpdatedAt > 0 && localUpdatedAt > 0 && localUpdatedAt < cloudUpdatedAt)
  );

  if (cloudData && cloudUpdatedAt >= localUpdatedAt && cloudDeleteStateMatches && cloudHasResolvedBinaryState && (photo.deleted || currentProviderBacked)) return;
  if (localIsStale && !legacyMigrationMode) {
    throw new Error(`PHOTO_CONFLICT:${photo.id}: Cloud revision mới hơn; giữ Cloud và chờ realtime hòa giải.`);
  }
  if (cloudData && !cloudDeleteStateMatches && cloudUpdatedAt >= localUpdatedAt) {
    throw new Error(`PHOTO_CONFLICT:${photo.id}: trạng thái xóa trên Cloud mới hơn local.`);
  }

  const now = Date.now();
  const nextRevision = legacyMigrationMode
    ? Math.max(cloudRevision + 1, 1)
    : Math.max(localRevision, 1);
  const logicalMeta = legacyMigrationMode ? { ...cloudData } : cleanPhotoMetadata(photo);
  const baseMeta = {
    ...logicalMeta,
    projectId,
    revision: nextRevision,
    updatedByUid: user.uid,
    updatedByEmail: user.email || '',
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
  };

  if (photo.deleted) {
    // Soft delete only. Do NOT delete R2/Firebase Storage/Drive/chunks here. Physical
    // purge happens after the configured retention window and migration verification.
    await setDoc(metaRef, {
      ...baseMeta,
      deleted: true,
      deletedAt: photo.deletedAt || now,
      deletedByUid: photo.deletedByUid || user.uid,
      deletedBy: photo.deletedBy || photo.deletedByUid || user.uid,
      updatedAt: localUpdatedAt || now,
      binaryUploadState: 'deleted',
      cloudSyncedAt: now,
    }, { merge: true });
    return;
  }

  let blob = await getPhotoBlob(photo.id, false);

  // Migration source #0: another object-storage provider. This makes R2 ↔ Firebase
  // Storage reversible without changing Firestore metadata shape or UI call sites.
  if (!blob && cloudData && cloudStorageBacked && cloudData?.storagePath) {
    blob = await downloadBinaryBlob(String(cloudData.storageProvider || ''), String(cloudData.storagePath)).catch(() => null);
  }

  // Migration source #1: old Firestore chunk binary.
  if (!blob && cloudData && Number(cloudData?.chunkCount || 0) > 0) {
    blob = await downloadPhotoBlobFromFirestoreChunks(projectId, photo.id, photo.mimeType || 'image/jpeg').catch(() => null);
  }

  // Migration source #2: old Drive binary. Read-only fallback is deliberately gated.
  if (!blob && LEGACY_DRIVE_READ_FALLBACK && cloudDriveBacked) {
    const driveFileId = parseDriveFileId(cloudData?.cloudFileId || cloudData?.cloudUrl);
    if (driveFileId) {
      blob = await downloadPhotoFromPrimaryDrive(projectId, photo.id, driveFileId, cloudData?.mimeType || photo.mimeType || 'image/jpeg').catch(() => null);
    }
  }

  if (!blob) {
    throw new Error(`Ảnh ${photo.id} chưa có binary local/legacy để migrate lên ${BINARY_STORAGE_PROVIDER}; giữ trạng thái pending.`);
  }

  const thumbnailBlob = await getPhotoBlob(photo.id, true).catch(() => null);
  const contentVersion = legacyMigrationMode
    ? Math.max(cloudUpdatedAt + 1, now)
    : (localUpdatedAt || now);
  const uploaded = await uploadProjectBinaryToCloud({
    projectId,
    entityType: photo.entityType || 'photo',
    entityId: photo.entityId || photo.id,
    assetId: photo.id,
    blob,
    thumbnailBlob,
    mimeType: blob.type || photo.mimeType || 'image/jpeg',
    createdByUid: photo.createdByUid || user.uid,
    createdAt: Number(photo.createdAt || now),
  });

  await setDoc(metaRef, {
    ...baseMeta,
    mimeType: uploaded.mimeType || blob.type || photo.mimeType || 'image/jpeg',
    fileSize: Number(uploaded.size || blob.size || photo.fileSize || 0),
    chunkCount: 0,
    contentVersion,
    contentHash: uploaded.checksum || photo.storageMd5Hash || '',
    storageProvider: uploaded.provider,
    storagePath: uploaded.storagePath,
    thumbnailPath: uploaded.thumbnailPath || '',
    storageMd5Hash: uploaded.checksum || '',
    storageEtag: uploaded.etag || '',
    storageGeneration: uploaded.generation || '',
    cloudFileId: `${uploaded.provider === 'r2' ? 'r2' : 'storage'}:${uploaded.storagePath}`,
    cloudUrl: `${uploaded.provider === 'r2' ? 'r2' : 'storage'}:${uploaded.storagePath}`,
    binaryMissingOnUploader: false,
    binaryUploadState: 'ready',
    deleted: false,
    deletedAt: null,
    deletedByUid: null,
          deletedBy: null,
    updatedAt: contentVersion,
    cloudSyncedAt: now,
  }, { merge: true });

  // Legacy binary is intentionally NOT deleted here. A separate migration/purge job
  // may clean Drive/chunks only after count + checksum + reference verification.
}

/**
 * One-shot metadata hydration for backup/export paths. This verifies the photo index
 * against the Firestore server (not only local cache); binary objects remain lazy and are downloaded by
 * getProjectPhotosWithBinary() when a self-contained backup is requested.
 *
 * Returning `verified=false` lets backup callers fail closed instead of silently
 * creating an incomplete archive when the project photo index cannot be read.
 */
export async function refreshProjectPhotoMetadataFromCloud(projectId: string): Promise<{ verified: boolean; count: number }> {
  if (!projectId) return { verified: false, count: 0 };
  try {
    const snap = await getDocsFromServer(collection(db, 'projects', projectId, 'photos'));
    const cloudPhotos = snap.docs.map((item) => ({
      id: item.id,
      ...item.data(),
      __pendingWrite: item.metadata.hasPendingWrites,
    } as PhotoAttachment & { __pendingWrite?: boolean }));
    await mergeCloudPhotoMetadata(projectId, cloudPhotos, cloudPhotos);
    return { verified: true, count: cloudPhotos.filter((photo) => !photo.deleted && !photo.deletedAt).length };
  } catch (err) {
    console.warn('[Photo Backup] could not verify Firestore photo metadata:', projectId, err);
    return { verified: false, count: 0 };
  }
}

export async function syncProjectPhotosToCloud(projectId: string): Promise<{ uploaded: number; skipped: number; migratedToStorage?: number; failed?: number }> {
  const photos = await getProjectPhotos(projectId, true);
  let uploaded = 0;
  let skipped = 0;
  let migratedToStorage = 0;
  let failed = 0;

  const cloudSnapshot = await getDocs(collection(db, 'projects', projectId, 'photos')).catch(() => null);
  const cloudById = new Map<string, any>();
  cloudSnapshot?.docs.forEach((item) => cloudById.set(item.id, item.data()));

  for (const photo of photos) {
    try {
      const cloudData = cloudById.get(photo.id) || null;
      const cloudUpdatedAt = cloudData ? Number(cloudData?.updatedAt || 0) : 0;
      const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
      const storageBacked = Boolean(cloudData?.storagePath) || isStorageCloudValue(cloudData?.cloudFileId) || ['firebase-storage', 'r2'].includes(String(cloudData?.storageProvider || ''));
      const currentProviderBacked = storageBacked && String(cloudData?.storageProvider || '') === BINARY_STORAGE_PROVIDER;
      const legacyBacked = isDriveCloudValue(cloudData?.cloudFileId) || cloudData?.storageProvider === 'google-drive-primary' || Number(cloudData?.chunkCount || 0) > 0;
      const needsStorageMigration = Boolean(!photo.deleted && cloudData && !currentProviderBacked && (storageBacked || legacyBacked));

      if (!needsStorageMigration && Boolean(cloudData) && cloudUpdatedAt >= localUpdatedAt && Boolean(cloudData?.deleted) === Boolean(photo.deleted) && (Boolean(cloudData?.deleted) || currentProviderBacked)) {
        skipped++;
        continue;
      }

      await uploadPhotoToCloud(projectId, photo);
      uploaded++;
      if (needsStorageMigration) migratedToStorage++;
    } catch (err) {
      failed++;
      console.warn(`[Photo Cloud] ${BINARY_STORAGE_PROVIDER} sync warning:`, photo.id, err);
    }
  }
  return { uploaded, skipped, migratedToStorage, failed };
}

async function downloadPhotoBlobFromFirestoreChunks(projectId: string, photoId: string, mimeType = 'image/jpeg'): Promise<Blob | null> {
  const metaSnap = await getDoc(doc(db, 'projects', projectId, 'photos', photoId));
  if (!metaSnap.exists() || metaSnap.data()?.deleted) return null;

  const q = query(collection(db, 'projects', projectId, 'photos', photoId, 'chunks'), orderBy('index', 'asc'));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const parts: Uint8Array[] = [];
  snap.forEach((chunkDoc) => {
    const bytes = chunkDoc.data()?.data;
    if (bytes && typeof bytes.toUint8Array === 'function') parts.push(bytes.toUint8Array());
  });
  if (parts.length === 0) return null;
  const blob = new Blob(parts, { type: metaSnap.data()?.mimeType || mimeType });
  await cachePhotoBlob(photoId, blob, true);
  return blob;
}

export async function downloadPhotoBlobFromCloud(projectId: string, photoId: string, mimeType = 'image/jpeg'): Promise<Blob | null> {
  if (!projectId || !photoId) return null;
  const metaSnap = await getDoc(doc(db, 'projects', projectId, 'photos', photoId));
  if (!metaSnap.exists() || metaSnap.data()?.deleted) return null;
  const data = metaSnap.data();

  const pointer = parseStoragePointer(data?.cloudFileId || data?.cloudUrl);
  const storagePath = String(data?.storagePath || pointer.path || '');
  const provider = String(data?.storageProvider || pointer.provider || '');
  if (storagePath && (provider === 'r2' || provider === 'firebase-storage' || isStorageCloudValue(data?.cloudFileId))) {
    const storageBlob = await downloadBinaryBlob(provider || pointer.provider, storagePath);
    if (storageBlob) {
      await cachePhotoBlob(photoId, storageBlob, true).catch(() => {});
      return storageBlob;
    }
  }

  if (LEGACY_DRIVE_READ_FALLBACK) {
    const driveFileId = parseDriveFileId(data?.cloudFileId || data?.cloudUrl);
    if (driveFileId) {
      try {
        const driveBlob = await downloadPhotoFromPrimaryDrive(projectId, photoId, driveFileId, data?.mimeType || mimeType);
        if (driveBlob) return driveBlob;
      } catch (err) {
        console.warn('[Photo Cloud] legacy Drive read warning:', err);
      }
    }
  }

  // Read-only compatibility for images uploaded before Firebase Storage migration.
  return downloadPhotoBlobFromFirestoreChunks(projectId, photoId, data?.mimeType || mimeType);
}


const projectInitialPhotoSyncScheduled = new Set<string>();
const projectLastPhotoSyncAt = new Map<string, number>();
const PHOTO_INITIAL_SYNC_DELAY_MS = 8000;
const PHOTO_INITIAL_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function subscribeProjectPhotosRealtime(
  projectId: string,
  onStatus?: (status: PhotoCloudSyncStatus) => void,
): () => void {
  if (!projectId) return () => {};
  const ref = collection(db, 'projects', projectId, 'photos');
  let firstSnapshot = true;
  let cancelled = false;
  let initialUploadNeeded = false;
  // Firestore may emit another snapshot while the previous IndexedDB metadata merge
  // is still awaiting. Serialize merges so an older snapshot can never finish after
  // a newer one and overwrite the local photo index.
  let photoSnapshotMergeQueue: Promise<void> = Promise.resolve();
  let delayedSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let retrySyncTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleInitialUpload = () => {
    if (cancelled || !initialUploadNeeded || projectInitialPhotoSyncScheduled.has(projectId)) return;
    const lastSyncAt = projectLastPhotoSyncAt.get(projectId) || 0;
    if (Date.now() - lastSyncAt < PHOTO_INITIAL_SYNC_MIN_INTERVAL_MS) {
      initialUploadNeeded = false;
      return;
    }
    projectInitialPhotoSyncScheduled.add(projectId);

    const run = () => {
      delayedSyncTimer = null;
      if (cancelled) {
        projectInitialPhotoSyncScheduled.delete(projectId);
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // Keep initialUploadNeeded=true. visibilitychange below schedules a fresh idle
        // attempt when the user returns instead of silently losing photo upload sync.
        projectInitialPhotoSyncScheduled.delete(projectId);
        return;
      }
      const start = Date.now();
      syncProjectPhotosToCloud(projectId)
        .then((result) => {
          initialUploadNeeded = false;
          projectLastPhotoSyncAt.set(projectId, Date.now());
          console.debug('[photo initial sync]', projectId, result, 'duration=', Date.now() - start);
        })
        .catch((err) => {
          console.warn('[Photo Cloud] delayed initial upload/migration warning:', err);
          if (!cancelled) {
            retrySyncTimer = setTimeout(() => {
              retrySyncTimer = null;
              scheduleInitialUpload();
            }, 30000);
          }
        })
        .finally(() => projectInitialPhotoSyncScheduled.delete(projectId));
    };

    delayedSyncTimer = setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(run, { timeout: 3000 });
      } else {
        run();
      }
    }, PHOTO_INITIAL_SYNC_DELAY_MS);
  };

  const handleVisibilityChange = () => {
    if (!cancelled && typeof document !== 'undefined' && document.visibilityState === 'visible' && initialUploadNeeded) {
      scheduleInitialUpload();
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange);

  const unsubscribe = onSnapshot(ref, (snap) => {
    const snapshotIsInitial = firstSnapshot;
    // Flip this synchronously before any async merge. Without this, a second
    // Firestore emission can also enter the "first snapshot" path and race it.
    firstSnapshot = false;
    const changes = snap.docChanges();
    onStatus?.({ phase: 'syncing', pending: changes.length });
    const changedPhotos = changes.map((change) => ({
      id: change.doc.id,
      ...change.doc.data(),
      __pendingWrite: change.doc.metadata.hasPendingWrites,
      ...(change.type === 'removed' ? { deleted: true, updatedAt: Date.now() } : {}),
    } as PhotoAttachment & { __pendingWrite?: boolean }));
    const cloudPhotos = snapshotIsInitial
      ? snap.docs.map((d) => ({ id: d.id, ...d.data(), __pendingWrite: d.metadata.hasPendingWrites } as PhotoAttachment & { __pendingWrite?: boolean }))
      : changedPhotos;

    photoSnapshotMergeQueue = photoSnapshotMergeQueue
      .then(async () => {
        if (cancelled) return;
        await mergeCloudPhotoMetadata(projectId, cloudPhotos, changedPhotos);
        if (cancelled) return;
        console.debug('[photo snapshot]', projectId, 'docs=', snap.size, 'changes=', changes.length, 'initial=', snapshotIsInitial);
        onStatus?.({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });

        if (snapshotIsInitial) {
          initialUploadNeeded = true;
          scheduleInitialUpload();
        }
      })
      .catch((err: any) => {
        if (!cancelled) onStatus?.({ phase: 'error', message: err?.message || String(err) });
      });
  }, (err) => {
    onStatus?.({ phase: 'error', message: err?.message || String(err) });
  });


  return () => {
    cancelled = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (delayedSyncTimer) clearTimeout(delayedSyncTimer);
    if (retrySyncTimer) clearTimeout(retrySyncTimer);
    projectInitialPhotoSyncScheduled.delete(projectId);
    unsubscribe();
  };
}
