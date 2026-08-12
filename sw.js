/* Service Worker – قرآن کریم · نور  (بارگذاری تدریجی – بدون دانلود یک‌جای فایل‌های سنگین) */
const STATIC_CACHE  = 'quran-nur-static-v45';
const RUNTIME_CACHE = 'quran-nur-runtime-v45';

/* فقط پوستهٔ سبک اپ در precache — فایل‌های سنگین داده در پس‌زمینه و بر اساس نیاز کش می‌شوند */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
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

/* ── Install: فقط پوستهٔ سبک را precache کن (سریع و بدون قفل شدن) ── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // یکی‌یکی تا اگر یکی خطا داد کل نصب خراب نشود
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

/* ── Activate: کش‌های قدیمی را پاک کن و کنترل را بگیر ── */
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

function isHeavyData(url) {
  return url.pathname.endsWith('quran-data.js') ||
         url.pathname.endsWith('word-timings.js');
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

  // 2) API (text) – network-first
  if (url.hostname.includes('alquran.cloud')) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 3) Same-origin static assets
  if (isSameOrigin(url) || isNavigation(req)) {
    // فایل‌های سنگین داده: cache-first (اولین بار از شبکه، بعد از کش)
    // تا در پس‌زمینه دانلود شوند و نصب SW را سنگین نکنند
    if (isHeavyData(url)) {
      event.respondWith(cacheFirst(req, STATIC_CACHE));
      return;
    }

    // index.html و ناوبری: stale-while-revalidate
    if (
      url.pathname.endsWith('index.html') ||
      url.pathname.endsWith('/') ||
      isNavigation(req)
    ) {
      event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
      return;
    }

    // بقیهٔ فایل‌های استاتیک: cache-first
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

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const networkRes = await networkPromise;
  if (networkRes) return networkRes;

  if (isNavigation(req)) {
    return (await caches.match('./index.html')) || (await caches.match('./'));
  }
  return new Response('', { status: 503, statusText: 'Offline' });
}
