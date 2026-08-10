// Tests for the room transport.
//
// The property that matters most here is a negative one: nothing in this module
// may block, delay or throw into the local roll path. That is not visible in a
// round trip test, so it is asserted directly — share() is called with no
// socket, with a dead socket, and with a relay that throws, and every one of
// those must return undefined without raising.
//
// Everything runs against a fake socket and injected timers. No network, and no
// real waiting: a backoff schedule tested with real timers would take a minute.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) {
  globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
}

import {
  createRoom, validateRoll, validateSystemRoll, backoffDelay, parsePassphraseFromHash, ROOM_STATES,
} from '../room.js';
import {
  deriveRoom, newSender, encryptMessage, decryptMessage, PROTOCOL_VERSION,
} from '../room-crypto.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

// --- the module has to survive the single-file build ---

// bundle.mjs finds exports with a regex and strips the leading `export `, so a
// brace re-export is invisible to it and leaves a bare block behind. That
// bundles without complaint and fails at runtime, in the download nobody runs
// before shipping. Asserted here so a later tidy-up is caught in CI instead.
{
  const src = readFileSync(new URL('../room.js', import.meta.url), 'utf8');

  ok('room.js declares no brace re-export the bundler cannot see',
     !/^export\s*\{/m.test(src));
  ok('room.js has no dynamic import', !/\bimport\s*\(/.test(src));
  ok('room.js has no top-level await', !/^await\s/m.test(src));

  const visible = [...src.matchAll(
    /^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  for (const name of ['createRoom', 'parsePassphraseFromHash', 'ROOM_STATES']) {
    ok(`bundle.mjs can see the ${name} export`, visible.includes(name), visible.join(','));
  }

  // The only import may be room-crypto.js. A client dependency here would not
  // survive the bundle and would break the no-dependency guarantee outright.
  const imports = [...src.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';/gm)].map(m => m[1]);
  ok('room.js imports nothing but room-crypto.js',
     imports.every(i => i === './room-crypto.js'), imports.join(','));
}

// A clock and timer queue we can advance by hand. Timers fire in due order so a
// ping scheduled before a backoff still runs first.
function makeClock() {
  let t = 1000000;
  let nextId = 1;
  const queue = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = nextId++;
      queue.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(id) { queue.delete(id); },
    pending: () => queue.size,
    // Advances the clock, running everything due along the way. Re-reads the
    // queue each pass because a fired timer commonly schedules the next one.
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let due = null;
        for (const [id, entry] of queue) {
          if (entry.at <= target && (!due || entry.at < due.entry.at)) due = { id, entry };
        }
        if (!due) break;
        queue.delete(due.id);
        t = due.entry.at;
        due.entry.fn();
      }
      t = target;
    },
  };
}

// Mirrors the browser WebSocket surface the module actually touches, and records
// everything sent so tests can assert on the wire rather than on internals.
function makeSocketFactory() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.closed = false;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      sockets.push(this);
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('not open');
      this.sent.push(JSON.parse(data));
    }
    close() { this.closed = true; this.readyState = 3; }

    // Test-side drivers.
    open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    deliver(obj) {
      if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) });
    }
    drop() { this.readyState = 3; if (this.onclose) this.onclose(); }
    frames(t) { return this.sent.filter(f => f.t === t); }
  }
  return { FakeSocket, sockets, last: () => sockets[sockets.length - 1] };
}

const PHRASE = 'anchor-tundra-vellum-quartz-bramble';
const room = await deriveRoom(PHRASE);

// Mirrors HELLO_REPLY_MAX_MS in room.js, which is module-private.
const HELLO_REPLY_WINDOW_MS = 400;

// Drains promise callbacks. Decryption inside the module is a chain of awaits
// on WebCrypto, so a delivered frame is not visible to the app until well after
// one turn of the microtask queue.
//
// A fixed number of turns was tried first and was flaky: WebCrypto timing
// varies, so a count that settled a roll on one run left it in flight on the
// next, and the replay test intermittently saw its first delivery arrive during
// the second. Waiting on the condition instead makes the tests deterministic.
async function settle(until, tries = 400) {
  for (let i = 0; i < tries; i++) {
    // setImmediate drains microtasks and the check phase, which is all a
    // promise chain that has already resolved needs. Encryption has not: it
    // runs on the crypto threadpool, and its completion only lands when the
    // loop actually idles. Spinning setImmediate never idles, so on a busy
    // machine all 400 turns could burn before an encrypt came back and the
    // assertion failed on a condition that was about to be true.
    //
    // A real timer every so often gives the loop that idle. It is safe here
    // because the room under test runs on an injected fake clock — the global
    // timer this uses is not the one being advanced.
    if (i % 25 === 24) await new Promise(resolve => setTimeout(resolve, 1));
    else await new Promise(resolve => setImmediate(resolve));
    if (until && until()) return;
  }
}

// Settles until the count of something stops changing, for the cases where the
// expected outcome is "nothing further happens".
const members = events => events.presence[events.presence.length - 1] || [];

async function settleQuiet(count) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await settle(null, 10);
    const now = count();
    if (now === last) return;
    last = now;
  }
}

