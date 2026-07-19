// Tests for room encryption.
//
// This is the code where being wrong is invisible: a room with a broken nonce
// scheme or missing replay check works perfectly in every manual test and fails
// only against someone deliberately attacking it. So the tests here assert the
// properties, not just that a round trip succeeds.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) {
  globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
}

import {
  generatePassphrase, normalizePassphrase, deriveRoom, newSender,
  encryptMessage, decryptMessage, PHRASE_BITS, PHRASE_WORDS, PROTOCOL_VERSION,
} from '../room-crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const rejects = async (name, fn, extra = '') => {
  try { await fn(); ok(name, false, extra || 'expected a rejection'); }
  catch { ok(name, true); }
};

// --- passphrases ---

{
  const p = generatePassphrase();
  ok('passphrase has the right number of words', p.split('-').length === PHRASE_WORDS, p);
  ok('passphrase is lowercase and hyphenated', /^[a-z]+(-[a-z]+)+$/.test(p), p);

  // 51.7 bits from five EFF words. That is not enough on its own — it is the
  // slow KDF that makes it work, costing an attacker ~29 years on a GPU rig
  // and ~7 months on a serious cluster, against rooms that expire in hours.
  //
  // The floor is set at 50 so that shrinking the wordlist, or dropping to four
  // words, fails here rather than silently weakening every room.
  ok('passphrase carries at least 50 bits', PHRASE_BITS >= 50,
     `${PHRASE_BITS.toFixed(1)} bits`);

  // Uniqueness: a generator that repeats itself would hand two groups the same
  // room without either knowing.
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(generatePassphrase());
  ok('passphrases do not repeat', seen.size === 2000, `${2000 - seen.size} collisions`);
}

{
  // The wordlist itself must not contain duplicates: a repeated word silently
  // reduces entropy below what PHRASE_BITS claims.
  const p = generatePassphrase();
  const words = new Set();
  for (let i = 0; i < 4000; i++) for (const w of generatePassphrase().split('-')) words.add(w);
  const listed = Math.round(Math.pow(2, PHRASE_BITS / PHRASE_WORDS));
  ok('wordlist size matches the entropy claim', words.size === listed,
     `saw ${words.size} distinct words, entropy implies ${listed}`);
  void p;
}

// Typing tolerance. Someone reading a passphrase aloud will produce spaces, and
// someone pasting it will produce hyphens; both must reach the same room.
{
  const variants = [
    'anchor-tundra-vellum-quartz-bramble',
    'Anchor Tundra Vellum Quartz Bramble',
    '  anchor  tundra  vellum  quartz  bramble  ',
    'ANCHOR-TUNDRA-VELLUM-QUARTZ-BRAMBLE',
    'anchor_tundra_vellum_quartz_bramble',
  ];
  const norm = variants.map(normalizePassphrase);
  ok('spacing, case and separators all normalize alike',
     norm.every(n => n === norm[0]), norm.join(' | '));
}

// --- key derivation ---

const PHRASE = 'anchor-tundra-vellum-quartz-bramble';
const OTHER  = 'granite-osprey-saffron-thicket-zephyr';

const room = await deriveRoom(PHRASE);
const roomB = await deriveRoom(PHRASE);
const roomOther = await deriveRoom(OTHER);

ok('same passphrase derives the same room id', room.roomId === roomB.roomId);
ok('different passphrases derive different room ids', room.roomId !== roomOther.roomId);
ok('room id is 128 bits of hex', /^[0-9a-f]{32}$/.test(room.roomId), room.roomId);

// Typed variants must land in the same room, or someone reading a passphrase
// over voice chat ends up alone in a room of their own.
ok('normalized variants reach the same room',
   (await deriveRoom('Anchor Tundra Vellum Quartz Bramble')).roomId === room.roomId);

// The key must not be extractable: if it were, a bug or an extension could read
// it out of a live session.
ok('message key is non-extractable', room.key.extractable === false);

await rejects('empty passphrase is rejected', () => deriveRoom(''));
await rejects('whitespace-only passphrase is rejected', () => deriveRoom('   '));
await rejects('overlong passphrase is rejected', () => deriveRoom('x'.repeat(500)));

// --- round trip ---

{
  const sender = newSender();
  const seen = new Map();
  const payload = { name: 'Amber Wolf', notation: '2d20kh1', dice: [3, 18], total: 18 };

  const wire = await encryptMessage(room, sender, payload);
  const got = await decryptMessage(room, seen, wire);

  ok('round trip preserves the roll', got.notation === '2d20kh1' && got.total === 18
     && got.dice.length === 2 && got.dice[0] === 3);
  ok('round trip preserves the name', got.name === 'Amber Wolf');
  ok('message carries the protocol version', got.v === PROTOCOL_VERSION);
  ok('message carries the sender', got.from === sender.id);
}

// --- the properties that matter ---

// A relay holding the ciphertext must not be able to read it. The strongest
// available check: the plaintext must not appear in the wire format.
{
  const sender = newSender();
  const wire = await encryptMessage(room, sender, {
    name: 'Amber Wolf', notation: '2d20kh1', dice: [3, 18], total: 18,
  });
  const decoded = Buffer.from(wire, 'base64').toString('binary');
  ok('ciphertext does not leak the name', !decoded.includes('Amber'));
  ok('ciphertext does not leak the notation', !decoded.includes('2d20'));
  ok('ciphertext does not leak the total', !decoded.includes('"total"'));

  // Beyond specific strings: the body should look like random bytes. A stray
  // run of printable ASCII would suggest something was not encrypted at all.
  // Checked as a proportion rather than an absence, since random bytes contain
  // printable characters by chance — about 95 of every 256.
  const body = Buffer.from(wire, 'base64').subarray(12);
  const printable = [...body].filter(b => b >= 0x20 && b < 0x7f).length;
  const ratio = printable / body.length;
  ok('ciphertext body looks random, not textual', ratio < 0.55,
     `${(ratio * 100).toFixed(0)}% printable`);
}

