// Room transport. Owns the WebSocket, the reconnect schedule, and the presence
// table; owns no pixels. Every user-visible effect leaves through a callback, so
// this file can be tested with a fake socket and no DOM.
//
// The rule that shapes everything below: rolling is local and must never wait on
// any of this. `share()` is synchronous and returns nothing for that reason, and
// no path from `doRoll` reaches an await here.
import {
  deriveRoom, newSender, encryptMessage, decryptMessage, normalizePassphrase,
  PROTOCOL_VERSION,
} from './room-crypto.js';

// The contract asks this module to re-export generatePassphrase,
// normalizePassphrase, PHRASE_WORDS and PHRASE_BITS for app.js's convenience.
// It deliberately does not, and the reason is the single-file build.
//
// Every form of re-export breaks it. `export { generatePassphrase }` is
// invisible to bundle.mjs, which finds exports with a regex anchored on
// `export const|let|var|function|class`, and the same pass strips the leading
// `export ` and leaves a bare block. Wrapping them in new function declarations
// fixes that and then collides at bundle time instead: modules there share one
// namespace, so a `generatePassphrase` declared here lands on top of the one
// room-crypto.js already contributed — "Identifier has already been declared",
// but only in the downloadable build, which is the build least likely to be
// tried before shipping.
//
// So app.js imports those four from './room-crypto.js' directly. One extra
// import line, against a failure that is invisible until someone opens the
// single-file copy.

export const ROOM_STATES = ['offline', 'connecting', 'live', 'retrying', 'failed'];

// Backoff: 1s, 2s, 4s, 8s, 16s, then every 30s, each with ±20% jitter. The
// jitter matters more than the curve — a relay restart drops every client at the
// same instant, and without it they all come back in the same tick and knock it
// over again.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
const BACKOFF_MAX_MS = 30000;
const BACKOFF_JITTER = 0.2;

// 25s sits under the 30s idle timeout that nginx and Cloudflare both default to.
// A longer interval means the proxy closes a socket the client believes is fine.
const PING_MS = 25000;
const PONG_TIMEOUT_MS = 10000;

// `bye` is best effort — a phone that goes into a tunnel sends nothing — so
// presence has to age out or the roster fills with people who left hours ago.
const PRESENCE_TTL_MS = 90000;

// How often the roster is swept for members past their TTL. Well under the TTL
// so a departure shows up within a few seconds of becoming certain.
const PRESENCE_SWEEP_MS = 10000;

// Answers to a newcomer's hello are spread over this window so ten clients do
// not all reply in the same tick.
const HELLO_REPLY_MAX_MS = 400;

// One failure is a corrupted frame. A run of them is the wrong passphrase, and
// a toast per message would bury the app.
const DECRYPT_FAIL_NOTICE_AT = 5;

// A relay that sends ten unparseable frames in a row is broken or hostile.
// Neither improves by being humoured.
const MAX_BAD_FRAMES = 10;

const NAME_MAX = 32;

// Terminal relay errors. Retrying a rejection the relay will simply repeat is
// noise, and it hides the real problem behind a spinner.
const TERMINAL_CODES = new Set(['bad_frame', 'bad_room', 'version', 'room_full', 'too_big']);

const NOTICE_FOR_CODE = {
  version: 'This copy of Dicebox is too old for the relay — reload the page',
  room_full: 'Room is full',
  expired: 'Room has expired — start a new one',
  rate: 'Rolling too fast to share — the roll still happened locally',
  bad_room: 'That room could not be joined',
  bad_frame: 'The relay rejected this client — please report it',
  too_big: 'That roll was too large to share',
};

// Trimmed, bounded, control characters stripped. Enforced on the way out and
// again on the way in: the sender is whoever holds the passphrase, and a name is
// a string from another machine no matter how friendly its owner.
function cleanName(input) {
  let s = '';
  for (const ch of String(input == null ? '' : input)) {
    const code = ch.codePointAt(0);
    // Stripped by code point rather than by a regex character class: a literal
    // control character in a source file is invisible to review and does not
    // survive a careless reformat intact.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    s += ch;
  }
  return s.trim().slice(0, NAME_MAX);
}