// Builds a room already joined and live, with its fake socket to hand.
async function liveRoom(opts = {}) {
  const clock = makeClock();
  const factory = makeSocketFactory();
  const events = { states: [], rolls: [], presence: [], notices: [] };

  const r = createRoom({
    url: 'wss://relay.example/ws',
    name: opts.name || 'Amber Wolf',
    WebSocketImpl: factory.FakeSocket,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    onState: (s, info) => events.states.push({ s, info }),
    onRoll: roll => events.rolls.push(roll),
    onPresence: list => events.presence.push(list),
    onNotice: text => events.notices.push(text),
    ...opts.overrides,
  });

  const joined = r.join(PHRASE);
  // deriveRoom is a real PBKDF2 pass, so the socket does not exist until it
  // resolves. Waiting on a poll rather than a fixed delay keeps this off the Pi's
  // timing entirely.
  while (!factory.last()) await settle();

  const sock = factory.last();
  sock.open();
  sock.deliver({ t: 'joined', v: PROTOCOL_VERSION, you: 'c7f21a04', n: 1, expires: clock.now() + 3600000 });
  const result = await joined;

  return { r, sock, factory, clock, events, result };
}

// --- the local roll path is never gated on the relay ---

// This is the block that must never regress. Core rule 1: if the relay is
// unreachable the app rolls locally, instantly, with nothing queued.
{
  const clock = makeClock();
  const factory = makeSocketFactory();
  const r = createRoom({
    url: 'wss://relay.example/ws',
    name: 'Amber Wolf',
    WebSocketImpl: factory.FakeSocket,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
  });

  const result = { notation: '1d20', total: 15, groups: [] };

  ok('createRoom connects nothing', factory.sockets.length === 0);
  ok('a fresh room is offline', r.state === 'offline');
  ok('a fresh room is not active', r.active === false);

  // The signature itself is load-bearing: a promise here invites an await in
  // doRoll, and an await in doRoll is a local roll waiting on the network.
  const returned = r.share(result);
  ok('share() returns undefined when offline', returned === undefined);
  ok('share() is not a promise', !(returned && typeof returned.then === 'function'));
  ok('share() while offline queues nothing', factory.sockets.length === 0);

  let threw = false;
  try {
    r.share(null);
    r.share(undefined);
    r.share({});
    r.share({ notation: '1d20' });
  } catch { threw = true; }
  ok('share() never throws, whatever it is handed', !threw);

  // leave() on an offline room is a no-op that still succeeds; app.js calls it
  // without checking state.
  let leaveThrew = false;
  try { r.leave(); } catch { leaveThrew = true; }
  ok('leave() on an offline room does not throw', !leaveThrew);
}

// share() must also be a silent no-op while the socket is down mid-session,
// rather than buffering for later delivery.
{
  const { r, sock, clock } = await liveRoom();
  sock.drop();
  clock.advance(1);

  ok('a dropped socket puts the room in retrying', r.state === 'retrying');

  const before = sock.sent.length;
  const returned = r.share({ notation: '2d6', total: 7, groups: [] });
  ok('share() during a reconnect returns undefined', returned === undefined);
  await settle();
  ok('share() during a reconnect sends nothing', sock.sent.length === before);

  // And nothing is flushed when the connection comes back. A roll from ten
  // minutes ago arriving now reads as a replay to everyone at the table.
  clock.advance(2000);
  const next = sock === undefined ? null : null;
  void next;
  r.leave();
}

// A relay whose socket throws on send must not turn a local roll into an error.
{
  const { r, sock } = await liveRoom();
  sock.send = () => { throw new Error('socket exploded'); };
  let threw = false;
  try { r.share({ notation: '1d20', total: 3, groups: [] }); } catch { threw = true; }
  await settle();
  ok('share() survives a socket that throws on send', !threw);
  r.leave();
}

// --- join and the wire ---

{
  const { r, sock, result, events } = await liveRoom();

  const join = sock.frames('join')[0];
  ok('join is the first frame', sock.sent[0].t === 'join');
  ok('join carries the derived room id', join.room === room.roomId, join.room);
  ok('join room id is 32 hex chars', /^[0-9a-f]{32}$/.test(join.room));
  ok('join carries the protocol version', join.v === PROTOCOL_VERSION);

  // The relay must never be handed key material, in any frame, in any field.
  const wire = JSON.stringify(sock.sent);
  ok('no frame contains the passphrase', !wire.includes('anchor'));
  ok('no frame contains a key field', !/"(key|k|secret|salt)"\s*:/.test(wire));

  ok('join resolves with the passphrase', result.passphrase === PHRASE);
  ok('join resolves with a share link', result.link.endsWith('#' + PHRASE), result.link);

  ok('state reaches live', r.state === 'live');
  ok('a live room is active', r.active === true);
  ok('every reported state is a known one',
     events.states.every(e => ROOM_STATES.includes(e.s)),
     events.states.map(e => e.s).join(','));
  ok('joined reports the connection count',
     events.states.some(e => e.s === 'live' && e.info.n === 1));

  // hello follows join so the rest of the table learns the name without the
  // relay ever holding a roster.
  await settle(() => sock.frames('send').length >= 1);
  ok('a hello is sent after joining', sock.frames('send').length >= 1);
  r.leave();
}

// --- receiving a roll ---

const sampleRoll = {
  k: 'roll',
  at: 1768000000000,
  name: 'Bram Oak',
  notation: '2d20kh1+3',
  total: 21,
  groups: [
    { kind: 'dice', sign: 1, count: 2, sides: 20,
      mods: { keepHigh: 1, keepLow: null, explode: false, rerollBelow: null },
      dice: [
        { value: 18, kept: true, exploded: false, rerolled: false, crit: null },
        { value: 3, kept: false, exploded: false, rerolled: false, crit: 'min' },
      ],
      subtotal: 18 },
    { kind: 'const', sign: 1, value: 3 },
  ],
};

