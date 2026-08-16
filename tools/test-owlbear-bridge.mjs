// Behavioral tests for the Owlbear-only background service. These use the real
// roll validator and protocol entry point with a small fake SDK; no action-panel
// DOM is present, which is the lifecycle this service exists to cover.
import { roll } from '../dice.js';
import { initializeOwlbearBackground, OBR_CHANNEL } from '../owlbear-session.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

async function bridgeHarness(options = {}) {
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => { listener = null; }; },
      async sendMessage(_channel, data, sendOptions) { sent.push({ data, options: sendOptions }); },
    },
    player: {
      async getConnectionId() { return options.connectionId ?? 'mine'; },
      async getName() { return options.playerName ?? 'Tester'; },
    },
    room: { get id() { return options.roomId === undefined ? 'test-room' : options.roomId; } },
  };
  const service = await initializeOwlbearBackground(OBR, {
    storage: options.storage ?? memoryStorage(),
    ...(options.init || {}),
  });
  return { sent, service, emit: event => listener(event), connectionId: options.connectionId ?? 'mine' };
}

{
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(channel, callback) {
        ok('background subscribes on the Dicebox channel', channel === OBR_CHANNEL, channel);
        listener = callback;
        return () => { listener = null; };
      },
      async sendMessage(channel, data, options) { sent.push({ channel, data, options }); },
    },
    player: {
      async getConnectionId() { return 'local-connection'; },
      async getName() { return 'Local Player'; },
    },
    room: { id: 'room-one' },
  };

  const service = await initializeOwlbearBackground(OBR, { storage: memoryStorage(), now: () => 1000 });
  ok('background exposes a disposable running service', !!service && typeof service.dispose === 'function');
  ok('background subscribes exactly once', typeof listener === 'function');

  const result = roll('1d6');
  const remote = {
    id: 'remote-roll-1', system: 'numeric', notation: result.notation,
    groups: result.groups, total: result.total, summary: null,
    who: 'Remote Player', at: 900,
  };
  await listener({ connectionId: 'remote-connection', data: remote });

  await listener({
    connectionId: 'local-connection',
    data: { v: 1, type: 'history.request', requestId: 'history-1' },
  });
  const reply = sent.find(message => message.data?.type === 'history.result');
  ok('closed-panel rolls are returned by history request',
     reply?.data?.rolls?.length === 1 && reply.data.rolls[0].id === 'remote-roll-1');
  ok('history reply is local to the requesting player', reply?.options?.destination === 'LOCAL');
  ok('history reply correlates with its request', reply?.data?.requestId === 'history-1');
  service.dispose();
  ok('disposing the service unsubscribes the background listener', listener === null);
}

// Owlbear Broadcast rejects messages above 16 KiB. History hydration therefore
// arrives as bounded local pages rather than one unbounded replay payload.
{
  const storage = memoryStorage();
  const sample = roll('1d6');
  const saved = Array.from({ length: 200 }, (_, index) => ({
    id: `history-roll-${index}`, system: 'numeric', notation: sample.notation,
    groups: sample.groups, total: sample.total, summary: null,
    who: 'Archived Player', at: index + 1,
  }));
  storage.setItem('dicebox:obr:history:v1:paged-room', JSON.stringify(saved));
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data, options) {
        const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
        if (bytes >= 16 * 1024) throw new Error('Owlbear 16 KiB message limit exceeded');
        sent.push({ data, options, bytes });
      },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Archivist'; } },
    room: { id: 'paged-room' },
  };
  await initializeOwlbearBackground(OBR, { storage });
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'history.request', requestId: 'history-pages',
  } });
  const pages = sent.filter(message => message.data?.type === 'history.result');
  ok('large retained history is split into multiple Broadcast-safe pages',
     pages.length > 1 && pages.flatMap(page => page.data.rolls).length === 200);
  ok('every history page leaves safety headroom below Owlbear’s hard limit',
     pages.every(page => page.bytes <= 12_000));
  ok('the final history page is marked complete', pages.at(-1)?.data?.done === true);
}