// Appends the room id to the relay URL. Hand-assembled rather than built with
// URL, because a relay may legitimately be configured with a path and a URL
// round trip would need a base that a ws:// scheme does not reliably provide.
function withRoom(url, roomId) {
  return url + (url.includes('?') ? '&' : '?') + 'room=' + roomId;
}

function jitter(ms) {
  return Math.round(ms * (1 + (Math.random() * 2 - 1) * BACKOFF_JITTER));
}

export function backoffDelay(attempt) {
  const base = attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : BACKOFF_MAX_MS;
  return jitter(base);
}

// Reads the passphrase out of the fragment and removes it in the same turn.
//
// The fragment is never sent to a server, but it does persist: it sits in the
// address bar where it gets screenshotted, in session history where Back
// restores it, and in browser sync where it reaches every other device on the
// account. Stripping it immediately is the difference between a key that lived
// for one turn and a key that lives in a Google account forever.
export function parsePassphraseFromHash() {
  if (typeof location === 'undefined' || !location.hash) return null;
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const phrase = normalizePassphrase(raw);
  if (!phrase) return null;

  try {
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch {
    // Some embeddings forbid replaceState. Returning the passphrase anyway is
    // right — failing to join because the URL could not be tidied would be a
    // worse outcome than a fragment that lingers.
  }
  return phrase;
}

// Validates a received roll against what dice.js could actually have produced.
//
// This is a typo-catcher, not a cheat detector, and the distinction is not
// modesty. Anyone who can encrypt for this room can encrypt a self-consistent
// lie; the check catches a malformed or out-of-version client, nothing more.
// So a failure drops the roll silently — no badge, no warning, no "verified"
// marker, because every one of those would claim an assurance that is not there.
export function validateRoll(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.notation !== 'string' || !msg.notation) return false;
  if (!Number.isFinite(msg.total)) return false;
  if (!Array.isArray(msg.groups) || msg.groups.length === 0) return false;

  let total = 0;
  for (const g of msg.groups) {
    if (!g || typeof g !== 'object') return false;
    const sign = g.sign === -1 ? -1 : g.sign === 1 ? 1 : null;
    if (sign === null) return false;

    if (g.kind === 'const') {
      if (!Number.isInteger(g.value)) return false;
      total += sign * g.value;
      continue;
    }
    if (g.kind !== 'dice') return false;

    if (!Number.isInteger(g.sides) || g.sides < 1 || g.sides > 10000) return false;
    if (!Number.isInteger(g.count) || g.count < 1 || g.count > 500) return false;
    if (!Array.isArray(g.dice) || g.dice.length !== g.count) return false;

    let subtotal = 0;
    for (const d of g.dice) {
      if (!d || typeof d !== 'object') return false;
      if (!Number.isInteger(d.value) || d.value < 1) return false;
      // An exploded die legitimately exceeds its sides — it is a sum of several
      // rolls. An unexploded one cannot, and that is the typo this catches.
      if (!d.exploded && d.value > g.sides) return false;
      if (d.kept) subtotal += d.value;
    }
    if (!Number.isInteger(g.subtotal) || g.subtotal !== subtotal) return false;
    total += sign * subtotal;
  }

  return total === msg.total;
}

// The system modes (V5, Fate, Genesys, …) don't reduce to a single numeric
// total, so they travel as `k:'roll2'` carrying the system id, its notation, the
// dice groups, and the per-system summary the sender already computed. There is
// nothing to re-derive a total against here; instead we bound every field so a
// malformed or oversized payload can't crash or wedge the receiver's renderer.
// Values are deliberately permissive — Fate dice are -1/0/+1, symbol dice carry
// glyph arrays — but everything is length- and range-capped. The summary is
// trusted for display only (the room is end-to-end encrypted among people who
// share the passphrase); the receiver still renders it inside a try/catch.
// The id here is the one the reducer stamps on result.system and share() puts on
// the wire, which is not always the picker's slug: Call of Cthulhu travels as
// 'coc', and the two-game engines collapse to one id each — Alien rolls as
// 'yearzero', Starforged as 'ironsworn'. Miss one and every roll from that mode
// is silently dropped at the receiver.
const SYSTEM_ROLL_KINDS = new Set([
  'v5', 'fate', 'genesys', 'daggerheart', 'cthulhutech', 'starwars', 'onering', 'pbta', 'mist', 'drawsteel', 'crows', 'shadowdark', 'mothership', 'coc', 'deltagreen', 'ironsworn', 'oracle', 'yearzero', 'bladerunner', 'twilight', 'cards', 'tarot', 'napoletane', 'hanafuda', 'utagaruta',
]);

