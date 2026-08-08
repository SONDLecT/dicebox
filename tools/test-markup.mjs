// Static checks on the markup and stylesheet. These catch wiring mistakes that
// the logic tests cannot see, because they live in the gap between files.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const js = readFileSync(join(root, 'app.js'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// --- the hidden-attribute trap ---
// `hidden` is only `display: none` in the UA stylesheet, so any class rule that
// sets display or positions the element beats it. Without a global override the
// modifier sheet rendered on load as a full-page blur that swallowed every tap.
ok('global [hidden] override exists',
   /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css));

const hiddenEls = [...html.matchAll(/<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*?)\shidden(?=[\s>])/g)];
ok('markup has elements using hidden', hiddenEls.length > 0);

for (const [, tag, attrs] of hiddenEls) {
  const id = (attrs.match(/id="([^"]+)"/) || [])[1] || tag;
  const classes = ((attrs.match(/class="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
  for (const cls of classes) {
    const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    if (!rule) continue;
    const setsDisplay = /display\s*:/.test(rule[1]);
    const isPositioned = /position\s*:\s*(fixed|absolute)/.test(rule[1]);
    // Either is fine on its own — the global override handles both — but only
    // because that override exists. This asserts the pairing stays intentional.
    if (setsDisplay || isPositioned) {
      ok(`#${id} stays hidden despite .${cls}`,
         /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css));
    }
  }
}

// --- elements the script reaches for must exist ---
const ids = [...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const missing = [...new Set(ids)].filter(id => !html.includes(`id="${id}"`));
ok('every getElementById target exists', missing.length === 0, missing.join(', '));

// --- classes must be styled ---
const htmlClasses = [...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/));
const jsClasses = [...js.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap(m => m[1].split(/\s+/));
const unstyled = [...new Set([...htmlClasses, ...jsClasses])]
  .filter(c => c && !css.includes(`.${c}`));
ok('every class has a style rule', unstyled.length === 0, unstyled.join(', '));

// --- the offline cache can actually be invalidated ---
//
// The one deploy bug with no symptom on the server. Every asset ships
// correctly, every check here passes, and installed copies keep serving the
// previous build because their service worker was told to keep it. It cost a
// round of "your fix is not working" after a deploy that changed render.js and
// left the cache name alone.
//
// deploy.mjs now rewrites the constant with a hash of everything shipped
// beside it, so the two have to keep agreeing on its shape.
const deploy = readFileSync(join(root, 'tools', 'deploy.mjs'), 'utf8');
const cacheDecl = /const CACHE = '[^']*';/;

ok('sw.js declares a cache name the deploy can find', cacheDecl.test(sw));
ok('the deploy rewrites the cache name', /const CACHE = '\$\{stamp\}';/.test(deploy));
// A silent no-op substitution is the failure being guarded against, so the
// deploy has to treat a miss as fatal rather than shipping what it found.
ok('a failed rewrite stops the deploy',
   /Could not find the CACHE constant/.test(deploy) && /process\.exit\(1\)/.test(deploy));
// Derived from the assets, not from the file it is written into.
ok('the cache name is derived from the shipped assets',
   /swCacheName/.test(deploy) && /path !== '\/sw\.js'/.test(deploy));

// The build id the app displays. Same hash as the cache name, so a copy that
// says which build it is cannot be lying: the id lives inside the bytes the
// service worker cached. This is the thing that ends "is the fix even loaded"
// without anyone having to diff bytes over the wire.
ok('the page carries a build meta tag', /<meta name="dicebox-build" content="">/.test(html));
ok('the app reads the build id', /dicebox-build/.test(js));
ok('the build id is shown', /id="build"/.test(html) && /\.build\s*\{/.test(css));
ok('the deploy stamps the build id',
   /dicebox-build" content="\)\[\^"\]\*\(">/.test(deploy) || /dicebox-build/.test(deploy));
ok('the build id and the cache name are the same hash',
   /const buildId = stamp\.replace/.test(deploy));

// --- the full history escapes the tray ---
//
// Every sheet is positioned inside .tray, which is right for a control acting
// on the dice underneath it and wrong for the one panel people sit and read:
// confined there it was a third of a phone tall, which is what players
// complained about. A revert to the shared .sheet positioning would make the
// panel quietly small again and break nothing else, so it is asserted here
// rather than left to be noticed at a table.
const historyRule = /#historyPanel\s*\{([^}]*)\}/.exec(css);
ok('the full history has positioning of its own', !!historyRule);
if (historyRule) {
  ok('the full history escapes the tray', /position\s*:\s*fixed/.test(historyRule[1]));
  // The panel holds still and the list inside it scrolls. Letting the sheet
  // scroll instead takes the title and the export buttons off screen with it.
  ok('the full history does not scroll itself', /overflow\s*:\s*hidden/.test(historyRule[1]));
}
ok('the history list is what scrolls',
   /#historyPanel\s+\.history-full\s*\{[^}]*flex\s*:\s*1 1 auto/.test(css));

// One custom property moves every row, and the choice survives a reload — a
// size that has to be set again each session is a chore rather than a setting.
ok('the reading size is one custom property',
   /--history-text/.test(css) && /--history-text/.test(js));
ok('the reading size is remembered', /dicebox:historyText/.test(js));
// Through the guarded store, not localStorage directly: this runs at load, and
// an unguarded read throws where storage is partitioned or denied.
ok('the reading size is read through the storage guard',
   /store\.get\('dicebox:historyText'\)/.test(js) &&
   /store\.set\('dicebox:historyText'/.test(js));

// --- what the share panel opens on ---
//
// Create and join must come before the privacy note. The note used to lead,
// which in an Owlbear panel put both controls below the fold: the panel is a
// fixed popover and a sheet only gets the tray's share of it, so opening Share
// meant scrolling past a paragraph about ciphertext to reach the button you
// opened it for. Ordering is invisible to every other check here and reverting
// it would break nothing that fails.
const setup = html.slice(html.indexOf('id="roomSetup"'), html.indexOf('id="roomLive"'));
const at = needle => setup.indexOf(needle);
ok('the share panel contains all three parts',
   at('id="roomCreate"') !== -1 && at('id="roomJoinForm"') !== -1 && at('id="roomNote"') !== -1);
ok('create comes before join', at('id="roomCreate"') < at('id="roomJoinForm"'));
ok('joining comes before the privacy note', at('id="roomJoinForm"') < at('id="roomNote"'));
// The made-room block belongs under Create, not after the join form: it is what
// Create produces and reads as orphaned anywhere else.
ok('the new passphrase appears under create',
   at('id="roomCreate"') < at('id="roomMade"') && at('id="roomMade"') < at('id="roomJoinForm"'));

// --- the privacy note ---
//
// The panel is the only privacy statement inside the app, and what it may
// claim differs by how the app was delivered. A served copy — the demo, and
// every self-hosted deployment — ships the encrypting code over the network on
// every load, so whoever serves it could change it. "Only people with the
// passphrase can read your rolls" is therefore a promise there, and a
// guarantee only in the single file, where nothing can change under the reader.
//
// That distinction used to live in the paragraph, which made it accurate and
// unreadable: three hedged sentences that players scrolled past to reach the
// join button. It now lives in the link, whose label has to keep saying that
// there are limits. So the checks below moved rather than relaxed — the note
// may not overclaim, and the link must still point at the limits.
const note = (html.match(/<p class="room-note" id="roomNote">([\s\S]*?)<\/p>/)?.[1] || '')
  .replace(/\s+/g, ' ').trim();
ok('the room note exists', note.length > 0);

// Short enough that create and join stay above the fold in an Owlbear panel.
ok('the note stays short enough for a panel', note.length <= 260, `${note.length} chars`);

// It may say what the mechanism is.
ok('the note says rolls are end-to-end encrypted',
   /end-to-end encrypted/.test(note), note);
ok('the note says the relay cannot read them',
   /relay only ever sees ciphertext/.test(note), note);

// It may not claim the operator is incapable of reading rolls. That is true of
// the single file and not of a served copy, and the difference is the whole
// reason this section exists.
ok('the served note claims nothing about the operator being unable',
   !/cannot see/.test(note) && !/we cannot/i.test(note) && !/nobody (else )?can/i.test(note),
   note);
ok('the served note does not claim to be the file on disk',
   !/on your disk/.test(note), note);

// The link is now the only place the caveat is stated, so its label carries the
// signal. "Find out more" would not: it promises detail, not limits.
const moreLink = html.match(/<p class="room-note room-note-more">([\s\S]*?)<\/p>/)?.[1] || '';
ok('the privacy section is linked from the panel',
   /#what-the-privacy-actually-is/.test(moreLink));
ok('the link says there are limits',
   /does\s?n.t guarantee|cannot|limits|actually/i.test(moreLink), moreLink.trim());

// The stronger claim stays gated on file:, where it is true.
ok('the stronger claim is gated on file:',
   /location\.protocol === 'file:'/.test(js) &&
   js.indexOf("location.protocol === 'file:'") < js.indexOf('the file on your disk'));

// --- accessibility ---
ok('intro is readable by screen readers', !/id="intro"[^>]*aria-hidden/.test(html));

const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
const unlabelled = buttons.filter(([, attrs, text]) =>
  !/aria-label=/.test(attrs) && !text.replace(/<[^>]*>/g, '').trim());
ok('icon-only buttons are labelled', unlabelled.length === 0, `${unlabelled.length} unlabelled`);

// --- offline integrity ---
// Read the real precache list rather than grepping the file, so a path that
// only appears in a comment cannot satisfy the check.
const swCode = sw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const precache = (swCode.match(/const ASSETS = \[([\s\S]*?)\]/)?.[1] || '')
  .split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);

ok('precache list is populated', precache.length > 5, `${precache.length} entries`);

// A file referenced by the page but missing from the precache list breaks the
// app offline, which is the one thing this app promises.
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)].map(m => m[1]);
const uncached = refs.filter(r => {
  const bare = r.replace(/^\.\//, '');
  // <base href="/"> names the root, which is the app shell — precached as './',
  // not a file of its own.
  if (bare === '/' || bare === '') return false;
  // index.html is served at './' and must not be precached under its own name.
  if (bare === 'index.html') return false;
  // The single-file build is a download, not something the app loads. Caching a
  // second copy of the whole app inside the app would double its footprint for
  // nothing.
  if (bare === 'dicebox.html') return false;
  return !precache.some(p => p.replace(/^\.\//, '') === bare);
});
ok('every local asset is precached', uncached.length === 0, uncached.join(', '));

// The check above only sees files the markup names directly, so it missed the
// room modules entirely: app.js imports them, index.html does not mention them.
// Offline that costs the whole app rather than one feature — a module request
// that misses the cache gets a 504, and a 504 anywhere in the graph means the
// entry module never evaluates. Walk the imports transitively from app.js.
const seen = new Set();
const queue = ['app.js'];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(join(root, file), 'utf8');
  for (const [, spec] of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    queue.push(spec.replace(/^\.\//, ''));
  }
}
const uncachedModules = [...seen].filter(m =>
  !precache.some(p => p.replace(/^\.\//, '') === m));
ok('every imported module is precached', uncachedModules.length === 0,
   uncachedModules.join(', '));

// The edge rewrites /index.html to / with a 307. Precaching the redirecting URL
// makes the install fail, and an installed app whose start_url redirects will
// not launch — that is exactly how the home-screen shortcut broke.
ok('index.html is not precached', !precache.includes('./index.html'));
ok('the app shell is precached', precache.includes('./'));

const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
ok('start_url does not redirect', !/index\.html$/.test(manifest.start_url),
   manifest.start_url);
ok('start_url is inside scope', manifest.start_url.startsWith(manifest.scope));
ok('manifest declares an id', typeof manifest.id === 'string' && manifest.id.length > 0);
ok('manifest is standalone', manifest.display === 'standalone');

// Every icon the manifest promises has to exist, or the install prompt is
// refused outright on Android.
for (const icon of manifest.icons) {
  ok(`icon ${icon.src} exists`, existsSync(join(root, icon.src)));
}
ok('has a maskable icon', manifest.icons.some(i => (i.purpose || '').includes('maskable')));
ok('has a 512px icon', manifest.icons.some(i => i.sizes === '512x512'));

// Standalone launchers and dashboards should see a rounded tile, not the opaque
// square that looked poor in Homarr. The maskable icon is intentionally the
// exception: Android supplies its own crop and requires the full canvas.
function pngPixels(file) {
  const data = readFileSync(file);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  const idat = [];
  for (let p = 8; p < data.length;) {
    const n = data.readUInt32BE(p);
    const type = data.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(data.subarray(p + 8, p + 8 + n));
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  ok(`${file} uses directly readable PNG scanlines`,
     [...Array(height).keys()].every(y => raw[y * stride] === 0));
  const alpha = (x, y) => raw[y * stride + 1 + x * 4 + 3];
  return { width, height, alpha };
}

for (const name of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
  const icon = pngPixels(join(root, 'icons', name));
  ok(`${name} has transparent rounded corners`,
     [[0, 0], [icon.width - 1, 0], [0, icon.height - 1],
      [icon.width - 1, icon.height - 1]].every(([x, y]) => icon.alpha(x, y) === 0));
  ok(`${name} keeps the middle of every edge opaque`,
     [[icon.width >> 1, 0], [icon.width >> 1, icon.height - 1],
      [0, icon.height >> 1], [icon.width - 1, icon.height >> 1]]
       .every(([x, y]) => icon.alpha(x, y) === 255));
}

{
  const icon = pngPixels(join(root, 'icons', 'icon-maskable-512.png'));
  ok('the maskable icon keeps its full safe-zone canvas',
     [[0, 0], [icon.width - 1, 0], [0, icon.height - 1],
      [icon.width - 1, icon.height - 1]].every(([x, y]) => icon.alpha(x, y) === 255));
}

// Replaying a redirected response from cache re-triggers the redirect, which
// browsers reject for navigations.
ok('service worker refuses to cache redirects', /res\.redirected/.test(swCode));
ok('navigations resolve to the shell', /cache\.match\('\.\/'/.test(swCode));

// Clicking a download link is a navigation, so the shell rule would answer it
// with index.html and the downloaded "single file" would be the multi-file app
// with dangling references. The bundle path has to skip that rule.
{
  const shellRule = swCode.indexOf("request.mode === 'navigate'");
  const bundleRule = swCode.indexOf('dicebox.html');
  ok('the bundle path bypasses the service worker',
     bundleRule !== -1 && bundleRule < shellRule,
     bundleRule === -1 ? 'no rule for it' : 'rule comes after the shell rule');
}

// The link has to carry `download`, or the browser renders the file instead of
// saving it — HTML served as HTML is displayed, not downloaded.
ok('the download link forces a save',
   /<a href="dicebox\.html"[^>]*\sdownload/.test(html));

ok('no external resources', !/(?:src|href)="https?:\/\/(?!github)/.test(html));

// A stale service worker pins every other asset to its old version.
ok('sw.js is marked no-cache',
   /\/sw\.js[\s\S]*?Cache-Control:\s*no-cache/.test(readFileSync(join(root, '_headers'), 'utf8')));

// --- CSP ---
// The strict policy forbids inline script and style; both would silently stop
// working in production while looking fine on a local file server.
ok('no inline <script> blocks', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html));
ok('no inline <style> blocks', !/<style[^>]*>[\s\S]*?\S[\s\S]*?<\/style>/.test(html));
ok('no inline event handlers', !/\son\w+\s*=\s*["']/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
