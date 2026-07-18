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

import { readFileSync, readdirSync, statSync } from 'node:fs';
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
const SCRIPT = config.name;
const DOMAIN = config.routes?.[0]?.pattern;

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

const files = walk(ROOT).map(full => {
  const body = readFileSync(full);
  // Cloudflare keys assets by a 32-char hash of contents plus extension.
  const ext = full.slice(full.lastIndexOf('.'));
  const hash = createHash('sha256').update(body).update(ext).digest('hex').slice(0, 32);
  return {
    path: '/' + relative(ROOT, full).split(sep).join('/'),
    hash,
    size: body.length,
    body,
    contentType: typeOf(full),
  };
});

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

// --- 4. attach the custom domain ---

if (DOMAIN) {
  const existing = await api(`/accounts/${ACCOUNT}/workers/domains?hostname=${DOMAIN}`);
  const attached = existing.find(d => d.hostname === DOMAIN && d.service === SCRIPT);

  if (attached) {
    console.log(`Custom domain already attached: ${DOMAIN}`);
  } else {
    console.log(`Attaching ${DOMAIN}...`);
    await api(`/accounts/${ACCOUNT}/workers/domains`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: 'production',
        hostname: DOMAIN,
        service: SCRIPT,
        zone_id: env.CLOUDFLARE_ZONE_ID,
      }),
    });
    console.log('Custom domain attached.');
  }
  console.log(`\nLive at https://${DOMAIN}`);
}
