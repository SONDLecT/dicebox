// Static checks on the markup and stylesheet. These catch wiring mistakes that
// the logic tests cannot see, because they live in the gap between files.
import { readFileSync } from 'node:fs';
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
// A file referenced by the page but missing from the precache list breaks the
// app offline, which is the one thing this app promises.
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)].map(m => m[1]);
const uncached = refs.filter(r => !sw.includes(r.replace(/^\.\//, '')));
ok('every local asset is precached', uncached.length === 0, uncached.join(', '));

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