// Persistence is room-scoped behind an async repository so production can use
// IndexedDB while tests and storage-denied browsers retain a bounded fallback.
{
  const writes = [];
  let listener = null;
  const historyStore = {
    async load(roomId) {
      ok('history repository loads the current Owlbear room only', roomId === 'idb-room');
      return [];
    },
    async save(roomId, rolls) { writes.push({ roomId, rolls: structuredClone(rolls) }); },
    close() {},
  };
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage() {},
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Persistent'; } },
    room: { id: 'idb-room' },
  };
  const service = await initializeOwlbearBackground(OBR, { storage: memoryStorage(), historyStore });
  const result = roll('1d6');
  await listener({ connectionId: 'remote', data: {
    id: 'persisted-roll', system: 'numeric', notation: result.notation,
    groups: result.groups, total: result.total, who: 'Remote', at: 1,
  } });
  ok('accepted closed-panel rolls persist through the room history repository',
     writes.at(-1)?.roomId === 'idb-room' && writes.at(-1).rolls.at(-1)?.id === 'persisted-roll');
  service.dispose();
}

// Completed-event traffic is untrusted Broadcast input. Retention is bounded by
// count and bytes, and a burst cannot force an unbounded stream of IndexedDB
// writes while the panel is closed.
{
  let listener = null;
  let retained = 0;
  const historyStore = {
    async load() { return []; },
    async save(_roomId, rolls) { retained = rolls.length; return true; },
    close() {},
  };
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage() {},
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Bounded'; } },
    room: { id: 'event-rate-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage: memoryStorage(), historyStore, now: () => 1000,
  });
  const result = roll('1d6');
  for (let index = 0; index < 105; index++) {
    await listener({ connectionId: `remote-${index}`, data: {
      id: `event-${index}`, system: 'numeric', notation: result.notation,
      groups: result.groups, total: result.total, who: 'Remote', at: index,
    } });
  }
  ok('completed-event bursts are admission bounded before persistence', retained === 100, String(retained));
}

// A request is local RPC: exactly this player's background computes it, returns a
// correlated interpreted result locally, and publishes the completed roll once
// to the other players. A request received from another connection is ignored.
{
  const storage = memoryStorage();
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(channel, data, options) { sent.push({ channel, data, options }); },
    },
    player: {
      async getConnectionId() { return 'mine'; },
      async getName() { return 'Bridge Roller'; },
    },
    room: { id: 'bridge-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage, now: () => 2000, makeId: () => 'bridge-roll-1',
  });

  const request = {
    v: 1, type: 'roll.request', requestId: 'forms-1', notation: 'gen:2a1p2d',
  };
  await listener({ connectionId: 'someone-else', data: request });
  ok('another player cannot trigger this Dicebox', sent.length === 0);

  await listener({ connectionId: 'mine', data: request });
  const result = sent.find(message => message.data?.type === 'roll.result');
  const event = sent.find(message => message.data?.type === 'roll.event');
  ok('same-player request returns an interpreted Dicebox result',
     result?.data?.requestId === 'forms-1' && result.data.system === 'genesys' && !!result.data.summary);
  ok('request result is correlated locally', result?.options?.destination === 'LOCAL');
  ok('the same completed roll is published once to the table',
     event?.options?.destination === 'REMOTE' && event.data.id === result?.data?.id);
  ok('the background owns the roll identity and attribution',
     result?.data?.id === 'bridge-roll-1' && result.data.who === 'Bridge Roller' && result.data.at === 2000);

  await listener({ connectionId: 'mine', data: request });
  ok('a repeated request ID replays its local response without rolling twice',
     sent.filter(message => message.data?.type === 'roll.result').length === 2 &&
     sent.filter(message => message.data?.type === 'roll.event').length === 1);

  await listener({
    connectionId: 'mine',
    data: { ...request, notation: 'gen:1a', requestId: request.requestId },
  });
  ok('reusing a request ID for different work fails closed',
     sent.some(message => message.data?.type === 'roll.error' &&
       message.data.requestId === request.requestId && message.data.code === 'request_id_conflict') &&
     sent.filter(message => message.data?.type === 'roll.event').length === 1);

  // Old preference values from earlier builds are deliberately ignored: VTT
  // sharing and local request handling are now part of the extension contract.
  storage.setItem('dicebox:obr:broadcast', '0');
  storage.setItem('dicebox:obr:requests', '0');
  await listener({
    connectionId: 'mine',
    data: { ...request, requestId: 'forms-always-on' },
  });
  ok('stale preference values cannot disable local extension requests',
     sent.some(message => message.data?.type === 'roll.result' && message.data.requestId === 'forms-always-on'));
  ok('stale preference values cannot disable Owlbear table publication',
     sent.filter(message => message.data?.type === 'roll.event').length === 2);

  const eventsBeforeBoundedRequest = sent.filter(message => message.data?.type === 'roll.event').length;
  await listener({
    connectionId: 'mine',
    data: { v: 1, type: 'roll.request', requestId: 'forms-too-many-dice', notation: '101d6' },
  });
  ok('the public bridge rejects oversized numeric pools before rolling them',
     sent.some(message => message.data?.type === 'roll.error' &&
       message.data.requestId === 'forms-too-many-dice' && message.data.code === 'invalid_request'));
  ok('a rejected oversized numeric pool is never published to the table',
     sent.filter(message => message.data?.type === 'roll.event').length === eventsBeforeBoundedRequest);
}

