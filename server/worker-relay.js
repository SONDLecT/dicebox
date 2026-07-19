// The hosted relay: the same broadcast fanout as server/relay.mjs, as a Worker
// with one Durable Object per room.
//
// Two implementations of one protocol is a real cost — they can drift, and a
// bug fixed in one can survive in the other. It is paid because the two run in
// genuinely different places: self-hosters get a Node process they can inspect
// and keep, and the demo gets something reachable from a phone without anyone
// running a server at home. server/relay.mjs remains the reference; anything
// changed here must be changed there.
//
// A room is a Durable Object because the sockets in one room must share state,
// and a plain Worker has no way to hold them together. Room id maps to object
// name, so Cloudflare routes every member of a room to the same instance.

// The class has to extend DurableObject for the hibernation API to work.
// Without it `ctx.getWebSockets()` returns an empty list rather than failing, so
// every connection believes it is alone in the room and no message is ever
// broadcast — a silent failure that looks exactly like a routing bug.
import { DurableObject } from 'cloudflare:workers';

const PROTOCOL_VERSION = 1;

const MAX_PER_ROOM = 16;
const MAX_CIPHERTEXT = 6144;
const RATE_MSGS = 30;
const RATE_WINDOW_MS = 10000;
const IDLE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Room ids are derived by HKDF and are always 32 hex characters. Strict because
// this is a routing key: a loose pattern means an id space nobody can reason
// about, and here it also means arbitrary strings becoming Durable Object names.
const ROOM_ID = /^[0-9a-f]{32}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      // Deliberately says nothing about rooms or connections. The self-hosted
      // relay can report its own counts because its operator is its user; here
      // that would publish how many tables are playing to anyone who asks.
      return json({ ok: true, protocol: PROTOCOL_VERSION });
    }

    if (url.pathname !== '/ws') {
      return json({ error: 'not_found' }, 404);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'upgrade_required' }, 426);
    }

    // An origin allowlist is what stops this being an open relay for anyone
    // else's app. Unset means allow, so a self-hoster who has not configured it
    // is not locked out of their own relay.
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length) {
      const origin = request.headers.get('Origin');
      if (!origin || !allowed.includes(origin)) {
        return json({ error: 'forbidden_origin' }, 403);
      }
    }

    // The room id has to arrive in the query string here, unlike the
    // self-hosted relay which reads it from the first frame: a Durable Object
    // is chosen by name before the socket is accepted, so there is no frame to
    // read yet. The client sends it both ways so one transport serves both.
    //
    // It is a hash of a secret rather than the secret. The passphrase never
    // leaves the browser and this identifier cannot be reversed into it, so
    // putting it in a URL costs nothing — but it does appear in Cloudflare's
    // request logs, which is precisely why it must stay a hash.
    const roomId = url.searchParams.get('room') || '';
    if (!ROOM_ID.test(roomId)) {
      return json({ error: 'bad_room' }, 400);
    }

    const id = env.ROOM.idFromName(roomId);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    // Hibernation: accepting through the context rather than calling accept()
    // lets Cloudflare evict this object from memory while the sockets stay
    // open. A dice room is idle between rolls, which is almost always, so this
    // is the difference between a real bill and a rounding error.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const peers = this.ctx.getWebSockets();
    if (peers.length >= MAX_PER_ROOM) {
      return json({ error: 'room_full' }, 403);
    }

    const now = Date.now();
    let createdAt = await this.ctx.storage.get('createdAt');
    if (!createdAt) {
      createdAt = now;
      // The only thing stored, and it is a timestamp rather than anything a
      // member said. Rooms hold no roster, no history and no ciphertext.
      await this.ctx.storage.put('createdAt', createdAt);
    }

    this.ctx.acceptWebSocket(server);

    // Serialised onto the socket so it survives hibernation: an object woken to
    // handle a message has lost every field set in the constructor, and this is
    // the only per-connection state that outlives that.
    server.serializeAttachment({
      id: crypto.randomUUID().slice(0, 8),
      joinedAt: now,
      stamps: [],
    });

    await this.arm();

    send(server, {
      t: 'joined',
      v: PROTOCOL_VERSION,
      you: server.deserializeAttachment().id,
      n: peers.length + 1,
      expires: createdAt + MAX_AGE_MS,
    });
    this.roster(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') {
      // The protocol is one JSON object per text frame. Binary would have to be
      // buffered and inspected to be rejected later, so it is refused here.
      return fail(ws, 'bad_frame', 'Binary frames are not accepted', 4400);
    }

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return fail(ws, 'bad_frame', 'Frame is not JSON', 4400);
    }
    if (!msg || typeof msg !== 'object') {
      return fail(ws, 'bad_frame', 'Frame is not an object', 4400);
    }

    // The client sends `join` because the self-hosted relay reads the room id
    // from it. Here the room was already decided by the URL before the socket
    // was accepted, so this is a no-op rather than an error — one client has to
    // speak to both relays, and rejecting the frame would close the connection
    // on every join.
    if (msg.t === 'join') {
      if (msg.v !== PROTOCOL_VERSION) {
        return fail(ws, 'version', 'This relay speaks protocol version 1', 4426);
      }
      return;
    }
    if (msg.t === 'ping') return send(ws, { t: 'pong' });
    if (msg.t === 'leave') return ws.close(1000, 'left');
    if (msg.t !== 'send') {
      return fail(ws, 'bad_frame', `Unknown frame type ${msg.t}`, 4400);
    }

    if (typeof msg.c !== 'string') {
      return fail(ws, 'bad_frame', 'Field c must be a string', 4400);
    }
    if (msg.c.length > MAX_CIPHERTEXT) {
      return fail(ws, 'too_big', 'Message is over the size limit', 4413);
    }

    const att = ws.deserializeAttachment();
    const now = Date.now();
    // Sliding window. Over the limit the message is dropped and the socket
    // stays open: someone rolling enthusiastically is not an attacker, and
    // ending their table's session would be the worse failure.
    att.stamps = (att.stamps || []).filter(t => now - t < RATE_WINDOW_MS);
    if (att.stamps.length >= RATE_MSGS) {
      ws.serializeAttachment(att);
      return send(ws, { t: 'error', code: 'rate', detail: 'Sending too fast — this message was dropped' });
    }
    att.stamps.push(now);
    ws.serializeAttachment(att);

    const createdAt = await this.ctx.storage.get('createdAt');
    if (createdAt && now - createdAt > MAX_AGE_MS) {
      // The absolute cap is the only thing here resembling revocation. Someone
      // who leaves a room keeps the passphrase, so a room that never expired
      // would be readable by them forever.
      return this.expire('expired');
    }

    await this.arm();

    // `c` goes out exactly as it came in. This relay does not parse, validate,
    // reorder or deduplicate ciphertext, and could not if it wanted to.
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) send(peer, { t: 'msg', c: msg.c });
    }
  }

  async webSocketClose(ws) {
    this.roster(ws);
    if (this.ctx.getWebSockets().length <= 1) {
      // Last one out: drop the timestamp so nothing outlives the room.
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketError(ws) {
    // A socket that errored is gone whether or not it says so. Closing keeps
    // the roster honest rather than leaving a phantom member in the room.
    try { ws.close(1011, 'error'); } catch { /* already gone */ }
  }

  // The alarm is what makes a room evaporate. Without it an abandoned room
  // would keep its storage until something else touched the object, which for
  // an object nobody visits again is never.
  async arm() {
    const at = Date.now() + IDLE_MS;
    const existing = await this.ctx.storage.getAlarm();
    // Re-arming on every message would be a storage write per roll. Only push
    // the alarm out when it is close enough to matter.
    if (existing === null || at - existing > 60000) {
      await this.ctx.storage.setAlarm(at);
    }
  }

  async alarm() {
    const createdAt = await this.ctx.storage.get('createdAt');
    const now = Date.now();
    const sockets = this.ctx.getWebSockets();

    if (createdAt && now - createdAt > MAX_AGE_MS) return this.expire('expired');
    if (!sockets.length) {
      await this.ctx.storage.deleteAll();
      return;
    }
    // Still occupied and inside its lifetime, so this was an idle alarm that
    // the room outlived. Arm the next one.
    await this.ctx.storage.setAlarm(now + IDLE_MS);
  }

  async expire(reason) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        send(ws, { t: 'error', code: reason, detail: 'This room has expired' });
        ws.close(4408, reason);
      } catch { /* already gone */ }
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  // Count only. Who is present, and under what name, is inside the ciphertext
  // where this relay cannot read it — the roster it broadcasts is a number.
  roster(except) {
    const peers = this.ctx.getWebSockets().filter(ws => ws !== except);
    for (const ws of peers) send(ws, { t: 'roster', n: peers.length });
  }
}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch { /* closing or gone */ }
}

function fail(ws, code, detail, closeCode) {
  send(ws, { t: 'error', code, detail });
  try { ws.close(closeCode, code); } catch { /* already gone */ }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
