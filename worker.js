// Serves the static assets and attaches security and cache headers.
//
// Workers static assets can run without any script at all, but then nothing can
// set headers — `_headers` is a Pages feature and is ignored here. This is the
// smallest script that fixes that: fetch the asset, copy the response, add the
// headers.

// The one origin the app may open a WebSocket to. Rooms do not work without it
// — `connect-src 'self'` blocks a relay on a separate host outright — but it is
// pinned to an exact origin rather than widened to `wss:` or `*`, and that
// distinction is the whole point.
//
// The relay never carries key material by design. A pinned connect-src is what
// keeps that true even if the design fails: a build that has been tampered with
// somewhere between here and the browser still cannot post a derived key to a
// host that is not on this line, because the browser refuses the connection
// before the request is made. `wss:` would allow every relay on the internet
// and give an attacker their pick, which defeats the control entirely.
//
// Self-hosters change this to their own relay. Deploying without one at all is
// fine and leaves the app local-only, which is the default anyway.
const RELAY_ORIGIN = 'wss://relay.dicebox.trollskull.cc';

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // The app is entirely self-contained apart from the relay above, so nothing
  // may load from anywhere else.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${RELAY_ORIGIN}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// A stale service worker pins every other asset to its old version, so it and
// the shell it installs must always be revalidated.
const ALWAYS_REVALIDATE = new Set(['/sw.js', '/', '/index.html', '/manifest.webmanifest']);

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
      for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Content-Disposition', 'attachment; filename="dicebox.html"');
      headers.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: res.status, headers });
    }

    const res = await env.ASSETS.fetch(request);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);

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