// Card requests use Dicebox's persistent deck rather than synthesizing an
// independent random hand. Consecutive requests draw without replacement and
// leave the same storage state the action panel uses.
{
  const storage = memoryStorage();
  const sent = [];
  let listener = null, seq = 0;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data, options) { sent.push({ data, options }); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Dealer'; } },
    room: { id: 'card-room' },
  };
  await initializeOwlbearBackground(OBR, { storage, makeId: () => `card-roll-${++seq}` });
  for (const requestId of ['draw-1', 'draw-2']) {
    await listener({
      connectionId: 'mine',
      data: { v: 1, type: 'roll.request', requestId, notation: 'deck:2' },
    });
  }
  const draws = sent.filter(message => message.data?.type === 'roll.result').map(message => message.data);
  const firstIds = new Set(draws[0]?.summary?.drawn?.map(card => card.id));
  const secondIds = draws[1]?.summary?.drawn?.map(card => card.id) || [];
  ok('card notation is handled by the background dealer',
     draws.length === 2 && draws.every(draw => draw.system === 'cards' && draw.groups[0].cards.length === 2));
  ok('consecutive background draws use one deck without replacement',
     firstIds.size === 2 && secondIds.every(id => !firstIds.has(id)) && draws[1].summary.remaining === 48);
  const deck = JSON.parse(storage.getItem('dicebox:deck:v1') || 'null');
  ok('background card state is compatible with the Dicebox panel',
     deck?.pos === 4 && Array.isArray(deck.hand) && deck.hand.length === 2);

  await listener({
    connectionId: 'mine',
    data: { v: 1, type: 'roll.request', requestId: 'tarot-1', notation: 'tarot:2 majors upright' },
  });
  const tarot = sent.find(message => message.data?.type === 'roll.result' && message.data.requestId === 'tarot-1')?.data;
  const tarotState = JSON.parse(storage.getItem('dicebox:tarot:v1') || 'null');
  ok('tarot requests use the persistent Dicebox tarot deck',
     tarot?.system === 'tarot' && tarot.summary?.kind === 'tarot' &&
     tarot.groups?.[0]?.cards?.length === 2 && tarotState?.pos === 2 && tarotState.majors === true);

  for (const [requestId, notation] of [
    ['nap-1', 'ita:2'], ['hana-1', 'hana:2'], ['uta-1', 'uta:2 en'],
  ]) {
    await listener({ connectionId: 'mine', data: { v: 1, type: 'roll.request', requestId, notation } });
  }
  const byRequest = id => sent.find(message => message.data?.type === 'roll.result' && message.data.requestId === id)?.data;
  ok('Neapolitan requests use the persistent Dicebox deck',
     byRequest('nap-1')?.system === 'napoletane' && JSON.parse(storage.getItem('dicebox:nap:v1'))?.pos === 2);
  ok('Hanafuda requests use the persistent Dicebox deck',
     byRequest('hana-1')?.system === 'hanafuda' && JSON.parse(storage.getItem('dicebox:hana:v1'))?.pos === 2);
  ok('Uta-garuta requests use the persistent Dicebox deck and language',
     byRequest('uta-1')?.system === 'utagaruta' &&
     JSON.parse(storage.getItem('dicebox:uta:v1'))?.pos === 2 &&
     JSON.parse(storage.getItem('dicebox:uta:v1'))?.lang === 'en');

  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'action.request', requestId: 'shuffle-1', action: 'shuffle', deck: 'cards',
  } });
  const shuffled = sent.find(message => message.data?.type === 'action.result' && message.data.requestId === 'shuffle-1')?.data;
  const resetDeck = JSON.parse(storage.getItem('dicebox:deck:v1') || 'null');
  ok('deck shuffle is a stateful Dicebox action, not a caller-owned rule',
     shuffled?.action === 'shuffle' && shuffled.deck === 'cards' &&
     resetDeck?.pos === 0 && resetDeck.hand?.length === 0 && resetDeck.pile?.length === 0,
     JSON.stringify({ shuffled, resetDeck, recent: sent.slice(-3).map(message => message.data) }));
}

