/* Service Worker – قرآن کریم · نور  (بهینه‌سازی کش) */
const STATIC_CACHE  = 'quran-nur-static-v45';
const RUNTIME_CACHE = 'quran-nur-runtime-v45';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './quran-data.js',
  './word-timings.js',
  './icon-192.webp',
  './icon-512.webp',
  './icon-512-splash.webp',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './apple-touch-icon.webp',
  './favicon-32.webp',
  './favicon-32.png'
];

/* ── Install: precache app shell + Quran data ── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // Cache files one-by-one so a single failure (e.g. large data file on slow net)
    // does not abort the whole install.
    for (const url of PRECACHE) {
      try {
        await cache.add(url);
      } catch (err) {
        console.warn('[SW] precache failed:', url, err);
      }
    }
    await self.skipWaiting();
  })());
});

/* ── Activate: remove old caches & take control ── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ── Helpers ── */
function isNavigation(req) {
  return req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
}

function isAudioOrFont(url) {
  return (
    url.hostname.includes('islamic.network') ||
    url.hostname.includes('everyayah.com') ||
    url.hostname.includes('mp3quran.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  );
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/* ── Fetch strategies ── */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Audio & fonts → Network-first, then cache (runtime)
  if (isAudioOrFont(url)) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 2) API (text) – almost never needed now, but keep network-first
  if (url.hostname.includes('alquran.cloud')) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 3) Same-origin static assets (HTML, JS, icons, data)
  if (isSameOrigin(url) || isNavigation(req)) {
    // index.html and main data: stale-while-revalidate for fast load + background update
    if (
      url.pathname.endsWith('index.html') ||
      url.pathname.endsWith('/') ||
      url.pathname.endsWith('quran-data.js') ||
      url.pathname.endsWith('word-timings.js') ||
      isNavigation(req)
    ) {
      event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
      return;
    }
    // Other static files: cache-first
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 4) Everything else: network only
});

/* Cache-first */
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    if (isNavigation(req)) {
      return (await caches.match('./index.html')) || (await caches.match('./'));
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/* Network-first (good for audio) */
async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/* Stale-while-revalidate (instant response + background update) */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // Return cache immediately if available, otherwise wait for network
  if (cached) {
    // Kick off background update (don't await)
    networkPromise.catch(() => {});
    return cached;
  }

  const networkRes = await networkPromise;
  if (networkRes) return networkRes;

  // Final offline fallback for navigation
  if (isNavigation(req)) {
    return (await caches.match('./index.html')) || (await caches.match('./'));
  }
  return new Response('', { status: 503, statusText: 'Offline' });
}
