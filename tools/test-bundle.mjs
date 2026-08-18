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

// A bundle once shipped without room.js or room-crypto.js in the module list.
// It parsed, so nothing downstream complained, but app.js calls createRoom at
// top level and the ReferenceError aborted its whole scope: no dice buttons, no
// roll handler, no animation loop — a static shell that could not roll a die.
// The execution check below does catch that, but only while the call stays at
// top level, so the bindings are asserted directly too.
//
// deriveRoom, encryptMessage and decryptMessage are the `export async function`
// cases the export-detection regex missed for a while. They are inlined either
// way, so only their arrival in __dicebox distinguishes a working build.
const required = [
  'createRoom', 'parsePassphraseFromHash', 'generatePassphrase',
  'deriveRoom', 'encryptMessage', 'decryptMessage',
];
const absent = required.filter(
  name => !new RegExp(`Object\\.assign\\(__dicebox, \\{[^}]*\\b${name}\\b`).test(script),
);
if (absent.length) {
  console.log('NOT SHARED VIA __dicebox: ' + absent.join(', '));
  process.exit(1);
}

const makeEl = (id='') => ({
  id, hidden:false, dataset:{}, value:'', textContent:'', children:[],
  style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; } },
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

// Via defineProperty rather than assignment: newer Node makes crypto, navigator
// and performance getter-only on globalThis, and a plain assignment throws.
const define = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

define('crypto', webcrypto);
define('performance', { now: () => 0 });
define('requestAnimationFrame', () => 0);
define('setTimeout', () => 0);
define('clearTimeout', () => {});
define('ResizeObserver', class { observe(){} disconnect(){} });
define('localStorage', { getItem:()=>null, setItem(){}, removeItem(){} });
define('matchMedia', () => ({matches:false,addEventListener(){},removeEventListener(){}}));
define('navigator', { vibrate(){}, userAgent:'node', serviceWorker:{register:()=>Promise.resolve()} });
define('getComputedStyle', () => ({ getPropertyValue: () => '#FCFCFA' }));
// The bundle is the single file, so file: is how it actually gets opened. It
// also puts the room note on its stronger branch, which is the one only this
// build can honestly claim.
globalThis.location = { protocol: 'file:', href: 'file:///dicebox.html', search: '', hash: '' };
globalThis.window = { addEventListener(){}, devicePixelRatio:2, matchMedia: globalThis.matchMedia, navigator:{standalone:false} };
globalThis.document = {
  documentElement: makeEl('html'),
  getElementById: id => { const el = store.get(id) || null; if (!el) missing.push(id); return el; },
  createElement: () => makeEl(),
  createTextNode: t => ({nodeType:3,textContent:String(t)}),
  querySelector: selector => selector === 'meta[name="dicebox-owlbear"]' ? null : makeEl(),
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

// --- Every cross-module name app.js uses must be pulled into its scope. ---
//
// The bundle strips import statements and hands each module the names it asks
// for from the __dicebox namespace. A name missing from the pull list parses
// and boots fine, then throws ReferenceError the first time a roll (or a mode
// switch, or a received room roll) touches it — which is how the single-file
// build shipped with rolling broken while every other build worked. This diff
// is static and complete: it can only miss what app.js does not import.
{
  const appSource = readFileSync(join(root, 'app.js'), 'utf8');
  const bundled = readFileSync(join(root, 'dist', 'dicebox.html'), 'utf8');

  const imported = new Set();
  for (const m of appSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/[\w-]+\.js'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (!name) continue;
      // `x as y` binds the alias, which the stripped bundle can never supply —
      // that is not a list problem but an unsupported shape. Refuse it here.
      if (/\sas\s/.test(name)) { console.log('BUNDLE-UNSAFE IMPORT ALIAS in app.js: ' + name); process.exit(1); }
      imported.add(name);
    }
  }

  // The app scope's pull is the last `const { ... } = __dicebox;` in the file.
  const pulls = [...bundled.matchAll(/const \{ ([^}]*)\} = __dicebox;/g)];
  const appPull = new Set(pulls.length ? pulls[pulls.length - 1][1].split(',').map(s => s.trim()) : []);
  const unpulled = [...imported].filter(name => !appPull.has(name));
  if (unpulled.length) {
    console.log('APP IMPORTS MISSING FROM THE BUNDLE PULL: ' + unpulled.join(', '));
    console.log('Add them to the matching *_EXPORTS list in tools/bundle.mjs.');
    process.exit(1);
  }
  console.log(`bundle pull covers all ${imported.size} of app.js's cross-module imports`);
}