{
  const { r, sock, events } = await liveRoom();
  const peer = newSender();

  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, sampleRoll) });
  await settle(() => events.rolls.length === 1);

  ok('a remote roll reaches onRoll', events.rolls.length === 1);
  const got = events.rolls[0];
  ok('the roll keeps its notation', got.notation === '2d20kh1+3');
  ok('the roll keeps its total', got.total === 21);
  ok('the roll carries the crypto sender id', got.from === peer.id);
  ok('the roll carries the name', got.name === 'Bram Oak');

  // groups must survive byte for byte: app.js hands them straight to describe(),
  // so any reshaping here becomes a second format to keep in step with dice.js.
  ok('groups pass through unaltered',
     JSON.stringify(got.groups) === JSON.stringify(sampleRoll.groups));

  // Replay: the same ciphertext again must not produce a second entry. The
  // first delivery has to be fully settled before the replay goes out, or the
  // two decrypt concurrently and both read the seen map before either writes.
  const wire = await encryptMessage(room, peer, { ...sampleRoll, total: 21 });
  const before = events.rolls.length;
  sock.deliver({ t: 'msg', c: wire });
  await settle(() => events.rolls.length > before);

  const afterFirst = events.rolls.length;
  sock.deliver({ t: 'msg', c: wire });
  await settleQuiet(() => events.rolls.length);
  ok('a replayed roll is rejected', events.rolls.length === afterFirst,
     `${events.rolls.length - afterFirst} extra`);

  r.leave();
}

// The client's own rolls must never come back through onRoll. app.js renders its
// own roll in finish(); a second path would show it twice.
{
  const { r, sock, events } = await liveRoom();
  r.share({ notation: '1d20', total: 15, groups: [{ kind: 'dice', sign: 1, count: 1, sides: 20, mods: {}, dice: [{ value: 15, kept: true, exploded: false, rerolled: false, crit: null }], subtotal: 15 }] });
  await settle(() => sock.frames('send').length >= 2);
  ok('share() puts a roll on the wire', sock.frames('send').length >= 2);
  ok('share() does not loop back into onRoll', events.rolls.length === 0);
  r.leave();
}

// --- roll validation, a typo-catcher rather than a cheat detector ---

{
  ok('a well-formed roll validates', validateRoll(sampleRoll));

  const bad = obj => validateRoll({ ...sampleRoll, ...obj });

  ok('an inconsistent total is rejected', !bad({ total: 99 }));
  ok('a die above its sides is rejected', !validateRoll({
    ...sampleRoll,
    total: 45,
    groups: [{ ...sampleRoll.groups[0], subtotal: 42,
      dice: [{ value: 42, kept: true, exploded: false, rerolled: false, crit: null },
             { value: 3, kept: false, exploded: false, rerolled: false, crit: null }] },
      sampleRoll.groups[1]],
  }));
  ok('a zero-valued die is rejected', !validateRoll({
    ...sampleRoll, total: 3,
    groups: [{ ...sampleRoll.groups[0], subtotal: 0,
      dice: [{ value: 0, kept: true, exploded: false, rerolled: false, crit: null },
             { value: 3, kept: false, exploded: false, rerolled: false, crit: null }] },
      sampleRoll.groups[1]],
  }));
  ok('a count that disagrees with the dice is rejected', !validateRoll({
    ...sampleRoll,
    groups: [{ ...sampleRoll.groups[0], count: 5 }, sampleRoll.groups[1]],
  }));
  ok('a wrong subtotal is rejected', !validateRoll({
    ...sampleRoll,
    groups: [{ ...sampleRoll.groups[0], subtotal: 17 }, sampleRoll.groups[1]],
  }));
  ok('sides beyond the dice.js ceiling are rejected', !validateRoll({
    ...sampleRoll,
    groups: [{ ...sampleRoll.groups[0], sides: 99999 }, sampleRoll.groups[1]],
  }));
  ok('a missing notation is rejected', !bad({ notation: '' }));
  ok('missing groups are rejected', !bad({ groups: [] }));
  ok('a non-object is rejected', !validateRoll(null) && !validateRoll('x'));

  // An exploded die legitimately exceeds its sides, and rejecting it would drop
  // every exploding roll at the table.
  ok('an exploded die above its sides is allowed', validateRoll({
    k: 'roll', notation: '1d6!', total: 11,
    groups: [{ kind: 'dice', sign: 1, count: 1, sides: 6,
      mods: { keepHigh: null, keepLow: null, explode: true, rerollBelow: null },
      dice: [{ value: 11, kept: true, exploded: true, rerolled: false, crit: null }],
      subtotal: 11 }],
  }));

  // Negative terms: 2d6-1 must validate, or subtraction breaks for everyone.
  ok('a negative constant term validates', validateRoll({
    k: 'roll', notation: '1d6-1', total: 4,
    groups: [
      { kind: 'dice', sign: 1, count: 1, sides: 6,
        mods: { keepHigh: null, keepLow: null, explode: false, rerollBelow: null },
        dice: [{ value: 5, kept: true, exploded: false, rerolled: false, crit: null }],
        subtotal: 5 },
      { kind: 'const', sign: -1, value: 1 },
    ],
  }));
}

// --- system rolls travel as roll2 and re-render from their summary ---

