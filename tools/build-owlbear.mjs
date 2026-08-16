// Builds the Owlbear Rodeo panel out of the app that is already here.
//
// The panel is not a second implementation and deliberately not a rewrite: an
// Owlbear extension is a web page loaded in an iframe, and Dicebox is a
// self-contained web page, so the extension is this app with three things
// changed and nothing else. Everything a player sees — the tray, the pool, the
// modifiers, the rooms — is the same code, and a fix to any of it reaches the
// panel by rebuilding rather than by being ported.
//
// What actually differs from the hosted copy:
//
//   1. The relay origin is baked in, because a panel has no settings screen and
//      nobody is going to edit a meta tag inside an iframe.
//   2. The PWA parts come out. A popover cannot be installed to a home screen
//      and has no address bar to install from.
//   3. The headers are the extension's own, and they are the interesting part.
//      The app's own build refuses to be framed at all; this one permits
//      exactly one framer and no others. See writeHeaders below.
//
// The app files are copied rather than inlined. bundle.mjs already produces the
// single-file build for people who want one, and a panel that arrives as one
// 220KB HTML file would be harder to inspect for anyone deciding whether to
// trust the extension with their table's passphrase.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'owlbear');
const BRAND_ICON = join(ROOT, 'brand', 'd20.svg');

// Owlbear serves rooms from here, and this is the only origin permitted to
// frame the panel. Not a variable: widening it is the one edit that would
// quietly undo the protection described in writeHeaders, so it is spelled out
// where anyone changing it has to read why first.
const OWLBEAR_ORIGIN = 'https://www.owlbear.rodeo';

const args = new Map(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
    }));

const relay = args.get('relay');
const site = args.get('site') || 'https://dicebox.cc';

// The hostname the panel is served from. Written into the generated wrangler
// config as a custom domain, and it must not be the app's own origin — the app
// refuses to be framed and this build does not, so sharing a host would mean
// one server sending two different frame-ancestors depending on the path, and
// the app's service worker would claim the panel besides.
const host = args.get('host') && args.get('host') !== true ? String(args.get('host')) : '';

// Defaults to owlbear/dist, which is the artifact you deploy. The test suite
// builds somewhere else on purpose: if `npm test` overwrote owlbear/dist with a
// build pointed at a fixture relay, the next deploy would ship a panel that
// installs, opens, rolls dice and silently shares nothing with anybody.
const OUT = args.get('out') && args.get('out') !== true
  ? join(ROOT, String(args.get('out')))
  : join(SRC, 'dist');

if (!relay || relay === true) {
  console.error(`
Usage: node tools/build-owlbear.mjs --relay=wss://relay.example.com/ws [--site=https://dicebox.example.com]

  --relay  The relay this panel talks to. Required, and baked into the build:
           an iframe has no settings screen to configure it from later.
           It is also written into the panel's connect-src, so the browser
           refuses any other host outright.

  --site   Where a full copy of Dicebox lives, for the help panel's links.
           Defaults to the public demo.

  --out    Where to build, relative to the repo root. Defaults to owlbear/dist.

  --host   Hostname to serve the panel from, e.g. vtt.dicebox.example.com.
           Written into the generated wrangler config. Must be its own origin,
           not a path on the app's.
`.trim());
  process.exit(1);
}

let relayOrigin;
try {
  const url = new URL(relay);
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('not a websocket url');
  // ws:// is allowed because a self-hoster testing on a LAN has no certificate
  // yet, but it is worth one line of warning: Owlbear is served over https, so
  // a browser will block a plaintext socket from a page inside it.
  if (url.protocol === 'ws:') {
    console.warn('warning: ws:// will be blocked as mixed content inside Owlbear. Use wss:// for anything real.');
  }
  relayOrigin = url.origin;
} catch {
  console.error(`--relay must be a websocket URL, e.g. wss://relay.example.com/ws (got ${relay})`);
  process.exit(1);
}

// Everything app.js reaches for at runtime. Kept as an explicit list rather than
// a directory copy so that a new file at the repo root cannot silently end up
// published on the extension origin.
const APP_FILES = [
  // The static graph app.js needs to start.
  'app.js', 'dice.js', 'render.js', 'under30-gap.js', 'tray-faces.js', 'system-dice.js', 'room.js', 'room-crypto.js', 'style.css',
  // Lazily imported on demand, so they cost nothing until used, but must be here
  // or that system is dead in the panel: the oracle tables and the card-deck art
  // (all vector SVG — the weight is trace detail, not resolution).
  'oracle-dice.js', 'ironsworn-oracles.js', 'starforged-oracles.js',
  'cards-art.js', 'tarot-art.js', 'nap-art.js', 'hana-art.js', 'uta-art.js',
  // Owlbear-only headless request/history service. The standalone page never
  // imports this module; it is copied solely into the extension artifact.
  'owlbear-session.js', 'owlbear-history.js', 'owlbear-auth.js',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const file of APP_FILES) copyFileSync(join(ROOT, file), join(OUT, file));
