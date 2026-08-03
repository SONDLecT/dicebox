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
const headers = readFileSync(join(OUT, '_headers'), 'utf8');
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
const present = new Set(readdirSync(OUT));

// --- the panel is complete ---

for (const file of ['index.html', 'app.js', 'dice.js', 'render.js', 'room.js',
                    'room-crypto.js', 'style.css', 'icon.svg', 'manifest.json',
                    '_headers', 'worker.js', 'wrangler.jsonc']) {
  ok(`${file} is built`, present.has(file));
}

// Nothing the page names may be missing, because the panel has no fallback for
// a 404 and a missing module means the entry module never evaluates at all.
// This is also what catches the PWA-stripping regexes removing one line too
// many, or a future asset being referenced but not added to the copy list.
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map(m => m[1]);
const dangling = refs.filter(r => !present.has(r.replace(/^\.\//, '')));
ok('every file the page references was built', dangling.length === 0, dangling.join(', '));

// app.js imports its modules directly; index.html never mentions them.
const imports = [...appJs.matchAll(/from '\.\/([^']+)'/g)].map(m => m[1]);
ok('app.js has imports to check', imports.length > 0);
const missingImports = imports.filter(f => !present.has(f));
ok('every module app.js imports was built', missingImports.length === 0, missingImports.join(', '));

// Every element app.js reaches for has to survive the build. The PWA stripping
// works by deleting whole lines from the markup, and a regex that matched one
// line too many would take an element with it — app.js would then throw on the
// first null dereference at load, and the panel would be blank with the error
// only visible in a console nobody has open.
const wanted = [...new Set([...appJs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))];
ok('there are elements to check', wanted.length > 10);
const lost = wanted.filter(id => !html.includes(`id="${id}"`));
ok('the build kept every element app.js uses', lost.length === 0, lost.join(', '));

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

// --- the manifest ---

ok('the manifest targets a known manifest version', manifest.manifest_version === 1);
ok('the manifest has an action', !!manifest.action && typeof manifest.action.popover === 'string');
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
