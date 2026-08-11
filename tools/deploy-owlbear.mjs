// Deploys the Owlbear panel to Cloudflare Workers static assets.
//
// A third deploy script rather than a flag on tools/deploy.mjs, for the reason
// deploy-relay.mjs gives: these have almost nothing in common beyond the API
// calls. This one ships a build directory that does not exist until
// build-owlbear.mjs makes it, with its own worker and its own headers, to an
// origin that must not be the app's.
//
// Wrangler would do this, and is unusable on this box, so it drives the same
// REST endpoints deploy.mjs does. Credentials come from .env, never logged.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
const DIST = join(ROOT, 'owlbear', 'dist');

const env = {};
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const TOKEN = env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) {
  console.error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in .env');
  process.exit(1);
}

if (!existsSync(join(DIST, 'wrangler.jsonc'))) {
  console.error('owlbear/dist is not built. Run:\n' +
    '  npm run build:owlbear -- --relay=wss://... --host=vtt.example.com');
  process.exit(1);
}

const config = JSON.parse(
  readFileSync(join(DIST, 'wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1'));

const SCRIPT = config.name;
const DOMAIN = config.routes?.[0]?.pattern;
if (!DOMAIN) {
  console.error('No hostname in the build. Rebuild with --host=vtt.example.com');
  process.exit(1);
}

// The one check worth failing a deploy over. The panel permits being framed by
// Owlbear; the app permits nothing. Publishing the panel onto the app's own
// hostname would put a framable copy of Dicebox on the origin whose whole
// promise is that it cannot be framed, and would hand it to the app's service
// worker besides. Both are silent — everything would appear to work.
const appHost = JSON.parse(
  readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
).routes?.[0]?.pattern;

if (DOMAIN === appHost || DOMAIN === `dev.${appHost}`) {
  console.error(`Refusing to deploy the panel to ${DOMAIN}: that is the app's own origin.`);
  console.error('The panel must be its own subdomain. See owlbear/README.md.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const typeOf = p => TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// worker.js is the script, not an asset, and wrangler.jsonc and _headers are
// build metadata. Shipping any of them as assets would publish them under the
// panel's origin for no reason.
const NOT_ASSETS = new Set(['/worker.js', '/wrangler.jsonc', '/_headers']);

const files = walk(DIST)
  .map(full => {
    const path = '/' + relative(DIST, full).split(sep).join('/');
    const body = readFileSync(full);
    const ext = full.slice(full.lastIndexOf('.'));
    return {
      path, body,
      size: body.length,
      hash: createHash('sha256').update(body).update(ext).digest('hex').slice(0, 32),
      contentType: typeOf(full),
    };
  })
  .filter(f => !NOT_ASSETS.has(f.path));

console.log(`Deploying ${files.length} files as "${SCRIPT}"`);
for (const f of files) console.log(`  ${f.path}  ${f.size}B`);

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { success: false, raw: text }; }
  if (!json.success) {
    console.error(`\nRequest failed: ${opts.method || 'GET'} ${path}`);
    console.error(JSON.stringify(json.errors || json.raw, null, 2));
    process.exit(1);
  }
  return json.result;
}

// --- 1. upload session ---

const manifest = {};
for (const f of files) manifest[f.path] = { hash: f.hash, size: f.size };

console.log('\nStarting upload session...');
const session = await api(
  `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/assets-upload-session`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  });

// --- 2. upload ---

let completionToken = session.jwt;
const buckets = session.buckets || [];

if (buckets.length) {
  const byHash = new Map(files.map(f => [f.hash, f]));
  let n = 0;
  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const f = byHash.get(hash);
      if (!f) continue;
      form.append(hash, new Blob([f.body.toString('base64')], { type: f.contentType }), hash);
      n++;
    }
    const res = await fetch(`${API}/accounts/${ACCOUNT}/workers/assets/upload?base64=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.jwt}` },
      body: form,
    });
    const json = await res.json();
    if (!json.success) {
      console.error('Asset upload failed:', JSON.stringify(json.errors, null, 2));
      process.exit(1);
    }
    if (json.result?.jwt) completionToken = json.result.jwt;
  }
  console.log(`Uploaded ${n} files.`);
} else {
  console.log('All files already present.');
}

// --- 3. the worker ---

console.log('Publishing worker...');
const script = readFileSync(join(DIST, 'worker.js'), 'utf8');

const metadata = {
  compatibility_date: config.compatibility_date,
  main_module: 'worker.js',
  assets: {
    jwt: completionToken,
    config: {
      html_handling: config.assets?.html_handling,
      not_found_handling: config.assets?.not_found_handling,
      run_worker_first: config.assets?.run_worker_first,
    },
  },
  bindings: [
    {
      type: 'assets',
      name: config.assets?.binding || 'ASSETS',
      // On the binding as well as in assets.config. Without it the edge serves
      // assets directly, the script never runs, and the panel ships with no
      // Content-Security-Policy at all while appearing to work perfectly.
      ...(config.assets?.run_worker_first ? { run_worker_first: true } : {}),
    },
  ],
};

const body = new FormData();
body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
body.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');

await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}?include_subdomain_availability=true`, {
  method: 'PUT',
  body,
});
console.log('Worker published.');

// --- 4. custom domain ---

const existing = await api(`/accounts/${ACCOUNT}/workers/domains?hostname=${DOMAIN}`);
if (existing.find(d => d.hostname === DOMAIN && d.service === SCRIPT)) {
  console.log(`Custom domain already attached: ${DOMAIN}`);
} else {
  console.log(`Attaching ${DOMAIN}...`);
  const zoneName = DOMAIN.split('.').slice(-2).join('.');
  const zones = await api(`/zones?name=${zoneName}`);
  if (!zones.length) { console.error(`No zone found for ${zoneName}`); process.exit(1); }
  await api(`/accounts/${ACCOUNT}/workers/domains`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      environment: 'production',
      hostname: DOMAIN,
      service: SCRIPT,
      zone_id: zones[0].id,
    }),
  });
  console.log('Custom domain attached.');
}

console.log(`\nPanel live at https://${DOMAIN}`);
console.log(`Install in Owlbear with: https://${DOMAIN}/manifest.json`);