copyFileSync(BRAND_ICON, join(OUT, 'icon.svg'));

// The Owlbear SDK, vendored (owlbear/obr-sdk.js, a self-contained esbuild bundle
// of @owlbear-rodeo/sdk — regenerate with owlbear/README's "update the SDK"). It
// exists ONLY in the panel build: app.js loads it lazily, gated on the
// dicebox-owlbear meta below, so the site never fetches it and the broadcast code
// never runs anywhere but here.
copyFileSync(join(SRC, 'obr-sdk.js'), join(OUT, 'obr-sdk.js'));
copyFileSync(join(SRC, 'background.html'), join(OUT, 'background.html'));
copyFileSync(join(SRC, 'background.js'), join(OUT, 'background.js'));
// The corner roll window the background opens for each completed roll.
copyFileSync(join(SRC, 'toast.html'), join(OUT, 'toast.html'));
copyFileSync(join(SRC, 'toast.css'), join(OUT, 'toast.css'));
copyFileSync(join(SRC, 'toast.js'), join(OUT, 'toast.js'));

// --- the page ---

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const before = html;
html = html.replace(/(<meta name="dicebox-relay" content=")[^"]*(">)/, `$1${relay}$2`);
if (html === before) {
  // The meta tag is how the relay reaches room.js. If the markup changed shape
  // and this stopped matching, the panel would build cleanly, install cleanly,
  // and then silently never share a roll.
  console.error('could not find the dicebox-relay meta tag in index.html');
  process.exit(1);
}

// The marker app.js uses to recognize the Owlbear-only build. Only this artifact
// imports the SDK and exposes the compact always-on Owlbear mode notice.
html = html.replace(
  /(<meta name="dicebox-relay"[^>]*>)/,
  '$1\n  <meta name="dicebox-owlbear" content="1">');

// The PWA wiring, removed. manifest.webmanifest and the icons are not copied to
// the extension origin, so leaving these would be three 404s on every open, and
// an install prompt for a page that cannot be installed.
const PWA_LINES = [
  /^.*<link rel="manifest".*$\n/m,
  /^.*<link rel="apple-touch-icon".*$\n/m,
  /^.*<link rel="icon".*$\n/m,
  /^.*<meta name="apple-mobile-web-app-capable".*$\n/m,
  /^.*<meta name="apple-mobile-web-app-status-bar-style".*$\n/m,
  /^.*<meta name="apple-mobile-web-app-title".*$\n/m,
];
for (const line of PWA_LINES) html = html.replace(line, '');

// The single-file download lives on the site, not here. Left relative it would
// resolve against the extension origin and 404; pointed at the site it still
// does the useful thing, which is hand someone a copy they can keep.
html = html.replace(
  /href="dicebox\.html" download="dicebox\.html"/,
  `href="${site}/dicebox.html" target="_blank" rel="noopener noreferrer"`);

writeFileSync(join(OUT, 'index.html'), html);

// --- the manifest ---

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
// Owlbear caps the name at 45 characters and the description at 128. Both are
// silent truncations rather than install errors, so they are checked here.
if (manifest.name.length > 45) throw new Error('manifest name exceeds 45 characters');
if (manifest.description && manifest.description.length > 128) {
  throw new Error('manifest description exceeds 128 characters');
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// --- the headers ---

function writeHeaders() {
  // Two lines here carry the whole security story of the extension, and both
  // are narrower than they look.
  //
  // frame-ancestors: the app's own build sets 'none' and means it — Dicebox
  // refuses to be embedded anywhere. This build has to be embedded, by exactly
  // one page, so it names that page instead of relaxing to a wildcard. A panel
  // that could be framed by anything could be framed by a site that then reads
  // whatever it can reach, and the thing it can reach is a room passphrase.
  //
  // connect-src: pinned to the one relay this build was made for, for the same
  // reason the hosted app pins its own. The relay is never given key material
  // by design; the pin is what keeps that true if the design fails. A build
  // tampered with between the server and the browser still cannot post a
  // derived key anywhere, because the browser refuses the connection before the
  // request is made. `wss:` would allow every relay on the internet and hand an
  // attacker their choice of them.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${relayOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${OWLBEAR_ORIGIN}`,
  ].join('; ');

  // A Worker, because that is what this project already deploys with — and
  // because `_headers` is a Pages feature that does nothing on Workers, which
  // wrangler.jsonc at the repo root says in as many words.
  //
  // That combination is the trap. Deployed the same way as the app, with only
  // the _headers file below, the panel would serve no CSP whatsoever: no
  // frame-ancestors, no pinned relay, nothing. And it would work — Owlbear
  // would frame it happily, the dice would roll, rooms would join. Every
  // control described here would simply be absent, with no symptom to notice.
  writeFileSync(join(OUT, 'worker.js'), `// Generated by tools/build-owlbear.mjs. Do not edit here.
//
// Serves the panel and attaches its headers. Workers static assets can run with
// no script at all, but then nothing sets headers — and for this build the
// headers are the entire security story, so the script is not optional.
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': ${JSON.stringify(csp)},
};

// Owlbear reads these two from its own page, which is a different origin, so
// the browser will not hand it the response without permission to. Without
// this, installing the extension fails at the first step with "failed to
// fetch" and no indication that the file was served perfectly well.
//
// Open to any origin rather than to Owlbear's, because these are the two files
// whose entire purpose is to be read by somebody else, they contain nothing
// that is not already public, and pinning to one host would break the moment
// Owlbear fetched from a different one. Everything else on this origin stays
// unreadable cross-origin.
const PUBLIC = new Set(['/manifest.json', '/icon.svg']);

// Never served stale past a redeploy: the manifest is how Owlbear decides what
// the extension is, and the shell is what the panel opens.
const FRESH = new Set(['/manifest.json', '/', '/index.html']);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    // A preflight never reaches the assets, so it is answered here. Owlbear's
    // fetch is simple enough not to trigger one today; a stricter fetch later
    // should not break installation.
    if (request.method === 'OPTIONS' && PUBLIC.has(path)) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Owlbear embeds these by their exact .html URLs, and the assets layer
    // would 307 them to the extensionless path. A background frame that lands
    // on a different URL than the manifest registered is a frame Owlbear may
    // not complete its handshake with, so both are served straight through —
    // the same dodge the app's worker does for /dicebox.html.
    const url = new URL(request.url);
    if (path === '/background.html' || path === '/toast.html') {
      const direct = new URL(path.replace(/\\.html$/, '') + url.search, url);
      const page = await env.ASSETS.fetch(direct);
      const pageHeaders = new Headers(page.headers);
      for (const [k, v] of Object.entries(HEADERS)) pageHeaders.set(k, v);
      pageHeaders.set('Content-Type', 'text/html; charset=utf-8');
      pageHeaders.set('Cache-Control', 'no-cache');
      return new Response(page.body, { status: page.status, headers: pageHeaders });
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);

    if (PUBLIC.has(path)) headers.set('Access-Control-Allow-Origin', '*');
    if (FRESH.has(path)) headers.set('Cache-Control', 'no-cache');

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
`);

  writeFileSync(join(OUT, 'wrangler.jsonc'), `{
  // Generated by tools/build-owlbear.mjs. Do not edit here.
  //
  // Deploys with the same infrastructure as the app: \`npx wrangler deploy\`
  // from this directory. Set a route, or attach a custom domain, to whichever
  // hostname you serve the panel from — it must be a different origin from the
  // app itself, because this one permits being framed and that one must not.
  "name": "dicebox-owlbear",
  "compatibility_date": "2026-07-18",
${host ? `
  "routes": [
    { "pattern": "${host}", "custom_domain": true }
  ],
` : ''}

  // Not optional. Without the script nothing sets the security headers, and
  // \`_headers\` is a Pages feature that Workers ignores silently.
  "main": "worker.js",

  "assets": {
    "directory": ".",
    "binding": "ASSETS",

    // Without this, matching assets are served directly, the script never runs,
    // and none of its headers apply — which for this build means shipping with
    // no CSP while appearing to work perfectly.
    "run_worker_first": true,

    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
`);

  writeFileSync(join(OUT, '_headers'), `# Generated by tools/build-owlbear.mjs. Do not edit here.
#
# Cloudflare **Pages** format, and ignored by Workers — if you are deploying
# with wrangler, worker.js is what sets these headers and this file does
# nothing. It is here for Pages and as a reference for other hosts; the nginx
# and Caddy equivalents are in owlbear/README.md.
#
# Whatever serves this build must send these headers. A host that sends none of
# them still appears to work, right up until it matters.

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: ${csp}

# Read cross-origin by Owlbear when the extension is installed and when the
# action icon is drawn. Without the CORS header the browser refuses to hand
# Owlbear the response and installation fails with "failed to fetch", however
# correctly the file was served.
/manifest.json
  Cache-Control: no-cache
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

/icon.svg
  Access-Control-Allow-Origin: *

/index.html
  Cache-Control: no-cache
`);
  return csp;
}

const csp = writeHeaders();

console.log(`${OUT.replace(ROOT + '/', '')}  built`);
console.log(`  relay   ${relay}`);
console.log(`  framer  ${OWLBEAR_ORIGIN}`);
console.log(`  files   ${APP_FILES.length + 4}`);
console.log(`\nCSP: ${csp}`);
console.log(`\nServe ${OUT.replace(ROOT + '/', '')} over https, then install`);
console.log(`  <your-origin>/manifest.json`);
console.log(`in Owlbear under Profile -> Add Extension.`);