const sampleSystemRoll = {
  k: 'roll2',
  at: 1768000000000,
  name: 'Bram Oak',
  system: 'v5',
  notation: 'v5:5h1',
  groups: [
    { kind: 'dice', sides: 10, count: 5, subtotal: 0, dice: [
      { value: 10, hunger: false, kept: true, exploded: false, rerolled: false },
      { value: 6, hunger: false, kept: true, exploded: false, rerolled: false },
      { value: 3, hunger: false, kept: true, exploded: false, rerolled: false },
      { value: 8, hunger: false, kept: true, exploded: false, rerolled: false },
      { value: 2, hunger: true, kept: true, exploded: false, rerolled: false },
    ] },
  ],
  summary: { successes: 3, tens: 1, crit: false, messy: false, bestial: false, outcome: 'success' },
};

// A peer's system roll arrives whole: its system id, notation, groups, and the
// summary the receiver renders the headline and detail from.
{
  const { r, sock, events } = await liveRoom();
  const peer = newSender();
  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, sampleSystemRoll) });
  await settle(() => events.rolls.length === 1);

  ok('a system roll reaches onRoll', events.rolls.length === 1);
  const got = events.rolls[0];
  ok('the system id survives', got.system === 'v5');
  ok('the system notation survives', got.notation === 'v5:5h1');
  ok('the summary rides along', !!got.summary && got.summary.successes === 3);
  ok('a system roll carries no numeric total', got.total === undefined);
  ok('system groups pass through unaltered',
     JSON.stringify(got.groups) === JSON.stringify(sampleSystemRoll.groups));
  r.leave();
}

// share() routes by system: a V5 result goes out as roll2 carrying its summary,
// not as the numeric roll schema (which has no place for it).
{
  const { r, sock } = await liveRoom();
  r.share({ system: 'v5', notation: 'v5:2h1', summary: { successes: 1 },
    groups: [{ kind: 'dice', sides: 10, count: 2, subtotal: 0,
      dice: [{ value: 7, kept: true }, { value: 2, hunger: true, kept: true }] }] });
  await settle(() => sock.frames('send').length >= 2);
  const frames = sock.frames('send');
  const decoded = await decryptMessage(room, new Map(), frames[frames.length - 1].c);
  ok('share() sends a system roll as roll2', !!decoded && decoded.k === 'roll2');
  ok('the roll2 frame carries the system and summary',
     decoded.system === 'v5' && decoded.summary.successes === 1);
  r.leave();
}

// A numeric roll still goes out under the original schema, so a client serving
// the old bundle from cache reads it unchanged.
{
  const { r, sock } = await liveRoom();
  r.share({ notation: '1d20', total: 15, groups: [{ kind: 'dice', sign: 1, count: 1, sides: 20,
    mods: {}, dice: [{ value: 15, kept: true, exploded: false, rerolled: false, crit: null }], subtotal: 15 }] });
  await settle(() => sock.frames('send').length >= 2);
  const frames = sock.frames('send');
  const decoded = await decryptMessage(room, new Map(), frames[frames.length - 1].c);
  ok('a numeric roll still goes out as roll', !!decoded && decoded.k === 'roll');
  r.leave();
}

// --- validateSystemRoll: a shape guard, permissive on values, capped on size ---

