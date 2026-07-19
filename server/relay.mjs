// The Dicebox relay: a dumb broadcast fanout for encrypted rolls.
//
// It routes ciphertext between connections that share a room id and does
// nothing else. It has no key, so it cannot read a roll, and it holds no disk,
// so there is nothing to seize or subpoena after a room ends. Rolls are decided
// on the device by crypto.getRandomValues and only reported here; this process
// never decides an outcome and must never be given the chance to.
//
// Frames are parsed by `ws`, not by hand. Masking, fragmentation, 64-bit
// lengths and partial TCP reads are exactly the untrusted-input parsing where a
// mature library has already had its bugs found.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

// Numbers must parse. A typo'd cap that silently reverts to the default is a
// cap nobody notices is missing until the day it was supposed to hold.
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const PORT = envInt('DICEBOX_PORT', 8787);
const BIND = process.env.DICEBOX_BIND || '127.0.0.1';
const MAX_ROOMS = envInt('DICEBOX_MAX_ROOMS', 500);
const MAX_PER_ROOM = envInt('DICEBOX_MAX_PER_ROOM', 16);
const MAX_CONNECTIONS = envInt('DICEBOX_MAX_CONNECTIONS', 2000);
const IDLE_MS = envInt('DICEBOX_IDLE_MS', 30 * 60 * 1000);
const MAX_AGE_MS = envInt('DICEBOX_MAX_AGE_MS', 12 * 60 * 60 * 1000);
const RATE_MSGS = envInt('DICEBOX_RATE_MSGS', 30);
const RATE_WINDOW_MS = envInt('DICEBOX_RATE_WINDOW_MS', 10000);
// A real client sends join on 'open', so this is generous by an order of
// magnitude and only ever catches a socket that has no intention of joining.
const JOIN_TIMEOUT_MS = envInt('DICEBOX_JOIN_TIMEOUT_MS', 15000);
const TRUST_PROXY = process.env.DICEBOX_TRUST_PROXY === '1';

