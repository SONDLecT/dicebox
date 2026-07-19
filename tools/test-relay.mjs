// Tests for the relay heartbeat.
//
// The failure being guarded against is invisible to a normal round trip: a
// client that vanishes without a FIN leaves a socket the relay still believes
// is live, and the Conn sits in room.conns holding one of MAX_PER_ROOM until
// the idle sweep eventually takes the whole room. A busy room never goes idle,
// so on a busy room it never clears at all.
//
// A half-open socket cannot be produced honestly in-process, so it is
// simulated the only way that matters: a client that answers pings is kept, a
// client whose pong is suppressed is reaped after two heartbeat rounds.
import { WebSocket } from 'ws';
import { server, rooms, connections, heartbeat, shutdown } from '../server/relay.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const ROOM = 'a'.repeat(32);

const listening = new Promise(resolve => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
});
await listening;
const { port } = server.address();

// Waits for the 'joined' reply rather than the socket opening: a Conn only
// occupies a room slot once the join frame has been handled server-side.
function joinedClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', v: 1, room: ROOM })));
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'joined') resolve(ws);
    });
  });
}

const live = await joinedClient();
const zombie = await joinedClient();

// Stops the pong at the source. From the relay's side this is exactly a socket
// that has stopped answering, which is what a lid-closed phone looks like.
zombie._receiver.removeAllListeners('ping');

ok('both clients hold room slots', rooms.get(ROOM)?.conns.size === 2);

heartbeat();
// The pong is a network round trip, so the reply has to land before the next
// round is allowed to judge it.
await new Promise(r => setTimeout(r, 200));

ok('one round reaps nobody', connections.size === 2);

heartbeat();
await new Promise(r => setTimeout(r, 200));

ok('the silent socket is reaped', connections.size === 1);
ok('its room slot is released', rooms.get(ROOM)?.conns.size === 1);
ok('the answering socket survives', live.readyState === WebSocket.OPEN);

// The room must still evaporate on its own terms once the last real client
// goes, rather than being kept alive by the reaping.
live.close();
await new Promise(r => setTimeout(r, 200));
ok('room is gone when the last client leaves', !rooms.has(ROOM));

// A socket that completes the handshake and then says nothing joins no room, so
// it is invisible to the idle sweep and to both room caps. Left alone it holds a
// MAX_CONNECTIONS slot for free, which is a whole-relay denial of service for
// the cost of an idle TCP socket. The timeout is driven by hand here rather than
// waited out.
const silent = new WebSocket(`ws://127.0.0.1:${port}/ws`);
await new Promise(r => silent.on('open', r));

ok('the silent socket holds a connection slot', connections.size === 1);
ok('it is in no room', !rooms.has(ROOM));

heartbeat();
await new Promise(r => setTimeout(r, 200));
ok('it survives while inside the join window', connections.size === 1);

// Far enough past the window that the exact value of JOIN_TIMEOUT_MS does not
// matter to this test.
heartbeat(Date.now() + 60000);
await new Promise(r => setTimeout(r, 200));
ok('it is dropped once the join window passes', connections.size === 0);

// A joined connection must not be caught by the same rule, however old it is.
const joined = await joinedClient();
heartbeat(Date.now() + 60000);
await new Promise(r => setTimeout(r, 200));
ok('a joined connection is not dropped for age', connections.size === 1);
ok('it keeps its room slot', rooms.get(ROOM)?.conns.size === 1);
joined.close();
await new Promise(r => setTimeout(r, 200));

console.log(`\n${pass} passed, ${fail} failed`);
shutdown('test');
process.exitCode = fail ? 1 : 0;