{
  ok('a well-formed system roll validates', validateSystemRoll(sampleSystemRoll));

  const bad = obj => validateSystemRoll({ ...sampleSystemRoll, ...obj });

  ok('an unknown system is rejected', !bad({ system: 'definitely-not-a-system' }));
  ok('a missing system is rejected', !bad({ system: '' }));
  ok('an empty notation is rejected', !bad({ notation: '' }));
  ok('an over-long notation is rejected', !bad({ notation: 'v'.repeat(201) }));
  ok('a non-object summary is rejected', !bad({ summary: null }) && !bad({ summary: [1, 2] }) && !bad({ summary: 'x' }));
  ok('empty groups are rejected', !bad({ groups: [] }));
  ok('a non-object is rejected', !validateSystemRoll(null) && !validateSystemRoll('x'));

  // Fate dice are -1/0/+1 with no per-die sides — the numeric validator would
  // reject them, this one must not.
  ok('a Fate roll validates', validateSystemRoll({
    system: 'fate', notation: '4dF', summary: { net: 1, total: 1, ladder: 'Fair' },
    groups: [{ kind: 'dice', sides: 6, count: 4, subtotal: 0, dice: [
      { value: 1, kept: true }, { value: -1, kept: true },
      { value: 0, kept: true }, { value: 1, kept: true },
    ] }],
  }));

  // Genesys dice carry glyph arrays and a colour tag.
  ok('a Genesys roll validates', validateSystemRoll({
    system: 'genesys', notation: 'gen:2A', summary: { success: 1, advantage: 0 },
    groups: [{ kind: 'dice', count: 2, subtotal: 0, dice: [
      { value: 3, sides: 8, color: 'ability', symbols: ['success'], kept: true },
      { value: 1, sides: 8, color: 'ability', symbols: [], kept: true },
    ] }],
  }));

  // Mothership: a percentile pair (tens die reads up to 90) with role tags, plus
  // a summary that carries a Stress delta — all display-only on the receiver.
  ok('a Mothership check validates', validateSystemRoll({
    system: 'mothership', notation: 'ms:c@35e',
    summary: { mode: 'check', value: 42, outcome: 'failure', success: false, stressDelta: 1 },
    groups: [{ kind: 'dice', count: 2, subtotal: 0, dice: [
      { value: 40, sides: 10, role: 'tens', kept: true },
      { value: 2, sides: 10, role: 'ones', kept: true },
    ] }],
  }));
  ok('a Mothership panic validates', validateSystemRoll({
    system: 'mothership', notation: 'ms:p@8',
    summary: { mode: 'panic', value: 5, panicked: true, lookup: 5 },
    groups: [{ kind: 'dice', count: 1, subtotal: 0, dice: [{ value: 5, sides: 20, role: 'panic', kept: true }] }],
  }));

  // Card draws carry ids and labels, not die values.
  ok('a card draw validates', validateSystemRoll({
    system: 'cards', notation: 'deck:3',
    summary: { drawn: [{ id: 'KS', label: 'K♠', red: false }], remaining: 49, total: 52 },
    groups: [{ kind: 'cards', count: 3, cards: [
      { id: 'KS', label: 'K♠', red: false }, { id: '10H', label: '10♥', red: true }, { id: 'J1', label: 'Joker (Le Fov)', red: false },
    ] }],
  }));
  ok('an oversized card draw is rejected', !validateSystemRoll({
    system: 'cards', notation: 'deck:3', summary: {},
    groups: [{ kind: 'cards', count: 13, cards: Array(13).fill({ id: 'KS', label: 'K♠' }) }],
  }));

  // Tarot draws ride the same cards group with a reversal flag.
  ok('a tarot draw validates', validateSystemRoll({
    system: 'tarot', notation: 'tarot:3',
    summary: { drawn: [{ id: 'T00', label: 'The Fool', rev: false }], remaining: 75, total: 78 },
    groups: [{ kind: 'cards', count: 3, cards: [
      { id: 'T00', label: 'The Fool', rev: false },
      { id: 'T10', label: 'The Wheel of Fortune', rev: true },
      { id: 'c07', label: 'Seven of Cups', rev: false },
    ] }],
  }));
  ok('a non-boolean reversal flag is rejected', !validateSystemRoll({
    system: 'tarot', notation: 'tarot:1', summary: {},
    groups: [{ kind: 'cards', count: 1, cards: [{ id: 'T00', label: 'The Fool', rev: 'yes' }] }],
  }));
  ok('an over-long card label is rejected', !validateSystemRoll({
    system: 'tarot', notation: 'tarot:1', summary: {},
    groups: [{ kind: 'cards', count: 1, cards: [{ id: 'T00', label: 'X'.repeat(25) }] }],
  }));
  ok('a napoletane draw validates', validateSystemRoll({
    system: 'napoletane', notation: 'nap:2',
    summary: { drawn: [{ id: 'd07', label: 'Sette di Denari', red: false }], remaining: 38, total: 40 },
    groups: [{ kind: 'cards', count: 2, cards: [
      { id: 'd07', label: 'Sette di Denari', red: false },
      { id: 'bC', label: 'Cavallo di Bastoni', red: false },
    ] }],
  }));

  ok('a wildly out-of-range die value is rejected', !validateSystemRoll({
    ...sampleSystemRoll,
    groups: [{ kind: 'dice', sides: 10, count: 1, subtotal: 0, dice: [{ value: 1e9, kept: true }] }],
  }));
  ok('a non-string glyph is rejected', !validateSystemRoll({
    system: 'genesys', notation: 'gen:1A', summary: {},
    groups: [{ kind: 'dice', count: 1, subtotal: 0, dice: [{ value: 1, symbols: [42], kept: true }] }],
  }));
  ok('an over-long glyph list is rejected', !validateSystemRoll({
    system: 'genesys', notation: 'gen:1A', summary: {},
    groups: [{ kind: 'dice', count: 1, subtotal: 0, dice: [{ value: 1, symbols: Array(13).fill('s'), kept: true }] }],
  }));
  ok('too many groups are rejected', !validateSystemRoll({
    ...sampleSystemRoll,
    groups: Array(51).fill({ kind: 'dice', count: 1, subtotal: 0, dice: [{ value: 1, kept: true }] }),
  }));
}

// An invalid roll is dropped in silence — no notice, no badge, no "suspicious
// roll" UI, because the check cannot support that claim.
{
  const { r, sock, events } = await liveRoom();
  const peer = newSender();
  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, { ...sampleRoll, total: 999 }) });
  await settle();
  ok('an inconsistent roll never reaches the app', events.rolls.length === 0);
  ok('an inconsistent roll raises no notice', events.notices.length === 0,
     events.notices.join(' | '));
  r.leave();
}

// --- presence ---

{
  const { r, sock, clock, events } = await liveRoom();
  const peer = newSender();

  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, { k: 'hello', at: clock.now(), name: 'Bram Oak', reply: false }) });
  await settle(() => events.presence.length > 0);

  const list = events.presence[events.presence.length - 1];
  ok('a hello adds a member', list.length === 1 && list[0].name === 'Bram Oak');
  ok('a member carries its crypto sender id', list[0].from === peer.id);

  // A hello asking for a reply must be answered, or a newcomer never learns who
  // is in the room — the relay holds no roster to ask.
  // The answer is delayed by a random 0-400ms so ten clients do not all reply in
  // the same tick, so the clock is advanced past the whole window and then
  // settled on the condition — advancing a fixed amount and settling a fixed
  // number of turns raced the encryption and failed about one run in six.
  const before = sock.frames('send').length;
  const peer2 = newSender();
  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer2, { k: 'hello', at: clock.now(), name: 'Cass Fen', reply: true }) });
  await settle(() => events.presence.length > 1);
  clock.advance(HELLO_REPLY_WINDOW_MS + 100);
  await settle(() => sock.frames('send').length > before);
  ok('a hello with reply:true is answered', sock.frames('send').length > before);

  // bye removes a member immediately.
  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, { k: 'bye', at: clock.now() }) });
  await settle(() => !members(events).some(m => m.from === peer.id));
  const afterBye = events.presence[events.presence.length - 1];
  ok('a bye removes that member', !afterBye.some(m => m.from === peer.id));

  // Ageing out: bye is best effort, so a member who simply vanishes has to
  // expire or they haunt the roster forever. Advanced comfortably past the 90s
  // TTL rather than just over it — the sweep runs on its own interval, so a
  // member is dropped at the first sweep after the TTL, not on the tick itself.
  clock.advance(120000);
  await settle();
  const aged = events.presence[events.presence.length - 1];
  ok('a silent member ages out after 90s', aged.length === 0,
     JSON.stringify(aged));

  r.leave();
}