const ALLOWED_ORIGINS = (process.env.DICEBOX_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Cleartext envelope cap. `maxPayload` below makes this the library's problem
// before it is ever this file's.
const MAX_FRAME = 8192;

// Base64 of a padded 256-byte-block message; 6144 chars is comfortably above
// anything a legitimate roll produces and well under the envelope cap.
const MAX_CIPHERTEXT = 6144;

// Past this many bytes queued on a socket, the peer is not draining and never
// will. Dropping it bounds memory; waiting does not.
const MAX_BUFFERED = 256 * 1024;

const ROOM_ID = /^[0-9a-f]{32}$/;

const PROTOCOL_VERSION = 1;

const startedAt = Date.now();

// roomId -> { conns: Set<Conn>, createdAt, lastAt }
const rooms = new Map();
const connections = new Set();

// Logging is counts and truncated ids only. A relay whose logs reconstruct who
// played and when has given away the thing the encryption was protecting, and
// log files outlive the rooms they describe. Room ids are truncated to eight
// characters: enough to correlate two lines during an incident, not enough to
// rejoin the room or to confirm a guess against a captured id.
function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

const shortRoom = roomId => `${roomId.slice(0, 8)}…`;

// A per-connection id the relay invents. Deliberately not the crypto sender id
// from newSender(): that one lives inside ciphertext and identifies a person to
// their table, this one identifies a socket to the relay and nothing else.
function newConnId() {
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
}

function send(conn, obj) {
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  conn.ws.send(JSON.stringify(obj));
}

// Every error the client acts on is a stable token; `detail` is prose for a
// human and may change freely.
function fail(conn, code, detail, closeCode) {
  send(conn, { t: 'error', code, detail });
  conn.ws.close(closeCode);
}

function roomOf(conn) {
  return conn.roomId ? rooms.get(conn.roomId) : undefined;
}

function broadcast(room, from, obj) {
  const wire = JSON.stringify(obj);
  for (const peer of room.conns) {
    // The sender is never echoed. A client renders its own roll from its own
    // local result before the socket is consulted at all, so an echo would add
    // a duplicate and, worse, invite a client to wait for one.
    if (peer === from) continue;
    if (peer.ws.readyState !== peer.ws.OPEN) continue;
    if (peer.ws.bufferedAmount > MAX_BUFFERED) {
      dropSlow(peer);
      continue;
    }
    peer.ws.send(wire);
  }
}

function dropSlow(conn) {
  log('drop_slow', { room: conn.roomId ? shortRoom(conn.roomId) : null });
  conn.ws.close(1013, 'Too slow');
}

function announceRoster(room, except) {
  broadcast(room, except, { t: 'roster', n: room.conns.size });
}

function destroyRoom(roomId) {
  rooms.delete(roomId);
}

// A room exists only while someone is in it. No grace period and nothing
// retained: no message buffer, no history, no name table. If a field here ever
// outlives a broadcast, that is the moment to stop and check it against the
// promise that rooms evaporate.
function removeConn(conn) {
  if (!connections.delete(conn)) return;
  const room = roomOf(conn);
  if (!room) return;
  room.conns.delete(conn);
  if (room.conns.size === 0) destroyRoom(conn.roomId);
  else announceRoster(room, conn);
}

function handleJoin(conn, msg) {
  if (conn.roomId) return fail(conn, 'bad_frame', 'Already joined', 4400);
  if (msg.v !== PROTOCOL_VERSION) {
    return fail(conn, 'version', 'This relay speaks protocol version 1', 4426);
  }
  if (typeof msg.room !== 'string' || !ROOM_ID.test(msg.room)) {
    // Strict because this is a routing key, not a user string. Loose validation
    // here is how you end up with a room-id space you cannot reason about.
    return fail(conn, 'bad_room', 'Room id must be 32 lowercase hex characters', 4400);
  }

  let room = rooms.get(msg.room);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      return fail(conn, 'server_full', 'This relay is at its room limit', 4503);
    }
    const now = Date.now();
    room = { conns: new Set(), createdAt: now, lastAt: now };
    rooms.set(msg.room, room);
  }

  if (room.conns.size >= MAX_PER_ROOM) {
    return fail(conn, 'room_full', `Room is at its ${MAX_PER_ROOM} connection limit`, 4403);
  }

  conn.roomId = msg.room;
  room.conns.add(conn);
  room.lastAt = Date.now();

  // There is deliberately no "unknown room" error. Any valid id can be joined,
  // and joining one nobody else holds simply creates a room of one. The relay
  // cannot tell a wrong passphrase from being first to arrive, and inventing an
  // error would turn it into an oracle for probing which rooms are live.
  send(conn, {
    t: 'joined',
    v: PROTOCOL_VERSION,
    you: conn.id,
    n: room.conns.size,
    expires: room.createdAt + MAX_AGE_MS,
  });
  announceRoster(room, conn);
}

// Sliding count over one window. Over the limit, the offending send is dropped
// and the socket stays open: a fast-fingered player is not an attacker, and
// ending a table's session over an enthusiastic minute is a worse failure than
// the one being prevented. Three consecutive windows over limit is no longer a
// player, and that does close.
function rateOk(conn) {
  const now = Date.now();
  if (now - conn.windowAt >= RATE_WINDOW_MS) {
    conn.overRuns = conn.windowCount > RATE_MSGS ? conn.overRuns : 0;
    conn.windowAt = now;
    conn.windowCount = 0;
  }
  conn.windowCount++;
  if (conn.windowCount <= RATE_MSGS) return true;
  if (conn.windowCount === RATE_MSGS + 1) conn.overRuns++;
  return false;
}

