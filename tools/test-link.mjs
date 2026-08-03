// Loads app.js as though the page had been opened from a shared room link.
//
// test-load.mjs evaluates app.js with an empty location.hash, so the whole
// link-handling path at the end of the file was never executed by any test. A
// call to history.replaceState that threw there took the two lines after it
// with it — the panel never opened and the room was never joined — and every
// suite still passed, because nothing had ever run those lines.
//
// The environments that matter here are the awkward ones: a browser that
// forbids replaceState, or one that does not implement it at all. Both are why
// room.js wraps its own call in a try, and this asserts the app survives them.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const PHRASE = 'anchor-tundra-vellum-quartz-bramble';

// Each case gets its own module instance, since app.js runs its link handling
// once at import. The cache is busted with a query string rather than by
// clearing it, which is not something Node exposes.
async function load(historyImpl, hash = '#' + PHRASE) {
  // Elements start hidden if the markup says so. Defaulting every element to
  // visible would make "the panel opened" true before app.js had done anything,
  // which is the one thing these cases need to distinguish.
  const store = new Map(ids.map(id => {
    const el = makeEl(id);
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    el.hidden = !!(tag && /\shidden(\s|>|=)/.test(tag[0]));
    return [id, el];
  }));

  // Via defineProperty rather than assignment: newer Node makes crypto,
  // navigator and performance getter-only on globalThis, and a plain assignment
  // throws there.
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  define('crypto', webcrypto);
  define('performance', { now: () => 0 });
  define('requestAnimationFrame', () => 0);
  define('setTimeout', fn => { void fn; return 0; });
  define('clearTimeout', () => {});
  define('ResizeObserver', class { observe(){} disconnect(){} });
  define('matchMedia', () => ({
    matches: false, addEventListener(){}, removeEventListener(){},
    addListener(){}, removeListener(){},
  }));
  define('localStorage', { getItem: () => null, setItem(){}, removeItem(){} });
  define('getComputedStyle', () => ({ getPropertyValue: () => '#FCFCFA' }));
  define('navigator', {
    vibrate(){}, userAgent: 'node',
    serviceWorker: { register: () => Promise.resolve() },
    clipboard: { writeText: () => Promise.resolve() },
  });
  define('window', {
    addEventListener(){}, devicePixelRatio: 2,
    matchMedia: globalThis.matchMedia,
    navigator: { standalone: false },
  });
  // Never opened: joining is asynchronous and the assertions here are about
  // what happens before any socket work begins.
  globalThis.WebSocket = class { constructor(){ this.readyState = 0; } send(){} close(){} };
  globalThis.location = {
    protocol: 'https:', href: 'https://example.invalid/' + hash,
    origin: 'https://example.invalid', pathname: '/', search: '', hash,
  };
  globalThis.history = historyImpl;
  globalThis.document = {
    documentElement: makeEl('html'),
    getElementById: id => store.get(id) || null,
    createElement: () => makeEl(),
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener(){},
  };

  await import(join(ROOT, 'app.js') + '?case=' + Math.random());
  return store;
}

function makeEl(id = '') {
  return {
    id, hidden: false, dataset: {}, value: '', textContent: '',
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; } },
    children: [], className: '', tabIndex: 0, role: '',
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, removeEventListener(){}, setAttribute(){},
    getAttribute(){ return null; }, removeAttribute(){},
    insertBefore(node){ this.children.push(node); return node; },
    append(){}, prepend(){}, remove(){}, replaceChildren(){},
    focus(){}, blur(){}, select(){}, scrollIntoView(){}, setPointerCapture(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    getBoundingClientRect(){ return { width: 360, height: 240, top: 0, left: 0 }; },
    getContext(){ return new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 360, height: 240 } : () => {}, set: () => true }); },
    get firstElementChild(){ return null; },
    get lastElementChild(){ return null; },
    get parentElement(){ return makeEl(); },
  };
}

// A browser that implements replaceState normally.
{
  let cleared = false;
  const store = await load({ replaceState: () => { cleared = true; } });
  ok('a shared link opens the room panel', store.get('roomPanel').hidden === false);
  ok('the fragment is cleared from the URL', cleared);
}

// A browser that forbids it. This is the case that shipped broken: the throw
// happened before the panel was opened, so the link silently did nothing.
{
  const store = await load({
    replaceState: () => { throw new DOMException('denied', 'SecurityError'); },
  });
  ok('a link still opens the panel when replaceState throws',
     store.get('roomPanel').hidden === false);
}

// A browser without replaceState at all — which is what the headless Chromium
// used for screenshots turned out to be, and how this was finally caught.
{
  const store = await load({});
  ok('a link still opens the panel when replaceState is missing',
     store.get('roomPanel').hidden === false);
}

// No fragment: the panel must stay shut rather than opening on every load.
{
  const store = await load({ replaceState: () => {} }, '');
  ok('no fragment leaves the panel closed', store.get('roomPanel').hidden !== false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
