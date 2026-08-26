const env = (import.meta as any).env || {};

/**
 * V6.3.0 Firebase-only migration switch.
 *
 * Production defaults to Firebase-only writes. Legacy Drive/local persistence may be
 * READ during the migration window so production data is never orphaned before the
 * migration verifier has proven count/reference/checksum parity.
 */
export const FIREBASE_ONLY_RUNTIME = String(env.VITE_RUNTIME_BACKEND || 'firebase-only').toLowerCase() !== 'legacy';
export const LEGACY_DRIVE_READ_FALLBACK = String(env.VITE_ENABLE_LEGACY_DRIVE_READ || 'true').toLowerCase() !== 'false';
export const LEGACY_DRIVE_WRITE_ENABLED = String(env.VITE_ENABLE_LEGACY_DRIVE_WRITE || 'false').toLowerCase() === 'true';
export const LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED = String(env.VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE || 'false').toLowerCase() === 'true';
export const LEGACY_LOCAL_IMPORT_ENABLED = String(env.VITE_ENABLE_LEGACY_LOCAL_IMPORT || 'true').toLowerCase() !== 'false';

export const RUNTIME_BACKEND_LABEL = FIREBASE_ONLY_RUNTIME ? 'Firebase-only' : 'Legacy compatibility';
