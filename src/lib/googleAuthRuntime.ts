import type { User } from 'firebase/auth';
import { signInWithGoogleAccount } from './firebase';

/**
 * UI-facing shared Google login helper. Runtime transport selection is centralized in
 * `src/lib/firebase.ts`, so every login surface uses the same Android Chrome / APK / PC rule.
 */
export async function signInWithGoogleRuntimeAware(): Promise<User | null> {
  return signInWithGoogleAccount();
}
