// Deploys the app to Cloudflare Workers static assets.
//
// Wrangler needs Node 22+; this box has 18, so this drives the same upload over
// the REST API. It does what `wrangler deploy` does for an assets-only Worker:
//   1. start an assets upload session, sending a manifest of hashes and sizes
//   2. upload whatever files Cloudflare says it does not already have
//   3. PUT the Worker with the resulting completion token
//   4. attach the custom domain
//
// Credentials come from .env and are never logged.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

// --- config ---

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

const config = JSON.parse(
  readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')       // strip line comments
    .replace(/,(\s*[}\]])/g, '$1')      // and trailing commas
);
// `--dev` publishes to a separate Worker on its own hostname, so a change can
// be looked at before it becomes the thing everyone gets.
//
// A distinct hostname rather than a /dev path on the live one: the service
// worker's cache is keyed by origin, so sharing a host would let a dev build's
// cache be served to the installed production app — testing could then break
// the live copy for anyone who had it on their home screen.
const DEV = process.argv.includes('--dev');

const SCRIPT = DEV ? `${config.name}-dev` : config.name;
// Dev is a single sandbox host; prod attaches every custom domain the config
// lists (the app now answers on both dicebox.cc and the old trollskull host).
const DOMAINS = DEV
  ? [env.DEV_HOSTNAME || `dev.${config.routes?.[0]?.pattern}`]
  : (config.routes || []).filter(r => r.custom_domain).map(r => r.pattern);

// --- collect the files that ship ---

