const CACHE = 'muf-ri-editor-v17';
const BASE = '/muf-ri-editor';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/js/app.js',
  BASE + '/js/ia.js',
  BASE + '/manifest.json',
  BASE + '/libs/blockly.min.js',
  BASE + '/libs/minimap.umd.js',
  BASE + '/libs/backpack.umd.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first pour les navigations / l'index : evite de rester bloque sur un cache obsolete.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(BASE + '/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match(BASE + '/index.html').then(c => c || caches.match(e.request)))
    );
    return;
  }
  // Cache-first pour les autres assets.
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
