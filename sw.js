// Cache-first service worker. The whole app is a handful of static files, so we
// precache all of them and never hit the network after install.

// Bump on every asset change, or installed copies keep serving the old app.
const CACHE = 'dicebox-v4';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './dice.js',
  './render.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(request)
        .then(res => {
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() => {
          // A navigation that misses the cache while offline still gets the app
          // shell rather than the browser's dinosaur.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
