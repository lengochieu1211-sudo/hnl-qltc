import { getCurrentRealFirebaseUser } from './firebase';

const env = (import.meta as any).env || {};
const R2_GATEWAY_URL = String(env.VITE_R2_GATEWAY_URL || '').trim().replace(/\/+$/, '');

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

export interface R2BinaryUploadResult {
  storagePath: string;
  thumbnailPath?: string;
  mimeType: string;
  size: number;
  sha256?: string;
  etag?: string;
  updated?: string;
}

export interface R2ObjectVerification {
  ready: boolean;
  size: number;
  sha256?: string;
  etag?: string;
}

export interface R2ProjectBinaryUploadInput {
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

export function isR2Configured(): boolean {
  return /^https:\/\//i.test(R2_GATEWAY_URL);
}

export function buildR2PhotoPaths(input: Pick<R2ProjectBinaryUploadInput, 'projectId' | 'entityType' | 'entityId' | 'assetId' | 'mimeType'>) {
  const ext = extensionForMime(input.mimeType);
  const base = `projects/${safeSegment(input.projectId)}/media/${safeSegment(input.entityType)}/${safeSegment(input.entityId)}/${safeSegment(input.assetId)}`;
  return { storagePath: `${base}/original.${ext}`, thumbnailPath: `${base}/thumb.${ext}` };
}

export function buildR2FloorPlanPaths(projectId: string, floorPlanId: string, mimeType?: string) {
  const ext = extensionForMime(mimeType);
  const base = `projects/${safeSegment(projectId)}/floor-plans/${safeSegment(floorPlanId)}`;
  return { storagePath: `${base}/original.${ext}`, thumbnailPath: `${base}/thumb.${ext}` };
}

async function authHeader(): Promise<string> {
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('R2_AUTH_UNAVAILABLE');
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

function gatewayUrl(path: string, storagePath: string): string {
  if (!isR2Configured()) throw new Error('R2_GATEWAY_NOT_CONFIGURED');
  return `${R2_GATEWAY_URL}${path}?key=${encodeURIComponent(storagePath)}`;
}

export async function verifyR2ObjectReady(
  storagePath: string,
  expectedSize?: number,
  expectedSha256?: string,
): Promise<R2ObjectVerification> {
  const response = await fetch(gatewayUrl('/v1/object', storagePath), {
    method: 'HEAD',
    headers: { Authorization: await authHeader() },
    cache: 'no-store',
  });
  if (!response.ok) return { ready: false, size: 0 };
  const size = Number(response.headers.get('Content-Length') || 0);
  const sha256 = String(response.headers.get('X-HNL-SHA256') || '').trim() || undefined;
  const etag = String(response.headers.get('etag') || '').trim() || undefined;
  const sizeMatches = !expectedSize || size === Number(expectedSize);
  const checksumMatches = !expectedSha256 || !sha256 || sha256 === expectedSha256;
  return { ready: size > 0 && sizeMatches && checksumMatches, size, sha256, etag };
}

async function putObject(storagePath: string, blob: Blob, metadata: Record<string, string>): Promise<R2BinaryUploadResult> {
  const response = await fetch(gatewayUrl('/v1/object', storagePath), {
    method: 'PUT',
    headers: {
      Authorization: await authHeader(),
      'Content-Type': blob.type || 'application/octet-stream',
      'X-HNL-Metadata': encodeURIComponent(JSON.stringify(metadata)),
    },
    body: blob,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`R2_UPLOAD_FAILED:${response.status}:${detail.slice(0, 300)}`);
  }
  const result = await response.json() as any;
  const returnedSize = Number(result.size || 0);
  const returnedSha256 = String(result.sha256 || '') || undefined;
  if (!returnedSize || returnedSize !== blob.size) {
    throw new Error(`R2_UPLOAD_SIZE_MISMATCH:${storagePath}:${returnedSize}:${blob.size}`);
  }
  const verified = await verifyR2ObjectReady(storagePath, blob.size, returnedSha256);
  if (!verified.ready) {
    throw new Error(`R2_UPLOAD_NOT_DURABLE:${storagePath}:${verified.size}:${blob.size}`);
  }
  return {
    storagePath,
    mimeType: String(result.mimeType || blob.type || 'application/octet-stream'),
    size: returnedSize,
    sha256: verified.sha256 || returnedSha256,
    etag: verified.etag || String(result.etag || '') || undefined,
    updated: String(result.updated || '') || undefined,
  };
}

export async function uploadProjectBinaryToR2(input: R2ProjectBinaryUploadInput): Promise<R2BinaryUploadResult> {
  const paths = buildR2PhotoPaths({ ...input, mimeType: input.mimeType || input.blob.type });
  const metadata = {
    projectId: String(input.projectId || ''), entityType: String(input.entityType || ''),
    entityId: String(input.entityId || ''), assetId: String(input.assetId || ''),
    createdByUid: String(input.createdByUid || ''), createdAt: String(Number(input.createdAt || Date.now())), app: 'HNL QLTC',
  };
  const original = await putObject(paths.storagePath, input.blob, metadata);
  let thumbnailPath: string | undefined;
  if (input.thumbnailBlob && input.thumbnailBlob.size > 0) {
    await putObject(paths.thumbnailPath, input.thumbnailBlob, { ...metadata, variant: 'thumbnail' });
    thumbnailPath = paths.thumbnailPath;
  }
  return { ...original, thumbnailPath };
}

export async function uploadFloorPlanBinaryToR2(input: {
  projectId: string; floorPlanId: string; blob: Blob; thumbnailBlob?: Blob | null; createdByUid?: string; createdAt?: number;
}): Promise<R2BinaryUploadResult> {
  const paths = buildR2FloorPlanPaths(input.projectId, input.floorPlanId, input.blob.type);
  const metadata = {
    projectId: input.projectId, entityType: 'floorPlan', entityId: input.floorPlanId, assetId: input.floorPlanId,
    createdByUid: input.createdByUid || '', createdAt: String(Number(input.createdAt || Date.now())), app: 'HNL QLTC',
  };
  const original = await putObject(paths.storagePath, input.blob, metadata);
  let thumbnailPath: string | undefined;
  if (input.thumbnailBlob && input.thumbnailBlob.size > 0) {
    await putObject(paths.thumbnailPath, input.thumbnailBlob, { ...metadata, variant: 'thumbnail' });
    thumbnailPath = paths.thumbnailPath;
  }
  return { ...original, thumbnailPath };
}

export async function downloadR2Blob(storagePath?: string | null): Promise<Blob | null> {
  const path = String(storagePath || '').trim();
  if (!path) return null;
  try {
    const response = await fetch(gatewayUrl('/v1/object', path), { headers: { Authorization: await authHeader() } });
    if (!response.ok) return null;
    return await response.blob();
  } catch (err) {
    console.warn('[Cloudflare R2] download failed:', path, err);
    return null;
  }
}