// Stateful follow-up actions refer to an authoritative Dicebox roll. The
// transition explicitly separates held, rerolled, and newly-added dice so an
// open remote panel can animate only the picked-up handful.
{
  const storage = memoryStorage();
  const sent = [];
  let listener = null, authoritySeq = 0;
  const authoritativeSources = new Map();
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data, options) { sent.push({ data, options }); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Pusher'; } },
    room: { id: 'push-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage,
    makeId: () => `authority-${++authoritySeq}`,
    rollAny: notation => structuredClone(authoritativeSources.get(notation)),
  });
  const source = {
    id: 'source-roll', system: 'yearzero', notation: 'yz:2b',
    groups: [{ kind: 'dice', sides: 6, count: 2, dice: [
      { type: 'base', sides: 6, value: 6 },
      { type: 'base', sides: 6, value: 3 },
    ] }],
    summary: { kind: 'yearzero', successes: 1, canPush: true, pushed: false },
    total: null, who: 'Pusher', at: 1,
  };
  authoritativeSources.set(source.notation, source);
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'source-authority', notation: source.notation,
  } });
  const sourceId = sent.find(message => message.data?.requestId === 'source-authority')?.data.id;
  await listener({
    connectionId: 'mine',
    data: { v: 1, type: 'action.request', requestId: 'push-1', action: 'push', rollId: sourceId },
  });
  const pushed = sent.find(message => message.data?.type === 'roll.result' && message.data.requestId === 'push-1')?.data;
  const transition = sent.find(message => message.data?.type === 'roll.transition')?.data;
  ok('push action resolves against the originating Dicebox roll',
     pushed?.parentId === sourceId && pushed.summary?.pushed === true);
  ok('push transition preserves held dice and identifies only rerolled dice',
     transition?.transition?.held?.join(',') === '0' &&
     transition?.transition?.rerolled?.join(',') === '1' &&
     transition?.transition?.added?.length === 0 &&
     transition.groups[0].dice[0].value === 6 && !transition.groups[0].dice[0].rerolled &&
     transition.groups[0].dice[1].rerolled === true);
  ok('push result is local while its visual transition is remote',
     sent.find(message => message.data?.type === 'roll.result')?.options?.destination === 'LOCAL' &&
     sent.find(message => message.data?.type === 'roll.transition')?.options?.destination === 'REMOTE');

  const pushCases = [
    {
      id: 'alien-source', system: 'yearzero', notation: 'yz:2b1x',
      dice: [
        { type: 'base', sides: 6, value: 6 },
        { type: 'base', sides: 6, value: 3 },
        { type: 'stress', sides: 6, value: 4 },
      ], held: '0', rerolled: '1,2', added: '3',
    },
    {
      id: 'br-source', system: 'bladerunner', notation: 'br:12,8',
      dice: [{ sides: 12, value: 6 }, { sides: 8, value: 3 }],
      held: '0', rerolled: '1', added: '',
    },
    {
      id: 't2k-source', system: 'twilight', notation: 't2k:12,8,1',
      dice: [{ sides: 12, value: 1 }, { sides: 8, value: 4 }, { type: 'ammo', sides: 6, value: 6 }],
      held: '0,2', rerolled: '1', added: '',
    },
  ];
  for (const sourceCase of pushCases) {
    const sourceRoll = {
      id: sourceCase.id, system: sourceCase.system, notation: sourceCase.notation,
      groups: [{ kind: 'dice', count: sourceCase.dice.length, dice: sourceCase.dice }],
      summary: { kind: sourceCase.system, successes: 0, canPush: true, pushed: false },
      total: null, who: 'Pusher', at: 2,
    };
    authoritativeSources.set(sourceRoll.notation, sourceRoll);
    const sourceRequestId = `source-${sourceCase.id}`;
    await listener({ connectionId: 'mine', data: {
      v: 1, type: 'roll.request', requestId: sourceRequestId, notation: sourceRoll.notation,
    } });
    const authoritativeId = sent.find(message => message.data?.requestId === sourceRequestId)?.data.id;
    await listener({ connectionId: 'mine', data: {
      v: 1, type: 'action.request', requestId: `push-${sourceCase.id}`,
      action: 'push', rollId: authoritativeId,
    } });
    const published = sent.find(message =>
      message.data?.type === 'roll.transition' && message.data.parentId === authoritativeId)?.data;
    ok(`${sourceCase.system} push publishes exact held/rerolled/added indexes`,
       published?.transition?.held?.join(',') === sourceCase.held &&
       published?.transition?.rerolled?.join(',') === sourceCase.rerolled &&
       published?.transition?.added?.join(',') === sourceCase.added);
  }
}

