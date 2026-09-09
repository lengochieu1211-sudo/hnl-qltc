import localforage from 'localforage';
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
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import type { FloorPlan } from '../types';
import { downloadFloorPlanFromPrimaryDrive } from './primaryDriveBridge';
import { LEGACY_DRIVE_READ_FALLBACK } from '../config/runtimeArchitecture';
import { BINARY_STORAGE_PROVIDER, downloadBinaryBlob, uploadFloorPlanBinaryToCloud } from './binaryStorage';
import { compressImageToBlob } from '../utils/imageCompressor';

const FLOOR_PLAN_OUTBOX_PREFIX = 'floor_plan_image_outbox_v1';

interface FloorPlanImageOutboxRecord {
  projectId: string;
  floorPlanId: string;
  revision: number;
  createdByUid: string;
  createdAt: number;
  blob: Blob;
}

export interface FloorPlanImageOutboxDiagnosticRow {
  projectId: string;
  floorPlanId: string;
  revision: number;
  createdByUid: string;
  createdAt: number;
  bytes: number;
  mimeType: string;
}

function encodeOutboxSegment(value: unknown): string {
  return encodeURIComponent(String(value || '').trim());
}

function floorPlanOutboxPrefixFor(projectId: string, uid: string): string {
  return `${FLOOR_PLAN_OUTBOX_PREFIX}:${encodeOutboxSegment(uid)}:${encodeOutboxSegment(projectId)}:`;
}

function floorPlanOutboxKey(projectId: string, floorPlanId: string, revision: number, uid: string): string {
  return `${floorPlanOutboxPrefixFor(projectId, uid)}${encodeOutboxSegment(floorPlanId)}:${Math.max(0, Number(revision || 0))}`;
}

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

async function writeFloorPlanOutboxBlob(
  projectId: string,
  floorPlanId: string,
  revision: number,
  blob: Blob,
  uid: string,
): Promise<void> {
  if (!projectId || !floorPlanId || !uid || !blob || blob.size <= 0) {
    throw new Error('FLOOR_PLAN_OUTBOX_INVALID');
  }
  const record: FloorPlanImageOutboxRecord = {
    projectId,
    floorPlanId,
    revision: Number(revision || Date.now()),
    createdByUid: uid,
    createdAt: Date.now(),
    blob,
  };
  await localforage.setItem(floorPlanOutboxKey(projectId, floorPlanId, record.revision, uid), record);
}

/** Persist the replacement drawing before React/Firestore reconciliation can touch it. */
export async function stageFloorPlanImageOutbox(
  projectId: string,
  floorPlanId: string,
  revision: number,
  imageUrl: string,
): Promise<{ bytes: number; mimeType: string }> {
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.uid) throw new Error('FLOOR_PLAN_OUTBOX_AUTH_UNAVAILABLE');
  const blob = await sourceToBlob(imageUrl);
  if (!blob || blob.size <= 0) throw new Error('FLOOR_PLAN_OUTBOX_BINARY_UNREADABLE');
  await writeFloorPlanOutboxBlob(projectId, floorPlanId, revision, blob, user.uid);
  return { bytes: blob.size, mimeType: blob.type || 'image/jpeg' };
}

async function getFloorPlanOutboxRecord(
  projectId: string,
  floorPlanId: string,
  revision: number,
  uid: string,
): Promise<FloorPlanImageOutboxRecord | null> {
  if (!projectId || !floorPlanId || !uid || !revision) return null;
  const record = await localforage.getItem<FloorPlanImageOutboxRecord>(floorPlanOutboxKey(projectId, floorPlanId, revision, uid));
  if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size <= 0) return null;
  if (record.projectId !== projectId || record.floorPlanId !== floorPlanId || Number(record.revision || 0) !== Number(revision)) return null;
  if (record.createdByUid !== uid) return null;
  return record;
}

async function getLatestFloorPlanOutboxRevision(projectId: string, floorPlanId: string, uid: string): Promise<number> {
  if (!projectId || !floorPlanId || !uid) return 0;
  const prefix = floorPlanOutboxPrefixFor(projectId, uid);
  const keys = await localforage.keys();
  let latest = 0;
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record || record.floorPlanId !== floorPlanId || record.createdByUid !== uid) continue;
    latest = Math.max(latest, Number(record.revision || 0));
  }
  return latest;
}

async function clearFloorPlanOutboxUpTo(projectId: string, floorPlanId: string, revision: number, uid: string): Promise<void> {
  if (!projectId || !floorPlanId || !uid) return;
  const prefix = floorPlanOutboxPrefixFor(projectId, uid);
  const keys = await localforage.keys();
  await Promise.all(keys.map(async (key) => {
    if (!key.startsWith(prefix)) return;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record || record.floorPlanId !== floorPlanId || record.createdByUid !== uid) return;
    if (Number(record.revision || 0) <= Number(revision || 0)) await localforage.removeItem(key).catch(() => {});
  }));
}

