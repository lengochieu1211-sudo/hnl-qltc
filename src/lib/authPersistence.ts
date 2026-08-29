import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
  type Persistence,
} from 'firebase/auth';
import { auth } from './firebase';

export type FirebaseAuthPersistenceMode = 'local' | 'session' | 'memory';

let preparationPromise: Promise<FirebaseAuthPersistenceMode> | null = null;

/**
 * Firebase JS 12.17.x introduced an IndexedDBLocalPersistence lifecycle regression:
 * opening an OAuth popup hides the opener document, closes the Auth IndexedDB handle,
 * then the returned credential can fail with "Database is closing/hidden".
 *
 * Firestore must keep its own persistent IndexedDB cache for offline business data.
 * This preflight changes only Firebase Authentication persistence and runs before the
 * React UI is rendered, so every Google sign-in entry point uses a non-IndexedDB Auth
 * persistence backend.
 */
export function prepareFirebaseAuthPersistence(): Promise<FirebaseAuthPersistenceMode> {
  if (preparationPromise) return preparationPromise;

  preparationPromise = (async () => {
    const candidates: Array<{ mode: FirebaseAuthPersistenceMode; persistence: Persistence }> = [
      { mode: 'local', persistence: browserLocalPersistence },
      { mode: 'session', persistence: browserSessionPersistence },
      { mode: 'memory', persistence: inMemoryPersistence },
    ];

    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        await setPersistence(auth, candidate.persistence);
        console.info(`[Firebase Auth] persistence prepared: ${candidate.mode}`);
        return candidate.mode;
      } catch (err) {
        lastError = err;
        console.warn(`[Firebase Auth] persistence ${candidate.mode} unavailable; trying fallback`, err);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No supported Firebase Auth persistence backend is available.');
  })();

  return preparationPromise;
}