// Tracked character state is owned by the background and uses the same storage
// keys as the panel. Rouse and Mothership consequences therefore survive panel
// closure and are visible on the next open.
{
  const storage = memoryStorage();
  storage.setItem('dicebox:v5:hunger', '4');
  storage.setItem('dicebox:ms:stress', '19');
  const sent = [];
  const seenNotations = [];
  let listener = null, id = 0;
  const rouseFailure = () => ({
    schema: 2, system: 'v5', notation: 'v5:rouse',
    groups: [{ kind: 'dice', dieType: 'v5', count: 1, dice: [{ value: 2, hunger: true }], subtotal: 0 }],
    summary: { kind: 'rouse', value: 2, success: false, hungerGain: 1, hungerAfter: null },
  });
  const mothershipFailure = notation => ({
    schema: 2, system: 'mothership', notation,
    groups: [{ kind: 'dice', sides: 100, count: 1, dice: [{ value: 99, kept: true }] }],
    summary: { kind: 'mothership', mode: 'check', outcome: 'failure', stressDelta: 1 },
  });
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data) { sent.push(data); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Tracker'; } },
    room: { id: 'state-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage, makeId: () => `state-${++id}`, rollRouse: rouseFailure,
    rollAny: notation => {
      seenNotations.push(notation);
      if (notation.startsWith('ms:')) return mothershipFailure(notation);
      return {
        schema: 2, system: 'v5', notation,
        groups: [{ kind: 'dice', dieType: 'v5', count: 1, dice: [{ value: 6, hunger: true }] }],
        summary: { kind: 'v5', pool: 6, hunger: 5, successes: 1 },
      };
    },
  });
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'rouse-1', notation: 'v5:rouse',
  } });
  const rouse = sent.find(message => message.requestId === 'rouse-1');
  ok('external Rouse checks update tracked Hunger through Dicebox rules',
     storage.getItem('dicebox:v5:hunger') === '5' &&
     rouse?.summary?.hungerAfter === 5 && rouse.summary.hungerRose === true && rouse.summary.tracked === true);

  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'ms-1', notation: 'ms:c@35',
  } });
  const ms = sent.find(message => message.requestId === 'ms-1');
  ok('external Mothership failures update tracked Stress through Dicebox rules',
     storage.getItem('dicebox:ms:stress') === '20' && ms?.summary?.stressOverflow === 0);

  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'v5-tracked', notation: 'v5:6',
  } });
  ok('ordinary external V5 rolls use Dicebox’s tracked Hunger by default',
     seenNotations.includes('v5:6h5'));

  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'panic-tracked', notation: 'ms:p',
  } });
  ok('external Panic checks use Dicebox’s tracked Stress by default',
     seenNotations.includes('ms:p@20'));
}

// Oracle requests select Dicebox's own Ironsworn or Starforged dataset; callers
// provide only the game and a normal oracle slug, never their own table data.
{
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data) { sent.push(data); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Oracle'; } },
    room: { id: 'oracle-room' },
  };
  await initializeOwlbearBackground(OBR, { storage: memoryStorage(), makeId: () => 'oracle-roll' });
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'oracle-1', notation: 'oracle:pay-the-price', game: 'ironsworn',
  } });
  const oracle = sent.find(message => message.requestId === 'oracle-1');
  ok('oracle requests use Dicebox datasets and return interpreted readings',
     oracle?.system === 'oracle' && oracle.notation === 'oracle:pay-the-price' &&
     oracle.groups?.[0]?.dieType === 'oracle' && typeof oracle.summary?.text === 'string');
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'history.request', requestId: 'oracle-history',
  } });
  const oracleHistory = sent.find(message => message.type === 'history.result' && message.requestId === 'oracle-history');
  ok('oracle results survive normalization and closed-panel hydration',
     oracleHistory?.rolls?.some(roll => roll.id === 'oracle-roll' && roll.system === 'oracle'));
}

