// Bump to evict every cache.
const CACHE_VERSION = 'v1';
const APP_CACHE = `wuwa-app-${CACHE_VERSION}`;
const IMG_CACHE = `wuwa-img-${CACHE_VERSION}`;

const IMAGE_HOST = 'raw.githubusercontent.com';
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

  // Icons: immutable once published. Cross-origin responses are opaque, so cache regardless of .ok.
  const isIcon = url.origin === self.location.origin
    ? url.pathname.startsWith('/images/')
    : url.hostname === IMAGE_HOST && url.pathname.includes('/images/');
  if (isIcon) {
    event.respondWith(cacheFirst(req, IMG_CACHE, { requireOk: false }));
    return;
  }

  if (url.origin !== self.location.origin) return;

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

async function cacheFirst(request, cacheName, { requireOk = true } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (!requireOk || response.ok) cache.put(request, response.clone());
  return response;
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
