const SW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SW_BUILD_ID = new URL(self.location.href).searchParams.get('build') || 'unknown-build';
const CACHE_NAME = `hnl-thi-cong-cache-${SW_VERSION}-${SW_BUILD_ID}`;

// Essential App Shell Resources
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/hnl-logo-original-16.png',
  '/hnl-logo-original-20.png',
  '/hnl-logo-original-24.png',
  '/hnl-logo-original-28.png',
  '/hnl-logo-original-32.png',
  '/hnl-logo-original-40.png',
  '/hnl-logo-original-48.png',
  '/hnl-logo-original-192.png',
  '/hnl-logo-original-512.png'
];

async function loadBuildAssetManifest() {
  const response = await fetch(`/sw-assets.json?build=${encodeURIComponent(SW_BUILD_ID)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`SW_ASSET_MANIFEST_HTTP_${response.status}`);
  const manifest = await response.json();
  if (manifest?.buildId && String(manifest.buildId) !== SW_BUILD_ID) {
    throw new Error(`SW_ASSET_MANIFEST_BUILD_MISMATCH:${manifest.buildId}:${SW_BUILD_ID}`);
  }
  const assets = Array.isArray(manifest?.assets)
    ? manifest.assets.filter((item) => typeof item === 'string' && item.startsWith('/assets/'))
    : [];
  if (!assets.some((item) => /\.js$/i.test(item))) throw new Error('SW_ASSET_MANIFEST_HAS_NO_JS_CHUNKS');
  return assets;
}

function isValidAssetResponse(url, response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const path = new URL(url, self.location.origin).pathname.toLowerCase();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  // The executable app shell intentionally includes HTML. Only these two canonical
  // navigation entries may be cached as HTML; hashed /assets URLs must never accept it.
  if (path === '/' || path === '/index.html') return contentType.includes('text/html');

  if (path.startsWith('/assets/')) {
    if (contentType.includes('text/html')) return false;
    if (path.endsWith('.js') || path.endsWith('.mjs')) return contentType.includes('javascript');
    if (path.endsWith('.css')) return contentType.includes('text/css');
    return true;
  }

  if (path.endsWith('.json')) return contentType.includes('json');
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico)$/i.test(path)) return contentType.startsWith('image/');
  return !contentType.includes('text/html');
}

async function deletePoisonedAssetCacheEntries(request) {
  for (const cacheName of await caches.keys()) {
    if (!cacheName.startsWith('hnl-thi-cong-cache-')) continue;
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached && !isValidAssetResponse(request.url, cached)) {
      await cache.delete(request);
      console.warn('[SW] Deleted poisoned asset cache entry:', request.url, cacheName);
    }
  }
}

async function cacheOneAsset(cache, url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!isValidAssetResponse(url, response)) {
    await cache.delete(url);
    throw new Error(`SW_INVALID_ASSET_RESPONSE:${url}:${response.status}:${response.headers.get('content-type') || 'unknown'}`);
  }
  await cache.put(url, response.clone());
}

async function cacheAssetsInBatches(cache, urls, batchSize = 4) {
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    await Promise.all(batch.map((url) => cacheOneAsset(cache, url)));
  }
}

// Install Event: atomically pre-cache the complete hashed Vite app shell. If any
// required chunk is missing, installation fails and the previous certified worker/cache
// stays active instead of activating a half-build that cannot cold-start offline.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const buildAssets = await loadBuildAssetManifest();
    const required = [...new Set([...STATIC_ASSETS, ...buildAssets])];
    console.log('[SW] Pre-caching complete app shell', {
      version: SW_VERSION,
      build: SW_BUILD_ID,
      hashedAssets: buildAssets.length,
    });
    // Keep complete offline coverage, but avoid flooding low-end Android/WebView
    // with every JS/CSS request at once during first install/update.
    await cacheAssetsInBatches(cache, required, 4);
    await self.skipWaiting();
  })());
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
    event.respondWith((async () => {
      let cachedResponse = await caches.match(request);
      if (cachedResponse && !isValidAssetResponse(request.url, cachedResponse)) {
        await deletePoisonedAssetCacheEntries(request);
        cachedResponse = undefined;
      }

      try {
        const networkResponse = await fetch(request, { cache: 'no-store' });

        // Hashed JS/CSS must never execute or enter CacheStorage with the wrong MIME.
        // Firebase Hosting can return an HTML error document for a real HTTP 404;
        // convert that to a MIME-safe plain 404 and purge any previously poisoned entry.
        if (!isValidAssetResponse(request.url, networkResponse)) {
          await deletePoisonedAssetCacheEntries(request);
          if (cachedResponse && isValidAssetResponse(request.url, cachedResponse)) return cachedResponse;
          return new Response('Hashed asset not found', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }

        const responseToCache = networkResponse.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        return networkResponse;
      } catch {
        if (cachedResponse && isValidAssetResponse(request.url, cachedResponse)) return cachedResponse;
        await deletePoisonedAssetCacheEntries(request);
        return Response.error();
      }
    })());
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
