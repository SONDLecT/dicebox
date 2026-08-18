// Owlbear-only background service. This module is copied into the VTT artifact
// but is never imported by the standalone Dicebox page.
import { roll, parseNotation } from './dice.js';
import {
  rollAny, detectSystem, rollRouse, resolveMothershipStress,
  parseV5, parseMothership, surgeV5,
  pushYearZero, pushBladeRunner, pushTwilight,
  parseCards, parseTarot, parseNapoletane, parseHanafuda, parseUtagaruta,
  newDeckOrder, summarizeCards, summarizeTarot, randInt,
} from './system-dice.js';
import { validateRoll, validateSystemRoll } from './room.js';
import { rollOracle, oracleSlug, findOracleBySlug } from './oracle-dice.js';
import { createOwlbearHistoryStore } from './owlbear-history.js';
import { flattenRollDice } from './tray-faces.js';
import { createSharedDecks } from './shared-decks.js';
import { formatHeadline, formatDetail } from './result-text.js';
import { getOrCreateLocalAuthSecret, signLocalPayload, signedLocalWireBytes } from './owlbear-auth.js';

export const OBR_CHANNEL = 'cc.dicebox.rolls';
export const OBR_PROTOCOL_VERSION = 1;
// The per-room synced history is a shared, persisted cache: it lives in
// IndexedDB, and a panel re-pages the whole of it on open. So it is bounded
// generously — tens of thousands of rolls, far past the old 500 — but not
// unbounded, since every byte here is re-synced on each panel open and stored
// per room. The standalone app's own visible log is capped separately and far
// higher.
const HISTORY_LIMIT = 20_000;
const HISTORY_PREFIX = 'dicebox:obr:history:v1:';
// Owlbear's hard Broadcast ceiling is 16 KiB. Keep substantial room for its
// routing envelope and future protocol fields rather than balancing on the cap.
const MAX_WIRE_BYTES = 12_000;
const MAX_HISTORY_BYTES = 8_000_000;
const MAX_PUBLIC_DICE = 100;
const MAX_PUBLIC_TERMS = 64;
// Reroll-below modifiers can turn a small encoded pool into millions of random
// draws. Bound expected work before entering the synchronous numeric engine.
const MAX_PUBLIC_EXPECTED_DRAWS = 1_000;

function wireBytes(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; }
  catch { return Infinity; }
}

function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* memory still serves this room */ }
}

function validRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 96;
}

const LOCAL_RESPONSE_TYPES = new Set(['roll.result', 'action.result', 'history.result', 'roll.error']);

class BridgeTimeoutError extends Error {
  constructor() { super('Dicebox request timed out'); this.name = 'BridgeTimeoutError'; }
}

async function withTimeout(operation, milliseconds) {
  let timer, active = true;
  const assertActive = () => { if (!active) throw new BridgeTimeoutError(); };
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(assertActive)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new BridgeTimeoutError()), milliseconds); }),
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
  }
}

function normalizeRoll(data) {
  if (!data || typeof data !== 'object' || typeof data.notation !== 'string') return null;
  const system = typeof data.system === 'string' ? data.system : 'numeric';
  const wire = system === 'numeric'
    ? { notation: data.notation, total: data.total, groups: data.groups }
    : { system, notation: data.notation, groups: data.groups, summary: data.summary };
  if (system === 'numeric' ? !validateRoll(wire) : !validateSystemRoll(wire)) return null;
  return {
    id: typeof data.id === 'string' && data.id.length <= 128 ? data.id : null,
    system,
    notation: data.notation,
    groups: data.groups,
    summary: data.summary ?? null,
    total: data.total ?? null,
    who: typeof data.who === 'string' ? data.who.slice(0, 40) : 'Someone',
    at: Number.isFinite(data.at) ? data.at : Date.now(),
    ...(typeof data.parentId === 'string' ? { parentId: data.parentId.slice(0, 128) } : {}),
  };
}

