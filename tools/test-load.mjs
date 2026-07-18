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
    id, hidden: false, dataset: {}, style: {}, value: '', textContent: '',
    children: [], className: '', tabIndex: 0, role: '',
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){ return null; },
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
globalThis.crypto = webcrypto;
globalThis.performance = { now: () => 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.setTimeout = (fn) => 0;
globalThis.clearTimeout = () => {};
globalThis.ResizeObserver = class { observe(){} disconnect(){} };
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
globalThis.navigator = { vibrate(){}, serviceWorker: { register: () => Promise.resolve() } };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#FCFCFA' });
globalThis.window = { addEventListener(){}, devicePixelRatio: 2 };
globalThis.document = {
  documentElement: makeEl('html'),
  getElementById: id => store.get(id) || null,
  createElement: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener(){},
};

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