export async function getFloorPlanImageOutboxSnapshot(projectId: string): Promise<FloorPlanImageOutboxDiagnosticRow[]> {
  const user = getCurrentRealFirebaseUser();
  if (!projectId || !user?.uid) return [];
  const prefix = floorPlanOutboxPrefixFor(projectId, user.uid);
  const keys = await localforage.keys();
  const rows: FloorPlanImageOutboxDiagnosticRow[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record?.blob || record.projectId !== projectId || record.createdByUid !== user.uid) continue;
    rows.push({
      projectId,
      floorPlanId: record.floorPlanId,
      revision: Number(record.revision || 0),
      createdByUid: record.createdByUid,
      createdAt: Number(record.createdAt || 0),
      bytes: Number(record.blob.size || 0),
      mimeType: String(record.blob.type || ''),
    });
  }
  return rows.sort((a, b) => b.revision - a.revision);
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
  if (!projectId || !plan?.id) return null;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.uid) return null;

  const revision = Number(plan.imageRevision || (plan as any).imageOutboxRevision || (plan as any).updatedAt || Date.now());
  if (Number(plan.imageCloudRevision || 0) >= revision && plan.storageProvider === BINARY_STORAGE_PROVIDER && plan.storagePath) {
    await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});
    return null;
  }

  // Capture a local data/blob URL into IndexedDB BEFORE any auth/network work. If a
  // realtime snapshot races this upload, the binary still survives under this revision.
  let blob: Blob | null = null;
  if (isLocalFloorPlanBinaryUrl(plan.imageUrl)) {
    blob = await sourceToBlob(plan.imageUrl);
    if (blob && blob.size > 0) {
      await writeFloorPlanOutboxBlob(projectId, plan.id, revision, blob, user.uid);
    }
  }
  if (!blob || blob.size <= 0) {
    const outbox = await getFloorPlanOutboxRecord(projectId, plan.id, revision, user.uid);
    blob = outbox?.blob || null;
  }
  if (!blob || blob.size <= 0) throw new Error(`FLOOR_PLAN_BINARY_MISSING:${plan.floorName || plan.id}:${revision}`);

  // Firebase-only deliberately makes getCurrentUserRole() return VIEWER, so upload
  // authorization MUST use the project-scoped Cloud role instead of the legacy cache.
  const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
  if (roleInfo.verification !== 'verified') throw new Error('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE');
  if (!roleInfo.allowed || roleInfo.role !== 'ADMIN') throw new Error('FLOOR_PLAN_ADMIN_REQUIRED');

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

  // If the user replaced the same floor again while revision A was uploading, never
  // publish A as the latest Firestore pointer. B remains in the outbox and wins.
  const latestPendingRevision = await getLatestFloorPlanOutboxRevision(projectId, plan.id, user.uid).catch(() => revision);
  if (latestPendingRevision > revision) {
    await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});
    return null;
  }

  const now = Date.now();
  const metadata: Partial<FloorPlan> & Record<string, any> = {
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
    imageUploadState: 'ready',
    imagePendingByUid: null,
    imageOutboxRevision: revision,
    revision: Math.max(Number((plan as any).revision || 0), 0) + 1,
    updatedByUid: user.uid,
    deletedAt: null,
    deletedByUid: null,
    deletedBy: null,
    updatedAt: Math.max(now, Number((plan as any).updatedAt || 0) + 1),
  };
  await setDoc(doc(db, 'projects', projectId, 'floor_plans', plan.id), metadata, { merge: true });
  await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});

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
  // Pure data + current uploader identity. Authorization remains in the scheduler and
  // sync function. A pending outbox marker keeps work discoverable after a cloud
  // snapshot replaces the in-memory data/blob URL.
  if (!plan?.id) return false;
  const revision = Number(plan.imageRevision || (plan as any).imageOutboxRevision || (isLocalFloorPlanBinaryUrl(plan.imageUrl) ? (plan as any).updatedAt || 0 : 0));
  if (!revision) return false;
  const cloudRevision = Number(plan.imageCloudRevision || 0);
  const cloudReady = cloudRevision >= revision && plan.storageProvider === BINARY_STORAGE_PROVIDER && Boolean(plan.storagePath);
  if (cloudReady) return false;
  if (isLocalFloorPlanBinaryUrl(plan.imageUrl)) return true;

  const userUid = getCurrentRealFirebaseUser()?.uid || '';
  const pendingOwnerUid = String((plan as any).imagePendingByUid || '');
  const pendingRevision = Number((plan as any).imageOutboxRevision || 0);
  return String((plan as any).imageUploadState || '') === 'pending'
    && Boolean(userUid)
    && pendingOwnerUid === userUid
    && pendingRevision >= revision;
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
      const result = await syncFloorPlanImageToCloud(projectId, plan);
      if (result) uploaded++;
      else skipped++;
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
