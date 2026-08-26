import {
  deleteObject,
  getBlob,
  getMetadata,
  getStorage,
  ref,
  uploadBytes,
  type FullMetadata,
} from 'firebase/storage';
import { firebaseApp } from './firebase';

export const firebaseStorage = getStorage(firebaseApp);

function safeSegment(value: unknown, fallback = 'unknown'): string {
  const out = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return out.slice(0, 140) || fallback;
}

function extensionForMime(mimeType?: string): string {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

export interface FirebaseBinaryUploadResult {
  storagePath: string;
  thumbnailPath?: string;
  mimeType: string;
  size: number;
  md5Hash?: string;
  generation?: string;
  updated?: string;
}

export interface ProjectBinaryUploadInput {
  projectId: string;
  entityType: string;
  entityId: string;
  assetId: string;
  blob: Blob;
  thumbnailBlob?: Blob | null;
  mimeType?: string;
  createdByUid?: string;
  createdAt?: number;
}

export function buildPhotoStoragePaths(input: Pick<ProjectBinaryUploadInput, 'projectId' | 'entityType' | 'entityId' | 'assetId' | 'mimeType'>) {
  const ext = extensionForMime(input.mimeType);
  const base = `projects/${safeSegment(input.projectId)}/media/${safeSegment(input.entityType)}/${safeSegment(input.entityId)}/${safeSegment(input.assetId)}`;
  return {
    storagePath: `${base}/original.${ext}`,
    thumbnailPath: `${base}/thumb.${ext}`,
  };
}

export function buildFloorPlanStoragePaths(projectId: string, floorPlanId: string, mimeType?: string) {
  const ext = extensionForMime(mimeType);
  const base = `projects/${safeSegment(projectId)}/floor-plans/${safeSegment(floorPlanId)}`;
  return {
    storagePath: `${base}/original.${ext}`,
    thumbnailPath: `${base}/thumb.${ext}`,
  };
}

function metadataFor(input: ProjectBinaryUploadInput): Record<string, string> {
  return {
    projectId: String(input.projectId || ''),
    entityType: String(input.entityType || ''),
    entityId: String(input.entityId || ''),
    assetId: String(input.assetId || ''),
    createdByUid: String(input.createdByUid || ''),
    createdAt: String(Number(input.createdAt || Date.now())),
    app: 'HNL QLTC',
  };
}

function mapMetadata(path: string, meta: FullMetadata): FirebaseBinaryUploadResult {
  return {
    storagePath: path,
    mimeType: meta.contentType || 'application/octet-stream',
    size: Number(meta.size || 0),
    md5Hash: meta.md5Hash || undefined,
    generation: meta.generation || undefined,
    updated: meta.updated || undefined,
  };
}

export async function uploadProjectBinary(input: ProjectBinaryUploadInput): Promise<FirebaseBinaryUploadResult> {
  const paths = buildPhotoStoragePaths({ ...input, mimeType: input.mimeType || input.blob.type });
  const customMetadata = metadataFor(input);
  const originalRef = ref(firebaseStorage, paths.storagePath);
  const result = await uploadBytes(originalRef, input.blob, {
    contentType: input.mimeType || input.blob.type || 'application/octet-stream',
    cacheControl: 'private,max-age=31536000,immutable',
    customMetadata,
  });

  let thumbnailPath: string | undefined;
  if (input.thumbnailBlob && input.thumbnailBlob.size > 0) {
    const thumbRef = ref(firebaseStorage, paths.thumbnailPath);
    await uploadBytes(thumbRef, input.thumbnailBlob, {
      contentType: input.thumbnailBlob.type || input.mimeType || 'image/jpeg',
      cacheControl: 'private,max-age=31536000,immutable',
      customMetadata: { ...customMetadata, variant: 'thumbnail' },
    });
    thumbnailPath = paths.thumbnailPath;
  }

  return { ...mapMetadata(paths.storagePath, result.metadata), thumbnailPath };
}

export async function uploadFloorPlanBinary(input: {
  projectId: string;
  floorPlanId: string;
  blob: Blob;
  thumbnailBlob?: Blob | null;
  createdByUid?: string;
  createdAt?: number;
}): Promise<FirebaseBinaryUploadResult> {
  const paths = buildFloorPlanStoragePaths(input.projectId, input.floorPlanId, input.blob.type);
  const customMetadata = {
    projectId: input.projectId,
    entityType: 'floorPlan',
    entityId: input.floorPlanId,
    assetId: input.floorPlanId,
    createdByUid: input.createdByUid || '',
    createdAt: String(Number(input.createdAt || Date.now())),
    app: 'HNL QLTC',
  };
  const result = await uploadBytes(ref(firebaseStorage, paths.storagePath), input.blob, {
    contentType: input.blob.type || 'image/jpeg',
    cacheControl: 'private,max-age=31536000,immutable',
    customMetadata,
  });
  let thumbnailPath: string | undefined;
  if (input.thumbnailBlob && input.thumbnailBlob.size > 0) {
    await uploadBytes(ref(firebaseStorage, paths.thumbnailPath), input.thumbnailBlob, {
      contentType: input.thumbnailBlob.type || input.blob.type || 'image/jpeg',
      cacheControl: 'private,max-age=31536000,immutable',
      customMetadata: { ...customMetadata, variant: 'thumbnail' },
    });
    thumbnailPath = paths.thumbnailPath;
  }
  return { ...mapMetadata(paths.storagePath, result.metadata), thumbnailPath };
}

export async function downloadStorageBlob(storagePath?: string | null): Promise<Blob | null> {
  const path = String(storagePath || '').trim();
  if (!path) return null;
  try {
    return await getBlob(ref(firebaseStorage, path));
  } catch (err) {
    console.warn('[Firebase Storage] download failed:', path, err);
    return null;
  }
}

export async function readStorageMetadata(storagePath?: string | null): Promise<FullMetadata | null> {
  const path = String(storagePath || '').trim();
  if (!path) return null;
  try { return await getMetadata(ref(firebaseStorage, path)); } catch (_) { return null; }
}

/** Purge only. Normal business delete is soft-delete and must not call this immediately. */
export async function purgeStoragePath(storagePath?: string | null): Promise<void> {
  const path = String(storagePath || '').trim();
  if (!path) return;
  await deleteObject(ref(firebaseStorage, path)).catch((err: any) => {
    if (String(err?.code || '').includes('object-not-found')) return;
    throw err;
  });
}