export function validateSystemRoll(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.system !== 'string' || !SYSTEM_ROLL_KINDS.has(msg.system)) return false;
  if (typeof msg.notation !== 'string' || !msg.notation || msg.notation.length > 200) return false;
  if (msg.parentId != null && (typeof msg.parentId !== 'string' || msg.parentId.length > 96)) return false;
  if (msg.transition != null) {
    const t = msg.transition;
    // Every two-beat mechanic that travels: the Year Zero-family push, the V5
    // Willpower reroll, the V5 Blood Surge. Rejecting the kind here drops the
    // WHOLE roll at the receiver, not just its animation — which is exactly
    // what happened to willpower rerolls before the list grew past 'push'.
    if (!t || typeof t !== 'object' || !['push', 'willpower', 'surge'].includes(t.kind)) return false;
    for (const key of ['held', 'rerolled', 'added']) {
      if (!Array.isArray(t[key]) || t[key].length > 100
          || t[key].some(index => !Number.isInteger(index) || index < 0 || index >= 100)) return false;
    }
  }
  if (!msg.summary || typeof msg.summary !== 'object' || Array.isArray(msg.summary)) return false;
  if (!Array.isArray(msg.groups) || msg.groups.length === 0 || msg.groups.length > 50) return false;

  for (const g of msg.groups) {
    if (!g || typeof g !== 'object') return false;
    if (g.kind === 'const') {
      if (!Number.isInteger(g.value)) return false;
      continue;
    }
    // Card draws (playing cards and tarot both) carry ids and display labels
    // rather than die values; tarot cards may add a reversal flag.
    if (g.kind === 'cards') {
      if (!Array.isArray(g.cards) || g.cards.length === 0 || g.cards.length > 12) return false;
      for (const card of g.cards) {
        if (!card || typeof card !== 'object') return false;
        // Hanafuda ids run to eleven characters; the old cap of 4 silently
        // rejected every hanafuda draw a peer sent.
        if (typeof card.id !== 'string' || card.id.length > 16) return false;
        if (typeof card.label !== 'string' || card.label.length > 24) return false;
        if (card.rev !== undefined && typeof card.rev !== 'boolean') return false;
      }
      continue;
    }
    if (g.kind !== 'dice') return false;
    if (!Array.isArray(g.dice) || g.dice.length === 0 || g.dice.length > 500) return false;
    if (g.sides !== undefined && (!Number.isInteger(g.sides) || g.sides < 1 || g.sides > 10000)) return false;

    for (const d of g.dice) {
      if (!d || typeof d !== 'object') return false;
      // Fate dice go negative; exploded dice go high. Wide but bounded.
      if (!Number.isInteger(d.value) || d.value < -100 || d.value > 100000) return false;
      if (d.sides !== undefined && (!Number.isInteger(d.sides) || d.sides < 1 || d.sides > 10000)) return false;
      if (d.symbols !== undefined) {
        if (!Array.isArray(d.symbols) || d.symbols.length > 12) return false;
        for (const s of d.symbols) if (typeof s !== 'string' || s.length > 24) return false;
      }
      // Short string tags the renderer keys off (die-type colour, role, face).
      for (const key of ['color', 'role', 'face', 'type']) {
        if (d[key] !== undefined && (typeof d[key] !== 'string' || d[key].length > 24)) return false;
      }
    }
  }

  return true;
}

