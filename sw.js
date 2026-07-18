// Cache-first service worker. The whole app is a handful of static files, so we
// precache all of them and never hit the network after install.

// Bump on every asset change, or installed copies keep serving the old app.
const CACHE = 'dicebox-v15';

// './' only — never './index.html'. The edge redirects /index.html to / with a
// 307, and a redirected response makes cache.addAll reject the whole batch,
// which would leave the app with no offline cache at all.
const ASSETS = [
  './',
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
      // Fetched one at a time rather than through addAll: a single failure there
      // rejects the whole batch and leaves nothing cached, so one unavailable
      // icon would cost the app its entire offline copy.
      .then(cache => Promise.all(ASSETS.map(async url => {
        try {
          // 'reload' skips the HTTP cache, so installing always stores fresh
          // copies rather than whatever the browser happens to be holding.
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (res.ok) await cache.put(url, res);
        } catch {
          // Offline or blocked: the fetch handler will cache it on first use.
        }
      })))
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
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(handle(request));
});

async function handle(request) {
  const cache = await caches.open(CACHE);

  // Every navigation resolves to the app shell. The edge redirects /index.html
  // to /, and an installed app launching at a redirecting URL fails to load —
  // so navigations are answered from the shell rather than followed.
  if (request.mode === 'navigate') {
    const shell = await cache.match('./', { ignoreSearch: true });
    if (shell) return shell;
    try {
      const res = await fetch(request);
      if (res.ok && !res.redirected) await cache.put('./', res.clone());
      return res;
    } catch {
      return new Response('Dicebox is offline and has no cached copy yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;

  try {
    const res = await fetch(request);
    // Redirected responses are not stored: replaying one from cache re-triggers
    // the redirect and browsers reject it for navigations.
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