// Every stateless Dicebox roller reaches the same authoritative bridge. Stateful
// decks and oracle tables have dedicated coverage above.
{
  const sent = [];
  let listener = null, seq = 0;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data, options) { sent.push({ data, options }); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Matrix'; } },
    room: { id: 'matrix-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage: memoryStorage(), makeId: () => `matrix-${++seq}`, now: () => 9_000,
  });
  const matrix = [
    ['numeric', '2d6'], ['v5', 'v5:6h2'], ['fate', '4dF'],
    ['genesys', 'gen:1a1d'], ['daggerheart', 'dh:+1@12'],
    ['cthulhutech', 'ct:5@3'], ['yearzero', 'yz:3b2s1g'],
    ['bladerunner', 'br:10,8'], ['twilight', 't2k:10,8,2'],
    ['starwars', 'sw:1a1d1f'], ['onering', 'tor:2@16'],
    ['pbta', 'pbta:+1'], ['mist', 'mist:-1'],
    ['mothership', 'ms:c@35'], ['coc', 'coc:60b'],
    ['deltagreen', 'dg:60'], ['ironsworn', 'iron:+2'],
  ];
  for (const [expected, notation] of matrix) {
    const requestId = `matrix-${expected}`;
    await listener({ connectionId: 'mine', data: {
      v: 1, type: 'roll.request', requestId, notation, stateMode: 'explicit',
    } });
    const result = sent.find(message => message.data?.type === 'roll.result' && message.data.requestId === requestId)?.data;
    ok(`bridge resolves ${expected} through Dicebox`, result?.system === expected, result?.system || 'no result');
  }
}

// A valid rules result can still be too large for Owlbear's wire limit. The
// bridge must fail explicitly rather than silently losing the response or event.
{
  const sent = [];
  let listener = null;
  const oversized = notation => ({
    schema: 2, system: 'genesys', notation,
    groups: [{ kind: 'dice', dieType: 'genesys', count: 1, dice: [{ value: 1, symbols: [] }] }],
    summary: { kind: 'genesys', success: 0, advantage: 0, detail: 'x'.repeat(13_000) },
  });
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data, options) { sent.push({ data, options }); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Bounded'; } },
    room: { id: 'bounded-room' },
  };
  await initializeOwlbearBackground(OBR, { storage: memoryStorage(), rollAny: oversized });
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'too-large', notation: 'gen:1a',
  } });
  ok('oversized results receive a correlated explicit error',
     sent.some(message => message.data?.type === 'roll.error' &&
       message.data.requestId === 'too-large' && message.data.code === 'result_too_large'));
  ok('oversized results are never partially published to the table',
     !sent.some(message => message.options?.destination === 'REMOTE'));
}

// A stalled lazy import or injected engine cannot hold the serialized state
// queue forever; the requester receives a correlated timeout.
{
  const sent = [];
  let listener = null;
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data) { sent.push(data); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Timeout'; } },
    room: { id: 'timeout-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage: memoryStorage(), requestTimeoutMs: 5,
    rollAny: () => new Promise(() => {}),
  });
  await listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: 'timeout-1', notation: 'gen:1a',
  } });
  ok('stalled roll requests fail with an explicit timeout',
     sent.some(message => message.type === 'roll.error' &&
       message.requestId === 'timeout-1' && message.code === 'timeout'));
}

// Requests are serialized because Hunger, Stress and deck operations mutate one
// shared state. A short burst is bounded and receives explicit overload errors.
{
  const sent = [];
  let listener = null, active = 0, maxActive = 0, seq = 0;
  const slowResult = async notation => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return {
      schema: 2, system: 'genesys', notation,
      groups: [{ kind: 'dice', dieType: 'genesys', count: 1, dice: [{ value: 1, symbols: [] }] }],
      summary: { kind: 'genesys', success: 0, advantage: 0 },
    };
  };
  const OBR = {
    broadcast: {
      onMessage(_channel, callback) { listener = callback; return () => {}; },
      async sendMessage(_channel, data) { sent.push(data); },
    },
    player: { async getConnectionId() { return 'mine'; }, async getName() { return 'Queue'; } },
    room: { id: 'queue-room' },
  };
  await initializeOwlbearBackground(OBR, {
    storage: memoryStorage(), now: () => 5000,
    makeId: () => `queue-${++seq}`, rollAny: slowResult,
  });
  await Promise.all(['q1', 'q2'].map(requestId => listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId, notation: 'gen:1a',
  } })));
  ok('stateful external requests execute serially', maxActive === 1);

  await Promise.all(Array.from({ length: 18 }, (_, index) => listener({ connectionId: 'mine', data: {
    v: 1, type: 'roll.request', requestId: `queued-${index}`, notation: 'gen:1a',
  } })));
  ok('the bounded stateful queue returns explicit overload errors',
     sent.some(message => message.type === 'roll.error' && message.code === 'busy'));

  for (let i = 0; i < 22; i++) {
    await listener({ connectionId: 'mine', data: {
      v: 1, type: 'roll.request', requestId: `burst-${i}`, notation: 'gen:1a',
    } });
  }
  ok('request bursts receive explicit rate-limit errors',
     sent.some(message => message.type === 'roll.error' && message.code === 'rate_limited'));
}