const ignore = readFileSync(join(ROOT, '.assetsignore'), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

const skip = name => ignore.includes(name) || name.startsWith('.');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (skip(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const typeOf = p => TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream';

// The single-file build is served from the site root as /dicebox.html, so the
// help panel can link to it on the same origin. Linking GitHub's raw URL
// instead just renders the file, since it is served as text/plain.
const extras = [{ from: join(ROOT, 'dist', 'dicebox.html'), to: '/dicebox.html' }];

// The relay a deployed copy talks to. Empty means no relay, which leaves the
// app local-only — that is the default and what an unconfigured deploy gets.
//
// Substituted at deploy time rather than committed into index.html so that the
// staging copy can point at the staging relay without the two ever differing in
// the repository. A deploy with no relay configured is a supported outcome, not
// a misconfiguration.
const RELAY = DEV
  ? (env.DEV_RELAY_URL || 'wss://dev.relay.dicebox.trollskull.cc/ws')
  : (env.RELAY_URL || '');

// The service worker's cache name, derived from the contents of everything it
// precaches rather than typed by hand.
//
// A stale cache name is the worst deploy bug this project has, because it has
// no symptom on the server: every asset is correct, every check passes, and
// installed copies keep serving the previous build forever. It cost a round of
// "the fix is not working" after a deploy that changed render.js and left CACHE
// alone — the browser was faithfully serving what it had been told to keep.
//
// Deriving it removes the step. Same assets, same name, no redundant
// invalidation; any asset changes and every installed copy picks it up.
const swCacheName = assets => {
  const hash = createHash('sha256');
  for (const { path, body } of [...assets].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(path).update(body);
  }
  return `dicebox-${hash.digest('hex').slice(0, 12)}`;
};

const withRelay = (full, body) => {
  // index.html only, never the single-file build. The README promises that the
  // downloaded file gives a real "we cannot see your rolls" guarantee because
  // no third party serves or carries anything — shipping it pre-pointed at the
  // demo's relay would make that false, and quietly. Someone who downloads the
  // file and wants rooms can set the meta tag themselves, which is a decision
  // they have made rather than one made for them.
  if (!full.endsWith('index.html')) return body;
  const html = body.toString('utf8').replace(
    /(<meta name="dicebox-relay" content=")[^"]*(">)/,
    `$1${RELAY}$2`);
  return Buffer.from(html, 'utf8');
};

const describeFile = (full, path) => {
  const body = withRelay(full, readFileSync(full));
  // Cloudflare keys assets by a 32-char hash of contents plus extension.
  const ext = full.slice(full.lastIndexOf('.'));
  const hash = createHash('sha256').update(body).update(ext).digest('hex').slice(0, 32);
  return { path, hash, size: body.length, body, contentType: typeOf(full) };
};

const files = [
  ...walk(ROOT).map(full =>
    describeFile(full, '/' + relative(ROOT, full).split(sep).join('/'))),
  ...extras.filter(e => existsSync(e.from)).map(e => describeFile(e.from, e.to)),
];

// Stamp the derived cache name into the service worker.
//
// Hashed over every other file rather than over the precache list, so an asset
// added to ASSETS without being added here cannot slip through. sw.js is
// excluded because its own body is what we are about to change.
const sw = files.find(f => f.path === '/sw.js');
if (!sw) {
  console.error('No /sw.js in the deploy — the offline cache would never update.');
  process.exit(1);
}
const rehash = f => {
  f.size = f.body.length;
  const ext = f.path.slice(f.path.lastIndexOf('.'));
  f.hash = createHash('sha256').update(f.body).update(ext).digest('hex').slice(0, 32);
};

// Computed before either file is patched, so it is a hash of the code being
// shipped rather than of a document that contains the hash of itself.
const stamp = swCacheName(files.filter(f => f.path !== '/sw.js'));
const buildId = stamp.replace('dicebox-', '');

{
  const before = sw.body.toString('utf8');
  const after = before.replace(/const CACHE = '[^']*';/, `const CACHE = '${stamp}';`);
  if (before === after) {
    console.error('Could not find the CACHE constant in sw.js — refusing to ship a cache that cannot be invalidated.');
    process.exit(1);
  }
  sw.body = Buffer.from(after, 'utf8');
  rehash(sw);
}

// The same id, shown in the app. A cached build that claims to be a build it is
// not is the one failure this cannot detect, and it is also the one that cannot
// happen: the id is inside the bytes being cached.
{
  const page = files.find(f => f.path === '/index.html');
  if (!page) {
    console.error('No /index.html in the deploy.');
    process.exit(1);
  }
  const before = page.body.toString('utf8');
  const after = before.replace(
    /(<meta name="dicebox-build" content=")[^"]*(">)/, `$1${buildId}$2`);
  if (before === after) {
    console.error('Could not find the dicebox-build meta tag in index.html.');
    process.exit(1);
  }
  page.body = Buffer.from(after, 'utf8');
  rehash(page);
}

console.log(`Build ${buildId} — service worker cache ${stamp}`);

console.log(`Deploying ${files.length} files as "${SCRIPT}"`);
for (const f of files) console.log(`  ${f.path}  ${f.size}B`);

// --- api helper ---

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

// --- 1. start an upload session ---

const manifest = {};
for (const f of files) manifest[f.path] = { hash: f.hash, size: f.size };

console.log('\nStarting upload session...');
const session = await api(
  `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/assets-upload-session`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  },
);

// --- 2. upload the buckets Cloudflare asks for ---

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
      // Payloads go up base64 encoded, keyed by hash.
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

// --- 3. put the worker ---

console.log('Publishing worker...');

// A script fronts the assets only to set headers; `_headers` is a Pages feature
// and is ignored on Workers.
const entry = config.main;
const script = readFileSync(join(ROOT, entry), 'utf8');

const metadata = {
  compatibility_date: config.compatibility_date,
  main_module: entry,
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
      // Belongs on the binding, not only in assets.config: without it the edge
      // serves matching files directly and the script never runs, so none of
      // its headers reach an asset response.
      ...(config.assets?.run_worker_first ? { run_worker_first: true } : {}),
    },
  ],
};

const body = new FormData();
body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
body.append(entry, new Blob([script], { type: 'application/javascript+module' }), entry);

await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}?include_subdomain_availability=true`, {
  method: 'PUT',
  body,
});
console.log('Worker published.');

// --- 4. attach the custom domains ---
//
// The zone is derived from each hostname rather than a single configured id, so
// domains in different zones (dicebox.cc and the old trollskull host) both
// attach from one deploy. Attaching is idempotent and never detaches, so the
// old host keeps serving until it is removed by hand.

for (const DOMAIN of DOMAINS) {
  const existing = await api(`/accounts/${ACCOUNT}/workers/domains?hostname=${DOMAIN}`);
  const attached = existing.find(d => d.hostname === DOMAIN && d.service === SCRIPT);

  if (attached) {
    console.log(`Custom domain already attached: ${DOMAIN}`);
  } else {
    const zoneName = DOMAIN.split('.').slice(-2).join('.');
    const zones = await api(`/zones?name=${zoneName}`);
    if (!zones.length) {
      console.error(`No zone found for ${zoneName} — skipping ${DOMAIN}`);
      continue;
    }
    console.log(`Attaching ${DOMAIN}...`);
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
}
console.log(`\nLive at https://${DOMAINS[0]}`);
