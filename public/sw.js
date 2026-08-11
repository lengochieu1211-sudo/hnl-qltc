const CACHE_NAME = 'qltc-an-phu-cache-v3';

// Essential App Shell Resources
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png'
];

// Install Event: Cache Core App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static app shell');
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
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Cache First for Static Assets, Network First with Offline JSON for API
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
              message: 'Bạn đang ngoại tuyến. Dữ liệu đã được lưu an toàn tại bộ nhớ thiết bị (localStorage).',
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

  // Static Assets / HTML / JS / Images: Stale-While-Revalidate
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