// Public numeric requests are bounded by expected random work, not just encoded
// length or output size. A near-certain reroll loop must be rejected before RNG.
{
  let rollerCalls = 0;
  const h = await bridgeHarness({ init: {
    rollAny: notation => {
      rollerCalls++;
      return roll(notation);
    },
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'roll.request', requestId: 'pathological-reroll', notation: '100d10000r9999',
  } });
  ok('pathological reroll work is rejected before the roller runs',
     rollerCalls === 0 && h.sent.some(message => message.data?.requestId === 'pathological-reroll' && message.data.code === 'invalid_request'));
  h.service.dispose();
}

// Typed compatibility is exact. Future protocol versions are not legacy events.
{
  const h = await bridgeHarness();
  const sample = roll('1d6');
  await h.emit({ connectionId: 'remote', data: {
    v: 99, type: 'roll.event', id: 'future-roll', system: 'numeric',
    notation: sample.notation, groups: sample.groups, total: sample.total, who: 'Future', at: 1,
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'history.request', requestId: 'future-history',
  } });
  const page = h.sent.find(message => message.data?.type === 'history.result');
  ok('unsupported typed protocol versions never enter history',
     !page?.data?.rolls?.some(item => item.id === 'future-roll'));
  h.service.dispose();
}

// History export is bounded independently from roll/action admission.
{
  const h = await bridgeHarness({ init: { now: () => 10_000 } });
  for (let i = 0; i < 3; i++) {
    await h.emit({ connectionId: h.connectionId, data: {
      v: 1, type: 'history.request', requestId: `history-burst-${i}`,
    } });
  }
  ok('history request bursts receive a bounded correlated error',
     h.sent.some(message => message.data?.requestId === 'history-burst-2' && message.data.code === 'rate_limited'));
  h.service.dispose();
}

// A push source is a one-shot authoritative result, not a reusable capability.
{
  let seq = 0;
  const sourceResult = {
    schema: 2, system: 'yearzero', notation: 'yz:2b',
    groups: [{ kind: 'dice', sides: 6, count: 2, dice: [
      { type: 'base', sides: 6, value: 6 },
      { type: 'base', sides: 6, value: 3 },
    ] }],
    summary: { kind: 'yearzero', successes: 1, canPush: true, pushed: false },
  };
  const h = await bridgeHarness({ init: {
    makeId: () => `owned-${++seq}`,
    rollAny: () => structuredClone(sourceResult),
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'roll.request', requestId: 'source-request', notation: 'yz:2b',
  } });
  const sourceId = h.sent.find(message => message.data?.requestId === 'source-request' && message.data.type === 'roll.result')?.data.id;
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'action.request', requestId: 'push-first', action: 'push', rollId: sourceId,
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'action.request', requestId: 'push-second', action: 'push', rollId: sourceId,
  } });
  ok('fresh request IDs cannot push the same source twice',
     h.sent.filter(message => message.data?.type === 'roll.transition' && message.data.parentId === sourceId).length === 1 &&
     h.sent.some(message => message.data?.requestId === 'push-second' && message.data.code === 'action_unavailable'));
  h.service.dispose();
}

// History must never fall into a cross-room "unknown" bucket.
{
  let rejected = false;
  try { await bridgeHarness({ roomId: null }); } catch { rejected = true; }
  ok('missing Owlbear room identity fails initialization closed', rejected);
}