export function createRoom(options = {}) {
  const noop = () => {};
  const onStateCb = options.onState || noop;
  const onRoll = options.onRoll || noop;
  const onPresence = options.onPresence || noop;
  const onNotice = options.onNotice || noop;

  // Injectable so tests can drive this with a fake socket and fake timers, and
  // so nothing here reaches for a global that the bundle might not have.
  const Socket = options.WebSocketImpl
    || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || (id => clearTimeout(id));
  const now = options.now || (() => Date.now());

  let url = options.url || '';
  let name = cleanName(options.name) || 'Player';

  // Everything below is reset by leave(). Key material lives only in `room`,
  // which is dropped there.
  let room = null;
  let sender = null;
  let seen = new Map();
  let ws = null;
  let state = 'offline';
  let selfId = null;
  let expiresAt = null;
  let attempt = 0;
  let decryptFails = 0;
  let badFrames = 0;
  let wantOpen = false;
  const members = new Map();

  const timers = new Set();
  function later(fn, ms) {
    const id = setTimer(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function clearAllTimers() {
    for (const id of timers) clearTimer(id);
    timers.clear();
  }

  let retryTimer = null;
  let pingTimer = null;
  let pongTimer = null;
  let ageTimer = null;

  // join() parks a resolver here to watch for the transition to live or failed.
  // A single slot rather than a listener list because there is only ever one
  // join in flight — join() leaves the previous room before starting.
  let joinWatcher = null;

  function setState(next, info) {
    if (state === next && !info) return;
    state = next;
    const detail = info || {};
    try {
      onStateCb(next, detail);
    } catch {
      // A throwing callback is app.js's bug, but letting it escape would abort
      // the socket handler mid-way and leave the transport in a half-state.
    }
    if (joinWatcher) joinWatcher(next, detail);
  }

  function notice(text) {
    try { onNotice(text); } catch { /* see setState */ }
  }

  function emitPresence() {
    const list = [...members.values()]
      .map(m => ({ from: m.from, name: m.name, since: m.since }))
      .sort((a, b) => a.since - b.since || (a.from < b.from ? -1 : 1));
    try { onPresence(list); } catch { /* see setState */ }
  }

  function agePresence() {
    const cutoff = now() - PRESENCE_TTL_MS;
    let dropped = false;
    for (const [id, m] of members) {
      if (m.lastAt < cutoff) { members.delete(id); dropped = true; }
    }
    if (dropped) emitPresence();
  }

  // Ageing runs on its own timer rather than on the back of the ping.
  //
  // It was folded into the heartbeat at first, which looked tidier and was
  // wrong: losing the socket stops the heartbeat, so the roster froze at the
  // moment of disconnection and everyone who left during an outage stayed on
  // it. Presence has to decay whether or not the relay is reachable.
  function ageTick() {
    if (!wantOpen) return;
    agePresence();
    ageTimer = later(ageTick, PRESENCE_SWEEP_MS);
  }

  function heartbeat() {
    if (!wantOpen) return;
    if (isOpen()) {
      sendFrame({ t: 'ping' });
      clearTimer(pongTimer);
      pongTimer = later(() => {
        // No pong inside the window means the socket is dead even though the
        // browser still calls it open — a proxy that dropped it silently, or a
        // network that went away without an RST. Treat it as a disconnect.
        if (isOpen()) dropSocket();
      }, PONG_TIMEOUT_MS);
    }
    pingTimer = later(heartbeat, PING_MS);
  }

  function isOpen() {
    return !!ws && ws.readyState === 1;
  }

  function sendFrame(obj) {
    if (!isOpen()) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      // A send can throw if the socket died between the readyState check and
      // here. Nothing to do about it and nothing worth telling the user.
      return false;
    }
  }

  // Encrypts and sends without ever being awaited by a caller. Failures are
  // swallowed on purpose: this is reached from the roll path, and a rejected
  // promise escaping here would surface as an unhandled rejection during an
  // ordinary offline roll.
  function sendEncrypted(payload) {
    if (!room || !sender || !isOpen()) return;
    encryptMessage(room, sender, payload)
      .then(c => { sendFrame({ t: 'send', c }); })
      .catch(() => {});
  }

  function sendHello(reply) {
    sendEncrypted({ k: 'hello', at: now(), name, reply: !!reply });
  }

  function touchMember(from, at) {
    const m = members.get(from);
    if (m) m.lastAt = at;
  }

  function handlePayload(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.from !== 'string') return;
    const at = now();

    if (msg.k === 'hello') {
      const clean = cleanName(msg.name);
      if (!clean) return;
      const existing = members.get(msg.from);
      if (existing) {
        existing.name = clean;
        existing.lastAt = at;
      } else {
        members.set(msg.from, { from: msg.from, name: clean, since: at, lastAt: at });
      }
      emitPresence();

      // Answer a newcomer so they learn the room without the relay holding a
      // roster. reply:false on the answer is load-bearing — without it N members
      // answering one newcomer trigger N more answers each.
      if (msg.reply) later(() => sendHello(false), Math.floor(Math.random() * HELLO_REPLY_MAX_MS));
      return;
    }

    if (msg.k === 'bye') {
      if (members.delete(msg.from)) emitPresence();
      return;
    }

    if (msg.k === 'roll') {
      touchMember(msg.from, at);
      if (!validateRoll(msg)) return;
      const clean = cleanName(msg.name);
      try {
        onRoll({
          from: msg.from,
          id: typeof msg.id === 'string' ? msg.id : null,
          name: clean || 'Someone',
          at: Number.isFinite(msg.at) ? msg.at : at,
          notation: msg.notation,
          groups: msg.groups,
          total: msg.total,
        });
      } catch { /* see setState */ }
      return;
    }

    if (msg.k === 'roll2') {
      touchMember(msg.from, at);
      if (!validateSystemRoll(msg)) return;
      const clean = cleanName(msg.name);
      try {
        onRoll({
          from: msg.from,
          id: typeof msg.id === 'string' ? msg.id : null,
          name: clean || 'Someone',
          at: Number.isFinite(msg.at) ? msg.at : at,
          system: msg.system,
          notation: msg.notation,
          groups: msg.groups,
          summary: msg.summary,
          parentId: typeof msg.parentId === 'string' ? msg.parentId : null,
          transition: msg.transition && typeof msg.transition === 'object' ? msg.transition : null,
        });
      } catch { /* see setState */ }
      return;
    }

    // Unknown kinds are ignored in silence. That is what lets a later version
    // add one without breaking clients the service worker is still serving from
    // cache and which cannot be updated.
  }

  function handleFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      frame = null;
    }
    if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') {
      if (++badFrames >= MAX_BAD_FRAMES) {
        wantOpen = false;
        closeSocket();
        setState('failed', { code: 'bad_frame' });
        notice('The relay is sending nonsense — disconnected');
      }
      return;
    }
    badFrames = 0;

    switch (frame.t) {
      case 'joined': {
        selfId = typeof frame.you === 'string' ? frame.you : null;
        expiresAt = Number.isFinite(frame.expires) ? frame.expires : null;
        attempt = 0;
        setState('live', { n: frame.n, expires: expiresAt });
        sendHello(true);
        break;
      }
      case 'roster':
        setState('live', { n: frame.n, expires: expiresAt });
        break;
      case 'msg':
        if (typeof frame.c === 'string') readMessage(frame.c);
        break;
      case 'pong':
        clearTimer(pongTimer);
        pongTimer = null;
        break;
      case 'error':
        handleError(frame);
        break;
      default:
        // An unknown frame type is not a malformed one; a newer relay may send
        // frames this client predates. Counting it toward the hostile-relay
        // threshold would break that client against a relay working correctly.
        break;
    }
  }

  function handleError(frame) {
    const code = typeof frame.code === 'string' ? frame.code : 'unknown';
    const text = NOTICE_FOR_CODE[code];
    if (text) notice(text);

    // Rate limiting is the one error that does not end the connection: a
    // fast-fingered player is not an attacker, and dropping a table's session
    // over an enthusiastic minute is worse than the problem it prevents.
    if (code === 'rate') return;

    if (code === 'expired') {
      wantOpen = false;
      closeSocket();
      reset();
      setState('offline', { code, detail: frame.detail });
      return;
    }

    if (TERMINAL_CODES.has(code)) {
      wantOpen = false;
      closeSocket();
      setState('failed', { code, detail: frame.detail });
    }
  }

  function readMessage(wire) {
    if (!room) return;
    decryptMessage(room, seen, wire).then(msg => {
      decryptFails = 0;
      handlePayload(msg);
    }).catch(() => {
      // Replays and tampered frames land here alongside wrong-key failures, and
      // they are indistinguishable by design. Counting rather than reporting is
      // the only way to tell a corrupted frame from a mistyped passphrase.
      if (++decryptFails === DECRYPT_FAIL_NOTICE_AT) {
        notice('Messages from this room cannot be read — check the passphrase');
      }
    });
  }

  function dropSocket() {
    closeSocket();
    if (!wantOpen) return;
    // Only on the first drop of an outage. scheduleRetry runs every backoff
    // step, and a notice per attempt would repeat this line every 30 seconds
    // for as long as the relay stayed down, which reads as a fault rather than
    // as the steady state it is.
    if (state !== 'retrying') notice('Relay unreachable — rolling locally');
    setState('retrying', {});
    scheduleRetry();
  }

  function scheduleRetry() {
    clearTimer(retryTimer);
    retryTimer = later(() => { if (wantOpen) openSocket(); }, backoffDelay(attempt++));
  }

  // Detaches the socket and, unless the caller says otherwise, closes it.
  //
  // leave() passes keepOpen because its goodbye is still being encrypted; it
  // closes the socket itself once that lands. Handlers are always detached
  // first, so a socket in that window can no longer deliver into the app.
  function closeSocket(keepOpen) {
    clearTimer(pingTimer); pingTimer = null;
    clearTimer(pongTimer); pongTimer = null;
    if (!ws) return;
    const dead = ws;
    ws = null;
    dead.onopen = dead.onmessage = dead.onclose = dead.onerror = null;
    if (!keepOpen) {
      try { dead.close(); } catch { /* already gone */ }
    }
  }

  function openSocket() {
    if (!room || !Socket) return;
    closeSocket();

    // A fresh sender on every connect. Reusing the old id with a counter reset
    // to zero puts a peer's replay guard into a state where either everything is
    // rejected as replayed or the guard has to be disabled — both worse than
    // appearing as a new participant, which is also the honest description of
    // what a reconnect is.
    sender = newSender();

    setState(attempt === 0 ? 'connecting' : 'retrying', {});

    let sock;
    try {
      // The room id goes in the query string as well as the join frame below.
      // The self-hosted relay reads it from the frame and ignores this; the
      // hosted one cannot, because a Durable Object is chosen by name before
      // the socket is accepted and there is no frame to read yet. Sending it
      // both ways lets one client speak to either relay.
      //
      // It is safe in a URL only because it is a hash: the passphrase itself
      // never leaves this device, and a room id cannot be reversed into one.
      sock = new Socket(room ? withRoom(url, room.roomId) : url);
    } catch {
      // A malformed URL throws here rather than firing onerror.
      dropSocket();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      sendFrame({ t: 'join', v: PROTOCOL_VERSION, room: room.roomId });
      clearTimer(pingTimer);
      pingTimer = later(heartbeat, PING_MS);
    };
    sock.onmessage = ev => {
      if (ws !== sock) return;
      // Binary frames carry nothing this protocol defines. Ignoring them beats
      // trying to coerce a Blob into a string on a path that must not throw.
      if (typeof ev.data === 'string') handleFrame(ev.data);
    };
    sock.onerror = () => { /* onclose always follows; handled there */ };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (state === 'failed') return;
      dropSocket();
    };
  }

  function reset() {
    clearAllTimers();
    clearTimer(retryTimer); retryTimer = null;
    pingTimer = null;
    pongTimer = null;
    ageTimer = null;
    room = null;
    sender = null;
    seen = new Map();
    selfId = null;
    expiresAt = null;
    attempt = 0;
    decryptFails = 0;
    badFrames = 0;
    if (members.size) { members.clear(); emitPresence(); }
  }

  const api = {
    get state() { return state; },
    get active() { return state === 'connecting' || state === 'live' || state === 'retrying'; },
    get name() { return name; },
    get members() { return [...members.values()].map(m => ({ ...m })); },
    get self() { return selfId; },
    get expires() { return expiresAt; },
    // How many messages in a row failed to decrypt. Exposed because the count
    // is the only observable trace of a frame being rejected — a caller waiting
    // for one to be processed has nothing else to watch, and waiting on elapsed
    // time instead is what made the tests flaky under load.
    get unreadable() { return decryptFails; },

    join(phrase) {
      if (!url) return Promise.reject(new Error('No relay is configured'));
      if (!Socket) return Promise.reject(new Error('WebSockets are unavailable'));

      // Leave first so a second join cannot leave the old socket delivering
      // messages this client can no longer decrypt.
      api.leave();

      const clean = normalizePassphrase(phrase);
      if (!clean) return Promise.reject(new Error('Passphrase is empty'));

      return deriveRoom(clean).then(derived => {
        room = derived;
        wantOpen = true;
        attempt = 0;
        clearTimer(ageTimer);
        ageTimer = later(ageTick, PRESENCE_SWEEP_MS);

        // Resolution rides on the state transition rather than a socket
        // handler, so a `joined` arriving after a reconnect settles this the
        // same as one on the first attempt.
        return new Promise((resolve, reject) => {
          joinWatcher = (next, info) => {
            if (next === 'live') {
              joinWatcher = null;
              resolve({ passphrase: clean, link: shareLink(clean) });
            } else if (next === 'failed') {
              joinWatcher = null;
              reject(new Error(info.code
                ? `Relay refused the room (${info.code})`
                : 'Could not join the room'));
            }
          };
          openSocket();
        });
      });
    },

    leave() {
      // The bye is encrypted, and encryption is async, so the socket cannot be
      // closed in this turn: closing here made every bye lose the race and the
      // frame never reached the wire at all. The socket is handed to the
      // encrypt chain, which sends the bye and the leave and then closes it.
      //
      // leave() itself stays synchronous and finishes the teardown immediately —
      // callers get `offline` on return, and the detached socket is no longer
      // referenced by anything that could deliver into the app.
      const departing = wantOpen && isOpen() ? ws : null;
      const key = room;
      const id = sender;

      if (departing && key && id) {
        encryptMessage(key, id, { k: 'bye', at: now() })
          .then(c => {
            if (departing.readyState !== 1) return;
            departing.send(JSON.stringify({ t: 'send', c }));
            departing.send(JSON.stringify({ t: 'leave' }));
          })
          .catch(() => {})
          .then(() => { try { departing.close(); } catch { /* already gone */ } });
      }

      wantOpen = false;
      closeSocket(!!departing);
      reset();
      setState('offline', {});
    },

    // The hot path. Synchronous, returns nothing, throws nothing.
    //
    // If the socket is down this is a no-op and the roll is NOT queued. A roll
    // that turns up ten minutes later is worse than one that never arrives — the
    // table has moved on, and a roll appearing out of nowhere reads as a replay.
    share(result) {
      if (!isOpen() || !room || !sender) return;
      if (!result || typeof result !== 'object') return;
      // A system roll (V5, Fate, …) has no single total to reduce to, so it goes
      // out as roll2 carrying its summary. Numeric rolls keep the original roll
      // schema, so a client still serving the old bundle from cache reads them
      // unchanged (and silently ignores the roll2 it doesn't know).
      // `id`, when present, lets a receiver on two transports at once (the relay
      // room and the Owlbear bus) drop the second copy. Optional, so an older
      // client that never sets it is unaffected.
      const sys = result.system;
      if (sys && sys !== 'numeric') {
        sendEncrypted({
          k: 'roll2',
          at: now(),
          id: result.rollId,
          name,
          system: sys,
          notation: result.notation,
          groups: result.groups,
          summary: result.summary,
          ...(typeof result.parentId === 'string' ? { parentId: result.parentId } : {}),
          ...(result.transition && typeof result.transition === 'object' ? { transition: result.transition } : {}),
        });
        return;
      }
      sendEncrypted({
        k: 'roll',
        at: now(),
        id: result.rollId,
        name,
        notation: result.notation,
        total: result.total,
        groups: result.groups,
      });
    },

    setName(next) {
      const clean = cleanName(next);
      if (!clean || clean === name) return;
      name = clean;
      if (state === 'live') sendHello(false);
    },

    setUrl(next) { url = String(next || ''); },
  };

  function shareLink(phrase) {
    if (typeof location === 'undefined') return '#' + phrase;
    return location.origin + location.pathname + '#' + phrase;
  }

  return api;
}