function loadHistory(storage, key) {
  try {
    const saved = JSON.parse(safeGet(storage, key) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.map(normalizeRoll).filter(Boolean).slice(-HISTORY_LIMIT);
  } catch { return []; }
}

function historyPayloads(history, requestId, state) {
  const pages = [];
  let rolls = [];
  // Pass one only probes sizes, so this envelope is a worst-case stand-in: the
  // 9999 pageCount is the widest the field can print, which means a page that
  // fits under the cap here can never overflow when the real (smaller) count is
  // stamped in below.
  const envelope = (pageRolls, page, pageState) => ({
    v: OBR_PROTOCOL_VERSION, type: 'history.result', requestId,
    page, pageCount: 9999, done: false, rolls: pageRolls,
    ...(pageState ? { state: pageState } : {}),
  });
  for (const roll of history) {
    const pageState = pages.length === 0 ? state : null;
    if (signedLocalWireBytes(envelope([...rolls, roll], pages.length, pageState)) <= MAX_WIRE_BYTES) {
      rolls.push(roll);
      continue;
    }
    // If the state snapshot and one record do not fit together, emit a state-only
    // first page and retry the record on the next page rather than losing either.
    if (!rolls.length && pages.length === 0 && pageState
        && signedLocalWireBytes(envelope([], 0, pageState)) <= MAX_WIRE_BYTES) {
      pages.push([]);
    } else if (rolls.length) {
      pages.push(rolls);
    }
    rolls = signedLocalWireBytes(envelope([roll], pages.length, null)) <= MAX_WIRE_BYTES ? [roll] : [];
    // A single over-limit record is never emitted. remember() rejects these for
    // new input; this branch safely skips one left by an older build.
  }
  if (rolls.length || !pages.length) pages.push(rolls);
  const pageCount = pages.length;
  return pages.map((pageRolls, index) => ({
    v: OBR_PROTOCOL_VERSION,
    type: 'history.result',
    requestId,
    page: index,
    pageCount,
    done: index === pageCount - 1,
    rolls: pageRolls,
    ...(index === 0 && state ? { state } : {}),
  }));
}



async function drawPlayingCards(decks, notation, assertActive) {
  const parsed = parseCards(notation);
  const art = await import('./cards-art.js');
  assertActive();
  const key = 'dicebox:deck:v1';
  const fresh = {
    order: [], pos: 0, jokers: false, replace: false, draw: 1,
    pile: [], hand: [], handReplace: false,
  };
  let state = { ...fresh };
  const saved = decks.get(key);
  if (saved && Array.isArray(saved.order) && saved.order.every(id => typeof id === 'string')) {
    state = { ...fresh, ...saved };
    if (!Array.isArray(state.pile)) state.pile = [];
    if (!Array.isArray(state.hand)) state.hand = [];
  }

  const ids = () => art.CARD_IDS.slice(0, state.jokers ? 54 : 52);
  const shuffle = () => {
    state.order = newDeckOrder(ids());
    state.pos = 0;
    state.pile = [];
    state.hand = [];
  };
  if (parsed.jokers !== state.jokers) {
    state.jokers = parsed.jokers;
    shuffle();
  }
  state.replace = parsed.replace;
  state.draw = parsed.draw;
  if (!state.order.length) shuffle();

  let drawnIds;
  if (state.replace) {
    const pool = state.order.slice(state.pos);
    drawnIds = pool.length
      ? Array.from({ length: parsed.draw }, () => pool[randInt(pool.length) - 1])
      : [];
  } else {
    drawnIds = state.order.slice(state.pos, state.pos + parsed.draw);
    state.pos += drawnIds.length;
  }
  if (state.hand.length && !state.handReplace) state.pile.push(...state.hand);
  state.hand = drawnIds.slice();
  state.handReplace = state.replace;
  assertActive();
  decks.set(key, state);

  const drawn = drawnIds.map(id => {
    const meta = art.cardMeta(id);
    return { id, label: meta.label, red: !!meta.red };
  });
  const remaining = Math.max(0, state.order.length - state.pos);
  let canonical = `deck:${state.draw}`;
  if (state.jokers) canonical += ' jokers';
  if (state.replace) canonical += ' replace';
  return {
    schema: 2,
    system: 'cards',
    notation: canonical,
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, remaining, state.order.length),
  };
}

async function drawTarot(decks, notation, assertActive) {
  const parsed = parseTarot(notation);
  const art = await import('./tarot-art.js');
  assertActive();
  const key = 'dicebox:tarot:v1';
  const fresh = {
    order: [], revs: [], pos: 0, reversals: true, majors: false,
    replace: false, draw: 1, pile: [], hand: [], handReplace: false,
  };
  let state = { ...fresh };
  const saved = decks.get(key);
  if (saved && Array.isArray(saved.order) && saved.order.every(id => typeof id === 'string')) {
    state = { ...fresh, ...saved };
    if (!Array.isArray(state.revs)) state.revs = [];
    if (!Array.isArray(state.pile)) state.pile = [];
    if (!Array.isArray(state.hand)) state.hand = [];
  }
  const ids = () => state.majors ? art.TAROT_IDS.slice(0, 22) : art.TAROT_IDS.slice();
  const shuffle = () => {
    state.order = newDeckOrder(ids());
    state.revs = state.order.map(() => state.reversals && randInt(2) === 1);
    state.pos = 0;
    state.pile = [];
    state.hand = [];
  };
  const compositionChanged = parsed.majors !== state.majors || parsed.reversals !== state.reversals;
  state.majors = parsed.majors;
  state.reversals = parsed.reversals;
  state.replace = parsed.replace;
  state.draw = parsed.draw;
  if (compositionChanged || !state.order.length) shuffle();

  let indexes;
  if (state.replace) {
    const remaining = state.order.length - state.pos;
    indexes = remaining > 0
      ? Array.from({ length: parsed.draw }, () => state.pos + randInt(remaining) - 1)
      : [];
  } else {
    const take = Math.min(parsed.draw, state.order.length - state.pos);
    indexes = Array.from({ length: take }, (_, i) => state.pos + i);
    state.pos += take;
  }
  const cards = indexes.map(index => ({ id: state.order[index], rev: !!state.revs[index] }));
  if (state.hand.length && !state.handReplace) state.pile.push(...state.hand);
  state.hand = cards.map(card => ({ ...card }));
  state.handReplace = state.replace;
  assertActive();
  decks.set(key, state);

  const drawn = cards.map(card => {
    const meta = art.tarotMeta(card.id);
    return { id: card.id, label: meta.label, rev: card.rev };
  });
  const remaining = Math.max(0, state.order.length - state.pos);
  let canonical = `tarot:${state.draw}`;
  if (state.majors) canonical += ' majors';
  if (!state.reversals) canonical += ' upright';
  if (state.replace) canonical += ' replace';
  return {
    schema: 2,
    system: 'tarot',
    notation: canonical,
    // kind 'cards', exactly as the panel's own tarot deal goes on the wire —
    // the shape validators accept one card-group kind for every deck.
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeTarot(drawn, remaining, state.order.length),
  };
}

