# The Dicebox relay

A small WebSocket server that forwards encrypted rolls between people who share
a passphrase. It is a broadcast fanout and nothing more: it cannot read a roll,
it does not decide one, and it writes nothing to disk.

Dicebox works with no relay at all. Rolling is local by default and stays local
if this process is unreachable — the app rolls instantly and shows a notice
rather than spinning or queueing. The relay only adds the shared-table feature.

## Running it

Node 18 or newer. One dependency, `ws`, already in the project's
`package.json`.

```
npm install
node server/relay.mjs
```

It binds `127.0.0.1:8787` by default, so a fresh install is not reachable from
the network until you say otherwise. Put it behind a TLS terminator — nginx,
Caddy, Cloudflare — and point the app's `connect-src` at that origin.

Behind nginx, the upgrade needs forwarding explicitly:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 120s;
}
```

`proxy_read_timeout` matters: the default 60 s is above the client's 25 s ping,
but a proxy that idles sockets out faster than that will cause reconnect loops
that look like relay flapping.

## Configuration

All via environment variables. A value that is not a positive integer is a
startup failure with a message, not a silent fall back to the default — a
typo'd cap that quietly reverts is a cap nobody notices is missing.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DICEBOX_PORT` | `8787` | Listen port |
| `DICEBOX_BIND` | `127.0.0.1` | Bind address. Loopback by default: a relay that binds `0.0.0.0` the moment it is installed is a relay someone exposed by accident. Compose sets `0.0.0.0` explicitly inside the container network. |
| `DICEBOX_ALLOWED_ORIGINS` | *(unset — all allowed)* | Comma-separated exact origins, e.g. `https://dicebox.trollskull.cc` |
| `DICEBOX_MAX_ROOMS` | `500` | Concurrent rooms |
| `DICEBOX_MAX_PER_ROOM` | `16` | Connections per room |
| `DICEBOX_MAX_CONNECTIONS` | `2000` | Connections process-wide |
| `DICEBOX_IDLE_MS` | `1800000` (30 min) | Room dies after this long with no traffic |
| `DICEBOX_MAX_AGE_MS` | `43200000` (12 h) | Absolute cap from room creation |
| `DICEBOX_RATE_MSGS` | `30` | Messages per window per connection |
| `DICEBOX_RATE_WINDOW_MS` | `10000` | Rate window |
| `DICEBOX_TRUST_PROXY` | `0` | `1` to read `X-Forwarded-For` for per-IP limits |

Set `DICEBOX_ALLOWED_ORIGINS` on any public deployment. A connection with no
`Origin` header is still allowed even when the list is set, because the
single-file build opened from `file://` has no meaningful origin and is a
first-class client. This is CSRF hygiene rather than authentication; there is
nothing here to authenticate.

## Endpoints

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/health` | `200 {"ok":true,"rooms":3,"connections":7,"uptime":1234}` |
| `GET` | `/healthz` | The same, for callers that expect that spelling |
| `GET` | `/ws` | `426 Upgrade Required` for a plain GET; WebSocket upgrades here |
| any | anything else | `404 {"error":"not_found"}` |

The relay serves no static files under any configuration. A separate origin
serving the app is what makes the self-hosted guarantee real, and merging the
two would quietly destroy it.

## What it can see

Being honest about this is the point, so the list is exhaustive.

- **Room ids.** A 128-bit value derived from the passphrase through PBKDF2 and
  HKDF. It cannot be reversed to the passphrase and reveals nothing about the
  message key, which is derived separately with a different info string.
- **Ciphertext.** Opaque blobs, passed through verbatim.
- **Traffic shape.** How many connections are in a room, when they arrive and
  leave, and roughly how often they send. End-to-end encryption hides content,
  not the existence of a session, and claiming otherwise would be overselling
  it. Every message is padded to a 256-byte block before encryption, so length
  does not leak dice count or name length.
- **IP addresses,** at the TCP layer, as any server does. They are used for
  connection limits and are never logged.

## What it cannot see

Names, notation, dice values, totals, timestamps and per-sender sequence
numbers all live inside the ciphertext, authenticated by `room-crypto.js`. The
relay has no key and no way to obtain one: **no key material crosses the relay
in either direction, ever** — not for join, not for rekey, not to pass a key to
a newcomer. There is no field in the protocol that could carry it.

It also cannot tell a wrong passphrase from being the first to arrive. Joining
a room id nobody else holds simply creates a room of one, and there is
deliberately no "unknown room" error — inventing one would turn the relay into
an oracle for probing which rooms are live.

## Why it stores nothing

Rooms live in a `Map` and evaporate. A room exists while it has at least one
connection and is destroyed the moment the last one leaves — immediately, with
no grace period and nothing retained. There is no message buffer and no
history, so a client joining mid-session sees rolls from that moment on. The
app says so rather than tolerating it silently.

Two timers run, because idle alone is insufficient:

- **Idle** — 30 minutes with no traffic and the room dies.
- **Absolute age** — 12 hours from creation regardless of activity.

The absolute cap is the only thing here resembling revocation. Someone who
leaves the table keeps the passphrase forever, so access has to expire on a
schedule instead of on a decision nobody is in a position to make. Both send
`{"t":"error","code":"expired"}` and close with `4408`.

Nothing is written to disk at any point. There is no database, no log file, no
cache directory, and the container can run read-only.

## Logging

Structured JSON to stdout: startup, shutdown, room expiry, and dropped slow
connections. Room ids are truncated to eight characters, which is enough to
correlate two lines during an incident and not enough to rejoin the room or
confirm a guess against a captured id.

Never logged: ciphertext, full room ids, IP addresses, message counts per room,
or anything else client-derived. Log files outlive the rooms they describe, and
a relay whose logs reconstruct who played and when has given away the thing the
encryption was there to protect.

## Limits and failure behaviour

- **Frame size** — 8192 bytes cleartext, enforced by `ws`'s `maxPayload` before
  this code sees it, and 6144 base64 chars in a `send`. Over either:
  `too_big`, close `4413`.
- **Rate** — over 30 messages per 10 s, the offending message is dropped and
  `{"t":"error","code":"rate"}` is sent with the socket left open. This is the
  only error not followed by a close: a fast-fingered player is not an attacker,
  and dropping a table's session over an enthusiastic minute is a worse failure
  than the one being prevented. Three consecutive windows over the limit is no
  longer a player, and closes with `4429`.
- **Backpressure** — a socket with more than 256 KB queued is not draining and
  is closed. Waiting on it would grow memory without bound.
- **Malformed frames** — not JSON, no string `t`, an unknown `t`, a room id that
  is not 32 lowercase hex characters, or anything before `join`: an `error` and
  a close. There is no partial tolerance; a client sending garbage is broken or
  hostile, and neither improves by being humoured.
- **Errors** are contained to one socket. A throw while handling one client's
  frame closes that connection rather than taking down every other table.

## Shutdown

`SIGTERM` and `SIGINT` stop accepting connections, send
`{"t":"error","code":"going_away"}` to everyone, close with `1001`, and exit. A
client treats that as retryable and backs off, so a restart does not produce a
stampede against a relay that is still coming up.
