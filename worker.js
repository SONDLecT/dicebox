// Serves the static assets and attaches security and cache headers.
//
// Workers static assets can run without any script at all, but then nothing can
// set headers — `_headers` is a Pages feature and is ignored here. This is the
// smallest script that fixes that: fetch the asset, copy the response, add the
// headers.

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // The app is entirely self-contained, so nothing may load from anywhere else.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
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
    const res = await env.ASSETS.fetch(request);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);

    if (ALWAYS_REVALIDATE.has(url.pathname)) {
      headers.set('Cache-Control', 'no-cache');
    } else if (url.pathname.startsWith('/icons/')) {
      headers.set('Cache-Control', 'public, max-age=604800');
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
