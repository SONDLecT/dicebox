// Static checks on the markup and stylesheet. These catch wiring mistakes that
// the logic tests cannot see, because they live in the gap between files.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  // index.html is served at './' and must not be precached under its own name.
  if (bare === 'index.html') return false;
  // The single-file build is a download, not something the app loads. Caching a
  // second copy of the whole app inside the app would double its footprint for
  // nothing.
  if (bare === 'dicebox.html') return false;
  return !precache.some(p => p.replace(/^\.\//, '') === bare);
});
ok('every local asset is precached', uncached.length === 0, uncached.join(', '));

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
