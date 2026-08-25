import {
  collection,
  doc,
  getDoc,
  getDocs,
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
import {
  cleanupPhotoVersionsOnPrimaryDrive,
  deletePhotoFromPrimaryDrive,
  downloadPhotoFromPrimaryDrive,
  isPrimaryDriveReady,
  PRIMARY_DRIVE_OWNER_EMAIL,
  uploadPhotoToPrimaryDrive,
} from './primaryDriveBridge';

// V6.2.27 stability baseline: Firestore photo chunks are read-only legacy data.
// New/changed binary files must stay local pending until the primary Drive accepts them.

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
  const cloudDriveBacked = isDriveCloudValue(cloudData?.cloudFileId) || cloudData?.storageProvider === 'google-drive-primary';
  const cloudFirestoreBacked = Number(cloudData?.chunkCount || 0) > 0;
  const cloudHasResolvedBinaryState = Boolean(cloudData?.deleted) || cloudDriveBacked || cloudFirestoreBacked;
  const cloudDeleteStateMatches = Boolean(cloudData?.deleted) === Boolean(photo.deleted);

  // V6.2.24: direct upload callers are idempotent too. Bulk sync already skips the
  // same/newer cloud revision, but a second direct call could resend an unchanged
  // binary before. That made Apps Script create a replacement Drive file and trash
  // the previous one even though the photo revision had not changed.
  if (cloudData && cloudUpdatedAt >= localUpdatedAt && cloudDeleteStateMatches && cloudHasResolvedBinaryState) return;

  const baseMeta = {
    ...cleanPhotoMetadata(photo),
    projectId,
    updatedByUid: user.uid,
    updatedByEmail: user.email || '',
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
  };

  if (photo.deleted) {
    const driveFileId = parseDriveFileId(cloudData?.cloudFileId || cloudData?.cloudUrl);
    if (driveFileId) {
      await deletePhotoFromPrimaryDrive(projectId, photo.id, driveFileId).catch((err) => {
        console.warn('[Photo Cloud] Drive delete warning:', err);
      });
    }
    await setDoc(metaRef, {
      ...baseMeta,
      deleted: true,
      deletedAt: photo.deletedAt || Date.now(),
      updatedAt: localUpdatedAt || Date.now(),
      chunkCount: 0,
      cloudSyncedAt: Date.now(),
    }, { merge: true });
    await deletePhotoChunks(projectId, photo.id).catch(() => {});
    return;
  }

  let blob = await getPhotoBlob(photo.id, false);

  // During migration a second device may have only Firestore metadata/chunks. Pull
  // the old binary once, then immediately re-upload it to the primary Drive.
  if (!blob && cloudData && Number(cloudData?.chunkCount || 0) > 0) {
    blob = await downloadPhotoBlobFromFirestoreChunks(projectId, photo.id, photo.mimeType || 'image/jpeg').catch(() => null);
  }

  if (!blob) {
    throw new Error(`Ảnh ${photo.id} chưa có binary local/legacy để tải lên Drive; giữ trạng thái pending.`);
  }

  // Preferred path: every authorized user's image is written by the Apps Script
  // that runs as lengochieu1211@gmail.com, so the file lands in the main Drive.
  try {
    if (await isPrimaryDriveReady()) {
      const drive = await uploadPhotoToPrimaryDrive(projectId, { ...photo, mimeType: blob.type || photo.mimeType });
      if (drive?.fileId) {
        const driveRef = `drive:${projectId}:${drive.fileId}`;
        const contentVersion = localUpdatedAt || Date.now();
        await setDoc(metaRef, {
          ...baseMeta,
          mimeType: drive.mimeType || blob.type || photo.mimeType || 'image/jpeg',
          fileSize: Number(drive.fileSize || blob.size || photo.fileSize || 0),
          chunkCount: 0,
          contentVersion,
          contentHash: drive.contentHash || '',
          storageProvider: 'google-drive-primary',
          driveOwnerEmail: drive.ownerEmail || PRIMARY_DRIVE_OWNER_EMAIL,
          driveFolderPath: drive.folderPath || '',
          cloudFileId: driveRef,
          cloudUrl: driveRef,
          binaryMissingOnUploader: false,
          deleted: false,
          deletedAt: null,
          updatedAt: contentVersion,
          cloudSyncedAt: Date.now(),
        }, { merge: true });
        // Cleanup is deliberately POST-COMMIT. If it fails, leave the stale Drive
        // version in place rather than failing the sync and retrying the binary.
        // The Apps Script re-verifies Firestore points at drive.fileId before trashing.
        await cleanupPhotoVersionsOnPrimaryDrive(projectId, photo.id, drive.fileId, contentVersion).catch((err) => {
          console.warn('[Photo Cloud] stale Drive cleanup deferred:', photo.id, err);
        });
        // Only delete old Firestore chunks AFTER the Drive upload + metadata write succeeded.
        await deletePhotoChunks(projectId, photo.id).catch(() => {});
        return;
      }
    }
  } catch (err) {
    console.warn('[Photo Cloud] Primary Drive upload unavailable; binary remains local for retry:', err);
    throw err;
  }

  throw new Error(`Drive chính chưa sẵn sàng cho ảnh ${photo.id}; binary vẫn ở IndexedDB và sẽ retry.`);
}

