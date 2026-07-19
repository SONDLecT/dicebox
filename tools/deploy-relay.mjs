// Deploys the room relay to Cloudflare Workers with Durable Objects.
//
// Separate from tools/deploy.mjs because the two have almost nothing in common:
// the app is static assets fronted by a header-setting script, and this is a
// script with no assets at all but a Durable Object namespace and a migration.
// Folding them together would mean a function of flags rather than two short
// scripts.
//
// Wrangler needs Node 22 and this box has 18, so this drives the same upload
// over the REST API. Credentials come from .env and are never logged.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

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
  readFileSync(join(ROOT, 'server/wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1')
);

const DEV = process.argv.includes('--dev');
const SCRIPT = DEV ? `${config.name}-dev` : config.name;
const DOMAIN = DEV
  ? (env.DEV_RELAY_HOSTNAME || `dev.${config.routes?.[0]?.pattern}`)
  : config.routes?.[0]?.pattern;

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    console.error(`${init.method || 'GET'} ${path} failed:`);
    console.error(JSON.stringify(json.errors || json, null, 2));
    process.exit(1);
  }
  return json.result;
}

const entry = config.main;
const script = readFileSync(join(ROOT, 'server', entry), 'utf8');

console.log(`Deploying relay as "${SCRIPT}"`);

const metadata = {
  compatibility_date: config.compatibility_date,
  main_module: entry,
  bindings: [
    ...(config.durable_objects?.bindings || []).map(b => ({
      type: 'durable_object_namespace',
      name: b.name,
      class_name: b.class_name,
    })),
    ...Object.entries(config.vars || {}).map(([name, text]) => ({
      type: 'plain_text', name, text,
    })),
  ],
  // The migration is what tells Cloudflare the class exists and is
  // SQLite-backed. Without it the binding refers to a namespace that was never
  // created and every request to the object fails.
  migrations: config.migrations?.length
    ? { new_tag: config.migrations[config.migrations.length - 1].tag,
        new_sqlite_classes: config.migrations[config.migrations.length - 1].new_sqlite_classes }
    : undefined,
  observability: config.observability,
};

const body = new FormData();
body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
body.append(entry, new Blob([script], { type: 'application/javascript+module' }), entry);

await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`, {
  method: 'PUT',
  body,
});
console.log('Relay published.');

if (DOMAIN) {
  const existing = await api(`/accounts/${ACCOUNT}/workers/domains?hostname=${DOMAIN}`);
  const attached = existing.find(d => d.hostname === DOMAIN && d.service === SCRIPT);
  if (attached) {
    console.log(`Custom domain already attached: ${DOMAIN}`);
  } else {
    console.log(`Attaching ${DOMAIN}...`);
    const zone = DOMAIN.split('.').slice(-2).join('.');
    const zones = await api(`/zones?name=${zone}`);
    if (!zones.length) {
      console.error(`No zone found for ${zone}`);
      process.exit(1);
    }
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
  console.log(`\nRelay live at wss://${DOMAIN}/ws`);
}
