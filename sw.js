/* Service worker — offline-first shell cache for Moe's Training Log */
const CACHE = 'moe-v10';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/data.js',
  '/config.js',
  '/icon.svg',
  '/manifest.json',
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
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
