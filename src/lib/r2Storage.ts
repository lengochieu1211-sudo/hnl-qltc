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

async function authHeader(forceRefresh = false): Promise<string> {
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('R2_AUTH_UNAVAILABLE');
  // Cross-account recovery: after a same-phone Google account switch the browser may
  // still hold a cached Firebase ID token close to expiry. Normal calls use the cheap
  // cached token; a 401/403 download retries once with a freshly minted token.
  const token = await user.getIdToken(forceRefresh);
  return `Bearer ${token}`;
}

function gatewayUrl(path: string, storagePath: string): string {
  if (!isR2Configured()) throw new Error('R2_GATEWAY_NOT_CONFIGURED');
  return `${R2_GATEWAY_URL}${path}?key=${encodeURIComponent(storagePath)}`;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function matchesExpected(actualSize: number, actualSha256: string | undefined, expectedSize?: number, expectedSha256?: string) {
  const sizeMatches = !expectedSize || actualSize === Number(expectedSize);
  const expectedHash = String(expectedSha256 || '').trim().toLowerCase();
  const actualHash = String(actualSha256 || '').trim().toLowerCase();
  const checksumMatches = !expectedHash || (Boolean(actualHash) && actualHash === expectedHash);
  return actualSize > 0 && sizeMatches && checksumMatches;
}

async function verifyR2ObjectViaAuthenticatedGet(
  url: string,
  authorization: string,
  expectedSize?: number,
  expectedSha256?: string,
): Promise<R2ObjectVerification> {
  const fallback = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authorization },
    cache: 'no-store',
  });
  if (!fallback.ok) return { ready: false, size: 0 };

  const buffer = await fallback.arrayBuffer();
  const size = buffer.byteLength;
  const sha256 = size > 0 ? await sha256Hex(buffer) : undefined;
  const etag = String(fallback.headers.get('etag') || '').trim() || undefined;
  return { ready: matchesExpected(size, sha256, expectedSize, expectedSha256), size, sha256, etag };
}

/**
 * Confirm that R2 really contains the uploaded bytes before Firestore metadata becomes
 * visible to another account. RC2.2.14 prefers the cheap authenticated HEAD route.
 *
 * Compatibility detail: the live pre-HEAD Worker did not include HEAD in its CORS
 * allow-methods list. Because Authorization triggers a preflight, browsers can reject
 * HEAD as a network/CORS error BEFORE JavaScript receives the Worker's HTTP 405. In
 * that legacy-only situation we retry with authenticated GET and locally SHA-256 the
 * returned bytes. GET is still fail-closed: the exact size/hash must match before the
 * Firestore `ready` metadata can be published. Auth/access/not-found HTTP failures do
 * not fall through to GET. Once the Worker is upgraded, the normal HEAD path is used.
 */
export async function verifyR2ObjectReady(
  storagePath: string,
  expectedSize?: number,
  expectedSha256?: string,
): Promise<R2ObjectVerification> {
  const authorization = await authHeader();
  const url = gatewayUrl('/v1/object', storagePath);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: authorization },
      cache: 'no-store',
    });
  } catch (headError) {
    console.warn('[R2] HEAD durability check unavailable; using authenticated GET compatibility verification.', headError);
    try {
      return await verifyR2ObjectViaAuthenticatedGet(url, authorization, expectedSize, expectedSha256);
    } catch {
      return { ready: false, size: 0 };
    }
  }

  if (response.ok) {
    const size = Number(response.headers.get('Content-Length') || 0);
    const sha256 = String(response.headers.get('X-HNL-SHA256') || '').trim() || undefined;
    const etag = String(response.headers.get('etag') || '').trim() || undefined;
    return { ready: matchesExpected(size, sha256, expectedSize, expectedSha256), size, sha256, etag };
  }

  // An actual HTTP response other than legacy 405 is an auth/access/not-found/server
  // signal and remains fail-closed. Only the legacy unknown-method response retries GET.
  if (response.status !== 405) return { ready: false, size: 0 };

  try {
    return await verifyR2ObjectViaAuthenticatedGet(url, authorization, expectedSize, expectedSha256);
  } catch {
    return { ready: false, size: 0 };
  }
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

  const requestObject = async (forceRefresh = false) => fetch(gatewayUrl('/v1/object', path), {
    method: 'GET',
    headers: { Authorization: await authHeader(forceRefresh) },
    cache: 'no-store',
  });

  try {
    let response = await requestObject(false);
    // Same-phone A -> B account switches and long-lived installed PWAs can occasionally
    // hit the gateway with an expired/stale Firebase token. Retry authentication once
    // before declaring the shared R2 binary unavailable. Real RBAC denial still fails.
    if (response.status === 401 || response.status === 403) {
      response = await requestObject(true);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn('[Cloudflare R2] download denied/missing:', { path, status: response.status, detail: detail.slice(0, 180) });
      return null;
    }
    const blob = await response.blob();
    if (!blob || blob.size <= 0) {
      console.warn('[Cloudflare R2] empty binary response:', path);
      return null;
    }
    return blob;
  } catch (err) {
    console.warn('[Cloudflare R2] download failed:', path, err);
    return null;
  }
}
