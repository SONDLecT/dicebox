import {
  getOrCreateLocalAuthSecret,
  signLocalPayload,
  verifyLocalPayload,
  signedLocalWireBytes,
} from '../owlbear-auth.js';

let pass = 0, fail = 0;
const ok = (name, condition) => {
  if (condition) pass++;
  else { fail++; console.log(`  FAIL  ${name}`); }
};

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
};

{
  const storage = memoryStorage();
  const first = getOrCreateLocalAuthSecret(storage);
  const second = getOrCreateLocalAuthSecret(storage);
  ok('same-origin contexts converge on one persisted authentication secret',
     /^[0-9a-f]{64}$/.test(first) && first === second);

  const payload = {
    v: 1, type: 'roll.result', requestId: 'request-1',
    id: 'roll-1', notation: '1d6', groups: [{ kind: 'dice', sides: 6, count: 1, dice: [{ value: 4 }] }], total: 4,
  };
  ok('signed wire accounting includes the complete authentication field',
     signedLocalWireBytes(payload) === new TextEncoder().encode(JSON.stringify({ ...payload, auth: '0'.repeat(64) })).length);
  const auth = await signLocalPayload(first, payload);
  ok('a valid complete local response verifies', await verifyLocalPayload(first, { ...payload, auth }));
  ok('JSON transport normalization does not invalidate a legitimate signature',
     await verifyLocalPayload(first, JSON.parse(JSON.stringify({ ...payload, optional: undefined,
       auth: await signLocalPayload(first, { ...payload, optional: undefined }) }))));
  ok('mutating any signed response field fails verification',
     !(await verifyLocalPayload(first, { ...payload, total: 5, auth })));
  ok('a signature made with another origin secret fails verification',
     !(await verifyLocalPayload('00'.repeat(32), { ...payload, auth })));
  ok('malformed and missing signatures fail closed',
     !(await verifyLocalPayload(first, { ...payload, auth: 'xyz' }))
     && !(await verifyLocalPayload(first, payload)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