// Message length must not track the content. Without padding a relay that
// cannot read a single roll could still distinguish 1d20 from 20d6, and tell
// players apart by the length of their names.
{
  const sender = newSender();
  const sizes = new Set();
  for (const payload of [
    { name: 'A', notation: '1d4', dice: [2], total: 2 },
    { name: 'Amber Wolf', notation: '2d20kh1', dice: [3, 18], total: 18 },
    { name: 'A Considerably Longer Display Name', notation: '20d6',
      dice: [1,2,3,4,5,6,1,2,3,4,5,6,1,2,3,4,5,6,1,2], total: 70 },
  ]) {
    sizes.add((await encryptMessage(room, sender, payload)).length);
  }
  ok('ciphertext length does not vary with content', sizes.size === 1,
     `saw ${sizes.size} distinct lengths: ${[...sizes].join(', ')}`);
}

// Nonces must never repeat under one key. This is the AES-GCM failure that is
// catastrophic rather than gradual — a repeat leaks the authentication key.
{
  const sender = newSender();
  const nonces = new Set();
  for (let i = 0; i < 3000; i++) {
    const wire = await encryptMessage(room, sender, { n: i });
    nonces.add(Buffer.from(wire, 'base64').subarray(0, 12).toString('hex'));
  }
  ok('one sender never repeats a nonce', nonces.size === 3000,
     `${3000 - nonces.size} repeats`);
}

{
  // Several senders share the key, which is exactly when random nonces would
  // start colliding by birthday bound. The senderId prefix must keep them apart.
  const senders = Array.from({ length: 50 }, () => newSender());
  const nonces = new Set();
  for (const s of senders) {
    for (let i = 0; i < 40; i++) {
      const wire = await encryptMessage(room, s, { i });
      nonces.add(Buffer.from(wire, 'base64').subarray(0, 12).toString('hex'));
    }
  }
  ok('many senders never collide on a nonce', nonces.size === 50 * 40,
     `${50 * 40 - nonces.size} collisions`);
}

// Replay: the whole point is that a captured message cannot be sent again.
{
  const sender = newSender();
  const seen = new Map();
  const wire = await encryptMessage(room, sender, { total: 20 });

  await decryptMessage(room, seen, wire);
  await rejects('a replayed message is rejected', () => decryptMessage(room, seen, wire));

  // And a later message still works, so the replay check is not simply refusing
  // everything after the first.
  const next = await encryptMessage(room, sender, { total: 7 });
  const got = await decryptMessage(room, seen, next);
  ok('a fresh message after a replay still works', got.total === 7);
}

// Cross-room: a message must not be replayable into a different room, even by
// someone who knows both passphrases. roomId is in the AEAD's additional data,
// so the tag covers it.
{
  const sender = newSender();
  const wire = await encryptMessage(room, sender, { total: 20 });
  await rejects('a message cannot be replayed into another room',
    () => decryptMessage(roomOther, new Map(), wire));
}

// Wrong passphrase: must fail closed, not produce garbage.
{
  const sender = newSender();
  const wire = await encryptMessage(room, sender, { total: 20 });
  await rejects('the wrong passphrase cannot decrypt',
    () => decryptMessage(roomOther, new Map(), wire));
}

// Tampering: every byte is covered by the tag.
{
  const sender = newSender();
  const wire = await encryptMessage(room, sender, { total: 3 });
  const bytes = Buffer.from(wire, 'base64');

  // Flip a bit in the ciphertext body.
  const body = Buffer.from(bytes); body[20] ^= 1;
  await rejects('tampered ciphertext is rejected',
    () => decryptMessage(room, new Map(), body.toString('base64')));

  // And in the nonce, which is not encrypted but is bound by the tag.
  const iv = Buffer.from(bytes); iv[2] ^= 1;
  await rejects('a tampered nonce is rejected',
    () => decryptMessage(room, new Map(), iv.toString('base64')));
}

// Truncation must not be mistaken for a short message.
{
  const sender = newSender();
  const wire = await encryptMessage(room, sender, { total: 3 });
  const short = Buffer.from(wire, 'base64').subarray(0, 8).toString('base64');
  await rejects('a truncated message is rejected',
    () => decryptMessage(room, new Map(), short));
}

// Garbage in must not crash the client. A relay can send anything, and a room
// member that throws an unhandled error on a malformed frame is a way to knock
// everyone else's app over.
{
  for (const junk of ['', 'x', '!!!!', 'AAAA', btoa('not a message at all')]) {
    await rejects(`junk input is rejected cleanly (${JSON.stringify(junk)})`,
      () => decryptMessage(room, new Map(), junk));
  }
}

// Attribution spoofing by a room member. Everyone in a room holds the key, so
// the tag proves nothing about which member wrote a message; only the nonce
// prefix does. Without the check, a forged { from: victim, seq: huge } poisons
// every receiver's seen map and the victim's real messages are dropped from
// then on.
{
  const attacker = newSender();
  const victim = newSender();
  const seen = new Map();

  const forged = await encryptMessage(room, attacker, {
    t: 'roll', from: victim.id, seq: 2 ** 40,
  });
  await rejects('a message claiming another sender id is rejected',
    () => decryptMessage(room, seen, forged));

  ok('a rejected forgery leaves the victim out of the replay map',
    !seen.has(victim.id));

  const genuine = await encryptMessage(room, victim, { t: 'roll', total: 7 });
  const got = await decryptMessage(room, seen, genuine);
  ok('the victim can still send after a forgery attempt', got.total === 7);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
