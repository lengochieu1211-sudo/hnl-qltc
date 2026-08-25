import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LanguageProvider } from './context/LanguageContext';
import './index.css';
import { registerServiceWorker } from './serviceWorkerRegistration';
import { cleanupTransientLocalStorage, estimateLocalStorageBytes } from './utils/storage';
import { migrateAndCleanLocalStorage } from './utils/migrateStorage';
import { appendRuntimeDiagnostic } from './lib/runtimeDiagnostics';

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

  // Dynamic import intentionally happens after preflight.
  const { default: App } = await import('./App.tsx');

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
