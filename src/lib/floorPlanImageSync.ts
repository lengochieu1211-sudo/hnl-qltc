import {
  Bytes,
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import type { FloorPlan } from '../types';
import {
  downloadFloorPlanFromPrimaryDrive,
  isPrimaryDriveReady,
  PRIMARY_DRIVE_OWNER_EMAIL,
  uploadFloorPlanToPrimaryDrive,
  deleteFloorPlanFromPrimaryDrive,
} from './primaryDriveBridge';

const CHUNK_BYTES = 560 * 1024;

export function isDisplayableFloorPlanUrl(value?: string | null): boolean {
  const url = String(value || '').trim();
  return url.startsWith('data:image/') || url.startsWith('blob:') || /^https?:\/\//i.test(url);
}

export function isLocalFloorPlanBinaryUrl(value?: string | null): boolean {
  const url = String(value || '').trim();
  return url.startsWith('data:image/') || url.startsWith('blob:');
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || 'image/jpeg' });
  } catch (_) {
    return null;
  }
}

async function sourceToBlob(source: string): Promise<Blob | null> {
  const value = String(source || '').trim();
  if (!value) return null;
  if (value.startsWith('data:image/')) return dataUrlToBlob(value);
  if (value.startsWith('blob:')) {
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh mặt bằng.'));
    reader.readAsDataURL(blob);
  });
}

function splitBytes(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + CHUNK_BYTES)));
  }
  return chunks;
}

async function deleteFallbackChunks(projectId: string, floorPlanId: string): Promise<void> {
  const chunksRef = collection(db, 'projects', projectId, 'floor_plan_images', floorPlanId, 'chunks');
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

async function uploadFallback(projectId: string, plan: FloorPlan, blob: Blob, revision: number): Promise<Partial<FloorPlan>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = splitBytes(bytes);
  await deleteFallbackChunks(projectId, plan.id).catch(() => {});

  let batch = writeBatch(db);
  let count = 0;
  chunks.forEach((chunk, index) => {
    const chunkRef = doc(db, 'projects', projectId, 'floor_plan_images', plan.id, 'chunks', String(index).padStart(5, '0'));
    batch.set(chunkRef, {
      index,
      data: Bytes.fromUint8Array(chunk),
      byteLength: chunk.byteLength,
      revision,
      updatedAt: Date.now(),
    });
    count++;
  });
  if (count > 0) await batch.commit();

  const now = Date.now();
  await setDoc(doc(db, 'projects', projectId, 'floor_plan_images', plan.id), {
    id: plan.id,
    floorName: plan.floorName || '',
    mimeType: blob.type || 'image/jpeg',
    fileSize: blob.size,
    chunkCount: chunks.length,
    revision,
    storageProvider: 'firestore-fallback',
    updatedAt: now,
    deleted: false,
  }, { merge: true });

  const metadata: Partial<FloorPlan> = {
    imageUrl: `cloud-floorplan:firestore:${projectId}:${plan.id}`,
    storageProvider: 'firestore-fallback',
    cloudFileId: `firestore:${projectId}:${plan.id}`,
    imageMimeType: blob.type || 'image/jpeg',
    imageFileSize: blob.size,
    imageRevision: revision,
    imageCloudRevision: revision,
    imageCloudSyncedAt: now,
    updatedAt: Math.max(now, Number((plan as any).updatedAt || 0) + 1),
  };

  await setDoc(doc(db, 'projects', projectId, 'floor_plans', plan.id), {
    ...metadata,
    // If a Drive-backed drawing is replaced while Drive is temporarily unavailable,
    // remove the stale Drive identity. Otherwise another device can keep attempting
    // the old Drive file even though this revision now lives in the Firestore fallback.
    driveFileId: deleteField(),
    driveUrl: deleteField(),
  }, { merge: true });
  return metadata;
}

export async function syncFloorPlanImageToCloud(projectId: string, plan: FloorPlan): Promise<Partial<FloorPlan> | null> {
  if (!projectId || !plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return null;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) return null;

  const revision = Number(plan.imageRevision || (plan as any).updatedAt || Date.now());
  if (Number(plan.imageCloudRevision || 0) >= revision && (plan.driveFileId || plan.cloudFileId || plan.storageProvider)) return null;

  const blob = await sourceToBlob(plan.imageUrl);
  if (!blob || blob.size <= 0) throw new Error(`Không đọc được ảnh mặt bằng ${plan.floorName || plan.id}.`);

  try {
    if (await isPrimaryDriveReady()) {
      const drive = await uploadFloorPlanToPrimaryDrive(projectId, { ...plan, imageRevision: revision });
      if (drive?.fileId) {
        const now = Date.now();
        const metadata: Partial<FloorPlan> = {
          imageUrl: `cloud-floorplan:drive:${projectId}:${drive.fileId}`,
          driveFileId: drive.fileId,
          driveUrl: `drive:${projectId}:${drive.fileId}`,
          cloudFileId: `drive:${projectId}:${drive.fileId}`,
          storageProvider: 'google-drive-primary',
          imageMimeType: drive.mimeType || blob.type || 'image/jpeg',
          imageFileSize: Number(drive.fileSize || blob.size || 0),
          imageRevision: revision,
          imageCloudRevision: revision,
          imageCloudSyncedAt: now,
          updatedAt: Math.max(now, Number((plan as any).updatedAt || 0) + 1),
        };
        await setDoc(doc(db, 'projects', projectId, 'floor_plans', plan.id), metadata, { merge: true });
        await deleteFallbackChunks(projectId, plan.id).catch(() => {});
        return metadata;
      }
    }
  } catch (err) {
    console.warn('[Floor Plan Image] Primary Drive unavailable, using Firestore fallback:', err);
  }

  return uploadFallback(projectId, plan, blob, revision);
}