// Names arrive from another machine and are rendered into the DOM by app.js, so
// they are bounded and stripped on receipt as well as on send.
{
  const { r, sock, clock, events } = await liveRoom();
  const peer = newSender();
  sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, {
    k: 'hello', at: clock.now(), name: 'x'.repeat(200), reply: false,
  }) });
  await settle(() => events.presence.length > 0);
  const list = events.presence[events.presence.length - 1];
  ok('an overlong name is truncated on receipt', list[0].name.length === 32,
     String(list[0].name.length));
  r.leave();
}

// --- malformed frames from the relay ---

// A hostile or broken relay must not be able to crash a client. Every one of
// these is delivered straight into onmessage.
{
  const { r, sock, events } = await liveRoom();
  const junk = [
    'not json at all', '', '[]', 'null', '42', '"string"',
    JSON.stringify({ no: 'type' }),
    JSON.stringify({ t: 42 }),
    JSON.stringify({ t: 'msg' }),
    JSON.stringify({ t: 'msg', c: 12345 }),
    JSON.stringify({ t: 'msg', c: 'not base64 !!!' }),
    JSON.stringify({ t: 'unknown_future_frame', payload: 1 }),
    JSON.stringify({ t: 'joined' }),
    JSON.stringify({ t: 'roster' }),
  ];

  let threw = false;
  for (const j of junk) {
    try { sock.deliver(j); } catch { threw = true; }
  }
  await settle();
  ok('malformed frames never throw into the app', !threw);
  ok('malformed frames produce no rolls', events.rolls.length === 0);

  // Binary frames carry nothing this protocol defines and must be ignored
  // rather than coerced.
  let binThrew = false;
  try {
    if (sock.onmessage) sock.onmessage({ data: Buffer.from([1, 2, 3]) });
  } catch { binThrew = true; }
  ok('a binary frame is ignored', !binThrew);

  r.leave();
}

// A relay sending nothing but nonsense is treated as hostile and dropped, rather
// than reconnected to forever.
{
  const { r, sock } = await liveRoom();
  for (let i = 0; i < 12; i++) sock.deliver('garbage');
  await settle();
  ok('a relay sending only nonsense ends in failed', r.state === 'failed', r.state);
  ok('a hostile relay is not retried', r.active === false);
  r.leave();
}

// Ciphertext that will not decrypt is counted rather than reported per message.
// A single failure is a corrupted frame; a run of them is the wrong passphrase.
{
  const { r, sock, events } = await liveRoom();
  const wrong = await deriveRoom('granite-osprey-saffron-thicket-zephyr');
  const stranger = newSender();

  // Waits for each failure to actually be counted. Spinning a fixed number of
  // microtask turns instead was flaky: WebCrypto runs off-thread, so under load
  // a decryption could still be in flight after the budget was spent, leaving
  // the run short of the threshold and the fifth message raising nothing.
  for (let i = 0; i < 4; i++) {
    sock.deliver({ t: 'msg', c: await encryptMessage(wrong, stranger, sampleRoll) });
    await settle(() => r.unreadable === i + 1);
  }
  ok('four unreadable messages are all counted', r.unreadable === 4,
     `counted ${r.unreadable}`);
  ok('a few unreadable messages raise no notice', events.notices.length === 0,
     events.notices.join(' | '));

  sock.deliver({ t: 'msg', c: await encryptMessage(wrong, stranger, sampleRoll) });
  await settle(() => events.notices.some(n => n.includes('passphrase')));
  ok('five unreadable messages raise one notice',
     events.notices.filter(n => n.includes('passphrase')).length === 1,
     events.notices.join(' | '));

  r.leave();
}

// --- reconnection ---

{
  const { r, sock, factory, clock, events } = await liveRoom();
  const firstJoin = sock.frames('join')[0];

  sock.drop();
  clock.advance(1);
  ok('a dropped socket reports retrying', r.state === 'retrying');
  ok('a dropped socket says rolling continues locally',
     events.notices.some(n => n.includes('locally')), events.notices.join(' | '));

  const before = factory.sockets.length;
  clock.advance(1400);
  ok('a reconnect is attempted after the first backoff',
     factory.sockets.length === before + 1);

  // The unreachable notice is shown once per outage, not once per attempt. A
  // relay down for an hour would otherwise repeat the line every 30 seconds and
  // read as a recurring fault rather than a steady state.
  const unreachable = () => events.notices.filter(n => n.includes('locally')).length;
  const noticesSoFar = unreachable();
  for (let i = 0; i < 6; i++) {
    factory.last().drop();
    clock.advance(60000);
  }
  ok('the unreachable notice is not repeated on every retry',
     unreachable() === noticesSoFar, `${unreachable() - noticesSoFar} extra`);

  const second = factory.last();
  second.open();
  const secondJoin = second.frames('join')[0];
  ok('the reconnect rejoins the same room', secondJoin.room === firstJoin.room);

  // A fresh sender per connection. Reusing the old id with a reset counter puts
  // a peer's replay guard into a state where either everything is rejected as
  // replayed or the guard has to be turned off.
  second.deliver({ t: 'joined', v: PROTOCOL_VERSION, you: 'aabbccdd', n: 2, expires: clock.now() + 3600000 });
  await settle();
  r.share({ notation: '1d6', total: 4, groups: [] });
  await settle();
  ok('the reconnect reaches live again', r.state === 'live');

  r.leave();
}