export async function syncProjectPhotosToCloud(projectId: string): Promise<{ uploaded: number; skipped: number; migratedToDrive?: number; failed?: number }> {
  const photos = await getProjectPhotos(projectId, true);
  const driveReady = await isPrimaryDriveReady().catch(() => false);
  let uploaded = 0;
  let skipped = 0;
  let migratedToDrive = 0;
  let failed = 0;

  // Read cloud photo metadata once. The old loop did one getDoc() network round-trip
  // per local photo, which made project switching and first sync increasingly slow.
  const cloudSnapshot = await getDocs(collection(db, 'projects', projectId, 'photos')).catch(() => null);
  const cloudById = new Map<string, any>();
  cloudSnapshot?.docs.forEach((item) => cloudById.set(item.id, item.data()));

  for (const photo of photos) {
    try {
      const cloudData = cloudById.get(photo.id) || null;
      const cloudUpdatedAt = cloudData ? Number(cloudData?.updatedAt || 0) : 0;
      const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
      const driveBacked = isDriveCloudValue(cloudData?.cloudFileId) || cloudData?.storageProvider === 'google-drive-primary';
      const firestoreBacked = Number(cloudData?.chunkCount || 0) > 0;
      const cloudHasBinary = Boolean(cloudData?.deleted) || driveBacked || firestoreBacked;
      const needsDriveMigration = Boolean(driveReady && !photo.deleted && cloudData && !driveBacked && firestoreBacked);

      if (!needsDriveMigration && Boolean(cloudData) && cloudUpdatedAt >= localUpdatedAt && Boolean(cloudData?.deleted) === Boolean(photo.deleted) && cloudHasBinary) {
        skipped++;
        continue;
      }

      await uploadPhotoToCloud(projectId, photo);
      uploaded++;
      if (needsDriveMigration) migratedToDrive++;
    } catch (err) {
      failed++;
      console.warn('[Photo Cloud] upload warning:', photo.id, err);
    }
  }
  return { uploaded, skipped, migratedToDrive, failed };
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

  const driveFileId = parseDriveFileId(data?.cloudFileId || data?.cloudUrl);
  if (driveFileId) {
    try {
      const driveBlob = await downloadPhotoFromPrimaryDrive(projectId, photoId, driveFileId, data?.mimeType || mimeType);
      if (driveBlob) return driveBlob;
    } catch (err) {
      console.warn('[Photo Cloud] Drive download warning:', err);
    }
  }

  // Read-only compatibility for images uploaded before the Drive-only binary policy.
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
      ...(change.type === 'removed' ? { deleted: true, updatedAt: Date.now() } : {}),
    } as PhotoAttachment));
    const cloudPhotos = snapshotIsInitial
      ? snap.docs.map((d) => ({ id: d.id, ...d.data() } as PhotoAttachment))
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
