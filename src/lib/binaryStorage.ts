import { FIREBASE_EMULATOR_ENABLED, getCurrentRealFirebaseUser } from './firebase';
import {
  downloadStorageBlob,
  readStorageMetadata,
  uploadFloorPlanBinary,
  uploadProjectBinary,
  type FirebaseBinaryUploadResult,
  type ProjectBinaryUploadInput,
} from './firebaseStorage';
import {
  downloadR2Blob,
  isR2Configured,
  verifyR2ObjectReady,
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

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Media metadata is published only after the binary is durable. An existing attachment
 * can also be edited/replaced while keeping the same logical photoId. Therefore the
 * physical asset directory must be immutable per content revision: otherwise uploading
 * replacement bytes to the old path can change what other devices read before Firestore
 * publishes the replacement metadata. The logical photo id remains unchanged in the
 * Firestore record; only the private binary assetId is content-addressed.
 *
 * Object-level createdByUid means the authenticated uploader of this immutable binary,
 * not necessarily the original author of the logical photo record. Binding it here to
 * the real Firebase user keeps Firebase Storage Rules and R2 audit metadata consistent
 * when an authorized second project member edits an existing attachment.
 */
async function immutableMediaInput(input: ProjectBinaryUploadInput): Promise<ProjectBinaryUploadInput> {
  const contentSha256 = await sha256Hex(input.blob);
  const logicalAssetId = String(input.assetId || 'asset').trim() || 'asset';
  const uploaderUid = getCurrentRealFirebaseUser()?.uid || String(input.createdByUid || '');
  return {
    ...input,
    assetId: `${logicalAssetId}--${contentSha256}`,
    createdByUid: uploaderUid,
  };
}

// Keep the provider boundary explicit. Stability/architecture gates intentionally look
// for this direct call to prove that the adapter still has exactly one R2 write authority;
// callers pass only the already content-addressed immutable input into this helper.
async function uploadImmutableProjectBinaryToR2(input: ProjectBinaryUploadInput) {
  return uploadProjectBinaryToR2(input);
}

export function binaryStorageReady(): boolean {
  return BINARY_STORAGE_PROVIDER === 'firebase-storage' || isR2Configured();
}

export async function uploadProjectBinaryToCloud(input: ProjectBinaryUploadInput): Promise<BinaryUploadResult> {
  // P0 atomic publication: even when the logical photoId is reused by image editing,
  // never overwrite bytes behind a Firestore pointer that another device can still see.
  const immutableInput = await immutableMediaInput(input);
  if (BINARY_STORAGE_PROVIDER === 'firebase-storage') return mapFirebase(await uploadProjectBinary(immutableInput));
  // RC2.2.13: PROD media has one write authority only: private Cloudflare R2.
  // If R2 is unavailable, callers keep the Blob in the account-scoped outbox and
  // retry R2. Do not silently write new media to a second provider.
  const result = await uploadImmutableProjectBinaryToR2(immutableInput);
  return {
    provider: 'r2', storagePath: result.storagePath, thumbnailPath: result.thumbnailPath,
    mimeType: result.mimeType, size: result.size, checksum: result.sha256, etag: result.etag, updated: result.updated,
  };
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

export async function verifyBinaryObjectReady(
  provider: string | null | undefined,
  storagePath?: string | null,
  expectedSize?: number,
  expectedChecksum?: string,
): Promise<boolean> {
  const path = String(storagePath || '').trim();
  if (!path) return false;
  if (provider === 'r2' || String(provider || '').startsWith('r2')) {
    const verified = await verifyR2ObjectReady(path, expectedSize, expectedChecksum).catch(() => null);
    return Boolean(verified?.ready);
  }
  if (provider === 'firebase-storage') {
    const meta = await readStorageMetadata(path).catch(() => null);
    if (!meta) return false;
    const size = Number(meta.size || 0);
    return size > 0 && (!expectedSize || size === Number(expectedSize));
  }
  return false;
}
