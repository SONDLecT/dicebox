// Loads app.js against the real markup in a minimal DOM shim. This catches the
// class of bug that only appears at page load: a missing element, a temporal
// dead zone from declaration ordering, or a null dereference during init.
// Minimal DOM shim: enough to evaluate app.js top-to-bottom and catch TDZ,
// missing elements, and null dereferences that only appear at load.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

const makeEl = (id = '') => {
  const el = {
    // style carries the custom-property methods as well as plain keys: the
    // history panel sets its reading size through setProperty, and a bare
    // object silently is not a CSSStyleDeclaration.
    id, hidden: false, dataset: {}, value: '', textContent: '',
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; } },
    children: [], className: '', tabIndex: 0, role: '',
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){ return null; },
    insertBefore(node){ this.children.push(node); return node; },
    removeAttribute(){}, append(){}, prepend(){}, remove(){}, replaceChildren(){},
    focus(){}, blur(){}, select(){}, scrollIntoView(){}, setPointerCapture(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    getBoundingClientRect(){ return { width: 360, height: 240, top: 0, left: 0 }; },
    getContext(){ return new Proxy({}, { get: (t,k) => k === 'canvas' ? {width:360,height:240} : () => {}, set: () => true }); },
    get firstElementChild(){ return null; },
    get lastElementChild(){ return null; },
    get parentElement(){ return makeEl(); },
  };
  return el;
};

const store = new Map(ids.map(id => [id, makeEl(id)]));
// Newer Node defines several of these — crypto, navigator, performance — as
// getter-only accessors on globalThis, so a plain assignment throws. That took
// the whole suite with it, including the five files npm test runs after this
// one, which is a lot of coverage to lose to a stub that never installed.
//
// defineProperty works whether the name is an accessor, an existing value, or
// absent, so every global goes through it rather than only the ones that have
// bitten so far.
const define = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

define('crypto', webcrypto);
define('performance', { now: () => 0 });
define('requestAnimationFrame', () => 0);
define('setTimeout', (fn) => 0);
define('clearTimeout', () => {});
define('ResizeObserver', class { observe(){} disconnect(){} });
define('localStorage', { getItem: () => null, setItem(){}, removeItem(){} });
define('navigator', { vibrate(){}, serviceWorker: { register: () => Promise.resolve() } });
define('getComputedStyle', () => ({ getPropertyValue: () => '#FCFCFA' }));
define('matchMedia', () => ({ matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }));
define('window', {
  addEventListener(){}, devicePixelRatio: 2,
  matchMedia: globalThis.matchMedia,
  navigator: { standalone: false },
});
define('navigator', { ...globalThis.navigator, userAgent: 'node' });
// The room note branches on this to decide which privacy guarantee it can
// honestly claim, so a served origin is the case to load under: it is what the
// demo and every self-hosted build are, and it is the default wording.
globalThis.location = { protocol: 'https:', href: 'https://example.invalid/', search: '', hash: '' };
globalThis.document = {
  documentElement: makeEl('html'),
  getElementById: id => store.get(id) || null,
  createElement: () => makeEl(),
  createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
  querySelector: selector => selector === 'meta[name="dicebox-owlbear"]' ? null : makeEl(),
  querySelectorAll: () => [],
  addEventListener(){},
};

// The source page is the standalone site, not the panel build. If this shim
// invents the build-only flag, app.js takes an impossible SDK path and the load
// test emits a false initialization error instead of exercising the real page.
if (!html.includes('meta name="dicebox-owlbear"') &&
    document.querySelector('meta[name="dicebox-owlbear"]') !== null) {
  console.log('DOM SHIM FAILED: standalone markup invented the Owlbear panel flag');
  process.exit(1);
}

const missing = [];
const origGet = document.getElementById;
document.getElementById = id => {
  const el = origGet(id);
  if (!el) missing.push(id);
  return el;
};

try {
  await import(join(ROOT, 'app.js'));
  if (missing.length) {
    console.log('MISSING ELEMENTS: ' + [...new Set(missing)].join(', '));
    process.exit(1);
  }
  console.log('app.js evaluates cleanly against the real markup');
} catch (err) {
  console.log('LOAD FAILED: ' + err.constructor.name + ': ' + err.message);
  if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}

// Again, with storage that throws on the way in.
//
// Safari in private browsing and any browser that partitions storage for an
// embedded copy make this raise rather than return null — and the theme is read
// at module top level, so a throw there aborts the module and leaves a blank
// page with no error anyone can see. The harshest real case is the property
// access itself throwing, not just the method, so that is what is stubbed.
//
// A query string is what makes the second import re-execute; without it the
// module registry returns the copy loaded above and this tests nothing.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
});

missing.length = 0;
try {
  await import(join(ROOT, 'app.js') + '?storage=denied');
  console.log('app.js survives storage being denied');
} catch (err) {
  console.log('LOAD FAILED WITH STORAGE DENIED: ' + err.constructor.name + ': ' + err.message);
  if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
