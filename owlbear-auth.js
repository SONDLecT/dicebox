export const LOCAL_AUTH_KEY = 'dicebox:obr:local-auth:v1';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalJson(value) {
  return stableJson(JSON.parse(JSON.stringify(value)));
}

function secretBytes(secret) {
  if (!/^[0-9a-f]{64}$/.test(secret || '')) return null;
  return Uint8Array.from(secret.match(/../g), byte => Number.parseInt(byte, 16));
}

export function getOrCreateLocalAuthSecret(storage) {
  try {
    const existing = storage?.getItem?.(LOCAL_AUTH_KEY);
    if (secretBytes(existing)) return existing;
  } catch { /* Storage denial is handled by an ephemeral, fail-closed key. */ }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const generated = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    storage?.setItem?.(LOCAL_AUTH_KEY, generated);
    const persisted = storage?.getItem?.(LOCAL_AUTH_KEY);
    if (secretBytes(persisted)) return persisted;
  } catch { /* Separate contexts will not share this key, so verification fails closed. */ }
  return generated;
}

export function signedLocalWireBytes(payload) {
  try {
    return new TextEncoder().encode(JSON.stringify({ ...payload, auth: '0'.repeat(64) })).length;
  } catch {
    return Infinity;
  }
}

async function importHmacKey(secret, usage) {
  const bytes = secretBytes(secret);
  if (!bytes) return null;
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signLocalPayload(secret, payload) {
  const key = await importHmacKey(secret, 'sign');
  if (!key) throw new Error('Dicebox local authentication key is unavailable');
  const signature = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(canonicalJson(payload)));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyLocalPayload(secret, signedPayload) {
  if (!signedPayload || typeof signedPayload !== 'object' || !/^[0-9a-f]{64}$/.test(signedPayload.auth || '')) return false;
  const key = await importHmacKey(secret, 'verify');
  if (!key) return false;
  const { auth, ...payload } = signedPayload;
  const signature = Uint8Array.from(auth.match(/../g), byte => Number.parseInt(byte, 16));
  try {
    return await crypto.subtle.verify(
      'HMAC', key, signature, new TextEncoder().encode(canonicalJson(payload)));
  } catch {
    return false;
  }
}