function handleSend(conn, msg) {
  const room = roomOf(conn);
  if (!room) return fail(conn, 'bad_frame', 'Join before sending', 4401);
  if (typeof msg.c !== 'string') {
    return fail(conn, 'bad_frame', 'Field c must be a string', 4400);
  }
  if (msg.c.length > MAX_CIPHERTEXT) {
    return fail(conn, 'too_big', 'Message is over the size limit', 4413);
  }
  if (!rateOk(conn)) {
    if (conn.overRuns >= 3) {
      return fail(conn, 'rate', 'Sustained rate limit', 4429);
    }
    send(conn, { t: 'error', code: 'rate', detail: 'Sending too fast — this message was dropped' });
    return;
  }

  room.lastAt = Date.now();
  // `c` goes out exactly as it came in. The relay does not parse, validate,
  // reorder or deduplicate ciphertext, and could not if it wanted to.
  broadcast(room, conn, { t: 'msg', c: msg.c });
}

function handleFrame(conn, data, isBinary) {
  // Binary frames are rejected outright: the protocol is one JSON object per
  // text message, and accepting a second encoding is a second parser.
  if (isBinary) return fail(conn, 'bad_frame', 'Binary frames are not accepted', 4400);

  const text = data.toString();
  if (text.length > MAX_FRAME) {
    return fail(conn, 'too_big', 'Frame is over the size limit', 4413);
  }

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return fail(conn, 'bad_frame', 'Frame is not JSON', 4400);
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
    return fail(conn, 'bad_frame', 'Frame must be an object with a string t', 4400);
  }

  // Anything before join closes the socket. There is no partial tolerance: a
  // client sending frames out of order is broken or hostile, and neither
  // improves by being humoured.
  if (msg.t !== 'join' && !conn.roomId) {
    return fail(conn, 'bad_frame', 'First frame must be join', 4401);
  }

  switch (msg.t) {
    case 'join': return handleJoin(conn, msg);
    case 'send': return handleSend(conn, msg);
    case 'ping': return send(conn, { t: 'pong' });
    case 'leave': return conn.ws.close(1000);
    default: return fail(conn, 'bad_frame', `Unknown frame type ${msg.t}`, 4400);
  }
}

// Both timers run. Idle alone is insufficient: a table that stays busy for a
// fortnight would keep a room alive indefinitely, and the absolute cap is the
// only thing here resembling revocation — a departed member keeps the
// passphrase forever, so access has to expire on a schedule instead.
function sweep(now = Date.now()) {
  for (const [roomId, room] of rooms) {
    const idle = now - room.lastAt >= IDLE_MS;
    const old = now - room.createdAt >= MAX_AGE_MS;
    if (!idle && !old) continue;
    for (const conn of room.conns) {
      send(conn, { t: 'error', code: 'expired', detail: 'Room has expired' });
      conn.ws.close(4408);
    }
    log('room_expired', { room: shortRoom(roomId), reason: old ? 'max_age' : 'idle' });
    destroyRoom(roomId);
  }
}

const sweepTimer = setInterval(() => sweep(), 30000);
sweepTimer.unref();

// A phone that loses network without a FIN — lid closed, NAT rebind, carrier
// handoff — leaves a half-open socket the kernel has no reason to notice, so
// 'close' never fires and removeConn never runs. The zombie then holds one of
// MAX_PER_ROOM forever, and sixteen of them return 'room_full' for a room with
// nobody in it. The client's own 'ping' frame cannot cover this: it is
// client-initiated, and a dead client by definition stops sending it. TCP
// keepalive is off by default in Node and would take hours anyway.
//
// The same pass drops sockets that never join. A connection with roomId null is
// in no room, so nothing else here can see it: sweep() walks rooms, the rate
// limiter is only reached from a frame handler, and MAX_ROOMS/MAX_PER_ROOM are
// checked inside handleJoin. Two thousand silent sockets would therefore sit
// until they filled MAX_CONNECTIONS and every real player got a 503, while
// /health still reported zero rooms and looked healthy.
function heartbeat(now = Date.now()) {
  for (const conn of connections) {
    if (conn.roomId === null && now - conn.acceptedAt > JOIN_TIMEOUT_MS) {
      conn.ws.terminate();
      removeConn(conn);
      continue;
    }
    if (!conn.alive) {
      // terminate(), not close(): a peer that did not answer a ping will not
      // complete a closing handshake either, and close() would wait for one.
      conn.ws.terminate();
      removeConn(conn);
      continue;
    }
    conn.alive = false;
    conn.ws.ping();
  }
}

