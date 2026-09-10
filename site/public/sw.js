// Bumping this string evicts every cache below on the next deploy's first visit -- the only
// manual step a future change needs, since fetch handlers key off it automatically.
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

  // Character/weapon/echo icons: filenames don't change once published, so a cache hit never
  // needs revalidating. `<img>` fetches these no-cors, so the response is opaque (status 0,
  // ok:false even on success) -- cache it unconditionally rather than gating on .ok.
  if (url.hostname === IMAGE_HOST && url.pathname.includes('/images/')) {
    event.respondWith(cacheFirst(req, IMG_CACHE, { requireOk: false }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // index.html: network-first, so a new deploy's referenced asset hashes are picked up as soon
  // as they're reachable -- falls back to the last cached shell only when offline.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req, APP_CACHE));
    return;
  }

  // Hashed JS/CSS/font/image assets: content-addressed by Vite's build, so a cache hit is
  // always correct -- a changed file gets a new URL instead of invalidating this one.
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

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
