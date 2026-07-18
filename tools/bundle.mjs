// Builds dicebox.html: the whole app as one file you can download and open.
//
// No server, no install, no build step to run it — double-click and it works,
// including on a laptop with no network. Everything is inlined: the modules are
// concatenated in dependency order, the icons become data URIs, and the service
// worker is dropped entirely since a single local file has nothing to cache.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');

const html = read('index.html');
const css = read('style.css');

// Each module keeps its own scope, with exports hoisted to a shared namespace.
// Plain concatenation would collide — dice.js and app.js both define MAX_SIDES,
// which modules keep apart and a flat script would not — and that breaks the
// bundle at parse time rather than anywhere useful.
function moduleScope(name, exportsFrom = []) {
  const src = read(name)
    .replace(/^\s*import\s+[\s\S]*?from\s+'[^']*';?\s*$/gm, '')
    .replace(/^export\s+/gm, '');

  // Names this module provides to the ones after it.
  const exported = [...read(name).matchAll(
    /^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )].map(m => m[1]);

  const pull = exportsFrom.length
    ? `const { ${exportsFrom.join(', ')} } = __dicebox;\n`
    : '';
  const push = exported.length
    ? `\nObject.assign(__dicebox, { ${exported.join(', ')} });`
    : '';

  return `// ${name}\n(() => {\n${pull}${src}${push}\n})();`;
}

const DICE_EXPORTS = ['roll', 'describe'];
const RENDER_EXPORTS = ['Die', 'Surface', 'separate', 'beginFrame', 'solidFor'];

const script = [
  'const __dicebox = {};',
  moduleScope('dice.js'),
  moduleScope('render.js'),
  moduleScope('app.js', [...DICE_EXPORTS, ...RENDER_EXPORTS]),
].join('\n\n');

const dataUri = name =>
  `data:image/png;base64,${readFileSync(join(root, name)).toString('base64')}`;

const manifest = JSON.parse(read('manifest.webmanifest'));
manifest.icons = manifest.icons.map(icon => ({ ...icon, src: dataUri(icon.src) }));
manifest.start_url = '.';

let out = html
  // The bundle is one file, so nothing is fetched: no manifest link, no icons to
  // resolve, and no service worker to register.
  .replace(/<link rel="manifest"[^>]*>/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>/,
    `<link rel="apple-touch-icon" href="${dataUri('icons/icon-180.png')}">`)
  .replace(/<link rel="icon"[^>]*>/,
    `<link rel="icon" href="${dataUri('icons/icon-192.png')}">`)
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<script type="module"[^>]*><\/script>/,
    `<script type="module">\n${script}\n</script>`);

// A single downloaded file cannot register a service worker from file://, and
// does not need one — it is already local.
out = out.replace(
  /if \('serviceWorker' in navigator\) \{[\s\S]*?\n\}/,
  '// Service worker omitted: this build is a single local file.',
);

// This build is the download, so it cannot offer one — a relative link would
// point at a file that is not there once the page has been saved somewhere else.
out = out.replace(
  /\s*<span class="colophon-sep">·<\/span>\s*<!--[\s\S]*?-->\s*<a href="dicebox\.html"[^>]*>[^<]*<\/a>/,
  '',
);

// The install button belongs to the hosted copy; a downloaded file is already
// as installed as it gets.
out = out.replace(
  /Add this to your home screen and it works offline, with no\s*\n\s*connection needed\./,
  'This is the single-file build: it already works offline, and can be copied anywhere.',
);

writeFileSync(join(root, 'dist', 'dicebox.html'), out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`dist/dicebox.html  ${kb}KB`);
