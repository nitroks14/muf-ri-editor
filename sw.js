const CACHE = 'muf-ri-editor-v3';
const BASE = '/muf-ri-editor';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/js/app.js',
  BASE + '/manifest.json',
  BASE + '/libs/blockly.min.js'
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
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