async function drawSimpleDeck(decks, notation, config, assertActive) {
  const parsed = config.parse(notation);
  const art = await import(config.module);
  assertActive();
  const ids = art[config.ids].slice();
  const meta = art[config.meta];
  const fresh = {
    order: [], pos: 0, replace: false, draw: 1,
    pile: [], hand: [], handReplace: false,
    ...(config.lang ? { lang: 'both' } : {}),
  };
  let state = { ...fresh };
  const saved = decks.get(config.key);
  if (saved && Array.isArray(saved.order) && saved.order.every(id => typeof id === 'string')) {
    state = { ...fresh, ...saved };
    if (!Array.isArray(state.pile)) state.pile = [];
    if (!Array.isArray(state.hand)) state.hand = [];
  }
  state.replace = parsed.replace;
  state.draw = parsed.draw;
  if (config.lang) state.lang = parsed.lang;
  if (!state.order.length || state.order.some(id => !ids.includes(id))) {
    state.order = newDeckOrder(ids);
    state.pos = 0;
    state.pile = [];
    state.hand = [];
  }
  let drawnIds;
  if (state.replace) {
    const pool = state.order.slice(state.pos);
    drawnIds = pool.length
      ? Array.from({ length: parsed.draw }, () => pool[randInt(pool.length) - 1])
      : [];
  } else {
    drawnIds = state.order.slice(state.pos, state.pos + parsed.draw);
    state.pos += drawnIds.length;
  }
  if (state.hand.length && !state.handReplace) state.pile.push(...state.hand);
  state.hand = drawnIds.slice();
  state.handReplace = state.replace;
  assertActive();
  decks.set(config.key, state);

  const drawn = drawnIds.map(id => ({ id, label: meta(id).label, red: false }));
  const remaining = Math.max(0, state.order.length - state.pos);
  let canonical = `${config.prefix}:${state.draw}`;
  if (config.lang && state.lang !== 'both') canonical += ` ${state.lang}`;
  if (state.replace) canonical += ' replace';
  return {
    schema: 2,
    system: config.system,
    notation: canonical,
    groups: [{ kind: 'cards', count: drawn.length, cards: drawn }],
    summary: summarizeCards(drawn, remaining, state.order.length),
  };
}

const SIMPLE_DECKS = {
  napoletane: {
    parse: parseNapoletane, module: './nap-art.js', ids: 'NAP_IDS', meta: 'napMeta',
    key: 'dicebox:nap:v1', prefix: 'nap', system: 'napoletane',
  },
  hanafuda: {
    parse: parseHanafuda, module: './hana-art.js', ids: 'HANA_IDS', meta: 'hanaMeta',
    key: 'dicebox:hana:v1', prefix: 'hana', system: 'hanafuda',
  },
  utagaruta: {
    parse: parseUtagaruta, module: './uta-art.js', ids: 'UTA_IDS', meta: 'utaMeta',
    key: 'dicebox:uta:v1', prefix: 'uta', system: 'utagaruta', lang: true,
  },
};

async function drawOracle(notation, game, assertActive) {
  const selected = game === 'starforged' ? 'starforged' : game === 'ironsworn' || game == null ? 'ironsworn' : null;
  if (!selected) throw new Error('Oracle game must be ironsworn or starforged');
  const module = selected === 'starforged'
    ? await import('./starforged-oracles.js')
    : await import('./ironsworn-oracles.js');
  assertActive();
  const dataset = selected === 'starforged' ? module.STARFORGED_ORACLES : module.IRONSWORN_ORACLES;
  const query = String(notation).slice(String(notation).indexOf(':') + 1).trim();
  const tableId = findOracleBySlug(dataset, query);
  if (!tableId) throw new Error(`No ${selected} oracle table matches "${query}"`);
  const node = rollOracle(dataset, tableId);
  return {
    schema: 2,
    system: 'oracle',
    notation: 'oracle:' + oracleSlug(dataset, node.id),
    groups: [{
      kind: 'dice', dieType: 'oracle', sides: node.sides, count: 1,
      dice: [{ value: node.roll, sides: node.sides, kept: true, rerolled: false, exploded: false }],
    }],
    summary: node,
  };
}

async function resetDeck(decks, deck, assertActive, notation = null) {
  const merged = (key, defaults) => ({ ...defaults, ...(decks.get(key) || {}) });
  let key, state, ids;
  if (deck === 'cards') {
    key = 'dicebox:deck:v1';
    let saved = merged(key, { jokers: false, replace: false, draw: 1 });
    if (notation) saved = { ...saved, ...parseCards(notation) };
    const art = await import('./cards-art.js');
    ids = art.CARD_IDS.slice(0, saved.jokers ? 54 : 52);
    state = { ...saved, order: newDeckOrder(ids), pos: 0, pile: [], hand: [], handReplace: false };
  } else if (deck === 'tarot') {
    key = 'dicebox:tarot:v1';
    let saved = merged(key, { majors: false, reversals: true, replace: false, draw: 1 });
    if (notation) saved = { ...saved, ...parseTarot(notation) };
    const art = await import('./tarot-art.js');
    ids = art.TAROT_IDS.slice(0, saved.majors ? 22 : 78);
    const order = newDeckOrder(ids);
    state = {
      ...saved, order, revs: order.map(() => saved.reversals && randInt(2) === 1),
      pos: 0, pile: [], hand: [], handReplace: false,
    };
  } else {
    const config = SIMPLE_DECKS[deck];
    if (!config) throw new Error('Unknown Dicebox deck');
    key = config.key;
    let saved = merged(key, { replace: false, draw: 1, lang: 'both' });
    if (notation) saved = { ...saved, ...config.parse(notation) };
    const art = await import(config.module);
    ids = art[config.ids].slice();
    state = { ...saved, order: newDeckOrder(ids), pos: 0, pile: [], hand: [], handReplace: false };
  }
  assertActive();
  decks.set(key, state);
  return { deck, remaining: ids.length, total: ids.length };
}

// The toast reads a roll with the same formatters the panel's readout uses —
// headline on top, the detail line beneath — falling back to the notation only
// if a malformed roll makes them throw.
function toastText(roll) {
  const shaped = { ...roll, system: roll.system || 'numeric' };
  let head, sub;
  try { head = String(formatHeadline(shaped).text); } catch { head = null; }
  try { sub = String(formatDetail(shaped)); } catch { sub = null; }
  return {
    head: (head || String(roll.total ?? roll.notation ?? 'Roll')).slice(0, 60),
    sub: (sub || String(roll.notation || '')).slice(0, 170),
  };
}

// Card systems the toast can show the actual cards for, with the drawn ids
// (and tarot's reversal flag) as its payload.
const TOAST_DECKS = new Set(['cards', 'tarot', 'napoletane', 'hanafuda', 'utagaruta']);
function toastCards(roll) {
  if (!TOAST_DECKS.has(roll.system) || !Array.isArray(roll.groups)) return null;
  const cards = roll.groups
    .filter(group => group && group.kind === 'cards' && Array.isArray(group.cards))
    .flatMap(group => group.cards)
    .filter(card => card && typeof card.id === 'string')
    .slice(0, 6)
    .map(card => ({ id: card.id, ...(card.rev ? { rev: true } : {}) }));
  return cards.length ? { system: roll.system, cards } : null;
}

