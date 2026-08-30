import { FIREBASE_EMULATOR_ENABLED } from './firebase';
import {
  downloadStorageBlob,
  uploadFloorPlanBinary,
  uploadProjectBinary,
  type FirebaseBinaryUploadResult,
  type ProjectBinaryUploadInput,
} from './firebaseStorage';
import {
  downloadR2Blob,
  isR2Configured,
  uploadFloorPlanBinaryToR2,
  uploadProjectBinaryToR2,
} from './r2Storage';

const env = (import.meta as any).env || {};
export type BinaryStorageProvider = 'r2' | 'firebase-storage';

const requestedProvider = String(env.VITE_BINARY_STORAGE_PROVIDER || 'r2').trim().toLowerCase();
export const BINARY_STORAGE_PROVIDER: BinaryStorageProvider = FIREBASE_EMULATOR_ENABLED
  ? 'firebase-storage'
  : requestedProvider === 'firebase-storage' ? 'firebase-storage' : 'r2';

export interface BinaryUploadResult {
  provider: BinaryStorageProvider;
  storagePath: string;
  thumbnailPath?: string;
  mimeType: string;
  size: number;
  checksum?: string;
  etag?: string;
  generation?: string;
  updated?: string;
}

function mapFirebase(result: FirebaseBinaryUploadResult): BinaryUploadResult {
  return {
    provider: 'firebase-storage', storagePath: result.storagePath, thumbnailPath: result.thumbnailPath,
    mimeType: result.mimeType, size: result.size, checksum: result.md5Hash,
    generation: result.generation, updated: result.updated,
  };
}

export function binaryStorageReady(): boolean {
  return BINARY_STORAGE_PROVIDER === 'firebase-storage' || isR2Configured();
}

export async function uploadProjectBinaryToCloud(input: ProjectBinaryUploadInput): Promise<BinaryUploadResult> {
  if (BINARY_STORAGE_PROVIDER === 'firebase-storage') return mapFirebase(await uploadProjectBinary(input));
  try {
    const result = await uploadProjectBinaryToR2(input);
    return {
      provider: 'r2', storagePath: result.storagePath, thumbnailPath: result.thumbnailPath,
      mimeType: result.mimeType, size: result.size, checksum: result.sha256, etag: result.etag, updated: result.updated,
    };
  } catch (r2Error) {
    // RC2.2.12 reliability failover: Firestore remains the business source of truth.
    // If the R2 Worker/network path is temporarily unavailable, store this photo in
    // the existing Firebase Storage fallback instead of leaving the outbox pending.
    console.warn('[Binary Storage] R2 upload failed; falling back to Firebase Storage for this media object.', r2Error);
    return mapFirebase(await uploadProjectBinary(input));
  }
}

export async function uploadFloorPlanBinaryToCloud(input: Parameters<typeof uploadFloorPlanBinary>[0]): Promise<BinaryUploadResult> {
  if (BINARY_STORAGE_PROVIDER === 'firebase-storage') return mapFirebase(await uploadFloorPlanBinary(input));
  const result = await uploadFloorPlanBinaryToR2(input);
  return {
    provider: 'r2', storagePath: result.storagePath, thumbnailPath: result.thumbnailPath,
    mimeType: result.mimeType, size: result.size, checksum: result.sha256, etag: result.etag, updated: result.updated,
  };
}

export async function downloadBinaryBlob(provider: string | null | undefined, storagePath?: string | null): Promise<Blob | null> {
  if (!storagePath) return null;
  if (provider === 'r2') return downloadR2Blob(storagePath);
  if (provider === 'firebase-storage') return downloadStorageBlob(storagePath);
  if (String(provider || '').startsWith('r2')) return downloadR2Blob(storagePath);
  return downloadStorageBlob(storagePath);
}
