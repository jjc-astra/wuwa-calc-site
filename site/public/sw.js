// Bump to evict every cache.
const CACHE_VERSION = 'v2';
const APP_CACHE = `wuwa-app-${CACHE_VERSION}`;
const IMG_CACHE = `wuwa-img-${CACHE_VERSION}`;

const ASSET_RE = /\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|ico)$/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // Icons: cached copy now, refreshed in the background so replaced or newly added icons show on the next load.
  if (url.pathname.startsWith('/images/')) {
    event.respondWith(staleWhileRevalidate(event, req, IMG_CACHE));
    return;
  }

  // Pages: network-first, falling back to the cached shell offline.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req, APP_CACHE, req.mode === 'navigate' ? '/' : undefined));
    return;
  }

  // Hashed assets: cache-first.
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req, APP_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Only successful responses are cached, so a missing icon is retried rather than stuck.
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return cached;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request) ?? (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw err;
  }
}
