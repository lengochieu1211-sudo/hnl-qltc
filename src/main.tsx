import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LanguageProvider } from './context/LanguageContext';
import './index.css';
import { registerServiceWorker } from './serviceWorkerRegistration';
import { cleanupTransientLocalStorage, estimateLocalStorageBytes } from './utils/storage';
import { migrateAndCleanLocalStorage } from './utils/migrateStorage';
import { appendRuntimeDiagnostic } from './lib/runtimeDiagnostics';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    appendRuntimeDiagnostic({
      level: 'error',
      area: 'window-error',
      code: 'UNCAUGHT_ERROR',
      message: `${event.message || 'Unknown error'}${event.filename ? ` | ${event.filename}:${event.lineno || 0}:${event.colno || 0}` : ''}`,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    appendRuntimeDiagnostic({
      level: 'error',
      area: 'unhandled-rejection',
      code: 'UNHANDLED_REJECTION',
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason || 'Unknown rejection'),
    });
  });
}

/**
 * Android/Chrome can keep navigator.onLine=true when the radio is connected but the
 * Internet/Firebase route is actually unavailable. HNL QLTC historically showed an
 * offline banner, but relying only on navigator.onLine made that UI regress after the
 * Firebase-only migration. This watchdog keeps the browser events as the fast signal
 * and adds a conservative network probe as a second source of truth.
 *
 * Important safety rules:
 * - two consecutive probe failures are required before declaring offline;
 * - native navigator.onLine=false declares offline immediately;
 * - a successful probe restores online even when Android never emitted an online event;
 * - the synthetic online/offline events feed the existing App + OfflineSyncBanner, so
 *   all permission/cache/retry logic keeps one shared connectivity state.
 */
function installConnectivityWatchdog() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  let effectiveOnline = navigator.onLine;
  let consecutiveFailures = 0;
  let probing = false;

  const emitConnectivity = (nextOnline: boolean, source: string) => {
    if (effectiveOnline === nextOnline) return;
    effectiveOnline = nextOnline;
    appendRuntimeDiagnostic({
      level: nextOnline ? 'info' : 'warn',
      area: 'connectivity',
      code: nextOnline ? 'ONLINE' : 'OFFLINE',
      message: `${nextOnline ? 'Online' : 'Offline'} · source=${source}`,
    });
    window.dispatchEvent(new Event(nextOnline ? 'online' : 'offline'));
  };

  const probeConnectivity = async () => {
    if (probing) return;
    if (!navigator.onLine) {
      consecutiveFailures = 2;
      emitConnectivity(false, 'navigator');
      return;
    }

    probing = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    try {
      // Firebase Hosting reserved endpoint is intentionally used instead of an app
      // asset so the service worker/app cache cannot make an offline device look online.
      await fetch(`/__/firebase/init.json?qlct_probe=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      consecutiveFailures = 0;
      emitConnectivity(true, 'firebase-hosting-probe');
    } catch (_) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) {
        emitConnectivity(false, 'firebase-hosting-probe');
      }
    } finally {
      window.clearTimeout(timeout);
      probing = false;
    }
  };

  const handleNativeOffline = () => {
    if (!navigator.onLine) {
      consecutiveFailures = 2;
      emitConnectivity(false, 'native-event');
    }
  };

  const handleNativeOnline = () => {
    consecutiveFailures = 0;
    void probeConnectivity();
  };

  window.addEventListener('offline', handleNativeOffline);
  window.addEventListener('online', handleNativeOnline);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void probeConnectivity();
  });

  // Probe quickly after startup, then keep a lightweight heartbeat. Twelve seconds is
  // frequent enough for field work while avoiding noisy traffic/battery usage.
  window.setTimeout(() => void probeConnectivity(), 1200);
  window.setInterval(() => void probeConnectivity(), 12000);
}

installConnectivityWatchdog();

async function bootstrap() {
  // IMPORTANT: run storage cleanup/migration before importing App. App imports Firebase.
  // On affected browsers Firestore can touch WebStorage client-state metadata during
  // initialization, so importing Firebase before this preflight can crash before the
  // app has a chance to free legacy localStorage quota.
  try {
    const before = estimateLocalStorageBytes();
    const migrated = await migrateAndCleanLocalStorage();
    const transient = cleanupTransientLocalStorage();
    const after = estimateLocalStorageBytes();
    if (migrated.migrated > 0 || transient.removed > 0 || before > 2 * 1024 * 1024) {
      console.info('[Bootstrap storage preflight]', {
        beforeBytesApprox: before,
        afterBytesApprox: after,
        migratedLegacyKeys: migrated.migrated,
        transientRemoved: transient.removed,
      });
    }
  } catch (err) {
    // Do not block startup if a browser temporarily refuses IndexedDB/localStorage work.
    console.warn('[Bootstrap storage preflight] Continuing with partial cleanup:', err);
  }

  // Firebase JS 12.17.x can close Auth IndexedDB when a Google popup hides the opener
  // document, producing "Database is closing/hidden" when the credential returns.
  // Prepare a non-IndexedDB Auth persistence backend before ANY UI login entry point
  // becomes clickable. Firestore's persistent IndexedDB cache remains unchanged.
  const { prepareFirebaseAuthPersistence, completeFirebaseAuthRedirect } = await import('./lib/authPersistence');
  await prepareFirebaseAuthPersistence();

  // P0 mobile Auth gate: a signInWithRedirect() round trip is not complete until the
  // returning page consumes getRedirectResult(). Do this before App mounts so both the
  // header login button and the permission-screen login button see the same restored
  // Firebase identity and RBAC refresh cannot race against an empty auth.currentUser.
  try {
    await completeFirebaseAuthRedirect();
  } catch (err) {
    // A failed OAuth return must not brick the application. Keep the UI available so
    // the user can retry login, while diagnostics retain the exact Firebase error.
    console.warn('[Bootstrap auth redirect] Continuing after redirect completion error:', err);
    appendRuntimeDiagnostic({
      level: 'error',
      area: 'firebase-auth',
      code: 'REDIRECT_COMPLETION_FAILED',
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  // Dynamic imports intentionally happen after storage/Auth/redirect preflight.
  // App Check is optional until DEV/PROD site keys are provisioned; missing key is a
  // deliberate no-op.
  const [{ default: App }, { initializeOptionalAppCheck }] = await Promise.all([
    import('./App.tsx'),
    import('./lib/appCheck'),
  ]);
  initializeOptionalAppCheck();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  registerServiceWorker();
}

bootstrap().catch((err) => {
  console.error('Application bootstrap failed:', err);
  appendRuntimeDiagnostic({ level: 'error', area: 'bootstrap', message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '<div style="padding:24px;font-family:system-ui;color:#991b1b">Không thể khởi động ứng dụng. Hãy tải lại trang.</div>';
  }
});