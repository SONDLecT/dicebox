// The app precaches all its files so it works fully offline. The code files
// (the shell, app.js, style.css and the small modules) are served
// NETWORK-FIRST when online, so a deploy lands on the next load instead of a
// reload or two later — the cache is the offline fallback, not the primary.
// The big deck-art modules and the icons stay cache-first: they are large and
// change rarely, and the deploy's content-hashed cache name refreshes them on
// the next service-worker update.

// Replaced at deploy time with a hash of every asset shipped alongside it, so
// this never has to be remembered — see swCacheName in tools/deploy.mjs. A
// stale cache name is the one deploy bug with no symptom on the server: the
// files are all correct and installed copies serve the previous build anyway.
//
// The literal below is what a local checkout and the single-file build use, and
// it only has to change if you are testing cache behaviour by hand.
const CACHE = 'dicebox-dev';

// './' only — never './index.html'. The edge redirects /index.html to / with a
// 307, and a redirected response makes cache.addAll reject the whole batch,
// which would leave the app with no offline cache at all.
const ASSETS = [
  './',
  './style.css',
  './app.js',
  './dice.js',
  './render.js',
  './under30-gap.js',
  './system-dice.js',
  './oracle-dice.js',
  // The deck art modules — big (cards ~1.1MB, tarot ~4.5MB), so the app pulls
  // each with a dynamic import only when its mode is opened; precaching them
  // here is what keeps that first open working offline. The Ironsworn oracle
  // data loads the same way, on first entry to the mode.
  './cards-art.js',
  './tarot-art.js',
  './nap-art.js',
  './hana-art.js',
  './uta-art.js',
  './ironsworn-oracles.js',
  './room.js',
  './room-crypto.js',
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
  const url = new URL(request.url);

  // A download click counts as a navigation, so the shell rule below would
  // answer it with index.html — which is exactly why the downloaded file arrived
  // as the multi-file app instead of the bundle. curl and "save link as" bypass
  // the service worker entirely, which is why those two always looked correct
  // and hid the bug.
  if (url.pathname.endsWith('/dicebox.html')) {
    return fetch(request);
  }

  // Navigations: network-first. An updated shell then lands on the next load,
  // not two loads later. Offline (or a failed fetch) falls back to the cached
  // shell. The edge redirects /index.html to /, so a redirected response is not
  // stored — replaying one re-triggers the redirect and browsers reject it.
  if (request.mode === 'navigate') {
    try {
      const res = await fetch(request);
      if (res.ok && !res.redirected) cache.put('./', res.clone());
      return res;
    } catch {
      const shell = await cache.match('./', { ignoreSearch: true });
      return shell || new Response('Dicebox is offline and has no cached copy yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  // The big deck-art modules and the icons stay cache-first — large, rarely
  // changed, and refreshed by the content-hashed cache name on SW update.
  const cacheFirst = /-art\.js$/.test(url.pathname) || url.pathname.includes('/icons/');
  if (cacheFirst) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(request);
      if (res.ok && !res.redirected) cache.put(request, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  }

  // Everything else — app.js, style.css, the small modules: network-first with
  // the cache as offline fallback, so an online reload always runs fresh code.
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || new Response('', { status: 504, statusText: 'Offline' });
  }
}
