import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
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
  isPhotoSharedCloudReady,
  mergeCloudPhotoMetadata,
} from '../utils/photoStorage';
import { getDeviceId, getDeviceName } from '../utils/deviceIdentity';
import { downloadPhotoFromPrimaryDrive } from './primaryDriveBridge';
import { LEGACY_DRIVE_READ_FALLBACK } from '../config/runtimeArchitecture';
import { BINARY_STORAGE_PROVIDER, downloadBinaryBlob, uploadProjectBinaryToCloud, verifyBinaryObjectReady } from './binaryStorage';
import { appendRuntimeDiagnostic } from './runtimeDiagnostics';

const photoSyncErrorCode = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err || '');
  const match = message.match(/^(R2_[A-Z0-9_]+|PHOTO_[A-Z0-9_]+|[A-Z0-9_]+):?/);
  return match?.[1] || 'PHOTO_SYNC_FAILED';
};

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
  return { provider: '', path: '' };
}

function hasDurableCloudBinaryPointer(photo: any): boolean {
  const pointer = parseStoragePointer(photo?.cloudFileId || photo?.cloudUrl);
  const provider = String(photo?.storageProvider || pointer.provider || '');
  return Boolean(
    photo?.storagePath
    || pointer.path
    || isDriveCloudValue(photo?.cloudFileId || photo?.cloudUrl)
    || Number(photo?.chunkCount || 0) > 0
    || ['r2', 'firebase-storage', 'google-drive-primary'].includes(provider)
  );
}

function cloudBinaryPointer(photo: any): { provider: string; storagePath: string; expectedSize?: number; expectedChecksum?: string } {
  const pointer = parseStoragePointer(photo?.cloudFileId || photo?.cloudUrl);
  return {
    provider: String(photo?.storageProvider || pointer.provider || ''),
    storagePath: String(photo?.storagePath || pointer.path || ''),
    expectedSize: Number(photo?.fileSize || 0) || undefined,
    expectedChecksum: String(photo?.contentHash || photo?.storageMd5Hash || '') || undefined,
  };
}

