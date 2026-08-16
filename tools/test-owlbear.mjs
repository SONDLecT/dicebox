// Checks the built Owlbear panel in owlbear/dist.
//
// Everything here is a property that fails silently in the place it matters.
// An extension is installed once, from a URL, into a room full of people who
// are about to play; there is no console anyone will look at and no address bar
// to reload from. A missing file, an unpinned socket or a widened frame-ancestor
// all present as "the dice panel is blank" twenty minutes into a session.
//
// Run tools/build-owlbear.mjs first — npm test does.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Matches build-owlbear.mjs's --out. The suite checks a throwaway build rather
// than owlbear/dist so that running the tests cannot leave the deployable
// artifact pointed at a fixture relay.
const outArg = process.argv.slice(2).find(a => a.startsWith('--out='));
const OUT = join(ROOT, outArg ? outArg.slice('--out='.length) : 'owlbear/dist');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

if (!existsSync(OUT)) {
  console.log('  FAIL  owlbear/dist does not exist — run tools/build-owlbear.mjs first');
  process.exit(1);
}

const html = readFileSync(join(OUT, 'index.html'), 'utf8');
const appJs = readFileSync(join(OUT, 'app.js'), 'utf8');
const sessionJs = readFileSync(join(OUT, 'owlbear-session.js'), 'utf8');
const headers = readFileSync(join(OUT, '_headers'), 'utf8');
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const present = new Set(readdirSync(OUT));
const mainAssetIgnore = readFileSync(join(ROOT, '.assetsignore'), 'utf8').split('\n').map(line => line.trim());

// --- the panel is complete ---

for (const file of ['index.html', 'app.js', 'dice.js', 'render.js', 'room.js',
                    'room-crypto.js', 'style.css', 'icon.svg', 'manifest.json',
                    '_headers', 'worker.js', 'wrangler.jsonc', 'obr-sdk.js',
                    'background.html', 'background.js', 'owlbear-session.js',
                    'owlbear-history.js', 'owlbear-auth.js',
                    'toast.html', 'toast.css', 'toast.js']) {
  ok(`${file} is built`, present.has(file));
}

ok('Owlbear-only protocol modules are excluded from the standalone site deployment',
   ['owlbear-auth.js', 'owlbear-session.js', 'owlbear-history.js'].every(file => mainAssetIgnore.includes(file)));

// Branding has one source of truth. The Owlbear action must be byte-for-byte the
// same d20 mark used to generate the PWA and dashboard icons, or the project
// quietly drifts back to two identities.
const brandIcon = join(ROOT, 'brand', 'd20.svg');
ok('the canonical d20 brand mark exists', existsSync(brandIcon));
if (existsSync(brandIcon) && present.has('icon.svg')) {
  ok('the Owlbear action uses the canonical d20 brand mark',
     readFileSync(join(OUT, 'icon.svg')).equals(readFileSync(brandIcon)));
}

