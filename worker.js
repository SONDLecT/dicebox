// Serves the static assets and attaches security and cache headers.
//
// Workers static assets can run without any script at all, but then nothing can
// set headers — `_headers` is a Pages feature and is ignored here. This is the
// smallest script that fixes that: fetch the asset, copy the response, add the
// headers.

// The only origin each deployment may open a WebSocket to. Rooms do not work
// without an entry here — `connect-src 'self'` blocks a relay on a separate
// host outright — but each is pinned to an exact origin rather than widened to
// `wss:` or `*`, and that distinction is the whole point.
//
// The relay never carries key material by design. A pinned connect-src is what
// keeps that true even if the design fails: a build that has been tampered with
// somewhere between here and the browser still cannot post a derived key to a
// host that is not on this list, because the browser refuses the connection
// before the request is made. `wss:` would allow every relay on the internet
// and give an attacker their pick, which defeats the control entirely.
//
// Staging and production are listed separately so neither can reach the other's
// relay. Self-hosters add their own. A host absent from this list gets no
// exception at all and stays local-only, which is the default anyway.
const RELAY_ORIGINS = {
  'dev.dicebox.trollskull.cc': 'wss://dev.relay.dicebox.trollskull.cc',
  // The canonical home and the old host both talk to the same relay, reachable
  // under either name (same Worker, same Durable Objects), so a room id is the
  // same table whichever front door a player came through.
  'dicebox.cc': 'wss://relay.dicebox.cc',
  'dicebox.trollskull.cc': 'wss://relay.dicebox.cc',
};

const securityHeaders = hostname => {
  const relay = RELAY_ORIGINS[hostname];
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The app is entirely self-contained apart from its own relay, so nothing
    // may load from anywhere else. A host with no relay listed above gets no
    // connect-src exception at all, which leaves it local-only.
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      relay ? `connect-src 'self' ${relay}` : "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
};

// A stale service worker pins every other asset to its old version, so it and
// the shell it installs must always be revalidated.
const ALWAYS_REVALIDATE = new Set(['/sw.js', '/', '/index.html', '/manifest.webmanifest']);

// Branded system slugs. Each opens the app shell, which reads location.pathname
// and starts in that system. Assets under the shell resolve to the root because
// index.html carries <base href="/">, so a slug never breaks a relative link.
// Anything not listed still 404s — a slug map, not a catch-all SPA rewrite.
// Canonical slugs are the community shorthand the picker shows, edition and
// all; the earlier forms stay as aliases so links shared before each rename
// keep working.
const SYSTEM_SLUGS = new Set([
  '/cards', '/tarot', '/italiane', '/napoletane', '/scopa', '/hanafuda', '/koikoi', '/hana', '/utagaruta', '/karuta', '/hyakunin', '/vtmv5', '/fate', '/genesys', '/dh', '/ctech2e', '/swrpg', '/tor2e', '/pbta', '/mist', '/mosh1e', '/coc', '/callofcthulhu', '/cthulhu', '/dg', '/deltagreen',
  '/v5', '/vtm', '/daggerheart', '/cthulhutech', '/force', '/feat', '/mothership', '/ctech', '/tor', '/mosh',
  '/ironsworn', '/starforged', '/iron', '/dcc',
  '/yz', '/yearzero', '/alien', '/forbiddenlands', '/vaesen', '/coriolis', '/mutant',
  '/brrpg', '/bladerunner',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The single-file build is a download, so it is served straight through with
    // a filename attached. Left to the default handling the edge rewrites
    // /dicebox.html to /dicebox with a 307, and a download link that redirects
    // is the same fragility that stopped the installed app from launching.
    if (url.pathname === '/dicebox.html') {
      const res = await env.ASSETS.fetch(new URL('/dicebox', url));
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(securityHeaders(url.hostname))) headers.set(k, v);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Content-Disposition', 'attachment; filename="dicebox.html"');
      headers.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: res.status, headers });
    }

    // A system slug serves the app shell (index.html) rather than 404ing. The
    // shell is revalidated like the root, since it is the same document.
    if (SYSTEM_SLUGS.has(url.pathname.replace(/\/+$/, ''))) {
      const res = await env.ASSETS.fetch(new URL('/', url));
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(securityHeaders(url.hostname))) headers.set(k, v);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Cache-Control', 'no-cache');
      if (url.hostname.startsWith('dev.')) headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(res.body, { status: res.status, headers });
    }

    const res = await env.ASSETS.fetch(request);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(securityHeaders(url.hostname))) headers.set(k, v);

    if (ALWAYS_REVALIDATE.has(url.pathname)) {
      headers.set('Cache-Control', 'no-cache');
    } else if (url.pathname.startsWith('/icons/')) {
      headers.set('Cache-Control', 'public, max-age=604800');
    }

    // The staging copy is for looking at changes before they go live, not for
    // anyone to find. Keeping it out of search results also keeps it from
    // competing with the real demo for the same queries.
    if (url.hostname.startsWith('dev.')) {
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