// Timeout is a commit boundary: abandoned asynchronous work may settle later,
// but it must never mutate tracked state after the error response.
{
  const storage = memoryStorage();
  storage.setItem('dicebox:ms:stress', '10');
  let resolveRoll;
  const delayed = new Promise(resolve => { resolveRoll = resolve; });
  const h = await bridgeHarness({ storage, init: {
    requestTimeoutMs: 5,
    rollAny: () => delayed,
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'roll.request', requestId: 'late-stress', notation: 'ms:c@35',
  } });
  resolveRoll({
    schema: 2, system: 'mothership', notation: 'ms:c@35',
    groups: [{ kind: 'dice', sides: 100, count: 1, dice: [{ value: 99, kept: true }] }],
    summary: { kind: 'mothership', mode: 'check', outcome: 'failure', stressDelta: 1 },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  ok('timed-out work cannot commit Stress later',
     storage.getItem('dicebox:ms:stress') === '10' &&
     h.sent.some(message => message.data?.requestId === 'late-stress' && message.data.code === 'timeout'));
  h.service.dispose();
}

// Embedded storage is opportunistic persistence, not the only in-room state.
{
  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const h = await bridgeHarness({ storage: denied });
  for (const requestId of ['denied-deck-1', 'denied-deck-2']) {
    await h.emit({ connectionId: h.connectionId, data: {
      v: 1, type: 'roll.request', requestId, notation: 'deck:2',
    } });
  }
  const draws = h.sent.filter(message => message.data?.type === 'roll.result' && message.data.system === 'cards');
  ok('deck state remains sequential when storage is denied',
     draws[0]?.data.summary?.remaining === 50 && draws[1]?.data.summary?.remaining === 48);
  h.service.dispose();
}

// Event bursts update memory immediately but coalesce durable snapshots. A
// blocked IndexedDB save cannot fan out into unbounded writes or stall handlers.
{
  let saveCalls = 0;
  const historyStore = {
    async load() { return []; },
    save() { saveCalls++; return new Promise(() => {}); },
    close() {},
  };
  const h = await bridgeHarness({ init: { historyStore } });
  const sample = roll('1d6');
  const emissions = Array.from({ length: 20 }, (_, index) => h.emit({
    connectionId: `remote-${index}`,
    data: {
      v: 1, type: 'roll.event', id: `persist-${index}`, system: 'numeric',
      notation: sample.notation, groups: sample.groups, total: sample.total,
      who: 'Remote', at: index + 1,
    },
  }));
  const settled = await Promise.race([
    Promise.all(emissions).then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 30)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 0));
  ok('blocked persistence is single-flight and never stalls message handlers', settled && saveCalls === 1, String(saveCalls));
  h.service.dispose();
}

// Manual tracker changes are serialized actions too; the panel never races a
// direct localStorage write against background-owned Hunger or Stress.
{
  const seen = [];
  const h = await bridgeHarness({ init: {
    rollAny: notation => {
      seen.push(notation);
      return {
        schema: 2, system: 'v5', notation,
        groups: [{ kind: 'dice', dieType: 'v5', count: 1, dice: [{ value: 6, hunger: true }] }],
        summary: { kind: 'v5', pool: 1, hunger: 1, successes: 1 },
      };
    },
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'action.request', requestId: 'set-hunger', action: 'state.set', state: { hunger: 4 },
  } });
  await h.emit({ connectionId: h.connectionId, data: {
    v: 1, type: 'roll.request', requestId: 'after-hunger', notation: 'v5:5',
  } });
  ok('tracked state changes are background-owned and affect the next roll',
     seen.includes('v5:5h4') && h.sent.some(message =>
       message.data?.requestId === 'set-hunger' && message.data.state?.hunger === 4));
  h.service.dispose();
}

// Once admitted, a failed request ID is terminal too: exact retries replay the
// same error and conflicting reuse cannot turn it into fresh work.
{
  let calls = 0;
  const h = await bridgeHarness({ init: { rollAny: () => { calls++; throw new Error('nope'); } } });
  const failed = { v: 1, type: 'roll.request', requestId: 'terminal-failure', notation: '1d6' };
  await h.emit({ connectionId: h.connectionId, data: failed });
  await h.emit({ connectionId: h.connectionId, data: failed });
  await h.emit({ connectionId: h.connectionId, data: { ...failed, notation: '1d8' } });
  const errors = h.sent.filter(message => message.data?.requestId === failed.requestId).map(message => message.data.code);
  ok('failed request IDs replay or conflict without re-executing',
     calls === 1 && errors.filter(code => code === 'invalid_request').length === 2
     && errors.includes('request_id_conflict'));
  h.service.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
