const HEAVY_DATA_URL_PREFIXES = [
  'data:image/',
  'data:application/pdf',
  'data:video/',
  'data:audio/',
];

function isHeavyInlinePayload(value: string): boolean {
  if (!value) return false;
  if (value.length < 32 * 1024) return false;
  return HEAVY_DATA_URL_PREFIXES.some(prefix => value.startsWith(prefix));
}

/**
 * Remove only inline binary payloads from JSON cache objects when localStorage is full.
 * Business metadata is preserved. Binary photos/floor plans are stored in IndexedDB/
 * PhotoStorage in current builds, so keeping another Base64 copy in localStorage only
 * increases crash risk.
 */
export function stripHeavyImages(obj: any): any {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    if (isHeavyInlinePayload(obj)) return '[binary-moved-to-indexeddb]';
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => stripHeavyImages(item));
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        cleaned[k] = stripHeavyImages(obj[k]);
      }
    }
    return cleaned;
  }
  return obj;
}

export function estimateLocalStorageBytes(): number {
  if (typeof localStorage === 'undefined') return 0;
  let chars = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || '';
    const value = localStorage.getItem(key) || '';
    chars += key.length + value.length;
  }
  // Web Storage strings are UTF-16 in the common browser implementations.
  return chars * 2;
}

export function isQuotaExceededError(err: unknown): boolean {
  const anyErr = err as any;
  const text = String(anyErr?.message || anyErr || '');
  return (
    anyErr?.name === 'QuotaExceededError' ||
    anyErr?.code === 22 ||
    /QuotaExceededError|exceeded the quota|storage.*quota/i.test(text)
  );
}

/**
 * Clear ONLY ephemeral/cache keys. Never remove project business data, IndexedDB data,
 * photos, backup versions, auth/member data or project metadata.
 *
 * In V6.2.10 Firestore no longer uses persistentLocalCache, so these `firestore_*`
 * WebStorage entries are stale coordination/client-state markers left by older builds.
 * Actual QLCT business records live in QLCT IndexedDB/Cloud. Chat additionally keeps a
 * dedicated IndexedDB outbox before sending, so pending chat is not dependent on these
 * WebStorage markers.
 */
export function cleanupTransientLocalStorage(): { removed: number; bytesFreedApprox: number } {
  if (typeof localStorage === 'undefined') return { removed: 0, bytesFreedApprox: 0 };

  const transientMatchers: Array<(key: string, value: string) => boolean> = [
    (key) => key === 'construction_offline_pending',
    // Firestore WebStorage shared-client state from persistent-cache builds.
    (key) => key.startsWith('firestore_clients_'),
    (key) => key.startsWith('firestore_mutations_'),
    (key) => key.startsWith('firestore_targets_'),
    (key) => key.startsWith('firestore_online_state_'),
    (key) => key.startsWith('firestore_sequence_number_'),
    (key) => key.startsWith('firestore_zombie_'),
  ];

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }

  let removed = 0;
  let bytesFreedApprox = 0;
  for (const key of keys) {
    const value = localStorage.getItem(key) || '';
    if (!transientMatchers.some(match => match(key, value))) continue;
    try {
      bytesFreedApprox += (key.length + value.length) * 2;
      localStorage.removeItem(key);
      removed += 1;
    } catch (_) {}
  }
  return { removed, bytesFreedApprox };
}

export function safeSetLocalStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    console.warn(`localStorage setItem failed for key "${key}", attempting safe cleanup...`, e);

    if (isQuotaExceededError(e)) {
      cleanupTransientLocalStorage();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (_) {
        // Continue to JSON cache compaction below.
      }
    }

    // If this is a JSON cache object, remove only embedded binary payloads.
    if (value && (value.startsWith('{') || value.startsWith('['))) {
      try {
        const parsed = JSON.parse(value);
        const cleaned = stripHeavyImages(parsed);
        const cleanedStr = JSON.stringify(cleaned);
        localStorage.setItem(key, cleanedStr);
        return true;
      } catch (innerErr) {
        console.warn(`Compacted JSON setItem failed for key "${key}":`, innerErr);
      }
    }

    console.error(`❌ Không thể lưu dữ liệu cho khoá "${key}" vì localStorage đã đầy. Dữ liệu nghiệp vụ trong IndexedDB/Cloud không bị xóa.`);
    return false;
  }
}
