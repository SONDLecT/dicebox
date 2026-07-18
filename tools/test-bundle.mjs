// Execute the bundled script against the same DOM shim the load test uses, so a
// bundle that parses but dies on load cannot ship.
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist', 'dicebox.html');
if (!existsSync(bundle)) {
  console.log('dist/dicebox.html missing — run: npm run bundle');
  process.exit(1);
}
const html = readFileSync(bundle, 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

const makeEl = (id='') => ({
  id, hidden:false, dataset:{}, style:{}, value:'', textContent:'', children:[],
  className:'', tabIndex:0, role:'', disabled:false,
  classList:{add(){},remove(){},toggle(){}},
  addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){return null;},
  removeAttribute(){}, append(){}, prepend(){}, remove(){}, replaceChildren(){},
  insertBefore(n){this.children.push(n);return n;},
  focus(){}, blur(){}, select(){}, scrollIntoView(){}, setPointerCapture(){},
  querySelectorAll(){return[];}, querySelector(){return null;},
  getBoundingClientRect(){return{width:360,height:240,top:0,left:0};},
  getContext(){return new Proxy({},{get:(t,k)=>k==='canvas'?{width:360,height:240}:()=>{},set:()=>true});},
  get firstElementChild(){return null;}, get lastElementChild(){return null;},
  get parentElement(){return makeEl();},
});
const store = new Map(ids.map(id => [id, makeEl(id)]));
const missing = [];

globalThis.crypto = webcrypto;
globalThis.performance = { now: () => 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.ResizeObserver = class { observe(){} disconnect(){} };
globalThis.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
globalThis.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.navigator = { vibrate(){}, userAgent:'node', serviceWorker:{register:()=>Promise.resolve()} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#FCFCFA' });
globalThis.window = { addEventListener(){}, devicePixelRatio:2, matchMedia: globalThis.matchMedia, navigator:{standalone:false} };
globalThis.document = {
  documentElement: makeEl('html'),
  getElementById: id => { const el = store.get(id) || null; if (!el) missing.push(id); return el; },
  createElement: () => makeEl(),
  createTextNode: t => ({nodeType:3,textContent:String(t)}),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener(){},
};

try {
  new Function(script)();
  if (missing.length) { console.log('MISSING ELEMENTS: ' + [...new Set(missing)].join(', ')); process.exit(1); }
  console.log('single-file bundle executes cleanly');
} catch (err) {
  console.log('BUNDLE FAILED: ' + err.constructor.name + ': ' + err.message);
  console.log((err.stack||'').split('\n').slice(1,3).join('\n'));
  process.exit(1);
}
