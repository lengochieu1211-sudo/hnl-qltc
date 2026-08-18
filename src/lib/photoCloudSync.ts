import {
  Bytes,
  collection,
  deleteDoc,
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

// Keep safely below Firestore's 1 MiB/document limit, including metadata overhead.
const CHUNK_BYTES = 560 * 1024;

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

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function splitBytes(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + CHUNK_BYTES)));
  }
  return chunks;
}

async function deletePhotoChunks(projectId: string, photoId: string): Promise<void> {
  const chunksRef = collection(db, 'projects', projectId, 'photos', photoId, 'chunks');
  const snap = await getDocs(chunksRef);
  if (snap.empty) return;
  let batch = writeBatch(db);
  let count = 0;
  for (const chunkDoc of snap.docs) {
    batch.delete(chunkDoc.ref);
    count++;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

export async function uploadPhotoToCloud(projectId: string, photo: PhotoAttachment): Promise<void> {
  if (!projectId || !photo?.id) return;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) return;

  const metaRef = doc(db, 'projects', projectId, 'photos', photo.id);
  const cloudSnap = await getDoc(metaRef).catch(() => null);
  const cloudData = cloudSnap?.exists() ? cloudSnap.data() : null;
  const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
  const cloudUpdatedAt = Number(cloudData?.updatedAt || 0);

  // Cloud version is already newer; realtime listener will reconcile it locally.
  if (cloudData && cloudUpdatedAt > localUpdatedAt) return;

  const baseMeta = {
    ...cleanPhotoMetadata(photo),
    projectId,
    updatedByUid: user.uid,
    updatedByEmail: user.email || '',
    updatedByDeviceId: getDeviceId(),
    updatedByDeviceName: getDeviceName(),
  };

  if (photo.deleted) {
    await setDoc(metaRef, {
      ...baseMeta,
      deleted: true,
      deletedAt: photo.deletedAt || Date.now(),
      updatedAt: localUpdatedAt || Date.now(),
      chunkCount: 0,
      cloudSyncedAt: Date.now(),
    }, { merge: true });
    // Reclaim free Firestore storage after tombstoning metadata.
    await deletePhotoChunks(projectId, photo.id).catch(() => {});
    return;
  }

  const blob = await getPhotoBlob(photo.id, false);
  if (!blob) {
    // Metadata can still be synchronized; binary may be fetched from another device later.
    await setDoc(metaRef, {
      ...baseMeta,
      deleted: false,
      updatedAt: localUpdatedAt || Date.now(),
      binaryMissingOnUploader: true,
      cloudSyncedAt: Date.now(),
    }, { merge: true });
    return;
  }

  const bytes = await blobToUint8Array(blob);
  const chunks = splitBytes(bytes);
  const contentVersion = localUpdatedAt || Date.now();

  // Delete stale chunks first so an edited photo cannot retain old trailing chunks.
  await deletePhotoChunks(projectId, photo.id).catch(() => {});

  let batch = writeBatch(db);
  let count = 0;
  chunks.forEach((chunk, index) => {
    const chunkRef = doc(db, 'projects', projectId, 'photos', photo.id, 'chunks', String(index).padStart(5, '0'));
    batch.set(chunkRef, {
      index,
      data: Bytes.fromUint8Array(chunk),
      byteLength: chunk.byteLength,
      contentVersion,
      updatedAt: Date.now(),
    });
    count++;
  });
  if (count > 0) await batch.commit();

  await setDoc(metaRef, {
    ...baseMeta,
    mimeType: blob.type || photo.mimeType || 'image/jpeg',
    fileSize: blob.size,
    chunkCount: chunks.length,
    contentVersion,
    binaryMissingOnUploader: false,
    deleted: false,
    deletedAt: null,
    updatedAt: contentVersion,
    cloudSyncedAt: Date.now(),
  }, { merge: true });
}

export async function syncProjectPhotosToCloud(projectId: string): Promise<{ uploaded: number; skipped: number }> {
  const photos = await getProjectPhotos(projectId, true);
  let uploaded = 0;
  let skipped = 0;
  for (const photo of photos) {
    try {
      const ref = doc(db, 'projects', projectId, 'photos', photo.id);
      const snap = await getDoc(ref).catch(() => null);
      const cloudUpdatedAt = snap?.exists() ? Number(snap.data()?.updatedAt || 0) : 0;
      const localUpdatedAt = Number(photo.updatedAt || photo.createdAt || 0);
      const cloudData = snap?.exists() ? snap.data() : null;
      const cloudHasBinary = Boolean(cloudData?.deleted) || Number(cloudData?.chunkCount || 0) > 0;
      if (snap?.exists() && cloudUpdatedAt >= localUpdatedAt && Boolean(cloudData?.deleted) === Boolean(photo.deleted) && cloudHasBinary) {
        skipped++;
        continue;
      }
      await uploadPhotoToCloud(projectId, photo);
      uploaded++;
    } catch (err) {
      console.warn('[Photo Cloud] upload warning:', photo.id, err);
    }
  }
  return { uploaded, skipped };
}

export async function downloadPhotoBlobFromCloud(projectId: string, photoId: string, mimeType = 'image/jpeg'): Promise<Blob | null> {
  if (!projectId || !photoId) return null;
  const metaSnap = await getDoc(doc(db, 'projects', projectId, 'photos', photoId));
  if (!metaSnap.exists() || metaSnap.data()?.deleted) return null;

  const q = query(collection(db, 'projects', projectId, 'photos', photoId, 'chunks'), orderBy('index', 'asc'));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const parts: Uint8Array[] = [];
  snap.forEach((chunkDoc) => {
    const bytes = chunkDoc.data()?.data;
    if (bytes && typeof bytes.toUint8Array === 'function') {
      parts.push(bytes.toUint8Array());
    }
  });
  if (parts.length === 0) return null;
  const blob = new Blob(parts, { type: metaSnap.data()?.mimeType || mimeType });
  await cachePhotoBlob(photoId, blob, true);
  return blob;
}

export function subscribeProjectPhotosRealtime(
  projectId: string,
  onStatus?: (status: PhotoCloudSyncStatus) => void,
): () => void {
  if (!projectId) return () => {};
  const ref = collection(db, 'projects', projectId, 'photos');
  let firstSnapshot = true;

  const unsubscribe = onSnapshot(ref, async (snap) => {
    try {
      onStatus?.({ phase: 'syncing', pending: snap.docChanges().length });
      const cloudPhotos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PhotoAttachment));
      await mergeCloudPhotoMetadata(projectId, cloudPhotos);
      onStatus?.({ phase: 'synced', pending: 0, lastSyncAt: Date.now() });

      // After the initial merge, upload only local versions that are newer/missing on Cloud.
      if (firstSnapshot) {
        firstSnapshot = false;
        syncProjectPhotosToCloud(projectId).catch((err) => console.warn('[Photo Cloud] initial upload warning:', err));
      }
    } catch (err: any) {
      onStatus?.({ phase: 'error', message: err?.message || String(err) });
    }
  }, (err) => {
    onStatus?.({ phase: 'error', message: err?.message || String(err) });
  });

  return unsubscribe;
}