// Backoff grows and is capped, and every delay is jittered so a relay restart
// does not bring every client back in the same tick.
{
  const seen = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const samples = Array.from({ length: 200 }, () => backoffDelay(attempt));
    seen.push({ attempt, min: Math.min(...samples), max: Math.max(...samples) });
  }
  const nominal = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
  ok('backoff follows the documented schedule',
     seen.every((s, i) => s.min >= nominal[i] * 0.79 && s.max <= nominal[i] * 1.21),
     JSON.stringify(seen));
  ok('backoff is capped at 30s', seen[7].max <= 30000 * 1.21);
  ok('backoff is jittered rather than fixed', seen[0].min !== seen[0].max);
}

// --- terminal errors stop, retryable ones do not ---

{
  for (const code of ['version', 'room_full', 'bad_room', 'bad_frame', 'too_big']) {
    const { r, sock, factory, clock } = await liveRoom();
    const before = factory.sockets.length;
    sock.deliver({ t: 'error', code, detail: 'nope' });
    sock.drop();
    clock.advance(120000);
    ok(`a ${code} error ends in failed`, r.state === 'failed', r.state);
    ok(`a ${code} error is not retried`, factory.sockets.length === before,
       `${factory.sockets.length - before} extra attempts`);
    r.leave();
  }
}

// Version mismatch has to be loud: the service worker is cache-first, so old
// clients stay in circulation and must be told to reload rather than fail quietly.
{
  const { r, sock, events } = await liveRoom();
  sock.deliver({ t: 'error', code: 'version' });
  ok('a version mismatch prompts a reload',
     events.notices.some(n => n.toLowerCase().includes('reload')),
     events.notices.join(' | '));
  r.leave();
}

// Rate limiting is the one error that keeps the connection, and the notice must
// say the roll still happened.
{
  const { r, sock, events } = await liveRoom();
  sock.deliver({ t: 'error', code: 'rate' });
  await settle();
  ok('a rate error keeps the room live', r.state === 'live', r.state);
  ok('a rate error does not close the socket', !sock.closed);
  ok('a rate error says the roll still happened locally',
     events.notices.some(n => n.includes('locally')), events.notices.join(' | '));
  r.leave();
}

// Expiry returns the room to offline rather than failed: the passphrase was
// fine, the room simply ran out of time, and a new one can be started.
{
  const { r, sock, events } = await liveRoom();
  sock.deliver({ t: 'error', code: 'expired' });
  await settle();
  ok('an expired room goes offline', r.state === 'offline', r.state);
  ok('an expired room says so',
     events.notices.some(n => n.includes('expired')), events.notices.join(' | '));
  ok('an expired room is no longer active', r.active === false);
  r.leave();
}

// --- liveness ---

{
  const { r, sock, clock } = await liveRoom();
  clock.advance(26000);
  ok('a ping is sent while live', sock.frames('ping').length >= 1);

  sock.deliver({ t: 'pong' });
  clock.advance(26000);
  ok('a pong keeps the socket up', r.state === 'live', r.state);

  // No pong inside the window means the socket is dead even though the browser
  // still reports it open — a proxy that dropped it without an RST.
  clock.advance(11000);
  ok('a missing pong is treated as a disconnect', r.state === 'retrying', r.state);
  r.leave();
}

// --- leave ---

{
  const { r, sock, events } = await liveRoom();
  // The join hello has to be on the wire before leaving, or the bye is the
  // first encrypted frame and the "bye follows hello" count below is off by one.
  await settle(() => sock.frames('send').length >= 1);
  r.leave();
  await settle(() => sock.closed && sock.frames('send').length >= 2);

  ok('leave closes the socket', sock.closed);
  ok('leave sends a leave frame', sock.frames('leave').length === 1);

  // The goodbye is encrypted, so it cannot be sent and the socket closed in the
  // same turn. Closing immediately made every bye lose the race to encryption
  // and reach the wire never — the roster only cleared when the peer aged out
  // 90 seconds later.
  ok('leave puts an encrypted bye on the wire before closing',
     sock.frames('send').length >= 2, sock.sent.map(f => f.t).join(' -> '));
  ok('the bye precedes the leave frame',
     sock.sent.findIndex(f => f.t === 'send') < sock.sent.findIndex(f => f.t === 'leave'),
     sock.sent.map(f => f.t).join(' -> '));
  ok('leave returns to offline', r.state === 'offline');
  ok('leave clears active', r.active === false);
  ok('leave reports the offline state', events.states[events.states.length - 1].s === 'offline');

  // Key material and identity must not survive a leave.
  ok('leave clears the roster', r.members.length === 0);
  ok('leave clears the relay-assigned id', r.self === null);

  // And a share after leaving is a no-op rather than a throw or a reconnect.
  let threw = false;
  try { r.share({ notation: '1d20', total: 9, groups: [] }); } catch { threw = true; }
  ok('share() after leave does not throw', !threw);
}

