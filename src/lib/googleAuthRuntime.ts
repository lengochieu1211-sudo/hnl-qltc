import { GoogleAuthProvider, signInWithPopup, type User } from 'firebase/auth';
import { auth, saveUserProfileToCloud, signInWithGoogleAccount } from './firebase';

function isAndroidChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const android = /Android/i.test(ua);
  const webView = /;\s*wv\)/i.test(ua) || /\bwv\b/i.test(ua) ||
    (typeof window !== 'undefined' && Boolean((window as Window & { AndroidExport?: unknown }).AndroidExport));
  return android && !webView;
}

/**
 * Shared Google login entry point for UI surfaces.
 * Keeps the already-Golden APK/WebView and desktop flows unchanged, while Android
 * Chrome uses popup to avoid the failing redirect round-trip on hnlqltc.web.app.
 */
export async function signInWithGoogleRuntimeAware(): Promise<User | null> {
  if (!isAndroidChromeBrowser()) return signInWithGoogleAccount();

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  await saveUserProfileToCloud(result.user).catch((err) => {
    console.warn('Could not save Google profile after Android Chrome sign-in:', err);
  });
  return result.user;
}
