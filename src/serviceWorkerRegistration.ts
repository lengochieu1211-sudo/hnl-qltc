import { APP_VERSION } from './config/appVersion';
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
        for (let registration of registrations) {
          registration.unregister();
        }
      }).catch((err) => {
        console.warn('[SW] Unregister failed:', err);
      });
    }
    return;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`)
        .then((registration) => {
          console.log('[SW] ServiceWorker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.warn('[SW] Registration failed:', error);
        });
    });
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