// Nothing the page names may be missing, because the panel has no fallback for
// a 404 and a missing module means the entry module never evaluates at all.
// This is also what catches the PWA-stripping regexes removing one line too
// many, or a future asset being referenced but not added to the copy list.
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map(m => m[1]);
// <base href="/"> names the site root, not a built file.
const dangling = refs.filter(r => r !== '/' && !present.has(r.replace(/^\.\//, '')));
ok('every file the page references was built', dangling.length === 0, dangling.join(', '));

// app.js imports its modules directly; index.html never mentions them. And those
// modules import their own — render.js pulls in under30-gap.js — so the whole
// STATIC graph has to be walked, not just app.js's first level. A file missing
// anywhere in it stops the entry module evaluating with no error to see, which
// is exactly how the panel once shipped rendering its shell and wiring nothing.
function moduleSrc(name) {
  try { return readFileSync(join(ROOT, name), 'utf8'); } catch { return ''; }
}
const graph = new Set();
const queue = ['app.js'];
while (queue.length) {
  const src = moduleSrc(queue.shift());
  for (const m of src.matchAll(/from '\.\/([^']+\.js)'/g)) {
    if (!graph.has(m[1])) { graph.add(m[1]); queue.push(m[1]); }
  }
}
ok('app.js has an import graph to check', graph.size > 5);
const missingImports = [...graph].filter(f => !present.has(f));
ok('every module in app.js\'s static import graph was built', missingImports.length === 0, missingImports.join(', '));

// The lazily import()'d modules — the card-deck art — cost nothing until a deck
// is opened, but a missing one is that deck dead in the panel with no warning.
// They are shipped, so they are checked; a literal import('./x.js') is required
// present. (The oracle modules load through a variable and are covered above by
// their place in the copy list.)
const dynamic = [...moduleSrc('app.js').matchAll(/import\('\.\/([^']+\.js)'\)/g)].map(m => m[1]);
const missingDynamic = dynamic.filter(f => !present.has(f));
ok('every lazily-imported module was built', missingDynamic.length === 0, missingDynamic.join(', '));

// Every element app.js reaches for has to survive the build. The PWA stripping
// works by deleting whole lines from the markup, and a regex that matched one
// line too many would take an element with it — app.js would then throw on the
// first null dereference at load, and the panel would be blank with the error
// only visible in a console nobody has open.
const wanted = [...new Set([...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))];
ok('there are elements to check', wanted.length > 10);
const lost = wanted.filter(id => !html.includes(`id="${id}"`));
ok('the build kept every element app.js uses', lost.length === 0, lost.join(', '));
ok('the VTT panel shows only a compact always-on Owlbear notice',
   html.includes('Owlbear mode') && html.includes('Rolls are shared with this game') &&
   !html.includes('id="obrBroadcast"') && !html.includes('id="obrRequests"'));
ok('the VTT app has no stale Owlbear sharing or request preference switches',
   !appJs.includes('OBR_BROADCAST_KEY') && !appJs.includes('OBR_REQUESTS_KEY'));
ok('the action panel asks the background for retained history',
   appJs.includes("type: 'history.request'"));
ok('local panel rolls send typed intent to the background without using the relay',
   appJs.includes("type: 'roll.request'") && appJs.includes("destination: 'LOCAL'")
   && !appJs.includes("type: 'roll.publish'"));
ok('local background responses are authenticated before the panel accepts them',
   appJs.includes('verifyLocalPayload') && sessionJs.includes('signLocalPayload'));

// --- the relay is baked in ---

const relayMeta = html.match(/<meta name="dicebox-relay" content="([^"]*)">/);
ok('the relay meta tag survives the build', !!relayMeta);
// An empty tag is the failure this is really about: it builds, installs, opens,
// rolls dice perfectly, and shares nothing. There is no error state for it.
ok('the relay is configured', !!relayMeta && relayMeta[1].length > 0,
   'the panel would roll locally and never share');
ok('the relay is a websocket url', !!relayMeta && /^wss?:\/\//.test(relayMeta[1]), relayMeta?.[1]);

// --- the headers ---

const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || '';
ok('a content security policy is set', csp.length > 0);

const directive = name => (csp.match(new RegExp(`${name} ([^;]+)`)) || [])[1]?.trim() || '';

// The panel must be framed by Owlbear and by nothing else. 'none' would make
// the extension impossible to open; a wildcard would let any site frame a page
// holding a room passphrase.
const ancestors = directive('frame-ancestors');
ok('the panel can be framed', ancestors.length > 0 && ancestors !== "'none'", ancestors);
ok('only Owlbear may frame the panel', ancestors === 'https://www.owlbear.rodeo', ancestors);
ok('frame-ancestors is not a wildcard', !ancestors.includes('*'), ancestors);

// The relay pin. This is the control that survives the build being tampered
// with: a modified panel still cannot post a derived key to a host the browser
// will not connect to.
const connect = directive('connect-src');
ok('connect-src names an exact relay host',
   /wss:\/\/[a-z0-9.-]+/i.test(connect), connect);
ok('connect-src is not opened to every relay',
   !/(^|\s)wss:(\s|$)/.test(connect) && !connect.includes('*'), connect);
ok('the pinned relay matches the configured one',
   !!relayMeta && connect.includes(new URL(relayMeta[1]).origin),
   `${connect} vs ${relayMeta?.[1]}`);

ok('scripts come only from the panel itself', directive('script-src') === "'self'");
ok('the referrer is suppressed', /Referrer-Policy:\s*no-referrer/.test(headers));
ok('sniffing is off', /X-Content-Type-Options:\s*nosniff/.test(headers));

// --- the headers actually get sent ---
//
// This project deploys on Cloudflare Workers, where `_headers` is a Pages
// feature and does nothing — the repo's own wrangler.jsonc says so. Shipping
// the panel with only that file would serve it with no CSP at all: no
// frame-ancestors, no pinned relay. Owlbear would frame it, the dice would
// roll, rooms would join, and every control above would be silently absent.
// So the build emits a Worker, and these check it is real.
const worker = readFileSync(join(OUT, 'worker.js'), 'utf8');
const wrangler = readFileSync(join(OUT, 'wrangler.jsonc'), 'utf8');

ok('the worker sets a content security policy', /Content-Security-Policy/.test(worker));
// Both files are generated from one value; if they ever disagree, the one that
// takes effect depends on the host, which is the worst possible outcome.
ok('the worker and _headers carry the same policy', worker.includes(csp),
   'the two copies of the CSP have drifted');
ok('the worker sets the other security headers',
   /X-Content-Type-Options/.test(worker) && /Referrer-Policy/.test(worker));

ok('the worker config points at the worker', /"main":\s*"worker\.js"/.test(wrangler));
// The subtle one. Without run_worker_first, Cloudflare serves matching assets
// directly and the script never executes, so the headers it sets never apply —
// the same silent no-CSP outcome, reached a different way.
ok('assets do not bypass the worker', /"run_worker_first":\s*true/.test(wrangler));
ok('the worker config binds the assets the worker reads',
   /"binding":\s*"ASSETS"/.test(wrangler) && /env\.ASSETS/.test(worker));

// --- Owlbear can actually read the manifest ---
//
// Owlbear fetches the manifest, and the action icon, from its own page. That is
// cross-origin, so without an Access-Control-Allow-Origin header the browser
// refuses to hand over a response that was served perfectly correctly, and the
// install dialog reports "failed to fetch" with nothing else to go on. This is
// the first thing anyone installing the extension hits, and the file being fine
// over curl proves nothing about it.
ok('the manifest is readable cross-origin',
   /Access-Control-Allow-Origin/.test(worker) && /'\/manifest\.json'/.test(worker));
ok('the action icon is readable cross-origin', /'\/icon\.svg'/.test(worker));
ok('_headers grants the same', /Access-Control-Allow-Origin/.test(headers));
// Only those two. The panel's own code has no reason to be fetchable by other
// sites, and opening it wholesale would be a wider grant than anything needs.
ok('CORS is limited to the files Owlbear reads',
   /const PUBLIC = new Set\(\['\/manifest\.json', '\/icon\.svg'\]\)/.test(worker));
ok('a preflight is answered', /OPTIONS/.test(worker));

// --- the manifest ---

ok('the manifest targets a known manifest version', manifest.manifest_version === 1);
ok('the background-bridge release bumps the extension version', manifest.version === '1.1.0', manifest.version);
ok('the manifest has an action', !!manifest.action && typeof manifest.action.popover === 'string');
ok('the manifest keeps an always-on background context', manifest.background_url === '/background.html', manifest.background_url);
// Silently truncated by Owlbear rather than rejected, so it has to be caught here.
ok('the name is within Owlbear\'s 45 characters', manifest.name.length <= 45, `${manifest.name.length}`);
ok('the description is within Owlbear\'s 128 characters',
   !manifest.description || manifest.description.length <= 128,
   `${manifest.description?.length}`);
ok('the action icon was built', present.has(manifest.action.icon.replace(/^\//, '')));

// Dicebox copies the passphrase, the invite link and the roll log to the
// clipboard. Inside an iframe that needs the permission declared here, or the
// buttons fail with nothing to explain why — which at a table reads as the
// passphrase being uncopyable at the exact moment everyone needs it.
const perms = (manifest.permissions || []).map(p => p.name);
ok('clipboard-write is requested', perms.includes('clipboard-write'), perms.join(', ') || 'none');
ok('every permission carries a reason',
   (manifest.permissions || []).every(p => typeof p.reason === 'string' && p.reason.length > 0));

// --- the Owlbear SDK waits for the parent handshake ---
//
// Exercise the production initializer itself rather than merely checking the
// order of strings. This catches both the original pre-ready subscription and
// delayed callback failures that would otherwise leave the sharing UI lying
// about whether broadcast is active.
function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

const initializeOwlbearSource = extractNamedFunction(appJs, 'initializeOwlbear');
ok('the shared table has a testable production initializer', !!initializeOwlbearSource);
if (initializeOwlbearSource) {
  const makeHarness = () => {
    const errors = [];
    const factory = new Function('captureError', `
      const OBR_CHANNEL = 'cc.dicebox.rolls';
      const OBR_PROTOCOL_VERSION = 1;
      let obr = null;
      let obrConnectionId = null;
      let obrPlayerName = '';
      const pendingOwlbearState = {};
      const requestOwlbearAction = () => {};
      const requestOwlbearHistory = () => {};
      const handleOwlbearMessage = () => {};
      // The panel's shared-deck view, stubbed: the initializer creates it and
      // hydrates on ready, which must not require a room API in this harness.
      let panelDecks = null;
      let uiSystem = 'numeric';
      const localStorage = undefined;
      const PANEL_DECKS = {};
      const hydrateSharedDeck = () => false;
      const createSharedDecks = () => ({ ready: Promise.resolve(), get: () => null, set: () => {}, dispose: () => {} });
      let accepted = 0;
      const acceptOwlbearRoll = () => { accepted++; };
      const console = {
        error: (...args) => captureError(args),
        warn: () => {},
      };
      ${initializeOwlbearSource}
      return {
        initializeOwlbear,
        state: () => ({ obr, obrPlayerName, accepted }),
      };
    `);
    return { ...factory(args => errors.push(args)), errors };
  };

  {
    const harness = makeHarness();
    const room = { hidden: true };
    let ready = null, subscriptions = 0, playerReads = 0;
    const sdk = {
      onReady(callback) { ready = callback; },
      broadcast: {
        onMessage() { subscriptions++; },
        sendMessage() { return Promise.resolve(); },
      },
      player: {
        getConnectionId() { return Promise.resolve('local-connection'); },
        getName() { playerReads++; return Promise.resolve('Ready Player'); },
      },
    };
    harness.initializeOwlbear(sdk, room);
    ok('broadcast is not subscribed before OBR_READY', subscriptions === 0);
    ok('the sharing row stays hidden before OBR_READY', room.hidden === true);
    await ready();
    await Promise.resolve();
    ok('broadcast subscribes after OBR_READY', subscriptions === 1);
    ok('successful subscription reveals and activates Owlbear sharing',
       room.hidden === false && harness.state().obr === sdk);
    ok('the player name is read only after readiness',
       playerReads === 1 && harness.state().obrPlayerName === 'Ready Player');
    ok('successful delayed initialization emits no SDK error', harness.errors.length === 0);
  }

  {
    const harness = makeHarness();
    const room = { hidden: true };
    let ready = null, playerReads = 0;
    const sdk = {
      onReady(callback) { ready = callback; },
      broadcast: { onMessage() { throw new Error('subscription failed'); } },
      player: {
        getConnectionId() { return Promise.resolve('local-connection'); },
        getName() { playerReads++; return Promise.resolve('Never read'); },
      },
    };
    harness.initializeOwlbear(sdk, room);
    await ready();
    ok('failed subscription leaves Owlbear sharing hidden and inactive',
       room.hidden === true && harness.state().obr === null && playerReads === 1);
    ok('failed delayed initialization is reported',
       harness.errors.length === 1 &&
       harness.errors[0][0] === '[Dicebox/Owlbear] SDK initialization failed' &&
       harness.errors[0][1]?.message === 'subscription failed');
  }
}

// --- the panel knows it is embedded ---

ok('the app detects being embedded', /window\.top !== window\.self/.test(appJs));
// A service worker inside the panel would pin it to whatever build was cached
// first, in a frame with no way to force a reload.
ok('the service worker is skipped when embedded',
   /if \(!embedded && 'serviceWorker' in navigator\)/.test(appJs));

// --- nothing from the PWA build survives ---

ok('no web app manifest is linked', !/rel="manifest"/.test(html));
ok('no icons are referenced', !/icons\//.test(html));
ok('no apple web app meta remains', !/apple-mobile-web-app/.test(html));
// The single-file download lives on the site; relative it would 404 here.
ok('the download link points off-origin',
   !/href="dicebox\.html"/.test(html) && /dicebox\.html/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