const heartbeatTimer = setInterval(heartbeat, 30000);
heartbeatTimer.unref();

const server = createServer((req, res) => {
  const path = (req.url || '').split('?')[0];

  if (req.method === 'GET' && (path === '/health' || path === '/healthz')) {
    // Counts only, never room ids. Health output ends up in monitoring systems,
    // logs and screenshots, and a room id plus a wordlist is a starting point.
    return json(res, 200, {
      ok: true,
      rooms: rooms.size,
      connections: connections.size,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  }

  if (req.method === 'GET' && path === '/ws') {
    return json(res, 426, { error: 'upgrade_required' });
  }

  // No static file serving, under any configuration. A separate origin serving
  // the app is what makes the self-hosted guarantee real; merging the two would
  // quietly destroy it.
  json(res, 404, { error: 'not_found' });
});

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

// noServer, so the upgrade handler decides. Letting `ws` attach to the server
// directly would accept upgrades on every path rather than just /ws.
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

function originAllowed(origin) {
  // A missing Origin is allowed: native clients and the single-file build
  // opened from file:// have no meaningful origin, and the single-file build is
  // a first-class client. This check is CSRF hygiene, not authentication —
  // there is nothing here to authenticate.
  if (!ALLOWED_ORIGINS.length) return true;
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '').split('?')[0];
  if (path !== '/ws') return refuse(socket, 404, 'Not Found');
  if (!originAllowed(req.headers.origin)) return refuse(socket, 403, 'Forbidden');
  if (connections.size >= MAX_CONNECTIONS) return refuse(socket, 503, 'Service Unavailable');

  wss.handleUpgrade(req, socket, head, ws => accept(ws, req));
});

function refuse(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function accept(ws, req) {
  const now = Date.now();
  const conn = {
    id: newConnId(),
    ws,
    roomId: null,
    ip: clientIp(req),
    acceptedAt: now,
    windowAt: now,
    windowCount: 0,
    overRuns: 0,
    alive: true,
  };
  connections.add(conn);

  ws.on('pong', () => { conn.alive = true; });

  ws.on('message', (data, isBinary) => {
    // A throw while handling one client's frame must not take down every other
    // table on the relay, so the blast radius is bounded to this socket.
    try {
      handleFrame(conn, data, isBinary);
    } catch {
      fail(conn, 'bad_frame', 'Frame could not be handled', 4400);
    }
  });

  // Without this, a socket error — a reset mid-write is the common one —
  // reaches the process as an unhandled 'error' event and exits it.
  ws.on('error', () => ws.close());
  ws.on('close', () => removeConn(conn));
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

let shuttingDown = false;

// Clients are told the relay is going away so they back off rather than
// stampeding one that is still coming up.
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutdown', { signal, rooms: rooms.size, connections: connections.size });

  server.close();
  for (const conn of connections) {
    send(conn, { t: 'error', code: 'going_away', detail: 'Relay is restarting' });
    conn.ws.close(1001);
  }
  rooms.clear();

  // Sockets that do not close on request must not hold the process open.
  const hard = setTimeout(() => process.exit(0), 3000);
  hard.unref();
  wss.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, BIND, () => {
  log('listening', {
    bind: BIND,
    port: PORT,
    origins: ALLOWED_ORIGINS.length || 'any',
    maxRooms: MAX_ROOMS,
    maxPerRoom: MAX_PER_ROOM,
    maxConnections: MAX_CONNECTIONS,
  });
});

// Exported for tools/test-relay.mjs, which needs to drive expiry and the
// heartbeat by hand rather than waiting out their timers.
export { server, wss, rooms, connections, sweep, heartbeat, shutdown };
