import { APP_VERSION } from './config/appVersion';

declare const __BUILD_ID__: string;

/**
 * Basic Service Worker registration helper for Hệ Thống Quản Lý Thi Công.
 * Enables full PWA caching and offline execution support.
 */

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;

  // Unregister service workers in development mode or preview environment to prevent stale cache & fetch errors on mobile iOS Safari
  if (process.env.NODE_ENV !== 'production' || window.location.hostname.includes('ais-dev') || window.location.hostname.includes('run.app')) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      }).catch((err) => {
        console.warn('[SW] Unregister failed:', err);
      });
    }
    return;
  }

  if ('serviceWorker' in navigator) {
    const registerCurrentBuildServiceWorker = () => {
      const buildId = typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : 'unknown-build';
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}&build=${encodeURIComponent(buildId)}`)
        .then((registration) => {
          console.log('[SW] ServiceWorker registered with scope:', registration.scope, 'build:', buildId);
          // Ask the browser to check immediately for a new worker. This matters on long-lived
          // field devices where the tab can remain open across multiple DEV/PROD deployments.
          void registration.update().catch((error) => {
            console.warn('[SW] Update check failed:', error);
          });
        })
        .catch((error) => {
          console.warn('[SW] Registration failed:', error);
        });
    };

    const scheduleRegistration = () => {
      const connection = (navigator as any).connection;
      const mobileLike = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
        || Math.min(window.innerWidth || 0, window.innerHeight || 0) < 820;
      const minimumQuietMs = mobileLike ? 5000 : 1800;
      window.setTimeout(() => {
        const idle = (window as any).requestIdleCallback;
        if (typeof idle === 'function') {
          idle(registerCurrentBuildServiceWorker, { timeout: mobileLike ? 3000 : 1600 });
        } else {
          registerCurrentBuildServiceWorker();
        }
      }, connection?.saveData ? Math.max(minimumQuietMs, 8000) : minimumQuietMs);
    };

    // Preserve full offline installation, but start it only after the first interaction
    // window so app-shell precaching cannot compete with initial navigation on mobile.
    if (document.readyState === 'complete') {
      scheduleRegistration();
    } else {
      window.addEventListener('load', scheduleRegistration, { once: true });
    }
  }
}

export function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}
