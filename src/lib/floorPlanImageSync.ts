import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import type { FloorPlan } from '../types';
import { downloadFloorPlanFromPrimaryDrive } from './primaryDriveBridge';
import { LEGACY_DRIVE_READ_FALLBACK } from '../config/runtimeArchitecture';
import { BINARY_STORAGE_PROVIDER, downloadBinaryBlob, uploadFloorPlanBinaryToCloud } from './binaryStorage';
import { compressImageToBlob } from '../utils/imageCompressor';

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

export async function syncFloorPlanImageToCloud(projectId: string, plan: FloorPlan): Promise<Partial<FloorPlan> | null> {
  if (!projectId || !plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return null;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) return null;

  const revision = Number(plan.imageRevision || (plan as any).updatedAt || Date.now());
  if (Number(plan.imageCloudRevision || 0) >= revision && plan.storageProvider === BINARY_STORAGE_PROVIDER && plan.storagePath) return null;

  const blob = await sourceToBlob(plan.imageUrl);
  if (!blob || blob.size <= 0) throw new Error(`Không đọc được ảnh mặt bằng ${plan.floorName || plan.id}.`);

  let thumbnailBlob: Blob | null = null;
  try { thumbnailBlob = await compressImageToBlob(blob, 480, 0.72); } catch (_) {}
  const uploaded = await uploadFloorPlanBinaryToCloud({
    projectId,
    floorPlanId: plan.id,
    blob,
    thumbnailBlob,
    createdByUid: user.uid,
    createdAt: Number((plan as any).createdAt || Date.now()),
  });

  const now = Date.now();
  const metadata: Partial<FloorPlan> = {
    imageUrl: `cloud-floorplan:${uploaded.provider}:${uploaded.storagePath}`,
    cloudFileId: `${uploaded.provider === 'r2' ? 'r2' : 'storage'}:${uploaded.storagePath}`,
    storageProvider: uploaded.provider,
    storagePath: uploaded.storagePath,
    thumbnailPath: uploaded.thumbnailPath || '',
    storageMd5Hash: uploaded.checksum || '',
    storageEtag: uploaded.etag || '',
    imageMimeType: uploaded.mimeType || blob.type || 'image/jpeg',
    imageFileSize: Number(uploaded.size || blob.size || 0),
    imageRevision: revision,
    imageCloudRevision: revision,
    imageCloudSyncedAt: now,
    revision: Math.max(Number((plan as any).revision || 0), 0) + 1,
    updatedByUid: user.uid,
    deletedAt: null,
    deletedByUid: null,
    deletedBy: null,
    updatedAt: Math.max(now, Number((plan as any).updatedAt || 0) + 1),
  };
  await setDoc(doc(db, 'projects', projectId, 'floor_plans', plan.id), metadata, { merge: true });

  // Do not delete Drive/chunk legacy binary yet. Migration cleanup is a separate,
  // verified purge pass after count + checksum + Firestore-reference parity.
  return metadata;
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

function parseStoragePointer(plan: FloorPlan): { provider: string; path: string } {
  const raw = String(plan.cloudFileId || '');
  const inferredProvider = raw.startsWith('r2:') ? 'r2' : raw.startsWith('storage:') ? 'firebase-storage' : '';
  if (plan.storagePath) return { provider: String(plan.storageProvider || inferredProvider), path: String(plan.storagePath) };
  if (raw.startsWith('r2:')) return { provider: 'r2', path: raw.slice(3) };
  if (raw.startsWith('storage:')) return { provider: 'firebase-storage', path: raw.slice('storage:'.length) };
  return { provider: '', path: '' };
}

export async function loadFloorPlanImageFromCloud(projectId: string, plan: FloorPlan): Promise<string | null> {
  if (!projectId || !plan?.id) return null;
  if (isDisplayableFloorPlanUrl(plan.imageUrl) && !String(plan.imageUrl).includes('[IMAGE_OMITTED')) return plan.imageUrl;

  let blob: Blob | null = null;
  const pointer = parseStoragePointer(plan);
  if (pointer.path && (pointer.provider === 'r2' || pointer.provider === 'firebase-storage')) {
    blob = await downloadBinaryBlob(pointer.provider, pointer.path);
  }

  if (!blob && LEGACY_DRIVE_READ_FALLBACK) {
    const driveFileId = parseDriveFileId(plan);
    if (driveFileId && (plan.storageProvider === 'google-drive-primary' || plan.driveFileId || String(plan.cloudFileId || '').startsWith('drive:'))) {
      try {
        blob = await downloadFloorPlanFromPrimaryDrive(projectId, plan.id, driveFileId, plan.imageMimeType || 'image/jpeg');
      } catch (err) {
        console.warn('[Floor Plan Image] legacy Drive read warning:', err);
      }
    }
  }

  if (!blob) {
    try {
      blob = await downloadFallback(projectId, plan);
    } catch (err) {
      console.warn('[Floor Plan Image] legacy Firestore chunk read warning:', err);
    }
  }
  if (!blob || blob.size <= 0) return null;
  return blobToDataUrl(blob);
}

export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {
  if (!plan?.id || !isLocalFloorPlanBinaryUrl(plan.imageUrl)) return false;
  const revision = Number(plan.imageRevision || (plan as any).updatedAt || 0);
  return !plan.imageCloudRevision || Number(plan.imageCloudRevision) < revision || plan.storageProvider !== BINARY_STORAGE_PROVIDER || !plan.storagePath;
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
  // Firebase-only soft delete: the business floor-plan document is tombstoned by the
  // normal Firestore write path. Binary objects stay in Storage (and legacy Drive)
  // until retention purge after migration verification. Never hard-delete on UI delete.
  console.debug('[Floor Plan Image] soft-delete retains binary for recovery', projectId, plan.id);
}
