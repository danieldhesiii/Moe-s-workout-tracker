/* Service worker — offline-first shell cache for Moe's Training Log */
const CACHE = 'moe-v21';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/data.js',
  '/config.js',
  '/icon.svg',
  '/manifest.json',
  '/vendor/gsap.min.js',
  '/vendor/lenis.min.js',
  '/vendor/splitting.min.js',
  '/vendor/splitting.css',
  '/vendor/swiper-bundle.min.js',
  '/vendor/swiper-bundle.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Pass through: Supabase API, CDN scripts, Open-Meteo, Google Fonts
  if (url.includes('supabase') || url.includes('jsdelivr') || url.includes('googleapis') ||
      url.includes('gstatic') || url.includes('open-meteo')) {
    return;
  }
  // Network-first for the page document (HTML shell) so it never gets stuck stale;
  // fall back to cache when offline.
  const isDoc = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isDoc) {
    e.respondWith(
      fetch(e.request)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }
  // Cache-first for everything else (versioned assets bypass via ?v= query).
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