async function verifyCurrentProviderCloudBinary(photo: any): Promise<boolean> {
  const pointer = cloudBinaryPointer(photo);
  if (!pointer.storagePath || pointer.provider !== BINARY_STORAGE_PROVIDER) return false;
  return verifyBinaryObjectReady(
    pointer.provider,
    pointer.storagePath,
    pointer.expectedSize,
    pointer.expectedChecksum,
  ).catch(() => false);
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
  // Ready-only publish: active metadata is NOT written to the shared Firestore
  // collection until the object-storage upload has produced a durable pointer.
  // The account-scoped IndexedDB outbox is the only source for pending active media.
  if (!deleted && (!hasDurableCloudBinaryPointer(photo) || String(photo.binaryUploadState || '') === 'pending')) {
    return;
  }
  await setDoc(doc(db, 'projects', projectId, 'photos', photo.id), {
    ...cleanPhotoMetadata(photo),
    id: photo.id,
    projectId,
    revision,
    deleted,
    deletedAt: deleted ? Number(photo.deletedAt || updatedAt) : null,
    deletedByUid: deleted ? (photo.deletedByUid || user.uid) : null,
    deletedBy: deleted ? (photo.deletedBy || photo.deletedByUid || user.uid) : null,
    binaryUploadState: deleted ? 'deleted' : 'ready',
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
  if (!user || user.isAnonymous) throw new Error('PHOTO_AUTH_UNAVAILABLE');

  const metaRef = doc(db, 'projects', projectId, 'photos', photo.id);
  const cloudSnap = await getDoc(metaRef).catch(() => null);
  const cloudData = cloudSnap?.exists() ? cloudSnap.data() : null;
  const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
  const cloudUpdatedAt = Number(cloudData?.updatedAt || 0);
  const cloudStorageBacked = Boolean(cloudData?.storagePath) || isStorageCloudValue(cloudData?.cloudFileId) || ['firebase-storage', 'r2'].includes(String(cloudData?.storageProvider || ''));
  const currentProviderBacked = cloudStorageBacked && String(cloudData?.storageProvider || '') === BINARY_STORAGE_PROVIDER;
  const cloudDriveBacked = isDriveCloudValue(cloudData?.cloudFileId) || cloudData?.storageProvider === 'google-drive-primary';
  const cloudFirestoreBacked = Number(cloudData?.chunkCount || 0) > 0
    || String(cloudData?.storageProvider || '') === 'firestore-fallback'
    || String(cloudData?.cloudFileId || cloudData?.cloudUrl || '').startsWith('firestore:');
  const cloudHasResolvedBinaryState = Boolean(cloudData?.deleted) || cloudStorageBacked || cloudDriveBacked || cloudFirestoreBacked;
  const cloudDeleteStateMatches = Boolean(cloudData?.deleted) === Boolean(photo.deleted);
  const cloudRevision = Number(cloudData?.revision || 0);
  const localRevision = Number(photo.revision || 0);
  const legacyMigrationMode = Boolean(cloudData && !photo.deleted && (!currentProviderBacked) && (cloudStorageBacked || cloudDriveBacked || cloudFirestoreBacked));

  // RC2.2.15 P0 self-heal: older releases could leave a Firestore row that looks R2-ready
  // while the actual object is missing/denied. If the original uploader device still has
  // the Blob, verify the object before treating metadata as authoritative. A broken pointer
  // is repaired from that local Blob instead of being skipped forever on every startup.
  const localRepairBlob = !photo.deleted && currentProviderBacked
    ? await getPhotoBlob(photo.id, false).catch(() => null)
    : null;
  const currentProviderVerified = localRepairBlob && currentProviderBacked
    ? await verifyCurrentProviderCloudBinary(cloudData)
    : true;
  const currentProviderRepairMode = Boolean(localRepairBlob && currentProviderBacked && !currentProviderVerified);
  const binaryRepairMode = legacyMigrationMode || currentProviderRepairMode;

  const cloudIsAuthoritative = Boolean(cloudData?.deleted) || cloudHasResolvedBinaryState;
  const localIsStale = Boolean(cloudData) && cloudIsAuthoritative && (
    (cloudRevision > 0 && localRevision > 0 && localRevision <= cloudRevision) ||
    (cloudRevision <= 0 && cloudUpdatedAt > 0 && localUpdatedAt > 0 && localUpdatedAt < cloudUpdatedAt)
  );

  const reconcileCloudIntoLocal = async () => {
    if (!cloudData) return;
    const cloudPhoto = { id: photo.id, ...cloudData } as PhotoAttachment;
    await mergeCloudPhotoMetadata(projectId, [cloudPhoto], [cloudPhoto]);
  };

  // If Firestore already says the photo is backed by the current provider but this
  // device has no local binary, it cannot repair/re-upload that object. Treat the
  // server metadata as authoritative and leave binary health to the download/verify
  // path. Re-upload attempts here only create a false pending loop on secondary devices.
  if (cloudData && currentProviderBacked && !photo.deleted && !localRepairBlob) {
    await reconcileCloudIntoLocal();
    return;
  }

  if (cloudData && cloudUpdatedAt >= localUpdatedAt && cloudDeleteStateMatches && cloudHasResolvedBinaryState && (photo.deleted || currentProviderBacked) && !currentProviderRepairMode) {
    await reconcileCloudIntoLocal();
    return;
  }
  if (localIsStale && !binaryRepairMode) {
    await reconcileCloudIntoLocal();
    return;
  }
  if (cloudData && !cloudDeleteStateMatches && cloudUpdatedAt >= localUpdatedAt) {
    await reconcileCloudIntoLocal();
    return;
  }

  const now = Date.now();
  // Existing Firestore photo rows must advance revision. Older releases could
  // leave pending/legacy metadata at the same revision as the local outbox;
  // reusing it violates lifecycleUpdateIsMonotonic() and strands the binary.
  const nextRevision = cloudData
    ? Math.max(cloudRevision + 1, localRevision + 1, 1)
    : Math.max(localRevision, 1);
  const logicalMeta = binaryRepairMode ? { ...cloudData } : cleanPhotoMetadata(photo);
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
      updatedAt: Math.max(localUpdatedAt || 0, cloudData ? cloudUpdatedAt + 1 : 0, now),
      binaryUploadState: 'deleted',
      cloudSyncedAt: now,
    }, { merge: true });
    return;
  }

  let blob = localRepairBlob || await getPhotoBlob(photo.id, false);

  // Migration source #0: another object-storage provider. This makes R2 ↔ Firebase
  // Storage reversible without changing Firestore metadata shape or UI call sites.
  if (!blob && cloudData && cloudStorageBacked && cloudData?.storagePath) {
    blob = await downloadBinaryBlob(String(cloudData.storageProvider || ''), String(cloudData.storagePath)).catch(() => null);
  }

  // Migration source #1: old Firestore chunk binary. Some legacy rows were written
  // with storageProvider/firestore: pointers but without chunkCount, so the pointer
  // itself must trigger a server-first chunk probe.
  if (!blob && cloudData && cloudFirestoreBacked) {
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
  // updatedAt is lifecycle-controlled too. Always advance an existing
  // pending/legacy row when replacing it with verified R2 metadata.
  const contentVersion = Math.max(
    localUpdatedAt || 0,
    cloudData ? cloudUpdatedAt + 1 : 0,
    now,
  );
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
    binaryRepairReason: currentProviderRepairMode ? 'r2-object-missing-or-mismatched' : '',
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

export async function syncProjectPhotosToCloud(projectId: string): Promise<{ uploaded: number; skipped: number; migratedToStorage?: number; failed?: number; lastError?: string; lastErrorPhotoId?: string }> {
  const photos = await getProjectPhotos(projectId, true);
  let uploaded = 0;
  let skipped = 0;
  let migratedToStorage = 0;
  let failed = 0;
  let lastError = '';
  let lastErrorPhotoId = '';

  // Online sync decisions must be based on SERVER metadata. Using getDocs() here
  // allowed persistent Firestore cache to classify an already-repaired R2 row as
  // `firestore-fallback`/legacy and repeatedly attempt an impossible local migration.
  // Offline still falls back to the cache so the outbox remains usable without network.
  let cloudSnapshot: Awaited<ReturnType<typeof getDocs>> | null = null;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    cloudSnapshot = await getDocsFromServer(collection(db, 'projects', projectId, 'photos')).catch(() => null);
  }
  if (!cloudSnapshot) {
    cloudSnapshot = await getDocs(collection(db, 'projects', projectId, 'photos')).catch(() => null);
  }
  const cloudById = new Map<string, any>();
  cloudSnapshot?.docs.forEach((item) => cloudById.set(item.id, item.data()));

  for (const photo of photos) {
    try {
      const cloudData = cloudById.get(photo.id) || null;
      const cloudUpdatedAt = cloudData ? Number(cloudData?.updatedAt || 0) : 0;
      const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
      const storageBacked = Boolean(cloudData?.storagePath) || isStorageCloudValue(cloudData?.cloudFileId) || ['firebase-storage', 'r2'].includes(String(cloudData?.storageProvider || ''));
      const currentProviderBacked = storageBacked && String(cloudData?.storageProvider || '') === BINARY_STORAGE_PROVIDER;
      const legacyBacked = isDriveCloudValue(cloudData?.cloudFileId)
        || cloudData?.storageProvider === 'google-drive-primary'
        || cloudData?.storageProvider === 'firestore-fallback'
        || String(cloudData?.cloudFileId || cloudData?.cloudUrl || '').startsWith('firestore:')
        || Number(cloudData?.chunkCount || 0) > 0;
      const needsStorageMigration = Boolean(!photo.deleted && cloudData && !currentProviderBacked && (storageBacked || legacyBacked));
      const localRepairCandidate = Boolean(!photo.deleted && currentProviderBacked && await getPhotoBlob(photo.id, false).catch(() => null));

      // Server R2-ready + no local Blob is not an upload-pending item on this device.
      if (currentProviderBacked && !photo.deleted && !localRepairCandidate) {
        skipped++;
        continue;
      }

      if (!needsStorageMigration && !localRepairCandidate && Boolean(cloudData) && cloudUpdatedAt >= localUpdatedAt && Boolean(cloudData?.deleted) === Boolean(photo.deleted) && (Boolean(cloudData?.deleted) || currentProviderBacked)) {
        skipped++;
        continue;
      }

      await uploadPhotoToCloud(projectId, photo);
      uploaded++;
      if (needsStorageMigration) migratedToStorage++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      lastErrorPhotoId = photo.id;
      appendRuntimeDiagnostic({
        level: 'error',
        area: 'photo-sync',
        projectId,
        code: photoSyncErrorCode(err),
        message: `${photo.entityType || 'photo'}/${photo.entityId || ''}/${photo.id}: ${message}`,
      });
      console.warn(`[Photo Cloud] ${BINARY_STORAGE_PROVIDER} sync warning:`, photo.id, err);
    }
  }
  return { uploaded, skipped, migratedToStorage, failed, lastError, lastErrorPhotoId };
}

