import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import { firebaseApp } from './firebase';

let appCheckInstance: AppCheck | null = null;

/**
 * Optional App Check bootstrap. Enforcement must only be enabled in Firebase Console
 * after DEV/PROD keys and wrapper behavior are verified. Missing key = deliberate no-op.
 */
export function initializeOptionalAppCheck(): AppCheck | null {
  if (appCheckInstance || typeof window === 'undefined') return appCheckInstance;
  const key = String((import.meta as any).env?.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();
  if (!key || key.startsWith('YOUR_')) return null;
  try {
    appCheckInstance = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(key),
      isTokenAutoRefreshEnabled: true,
    });
    return appCheckInstance;
  } catch (err) {
    console.warn('[App Check] bootstrap skipped:', err);
    return null;
  }
}