export async function initializeOwlbearBackground(OBR, options = {}) {
  if (!OBR?.broadcast?.onMessage || !OBR?.broadcast?.sendMessage) {
    throw new Error('Owlbear Broadcast API is unavailable');
  }
  // Reaching localStorage can itself throw inside a third-party iframe with
  // strict storage settings; the popover guards this and the background must
  // too, or the whole service dies on the read. Memory alone still serves.
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const rollAnyFn = options.rollAny ?? rollAny;
  const rollRouseFn = options.rollRouse ?? rollRouse;
  // One deck on the table: state shared through room metadata when the API is
  // there, this client's storage otherwise. Its first metadata read is awaited
  // briefly so the opening draw comes off the room's deck, not a stale local.
  const decks = createSharedDecks(OBR, storage);
  try { await withTimeout(() => decks.ready, 1_500); } catch { /* local decks serve */ }
  const storedHunger = Number(safeGet(storage, 'dicebox:v5:hunger'));
  const storedStress = Number(safeGet(storage, 'dicebox:ms:stress'));
  const trackedState = {
    hunger: Number.isFinite(storedHunger) && storedHunger >= 0 && storedHunger <= 5 ? Math.round(storedHunger) : 0,
    stress: Number.isFinite(storedStress) && storedStress >= 2 && storedStress <= 20 ? Math.round(storedStress) : 2,
  };
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
    ? Math.max(1, Math.min(10_000, options.requestTimeoutMs)) : 4_000;
  let [connectionId, playerName] = await Promise.all([
    OBR.player.getConnectionId(),
    Promise.resolve().then(() => OBR.player.getName()).catch(() => 'Someone'),
  ]);
  // The room id is a PROPERTY on the SDK's RoomApi (`get id`), not a getId()
  // method — calling the method that does not exist was a TypeError that killed
  // this whole service at init on every real client, while the test mock
  // happily supplied one. Accept either shape so a future SDK can move it.
  const roomId = typeof OBR.room?.id === 'string' && OBR.room.id
    ? OBR.room.id
    : (typeof OBR.room?.getId === 'function' ? await OBR.room.getId() : '');
  if (typeof roomId !== 'string' || !roomId.trim() || roomId.length > 128) {
    throw new Error('Owlbear room identity is unavailable');
  }
  // The connection id rotates on every disconnect/reconnect, and requests are
  // gated on it — a stale cache would make the service reject its own player's
  // panel until the room reloaded. The local player listener keeps it fresh.
  let unsubscribePlayer = null;
  try {
    if (typeof OBR.player?.onChange === 'function') {
      unsubscribePlayer = OBR.player.onChange(p => {
        if (typeof p?.connectionId === 'string' && p.connectionId) connectionId = p.connectionId;
        if (typeof p?.name === 'string' && p.name) playerName = p.name;
      });
    }
  } catch { /* a fixed id serves until the next reload, as before */ }
  const historyKey = HISTORY_PREFIX + roomId;
  const historyStore = options.historyStore ?? createOwlbearHistoryStore();
  // Ensure this origin has provisioned a key before the first local response.
  getOrCreateLocalAuthSecret(storage);
  const legacyHistory = loadHistory(storage, historyKey);
  let storedHistory = [];
  try { storedHistory = await withTimeout(() => historyStore.load(roomId), Math.min(requestTimeoutMs, 1_000)); }
  catch { /* fall back to the guarded legacy cache below */ }
  const hasStoredHistory = Array.isArray(storedHistory) && storedHistory.length > 0;
  const history = (hasStoredHistory ? storedHistory : legacyHistory)
    .map(normalizeRoll).filter(Boolean).slice(-HISTORY_LIMIT);
  const ids = new Set(history.map(roll => roll.id).filter(Boolean));
  // The serialized size is tracked incrementally — one wireBytes per roll as it
  // arrives or leaves — so the byte cap costs nothing per roll no matter how
  // large the history grows. Re-encoding the whole array on every roll would
  // have made a big cap quadratic.
  let historyBytes = history.reduce((sum, roll) => sum + wireBytes(roll), 0);
  let closed = false, persistInFlight = false, persistDirty = false, fallbackScheduled = false;

  // History mutation is synchronous and persistence is one coalesced writer.
  // Message handlers never await IndexedDB, so a blocked browser transaction
  // cannot fan out into unbounded saves or hold the protocol queue forever.
  const schedulePersistence = () => {
    persistDirty = true;
    if (!fallbackScheduled) {
      fallbackScheduled = true;
      queueMicrotask(() => {
        fallbackScheduled = false;
        if (!closed) safeSet(storage, historyKey, JSON.stringify(history));
      });
    }
    if (persistInFlight || closed) return;
    persistInFlight = true;
    queueMicrotask(async () => {
      while (persistDirty && !closed) {
        persistDirty = false;
        const snapshot = history.slice();
        try { await historyStore.save(roomId, snapshot); }
        catch { /* guarded local fallback is already current */ }
      }
      persistInFlight = false;
      if (persistDirty && !closed) schedulePersistence();
    });
  };
  if (!hasStoredHistory && history.length) schedulePersistence();

  // The corner roll window, the way the native dice app shows results: a small
  // popover the background opens over the game for every completed roll — yours
  // and the table's — so rolls read without the panel open. One at a time, a
  // few seconds each, click to dismiss. Guarded on the API so a host (or test)
  // without popovers simply never shows one.
  const TOAST_ID = 'cc.dicebox/toast';
  const TOAST_MS = 5_000;
  let toastTimer = null;
  // The toast stands in for a closed panel. With the action popover open the
  // roll is already animating full-size on the tray, so the corner window
  // would only repeat it — the background watches the popover's open state and
  // holds its toasts while it shows.
  let actionOpen = false;
  let unsubscribeAction = null;
  try {
    if (typeof OBR.action?.isOpen === 'function') {
      Promise.resolve(OBR.action.isOpen()).then(open => { actionOpen = !!open; }).catch(() => {});
    }
    if (typeof OBR.action?.onOpenChange === 'function') {
      unsubscribeAction = OBR.action.onOpenChange(open => {
        actionOpen = !!open;
        // Opening the panel also retires a toast already on screen — the roll
        // it shows is about to be on the tray.
        if (actionOpen && toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
          try { Promise.resolve(OBR.popover.close(TOAST_ID)).catch(() => {}); } catch { /* gone */ }
        }
      });
    }
  } catch { /* no open-state signal; toasts simply always show */ }
  const showToast = roll => {
    if (closed || actionOpen || !OBR.popover?.open || !roll) return;
    try {
      // The dice travel as the tray's own paint list — flattenRollDice output,
      // pruned — plus the summary fields the shared stamping tints from, so the
      // toast replays the throw in the exact colours and faces the roller's
      // tray showed. Card draws carry no dice and get the text-only window.
      const flat = Array.isArray(roll.groups)
        ? flattenRollDice(roll).filter(die => Number.isFinite(die.value)).slice(0, 14)
        : [];
      const text = toastText(roll);
      const cards = toastCards(roll);
      const query = new URLSearchParams({
        who: String(roll.who || 'Someone').slice(0, 40),
        head: text.head,
        sub: text.sub,
      });
      if (flat.length) {
        const s = roll.summary && typeof roll.summary === 'object' ? roll.summary : {};
        query.set('r', JSON.stringify({
          system: roll.system || 'numeric',
          summary: {
            weary: s.weary, band: s.band, outcome: s.outcome, success: s.success,
            modifier: s.modifier, mode: s.mode, panicked: s.panicked,
          },
          flat,
        }));
      }
      if (cards) query.set('c', JSON.stringify(cards));
      Promise.resolve(OBR.popover.open({
        id: TOAST_ID,
        url: `/toast.html?${query}`,
        width: 272,
        height: flat.length || cards ? 182 : 96,
        // Anchored to a point far past the page corner and clamped back inside
        // it, which is what pins the window bottom-right at any viewport size.
        anchorReference: 'POSITION',
        anchorPosition: { left: 1_000_000, top: 1_000_000 },
        transformOrigin: { horizontal: 'RIGHT', vertical: 'BOTTOM' },
        hidePaper: true,
        disableClickAway: true,
        marginThreshold: 16,
      })).catch(() => {});
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastTimer = null;
        try { Promise.resolve(OBR.popover.close(TOAST_ID)).catch(() => {}); } catch { /* gone */ }
      }, TOAST_MS);
    } catch { /* a roll without its window is still a roll */ }
  };

  const remember = async data => {
    const roll = normalizeRoll(data);
    if (!roll || wireBytes(roll) > MAX_WIRE_BYTES) return null;
    if (roll.id && ids.has(roll.id)) return roll;
    if (!Number.isFinite(roll.at)) roll.at = now();
    history.push(roll);
    if (roll.id) ids.add(roll.id);
    historyBytes += wireBytes(roll);
    while (history.length > HISTORY_LIMIT || historyBytes > MAX_HISTORY_BYTES) {
      const dropped = history.shift();
      if (!dropped) break;
      historyBytes -= wireBytes(dropped);
      if (dropped.id && !history.some(item => item.id === dropped.id)) ids.delete(dropped.id);
    }
    schedulePersistence();
    return roll;
  };

  const requested = new Map();
  const consumedPushes = new Set();
  // A Blood Surge is one-shot per roll too, tracked apart from pushes so the
  // two follow-ups can never spend each other.
  const consumedSurges = new Set();
  // Only outcomes produced by this coordinator can authorize follow-up actions.
  // Remote table events are display/history data, never an authority source.
  const actionSources = new Map();
  const requestSignature = data => data.type === 'roll.request'
    ? JSON.stringify(['roll', data.notation, data.game ?? null])
    : JSON.stringify(['action', data.action, data.rollId ?? null, data.deck ?? null, data.state ?? null, data.notation ?? null]);
  const requestTimes = [];
  const historyTimes = [];
  const publishedTimes = [];
  const admitInWindow = (times, limit) => {
    const stamp = now();
    while (times.length && times[0] <= stamp - 10_000) times.shift();
    if (times.length >= limit) return false;
    times.push(stamp);
    return true;
  };
  const admitRequest = () => admitInWindow(requestTimes, 20);
  const admitHistoryRequest = () => admitInWindow(historyTimes, 2);
  const admitPublishedEvent = () => admitInWindow(publishedTimes, 100);
  const executeNotation = async (notation, request = {}, assertActive = () => {}) => {
    if (typeof notation !== 'string' || notation.length === 0 || notation.length > 512) {
      throw new Error('Notation must be 1 to 512 characters');
    }
    if (/^v5:rouse2?$/i.test(notation.trim())) {
      const result = rollRouseFn(/2$/i.test(notation.trim()) ? 2 : 1);
      const hunger = trackedState.hunger;
      const tracked = hunger > 0;
      result.summary.tracked = tracked;
      if (tracked) {
        const next = Math.min(5, hunger + Number(result.summary.hungerGain || 0));
        assertActive();
        trackedState.hunger = next;
        safeSet(storage, 'dicebox:v5:hunger', String(next));
        result.summary.hungerAfter = next;
        result.summary.hungerRose = next > hunger;
      }
      return result;
    }
    const system = detectSystem(notation);
    if (system === 'numeric') {
      const { terms } = parseNotation(notation);
      const dice = terms.reduce((total, term) => total + (term.kind === 'dice' ? term.count : 0), 0);
      if (terms.length > MAX_PUBLIC_TERMS || dice > MAX_PUBLIC_DICE) {
        throw new Error(`The public Owlbear bridge allows at most ${MAX_PUBLIC_DICE} dice and ${MAX_PUBLIC_TERMS} terms`);
      }
      const expectedDraws = terms.reduce((total, term) => {
        if (term.kind !== 'dice') return total;
        const threshold = term.mods?.rerollBelow;
        const rerollFactor = Number.isInteger(threshold) && threshold >= 1 && threshold < term.sides
          ? term.sides / (term.sides - threshold) : 1;
        const explosionFactor = term.mods?.explode ? term.sides / (term.sides - 1) : 1;
        return total + term.count * rerollFactor * explosionFactor;
      }, 0);
      if (!Number.isFinite(expectedDraws) || expectedDraws > MAX_PUBLIC_EXPECTED_DRAWS) {
        throw new Error(`The public Owlbear bridge allows at most ${MAX_PUBLIC_EXPECTED_DRAWS} expected random draws`);
      }
    }
    if (system === 'oracle') return drawOracle(notation, request.game, assertActive);
    if (system === 'cards') return drawPlayingCards(decks, notation, assertActive);
    if (system === 'tarot') return drawTarot(decks, notation, assertActive);
    if (SIMPLE_DECKS[system]) return drawSimpleDeck(decks, notation, SIMPLE_DECKS[system], assertActive);

    let authoritativeNotation = notation;
    if (system === 'v5') {
      const parsed = parseV5(notation);
      const tracked = trackedState.hunger;
      authoritativeNotation = `v5:${parsed.pool}h${Math.min(parsed.pool, tracked)}`
        + (parsed.difficulty === null ? '' : `@${parsed.difficulty}`);
    } else if (system === 'mothership') {
      const parsed = parseMothership(notation);
      if (parsed.mode === 'panic') {
        const stress = trackedState.stress;
        authoritativeNotation = `ms:p@${stress}${parsed.advantage || ''}`;
      }
    }

    const result = await rollAnyFn(authoritativeNotation);
    assertActive();
    const completed = result?.deferred ? roll(authoritativeNotation) : result;
    if (!completed || typeof completed !== 'object') throw new Error('Dicebox could not resolve this notation');
    if (completed.system === 'mothership' && completed.summary?.stressDelta) {
      const resolved = resolveMothershipStress(trackedState.stress, completed.summary.stressDelta);
      assertActive();
      trackedState.stress = resolved.stress;
      safeSet(storage, 'dicebox:ms:stress', String(resolved.stress));
      completed.summary.stressAfter = resolved.stress;
      completed.summary.stressOverflow = resolved.overflow;
    }
    return completed;
  };

  const compactDeckState = (key, defaults, total) => {
    const saved = decks.get(key);
    const state = saved && typeof saved === 'object' ? { ...defaults, ...saved } : defaults;
    const size = Array.isArray(state.order) && state.order.length ? state.order.length : total;
    const pos = Number.isInteger(state.pos) ? Math.max(0, Math.min(size, state.pos)) : 0;
    return {
      total: size,
      remaining: Math.max(0, size - pos),
      draw: Number.isInteger(state.draw) ? state.draw : defaults.draw,
      replace: !!state.replace,
      ...(Object.hasOwn(defaults, 'jokers') ? { jokers: !!state.jokers } : {}),
      ...(Object.hasOwn(defaults, 'majors') ? { majors: !!state.majors, reversals: state.reversals !== false } : {}),
      ...(Object.hasOwn(defaults, 'lang') ? { lang: ['both', 'en', 'ja'].includes(state.lang) ? state.lang : 'both' } : {}),
    };
  };
  const stateSnapshot = () => ({
    hunger: trackedState.hunger,
    stress: trackedState.stress,
    decks: {
      cards: compactDeckState('dicebox:deck:v1', { draw: 1, replace: false, jokers: false }, 52),
      tarot: compactDeckState('dicebox:tarot:v1', { draw: 1, replace: false, majors: false, reversals: true }, 78),
      napoletane: compactDeckState('dicebox:nap:v1', { draw: 1, replace: false }, 40),
      hanafuda: compactDeckState('dicebox:hana:v1', { draw: 1, replace: false }, 48),
      utagaruta: compactDeckState('dicebox:uta:v1', { draw: 1, replace: false, lang: 'both' }, 100),
    },
  });

  const sendMessage = async (payload, sendOptions) => {
    let outgoing = payload;
    if (sendOptions?.destination === 'LOCAL' && LOCAL_RESPONSE_TYPES.has(payload?.type)) {
      const authSecret = getOrCreateLocalAuthSecret(storage);
      outgoing = { ...payload, auth: await signLocalPayload(authSecret, payload) };
    }
    if (wireBytes(outgoing) > MAX_WIRE_BYTES) throw new Error('Owlbear message exceeds Dicebox wire limit');
    return withTimeout(
      () => OBR.broadcast.sendMessage(OBR_CHANNEL, outgoing, sendOptions),
      requestTimeoutMs,
    );
  };

  const errorResponse = (requestId, code, error) => ({
    v: OBR_PROTOCOL_VERSION,
    type: 'roll.error',
    requestId,
    code,
    message: String(error?.message || error || code).slice(0, 240),
  });
  const sendError = (requestId, code, error) => sendMessage(
    errorResponse(requestId, code, error), { destination: 'LOCAL' });
  const failRequest = (requestId, signature, code, error) => {
    const response = errorResponse(requestId, code, error);
    requested.set(requestId, { signature, response });
    if (requested.size > 400) requested.delete(requested.keys().next().value);
    return sendMessage(response, { destination: 'LOCAL' });
  };

  const handle = async event => {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (wireBytes(data) > MAX_WIRE_BYTES) {
      if (event.connectionId === connectionId && validRequestId(data.requestId)
          && data.v === OBR_PROTOCOL_VERSION
          && (data.type === 'roll.request' || data.type === 'action.request')) {
        await sendError(data.requestId, 'request_too_large', 'Dicebox request exceeds the public bridge limit');
      }
      return;
    }

    if (data.v === OBR_PROTOCOL_VERSION && data.type === 'roll.request') {
      if (event.connectionId !== connectionId || !validRequestId(data.requestId)) return;
      if (!admitRequest()) {
        await sendError(data.requestId, 'rate_limited', 'Too many Dicebox requests; try again shortly');
        return;
      }
      const signature = requestSignature(data);
      const previous = requested.get(data.requestId);
      if (previous) {
        if (previous.signature !== signature) {
          await sendError(data.requestId, 'request_id_conflict', 'This request ID was already used for different work');
          return;
        }
        if (!previous.response) {
          await sendError(data.requestId, 'request_in_progress', 'This request is still running');
          return;
        }
        await sendMessage(previous.response, { destination: 'LOCAL' });
        return;
      }
      requested.set(data.requestId, { signature, response: null });
      let result;
      try { result = await withTimeout(assertActive => executeNotation(data.notation, data, assertActive), requestTimeoutMs); }
      catch (error) {
        await failRequest(data.requestId, signature,
          error instanceof BridgeTimeoutError ? 'timeout' : 'invalid_request', error);
        return;
      }
      const completed = {
        v: OBR_PROTOCOL_VERSION,
        type: 'roll.result',
        requestId: data.requestId,
        id: String(makeId()).slice(0, 128),
        system: result.system || 'numeric',
        notation: result.notation,
        groups: result.groups,
        summary: result.summary ?? null,
        total: result.total ?? null,
        who: String(playerName || 'Someone').slice(0, 40),
        at: now(),
        state: stateSnapshot(),
      };
      if (signedLocalWireBytes(completed) > MAX_WIRE_BYTES) {
        await failRequest(data.requestId, signature, 'result_too_large', 'Dicebox result exceeds Owlbear’s message limit');
        return;
      }
      requested.set(data.requestId, { signature, response: completed });
      if (requested.size > 400) requested.delete(requested.keys().next().value);
      await remember(completed);
      actionSources.set(completed.id, normalizeRoll(completed));
      if (actionSources.size > 400) actionSources.delete(actionSources.keys().next().value);
      await sendMessage(completed, { destination: 'LOCAL' });
      const { requestId: _privateCorrelation, state: _privateState, ...published } = completed;
      await sendMessage({
        ...published,
        type: 'roll.event',
      }, { destination: 'REMOTE' });
      showToast(completed);
      return;
    }

    if (data.v === OBR_PROTOCOL_VERSION && data.type === 'action.request') {
      if (event.connectionId !== connectionId || !validRequestId(data.requestId)) return;
      if (!admitRequest()) {
        await sendError(data.requestId, 'rate_limited', 'Too many Dicebox requests; try again shortly');
        return;
      }
      const signature = requestSignature(data);
      const previous = requested.get(data.requestId);
      if (previous) {
        if (previous.signature !== signature) {
          await sendError(data.requestId, 'request_id_conflict', 'This request ID was already used for different work');
          return;
        }
        if (!previous.response) {
          await sendError(data.requestId, 'request_in_progress', 'This request is still running');
          return;
        }
        await sendMessage(previous.response, { destination: 'LOCAL' });
        return;
      }
      requested.set(data.requestId, { signature, response: null });
      if (data.action === 'state.set') {
        const next = data.state;
        const keys = next && typeof next === 'object' && !Array.isArray(next) ? Object.keys(next) : [];
        if (keys.length !== 1 || !['hunger', 'stress'].includes(keys[0]) || !Number.isInteger(next[keys[0]])) {
          await failRequest(data.requestId, signature, 'invalid_request', 'State changes require one bounded integer tracker');
          return;
        }
        if (keys[0] === 'hunger' && (next.hunger < 0 || next.hunger > 5)) {
          await failRequest(data.requestId, signature, 'invalid_request', 'Hunger must be 0 to 5');
          return;
        }
        if (keys[0] === 'stress' && (next.stress < 2 || next.stress > 20)) {
          await failRequest(data.requestId, signature, 'invalid_request', 'Stress must be 2 to 20');
          return;
        }
        trackedState[keys[0]] = next[keys[0]];
        safeSet(storage, keys[0] === 'hunger' ? 'dicebox:v5:hunger' : 'dicebox:ms:stress', String(next[keys[0]]));
        const completed = {
          v: OBR_PROTOCOL_VERSION, type: 'action.result', requestId: data.requestId,
          action: data.action, at: now(), state: stateSnapshot(),
        };
        requested.set(data.requestId, { signature, response: completed });
        if (requested.size > 400) requested.delete(requested.keys().next().value);
        await sendMessage(completed, { destination: 'LOCAL' });
        return;
      }
      if (data.action === 'shuffle' || data.action === 'reset') {
        let deckState;
        try { deckState = await withTimeout(assertActive => resetDeck(decks, data.deck, assertActive, data.notation), requestTimeoutMs); }
        catch (error) {
          await failRequest(data.requestId, signature,
            error instanceof BridgeTimeoutError ? 'timeout' : 'invalid_request', error);
          return;
        }
        const completed = {
          v: OBR_PROTOCOL_VERSION,
          type: 'action.result',
          requestId: data.requestId,
          action: data.action,
          ...deckState,
          at: now(),
          state: stateSnapshot(),
        };
        requested.set(data.requestId, { signature, response: completed });
        if (requested.size > 400) requested.delete(requested.keys().next().value);
        await sendMessage(completed, { destination: 'LOCAL' });
        return;
      }
      if (!['push', 'surge'].includes(data.action) || typeof data.rollId !== 'string' || data.rollId.length > 128) {
        await failRequest(data.requestId, signature, 'invalid_request', 'Unsupported or invalid action');
        return;
      }
      const source = actionSources.get(data.rollId);
      if (!source) {
        await failRequest(data.requestId, signature, 'not_found', 'The originating Dicebox roll is unavailable');
        return;
      }
      let result;
      if (data.action === 'surge') {
        // Blood Surge: 1-4 ordinary dice from Blood Potency, added to a V5
        // pool roll, once. The panel says how many; the background rolls the
        // ride-along Rouse and owns the Hunger it moves — the state snapshot
        // on the result is what re-syncs every panel's tracker.
        if (!Number.isInteger(data.dice) || data.dice < 1 || data.dice > 4) {
          await failRequest(data.requestId, signature, 'invalid_request', 'Surge dice must be 1 to 4');
          return;
        }
        if (source.system !== 'v5' || source.summary?.kind !== 'v5'
            || source.summary?.surged || consumedSurges.has(source.id)) {
          await failRequest(data.requestId, signature, 'action_unavailable', 'This roll cannot Blood Surge');
          return;
        }
        try { result = surgeV5(source, data.dice, randInt(10)); }
        catch (error) { await failRequest(data.requestId, signature, 'action_failed', error); return; }
        // Unlike a lone Rouse (pass/fail while Hunger sits untracked at 0),
        // the surge's failure always climbs — the app's local surge does the
        // same, and the two surfaces must never disagree about a tracker.
        if (!result.summary.surge.rouse.success) {
          trackedState.hunger = Math.min(5, trackedState.hunger + 1);
          safeSet(storage, 'dicebox:v5:hunger', String(trackedState.hunger));
        }
        result.summary.surge.rouse.hungerAfter = trackedState.hunger;
      } else {
        const push = source.system === 'bladerunner' ? pushBladeRunner
          : source.system === 'twilight' ? pushTwilight
          : source.system === 'yearzero' ? pushYearZero
          : null;
        if (!push || !source.summary?.canPush || consumedPushes.has(source.id)) {
          await failRequest(data.requestId, signature, 'action_unavailable', 'This roll cannot be pushed');
          return;
        }
        try { result = push(source); }
        catch (error) { await failRequest(data.requestId, signature, 'action_failed', error); return; }
      }
      const before = source.groups?.[0]?.dice || [];
      const after = result.groups?.[0]?.dice || [];
      const held = [], rerolled = [], added = [];
      after.forEach((die, index) => {
        if (index >= before.length) added.push(index);
        else if (die.rerolled) rerolled.push(index);
        else held.push(index);
      });
      const completed = {
        v: OBR_PROTOCOL_VERSION,
        type: 'roll.result',
        requestId: data.requestId,
        id: String(makeId()).slice(0, 128),
        parentId: source.id,
        system: result.system,
        notation: result.notation,
        groups: result.groups,
        summary: result.summary,
        total: result.total ?? null,
        transition: { kind: data.action, held, rerolled, added },
        who: String(playerName || 'Someone').slice(0, 40),
        at: now(),
        state: stateSnapshot(),
      };
      if (signedLocalWireBytes(completed) > MAX_WIRE_BYTES) {
        await failRequest(data.requestId, signature, 'result_too_large', 'Dicebox result exceeds Owlbear’s message limit');
        return;
      }
      (data.action === 'surge' ? consumedSurges : consumedPushes).add(source.id);
      requested.set(data.requestId, { signature, response: completed });
      if (requested.size > 400) requested.delete(requested.keys().next().value);
      await remember(completed);
      actionSources.set(completed.id, normalizeRoll(completed));
      if (actionSources.size > 400) actionSources.delete(actionSources.keys().next().value);
      await sendMessage(completed, { destination: 'LOCAL' });
      const { requestId: _privateCorrelation, state: _privateState, ...published } = completed;
      await sendMessage({
        ...published,
        type: 'roll.transition',
        transition: { kind: data.action, held, rerolled, added },
      }, { destination: 'REMOTE' });
      showToast(completed);
      return;
    }

    if (data.v === OBR_PROTOCOL_VERSION && data.type === 'history.request') {
      if (event.connectionId !== connectionId || !validRequestId(data.requestId)) return;
      if (!admitHistoryRequest()) {
        await sendError(data.requestId, 'rate_limited', 'Too many Dicebox history requests; try again shortly');
        return;
      }
      for (const page of historyPayloads(history, data.requestId, stateSnapshot())) {
        await sendMessage(page, { destination: 'LOCAL' });
      }
      return;
    }

    // Completed table rolls retain their legacy top-level shape for older panels.
    // New clients may additionally mark them as roll.event.
    const legacyCompleted = data.type === undefined && data.v === undefined;
    const currentCompleted = data.v === OBR_PROTOCOL_VERSION &&
      (data.type === 'roll.event' || data.type === 'roll.transition');
    if ((legacyCompleted || currentCompleted) && admitPublishedEvent()) {
      const roll = await remember(data);
      showToast(roll);
    }
  };

  let serial = Promise.resolve();
  let queued = 0;
  const dispatch = event => {
    const type = event?.data?.type;
    const stateful = event?.data?.v === OBR_PROTOCOL_VERSION &&
      (type === 'roll.request' || type === 'action.request' || type === 'history.request');
    if (!stateful) return handle(event);
    const requestId = event?.data?.requestId;
    if (event?.connectionId !== connectionId || !validRequestId(requestId)) return Promise.resolve();
    if (queued >= 16) {
      return sendError(requestId, 'busy', 'Dicebox request queue is full');
    }
    queued++;
    const run = serial.then(() => handle(event)).finally(() => { queued--; });
    serial = run.catch(() => {});
    return run;
  };

  const unsubscribe = OBR.broadcast.onMessage(OBR_CHANNEL, event => dispatch(event).catch(error => {
    console.error('[Dicebox/Owlbear background] message failed', error);
  }));

  return {
    dispose() {
      closed = true;
      if (typeof unsubscribePlayer === 'function') { try { unsubscribePlayer(); } catch { /* gone */ } }
      decks.dispose();
      if (typeof unsubscribeAction === 'function') { try { unsubscribeAction(); } catch { /* gone */ } }
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      if (typeof unsubscribe === 'function') unsubscribe();
      if (typeof historyStore.close === 'function') historyStore.close();
    },
  };
}