async function downloadPhotoBlobFromFirestoreChunks(projectId: string, photoId: string, mimeType = 'image/jpeg'): Promise<Blob | null> {
  const metaRef = doc(db, 'projects', projectId, 'photos', photoId);
  let metaSnap: any = null;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    metaSnap = await getDocFromServer(metaRef).catch(() => null);
  }
  if (!metaSnap) metaSnap = await getDoc(metaRef).catch(() => null);
  if (!metaSnap?.exists() || metaSnap.data()?.deleted) return null;

  const q = query(collection(db, 'projects', projectId, 'photos', photoId, 'chunks'), orderBy('index', 'asc'));
  // Legacy chunks may never have been materialized in this browser's persistent cache.
  // Ask the server first while online; otherwise a valid historical image can be
  // misreported as missing during PDF/HTML export on a second device.
  let snap: any = null;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    snap = await getDocsFromServer(q).catch(() => null);
  }
  if (!snap) snap = await getDocs(q).catch(() => null);
  if (!snap || snap.empty) return null;

  const parts: Uint8Array[] = [];
  snap.forEach((chunkDoc: any) => {
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

  const photoRef = doc(db, 'projects', projectId, 'photos', photoId);
  const readPhotoMeta = async (serverOnly = false) => {
    const snap = serverOnly ? await getDocFromServer(photoRef) : await getDoc(photoRef);
    if (!snap.exists() || snap.data()?.deleted) return null;
    return snap.data() as any;
  };

  let data = await readPhotoMeta(false);
  if (!data) return null;

  const hasUsableBinaryPointer = (value: any) => Boolean(
    value?.storagePath
    || isStorageCloudValue(value?.cloudFileId)
    || isStorageCloudValue(value?.cloudUrl)
    || isDriveCloudValue(value?.cloudFileId)
    || isDriveCloudValue(value?.cloudUrl)
    || String(value?.storageProvider || '') === 'firestore-fallback'
    || String(value?.cloudFileId || value?.cloudUrl || '').startsWith('firestore:')
    || Number(value?.chunkCount || 0) > 0
  );

  // RC2.2.9 same-phone account switch: persistent Firestore cache can still contain
  // the initial binaryUploadState=pending document after account A has completed the
  // R2 upload on the server. Account B must refresh that metadata from the server once
  // before showing a placeholder. This also repairs a stale cache without clearing all
  // Firestore offline data.
  if (!hasUsableBinaryPointer(data) || String(data?.binaryUploadState || '') === 'pending') {
    try {
      const serverData = await readPhotoMeta(true);
      if (serverData) data = serverData;
    } catch (err) {
      console.warn('[Photo Cloud] server metadata refresh warning:', photoId, err);
    }
  }

  const tryObjectStorage = async (meta: any): Promise<Blob | null> => {
    const pointer = parseStoragePointer(meta?.cloudFileId || meta?.cloudUrl);
    const storagePath = String(meta?.storagePath || pointer.path || '');
    const provider = String(meta?.storageProvider || pointer.provider || '');
    if (!storagePath || !['r2', 'firebase-storage'].includes(provider)) return null;
    const storageBlob = await downloadBinaryBlob(provider, storagePath);
    if (!storageBlob || storageBlob.size <= 0) return null;
    await cachePhotoBlob(photoId, storageBlob, true).catch(() => {});
    return storageBlob;
  };

  let storageBlob = await tryObjectStorage(data);
  if (storageBlob) return storageBlob;

  // P0 cross-account recovery (RC2.2.15): a second user may already have a valid-looking
  // cached Firestore pointer while the server row has since been repaired/migrated. A
  // failed private-object read must therefore force one server metadata refresh and retry
  // before the UI gives up. This specifically closes Editor-local -> Admin-broken-image.
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      const serverData = await readPhotoMeta(true);
      if (serverData) {
        data = serverData;
        storageBlob = await tryObjectStorage(serverData);
        if (storageBlob) return storageBlob;
      }
    } catch (err) {
      console.warn('[Photo Cloud] cross-account server retry warning:', photoId, err);
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


export async function verifyPhotoBinaryReadyInCloud(projectId: string, photoId: string): Promise<boolean> {
  if (!projectId || !photoId) return false;
  try {
    const snap = await getDocFromServer(doc(db, 'projects', projectId, 'photos', photoId));
    if (!snap.exists()) return false;
    const data = snap.data() as any;
    if (data?.deleted || data?.deletedAt) return false;
    const pointer = parseStoragePointer(data?.cloudFileId || data?.cloudUrl);
    const provider = String(data?.storageProvider || pointer.provider || '');
    const storagePath = String(data?.storagePath || pointer.path || '');
    if (String(data?.binaryUploadState || '') !== 'ready' || !storagePath) return false;
    if (provider !== 'r2' && provider !== 'firebase-storage') return false;
    return verifyBinaryObjectReady(provider, storagePath, Number(data?.fileSize || 0) || undefined, String(data?.contentHash || data?.storageMd5Hash || '') || undefined);
  } catch (err) {
    appendRuntimeDiagnostic({ level: 'warn', area: 'photo-verify', projectId, code: photoSyncErrorCode(err), message: `${photoId}: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}


const projectInitialPhotoSyncScheduled = new Set<string>();
const projectLastPhotoSyncAt = new Map<string, number>();
const PHOTO_INITIAL_SYNC_DELAY_MS = 1200;
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
          const failed = Number(result.failed || 0);
          console.debug('[photo initial sync]', projectId, result, 'duration=', Date.now() - start);
          if (failed > 0) {
            initialUploadNeeded = true;
            onStatus?.({ phase: 'error', pending: failed, message: `${failed} ảnh chưa lên Cloud/R2; đang tự retry.${result.lastError ? ` Lỗi gần nhất: ${result.lastError}` : ''}` });
            retrySyncTimer = setTimeout(() => {
              retrySyncTimer = null;
              projectInitialPhotoSyncScheduled.delete(projectId);
              scheduleInitialUpload();
            }, 2500);
            return;
          }
          initialUploadNeeded = false;
          projectLastPhotoSyncAt.set(projectId, Date.now());
        })
        .catch((err) => {
          console.warn('[Photo Cloud] delayed initial upload/migration warning:', err);
          if (!cancelled) {
            retrySyncTimer = setTimeout(() => {
              retrySyncTimer = null;
              scheduleInitialUpload();
            }, 5000);
          }
        })
        .finally(() => projectInitialPhotoSyncScheduled.delete(projectId));
    };

    delayedSyncTimer = setTimeout(() => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(run, { timeout: 1000 });
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
        const activeUid = getCurrentRealFirebaseUser()?.uid || '';
        const localAfterMerge = await getProjectPhotos(projectId, true);
        const pendingLocal = localAfterMerge.filter((photo) =>
          !photo.deleted && !photo.deletedAt
          && !isPhotoSharedCloudReady(photo)
          && (!photo.createdByUid || photo.createdByUid === activeUid)
        ).length;
        if (pendingLocal > 0) {
          initialUploadNeeded = true;
          onStatus?.({ phase: 'syncing', pending: pendingLocal, message: `${pendingLocal} ảnh đang chờ Cloud/R2.` });
          scheduleInitialUpload();
        } else {
          onStatus?.({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });
        }

        if (snapshotIsInitial && pendingLocal === 0) {
          // Still run one migration/self-heal pass for legacy pointers even when the
          // current account has no explicit local pending item.
          initialUploadNeeded = true;
          scheduleInitialUpload();
        }
      })
      .catch((err: any) => {
        appendRuntimeDiagnostic({ level: 'error', area: 'photo-realtime', projectId, code: photoSyncErrorCode(err), message: err?.message || String(err) });
        if (!cancelled) onStatus?.({ phase: 'error', message: err?.message || String(err) });
      });
  }, (err) => {
    appendRuntimeDiagnostic({ level: 'error', area: 'photo-realtime', projectId, code: photoSyncErrorCode(err), message: err?.message || String(err) });
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
