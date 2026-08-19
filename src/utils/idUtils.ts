/** Creates collision-resistant IDs for multi-device use. */
export function createEntityId(prefix: string): string {
  const cleanPrefix = String(prefix || 'id').replace(/[^A-Za-z0-9_-]/g, '') || 'id';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${cleanPrefix}-${crypto.randomUUID()}`;
  }
  return `${cleanPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}


/** Stable non-cryptographic hash for deterministic cross-device record IDs. */
export function stableIdHash(value: string): string {
  let hash = 0x811c9dc5;
  const input = String(value || '');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

/** Creates the same ID on every device for the same logical business key. */
export function createDeterministicId(prefix: string, logicalKey: string): string {
  const cleanPrefix = String(prefix || 'id').replace(/[^A-Za-z0-9_-]/g, '') || 'id';
  return `${cleanPrefix}-${stableIdHash(logicalKey)}`;
}


/** Short collision-resistant token for human-readable IDs that also keep a sequence prefix. */
export function createShortToken(length = 6): string {
  const safeLength = Math.max(4, Math.min(16, Math.trunc(length || 6)));
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, safeLength).toUpperCase();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(-safeLength).toUpperCase();
}