async function downloadFallback(projectId: string, plan: FloorPlan): Promise<Blob | null> {
  const metaSnap = await getDoc(doc(db, 'projects', projectId, 'floor_plan_images', plan.id));
  if (!metaSnap.exists() || metaSnap.data()?.deleted) return null;
  const q = query(collection(db, 'projects', projectId, 'floor_plan_images', plan.id, 'chunks'), orderBy('index', 'asc'));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const parts: Uint8Array[] = [];
  snap.forEach((chunkDoc) => {
    const value = chunkDoc.data()?.data;
    if (value && typeof value.toUint8Array === 'function') parts.push(value.toUint8Array());
  });
  if (parts.length === 0) return null;
  return new Blob(parts, { type: plan.imageMimeType || metaSnap.data()?.mimeType || 'image/jpeg' });
}

function parseDriveFileId(plan: FloorPlan): string {
  if (plan.driveFileId) return String(plan.driveFileId);
  const raw = String(plan.cloudFileId || plan.driveUrl || '');
  if (!raw.startsWith('drive:')) return '';
  const parts = raw.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : parts[1] || '';
}

export async function loadFloorPlanImageFromCloud(projectId: string, plan: FloorPlan): Promise<string | null> {
  if (!projectId || !plan?.id) return null;
  if (isDisplayableFloorPlanUrl(plan.imageUrl) && !String(plan.imageUrl).includes('[IMAGE_OMITTED')) return plan.imageUrl;

  let blob: Blob | null = null;
  const driveFileId = parseDriveFileId(plan);
  if (driveFileId && (plan.storageProvider === 'google-drive-primary' || plan.driveFileId || String(plan.cloudFileId || '').startsWith('drive:'))) {
    try {
      blob = await downloadFloorPlanFromPrimaryDrive(projectId, plan.id, driveFileId, plan.imageMimeType || 'image/jpeg');
    } catch (err) {
      console.warn('[Floor Plan Image] Drive download warning:', err);
    }
  }
  if (!blob) {
    try {
      blob = await downloadFallback(projectId, plan);
    } catch (err) {
      console.warn('[Floor Plan Image] Firestore fallback download warning:', err);
    }
  }
  if (!blob || blob.size <= 0) return null;
  return blobToDataUrl(blob);
}

export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {
  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;
  const revision = Number(plan.imageRevision || (plan as any).updatedAt || 0);
  return !plan.imageCloudRevision || Number(plan.imageCloudRevision) < revision || (!plan.driveFileId && !plan.cloudFileId && !plan.storageProvider);
}

export async function syncFloorPlanImagesToCloud(projectId: string, floorPlans: FloorPlan[]): Promise<{ uploaded: number; skipped: number; failed: number }> {
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const plan of floorPlans || []) {
    if (!floorPlanNeedsCloudUpload(plan)) {
      skipped++;
      continue;
    }
    try {
      await syncFloorPlanImageToCloud(projectId, plan);
      uploaded++;
    } catch (err) {
      failed++;
      console.warn('[Floor Plan Image] manual sync warning:', plan.floorName, err);
    }
  }
  return { uploaded, skipped, failed };
}


/** Remove binary floor-plan data from the active cloud provider after the business
 * floor record has been deleted. Failures are non-fatal and can be retried later. */
export async function deleteFloorPlanImageFromCloud(projectId: string, plan: FloorPlan): Promise<void> {
  if (!projectId || !plan?.id) return;
  const driveFileId = parseDriveFileId(plan);
  if (driveFileId) {
    await deleteFloorPlanFromPrimaryDrive(projectId, plan.id, driveFileId).catch((err) => {
      console.warn('[Floor Plan Image] Drive delete warning:', err);
    });
  }
  await deleteFallbackChunks(projectId, plan.id).catch((err) => {
    console.warn('[Floor Plan Image] fallback chunk delete warning:', err);
  });
  await deleteDoc(doc(db, 'projects', projectId, 'floor_plan_images', plan.id)).catch(() => {});
}
