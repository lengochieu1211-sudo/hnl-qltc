const SW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SW_BUILD_ID = new URL(self.location.href).searchParams.get('build') || 'unknown-build';
const CACHE_NAME = `hnl-thi-cong-cache-${SW_VERSION}-${SW_BUILD_ID}`;

// Essential App Shell Resources
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon-3d.ico',
  '/icon-3d-192.png',
  '/icon-3d-512.png'
];

// Install Event: Cache Core App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static app shell', { version: SW_VERSION, build: SW_BUILD_ID });
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Cleanup Old Caches & Claim Clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache.startsWith('hnl-thi-cong-cache-') && cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
          return undefined;
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass non-GET requests or browser extension requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // API Calls: Network First -> Fallback to Offline JSON Response
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => {
          return new Response(
            JSON.stringify({
              offline: true,
              message: 'Bạn đang ngoại tuyến. Dữ liệu nghiệp vụ dùng bộ nhớ ngoại tuyến chính thức của Firestore; ảnh chờ tải lên được giữ trong hàng đợi cục bộ.',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
    );
    return;
  }

  // Navigation & HTML document requests: Network First -> Fallback to Cache.
  // Never prefer cached HTML while online, otherwise an old document can reference
  // hashed JS chunks that no longer exist after a new deployment.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache));
          }
          return networkResponse;
        })
        .catch(async () => {
          return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
        })
    );
    return;
  }

  // Hashed Vite assets must be network-first while online. Serving an old cached chunk
  // after deployment can combine code from two builds. The cache remains an offline
  // fallback, so installed/PWA use still works without connectivity.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static resources / images: Stale-While-Revalidate.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
