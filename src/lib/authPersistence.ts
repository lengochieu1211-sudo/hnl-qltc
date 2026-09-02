import {
  browserLocalPersistence,
  browserSessionPersistence,
  getRedirectResult,
  inMemoryPersistence,
  setPersistence,
  type Persistence,
  type User,
} from 'firebase/auth';
import { auth, saveUserProfileToCloud } from './firebase';

export type FirebaseAuthPersistenceMode = 'local' | 'session' | 'memory';

let preparationPromise: Promise<FirebaseAuthPersistenceMode> | null = null;
let redirectCompletionPromise: Promise<User | null> | null = null;

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

/**
 * Completes a pending OAuth redirect before React mounts.
 *
 * Mobile HNL QLTC uses signInWithRedirect. Starting a redirect is only the first half
 * of Firebase Auth: after Google returns to hnlqltc.web.app, getRedirectResult() must
 * consume the pending credential. Without this bootstrap step the browser can return
 * to the app with auth.currentUser still empty, so every login entry point appears to
 * do nothing and project RBAC remains VIEWER.
 *
 * This routine is intentionally idempotent because React StrictMode and multiple auth
 * surfaces must never race to consume the same redirect result.
 */
export function completeFirebaseAuthRedirect(): Promise<User | null> {
  if (redirectCompletionPromise) return redirectCompletionPromise;

  redirectCompletionPromise = (async () => {
    try {
      const result = await getRedirectResult(auth);
      const user = result?.user || auth.currentUser || null;
      if (result?.user) {
        console.info('[Firebase Auth] Google redirect completed:', result.user.email || result.user.uid);
        await saveUserProfileToCloud(result.user).catch((err) => {
          console.warn('[Firebase Auth] Could not save Google profile after redirect:', err);
        });
      }
      return user;
    } catch (err) {
      console.error('[Firebase Auth] Google redirect completion failed:', err);
      throw err;
    }
  })();

  return redirectCompletionPromise;
}
