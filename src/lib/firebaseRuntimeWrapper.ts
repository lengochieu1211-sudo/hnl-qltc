import { GoogleAuthProvider, signInWithPopup, type User } from 'firebase/auth';
import * as base from './firebaseBase';

export * from './firebaseBase';

function isAndroidChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const android = /Android/i.test(ua);
  const webView = /;\s*wv\)/i.test(ua) || /\bwv\b/i.test(ua) ||
    (typeof window !== 'undefined' && Boolean((window as Window & { AndroidExport?: unknown }).AndroidExport));
  return android && !webView;
}

export async function signInWithGoogle(): Promise<User | null> {
  if (!isAndroidChromeBrowser()) return base.signInWithGoogle();

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(base.auth, provider);
  await base.saveUserProfileToCloud(result.user).catch((err) => {
    console.warn('Could not save Google profile after Android Chrome sign-in:', err);
  });
  return result.user;
}

export const signInWithGoogleAccount = signInWithGoogle;