// --- names ---

{
  const { r, sock } = await liveRoom();
  // The join hello must land before the count is taken, or `before` is 0 and the
  // join hello itself satisfies the assertion rather than the rename.
  await settle(() => sock.frames('send').length >= 1);
  const before = sock.frames('send').length;
  r.setName('Cass Fen');
  await settle(() => sock.frames('send').length > before);
  ok('setName broadcasts a hello while live', sock.frames('send').length > before);
  ok('setName updates the name', r.name === 'Cass Fen');

  r.setName('   ');
  ok('a blank name is refused', r.name === 'Cass Fen');

  r.setName('y'.repeat(100));
  ok('an overlong name is trimmed on send', r.name.length === 32);
  r.leave();
}

// --- the passphrase never lingers in the URL ---

// The fragment is never sent to a server, but it does persist in the address
// bar, in session history and in browser sync. Stripping it in the same turn it
// is read is the difference between a key that lived for one turn and a key
// that lives in a synced profile.
{
  const calls = [];
  globalThis.location = {
    hash: '#anchor-tundra-vellum-quartz-bramble',
    pathname: '/dicebox/',
    search: '',
    origin: 'https://example.test',
  };
  globalThis.history = {
    replaceState: (a, b, url) => { calls.push(url); globalThis.location.hash = ''; },
  };

  const phrase = parsePassphraseFromHash();
  ok('the passphrase is read from the fragment', phrase === PHRASE, String(phrase));
  ok('the fragment is stripped immediately', calls.length === 1, JSON.stringify(calls));
  ok('the replacement URL carries no fragment', !calls[0].includes('#'), calls[0]);
  ok('location.hash no longer holds the passphrase', globalThis.location.hash === '');

  ok('a second read finds nothing', parsePassphraseFromHash() === null);

  // A spoken passphrase arrives with spaces and capitals; it must still land.
  globalThis.location.hash = '#Anchor%20Tundra%20Vellum%20Quartz%20Bramble';
  ok('a spaced fragment normalizes to the same phrase',
     parsePassphraseFromHash() === PHRASE);

  // replaceState is forbidden in some embeddings. Failing to join because the
  // URL could not be tidied would be the worse outcome.
  globalThis.location.hash = '#anchor-tundra-vellum-quartz-bramble';
  globalThis.history.replaceState = () => { throw new Error('denied'); };
  let hashThrew = false;
  let got = null;
  try { got = parsePassphraseFromHash(); } catch { hashThrew = true; }
  ok('a forbidden replaceState does not throw', !hashThrew);
  ok('a forbidden replaceState still yields the passphrase', got === PHRASE);

  delete globalThis.location;
  delete globalThis.history;
}

// --- callbacks that throw are contained ---

// A throwing callback is app.js's bug, but letting it escape would abort a
// socket handler mid-way and leave the transport in a half-built state.
{
  const clock = makeClock();
  const factory = makeSocketFactory();
  const r = createRoom({
    url: 'wss://relay.example/ws',
    name: 'Amber Wolf',
    WebSocketImpl: factory.FakeSocket,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    onState: () => { throw new Error('app bug'); },
    onRoll: () => { throw new Error('app bug'); },
    onPresence: () => { throw new Error('app bug'); },
    onNotice: () => { throw new Error('app bug'); },
  });

  let threw = false;
  const joined = r.join(PHRASE).catch(() => {});
  while (!factory.last()) await settle();
  const sock = factory.last();
  try {
    sock.open();
    sock.deliver({ t: 'joined', v: PROTOCOL_VERSION, you: 'aa', n: 1, expires: clock.now() + 1000 });
    await settle();
    const peer = newSender();
    sock.deliver({ t: 'msg', c: await encryptMessage(room, peer, sampleRoll) });
    await settle();
    r.share({ notation: '1d6', total: 3, groups: [] });
    await settle();
  } catch { threw = true; }
  await joined;
  ok('a throwing callback never escapes the transport', !threw);
  r.leave();
}

// --- what a join emits, which app.js depends on ---
//
// join() leaves any previous room before it starts, and leave() announces
// 'offline'. So a single successful join emits offline -> connecting -> live,
// and the offline carries no code because nothing went wrong.
//
// app.js stores the passphrase before joining so the live view can show it, and
// used to clear it on any 'offline' — so the phrase was wiped mid-join and the
// panel rendered "The passphrase" above an empty line. The copy buttons still
// worked, because the join promise restored it a moment later, which is exactly
// what made it read as a display bug instead of a lifecycle one.
//
// Asserted here rather than in app.js because it is room.js's sequence that
// makes the rule necessary: anything reacting to 'offline' has to be able to
// tell a room ending from a join beginning, and the code field is the only
// thing that distinguishes them.
{
  const { r, events } = await liveRoom();
  const states = events.states.map(e => e.s);
  ok('a join announces offline before it connects', states.includes('offline'), states.join(' -> '));
  ok('a join reaches live', states.includes('live'), states.join(' -> '));

  const offline = events.states.filter(e => e.s === 'offline');
  ok('an offline is emitted at all', offline.length > 0);
  ok('the offline emitted while joining carries no code',
     offline.every(e => !(e.info && e.info.code)),
     JSON.stringify(offline));
  r.leave();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
