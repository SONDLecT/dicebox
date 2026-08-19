# The Dicebox room API

**Status: DRAFT for review.** This documents the passphrase-room transport as a
contract third-party apps can build against. The wire it describes already ships
and runs; what is new here is the promise to keep it stable and the guidance for
speaking it from outside Dicebox. Nothing about the app changes by writing this
down — but once an app depends on it, the shapes below stop being ours to move
freely, so read it as the thing we are agreeing to hold still.

The implementation lives in [`room.js`](../room.js) (transport, presence,
validation) and [`room-crypto.js`](../room-crypto.js) (key derivation, message
encryption). Both ship in the main app bundle, so this transport is available on
**every** build — dicebox.cc, the installed PWA, and self-hosted copies alike.

This is a different thing from the [Owlbear bridge](../owlbear/API.md). That one
is a request/response RPC, local to a single Owlbear client, where Dicebox rolls
on a caller's behalf and answers. This one is a peer group: everyone holding the
passphrase is equal, rolls are announced, and there is no authority to ask. If
you want "ask Dicebox to roll and get the outcome back," that is the Owlbear
document, not this one.

## Read this before anything else: the trust model

Identity in a room is two things and nothing more: **you hold the passphrase, and
you picked a display name.** There is no cryptographic person. The name is a free
string set by whoever sends the message.

Three consequences follow, and every integration has to be built around them:

1. **The passphrase is the entire capability.** Holding it lets a client read
   every message in the room and publish under any name. There is no narrower
   grant — no "read only," no "publish as this one player," no per-app key you
   can revoke. Handing an app the passphrase is handing it full room membership,
   exactly the trust you extend when you paste a room link to a friend.

2. **Validation is a typo-catcher, not cheat detection.** Anyone who can encrypt
   for the room can encrypt a self-consistent lie. The checks in this document
   exist to drop malformed or out-of-version frames, nothing more. A frame that
   fails them is dropped **silently** — no badge, no warning, no "rejected"
   marker — because every one of those would imply an assurance that is not
   there.

3. **Never present a received roll as verified or authoritative.** It is a claim
   by a passphrase-holder. Display it as such. The moment an integration renders
   a "verified roll" checkmark, it is lying to its user about what the room can
   prove, which is: that the sender knew the passphrase. That is all.

The room is end-to-end encrypted, so the *relay* is untrusted and blind. The
*members* are trusted because they share a secret. Do not confuse the two.

## Transport

Each deployment reaches exactly one relay origin, pinned by the page's
`connect-src` (see [`worker.js`](../worker.js)). Rooms do not work against any
other relay — the Content-Security-Policy blocks the socket before it opens. The
hosted relay for dicebox.cc is `wss://relay.dicebox.cc`.

A client connects a WebSocket to the relay with the room id in the query string
(`?room=<roomId>`) and also in the first frame, so one client can speak to either
the hosted relay (which routes by socket name) or a self-hosted one (which reads
the frame). The relay is a dumb router: it forwards ciphertext among the sockets
in a room and holds no history, no roster, and no keys.

### Frames (client ↔ relay)

Frames are JSON with a string `t`. They are **not** encrypted — they are the
envelope the relay reads to route. The encrypted payload rides inside `send` /
`msg` as an opaque base64 string `c`.

Client → relay:

| `t` | Fields | Meaning |
| --- | --- | --- |
| `join` | `v`, `room` | Join the room. `v` is `PROTOCOL_VERSION`. |
| `send` | `c` | Broadcast one encrypted message to the room. |
| `leave` | — | Depart cleanly. |
| `ping` | — | Heartbeat (~25s), under proxy idle timeouts. |

Relay → client:

| `t` | Fields | Meaning |
| --- | --- | --- |
| `joined` | `you`, `n`, `expires` | Accepted. `you` is this socket's relay id; `expires` is the room's expiry. |
| `roster` | `n` | Member count changed. |
| `msg` | `c` | An encrypted message from a member. |
| `pong` | — | Heartbeat reply. |
| `error` | `code`, `detail?` | See below. |

Error codes a client must handle: `version` (client too old — reload),
`room_full`, `expired`, `rate` (slow down — the roll still happened locally, do
**not** retry), `bad_room`, `bad_frame`, `too_big`. All except `rate` and
`expired` are terminal. `rate` is deliberately non-fatal: a fast-fingered player
is not an attacker.

Presence is derived by the members, not the relay: each announces itself with a
`hello` and ages peers out of its own roster on a TTL (~90s) if they go quiet.
There is no authoritative member list anywhere.

**Rolls are fire-and-forget and are never queued.** If the socket is down when a
roll happens, it is not sent and not buffered — a roll surfacing minutes later,
after the table has moved on, reads as a replay and is worse than one that never
arrives. Every design here follows from rolling being local and never waiting on
the network.

## Crypto

Everything the room needs comes from the passphrase alone. The relay learns the
room id and nothing else.

```
K       = PBKDF2-SHA256(passphrase, salt="dicebox-room-v1", iters=600000)  -> 256 bits
roomId  = HKDF-SHA256(K, info="dicebox-room-v1-id")   -> 128 bits, hex   (the relay sees this)
roomKey = HKDF-SHA256(K, info="dicebox-room-v1-key")  -> AES-256-GCM key (never leaves the device)
```

The passphrase is normalized first (trimmed, lowercased, separators collapsed to
single hyphens). A generated passphrase is five words from the EFF short wordlist
(~64 bits). `roomId` reveals nothing about `roomKey`: HKDF is one-way and the two
use different `info` strings.

Each message is:

- Serialized as JSON with an envelope (below), then **padded** to a multiple of
  256 bytes. Padding is load-bearing privacy, not hygiene: without it the
  ciphertext length would let the blind relay tell a `1d20` from `20d6`, and tell
  players apart by name length.
- Encrypted with AES-256-GCM. The **nonce is `senderId(4) || counter(8)`, never
  random** — every member encrypts under the same key, and a repeated GCM nonce
  does not merely weaken, it leaks the auth key and the XOR of both plaintexts.
- Authenticated with additional data `"<roomId>:<PROTOCOL_VERSION>"`, so a
  message cannot be replayed into another room or reinterpreted under another
  version.
- Wire form: `base64(nonce(12) || ciphertext)`.

`PROTOCOL_VERSION` is `1`. It rides inside the ciphertext **and** in the AAD; a
version mismatch fails closed rather than interoperating badly, which matters
because the service worker keeps old clients in circulation long after a change
ships.

### The envelope

Every decrypted payload carries, inside the ciphertext:

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | int | `PROTOCOL_VERSION`. Mismatch → reject. |
| `from` | hex(4) | Sender id. **Must** equal the nonce's first 4 bytes, or reject. |
| `seq` | int | Per-sender monotonic counter. `seq <= last seen` → reject as replay. |
| `k` | string | The message kind (below). |

Two rules that are not optional for a correct client:

- **`from` must match the nonce prefix.** `from` is attacker-editable within the
  room (every member holds the key), so binding attribution to it alone let a
  member forge `from: victim, seq: huge` and permanently poison the victim's
  replay counter, silently vanishing their real messages. Bind to the nonce
  prefix, which a second sender cannot reuse without repeating a nonce.
- **Track `seq` per `from`** and reject non-increasing values, or captured
  messages replay into every tray.

## Message kinds

All five current kinds. **Unknown kinds are ignored in silence** — that is what
lets a later version add one without breaking clients served from an old cache.
An integration should do the same.

### `hello` / `bye` — presence

```json
{ "k": "hello", "at": 1723900000000, "name": "Kira", "reply": true }
{ "k": "bye",   "at": 1723900050000 }
```

`reply:true` asks existing members to answer with their own `hello` (`reply:false`
on the answer, or N members chorus). Answers are jittered. A member with a torch
state answers with a `torch` alongside, so a newcomer learns the light with the
roster.

### `roll` — a numeric roll

```json
{
  "k": "roll", "at": 1723900100000, "id": "dicebox-roll-abc",
  "name": "Kira", "notation": "2d20+3", "total": 27,
  "groups": [
    { "kind": "dice", "sign": 1, "sides": 20, "count": 2, "subtotal": 24,
      "dice": [ { "value": 20, "kept": true }, { "value": 4, "kept": true } ] },
    { "kind": "const", "sign": 1, "value": 3 }
  ]
}
```

`validateRoll` (the read-side check) requires:

- `notation` a non-empty string; `total` finite; `groups` non-empty.
- Each group has `sign` of `1` or `-1`.
- `const`: integer `value`.
- `dice`: integer `sides` in `1..10000`, integer `count` in `1..500`, a `dice`
  array of exactly `count` entries. Each die has an integer `value >= 1`; an
  unexploded die may not exceed `sides` (the typo this catches); `kept` dice sum
  to `subtotal`.
- The signed sum of `const` values and dice subtotals must equal `total`. A roll
  that does not reconcile is dropped.

`id` is the sender's stable roll id. A receiver bridging two transports (a relay
room and the Owlbear bus at once) uses it to drop the second copy.

### `roll2` — a system roll

The system modes (V5, Fate, Genesys, card draws, …) do not reduce to one numeric
total, so they travel as `roll2` carrying the system id, notation, dice groups,
and the per-system summary the sender already computed.

```json
{
  "k": "roll2", "at": 1723900200000, "id": "dicebox-roll-def",
  "name": "Kira", "system": "v5", "notation": "v5:6h2",
  "groups": [ { "kind": "dice", "sides": 10, "dice": [ { "value": 10, "role": "hunger" } ] } ],
  "summary": { "successes": 4, "messy": true },
  "parentId": "dicebox-roll-abc",
  "transition": { "kind": "willpower", "held": [0,1], "rerolled": [2], "added": [] }
}
```

`validateSystemRoll` requires:

- `system` one of the known ids. **The id is the reducer's id, not always the
  picker slug** — Call of Cthulhu travels as `coc`, Alien as `yearzero`,
  Starforged as `ironsworn`. Miss it and every roll from that mode is dropped
  silently at the receiver. Current set: `v5, fate, genesys, daggerheart,
  cthulhutech, starwars, onering, pbta, mist, drawsteel, crows, shadowdark,
  mothership, coc, deltagreen, ironsworn, oracle, yearzero, bladerunner,
  twilight, cards, tarot, napoletane, hanafuda, utagaruta`.
- `notation` a non-empty string ≤ 200 chars.
- `summary` a plain object (trusted for display only, rendered inside a
  try/catch — bound your own fields, but the receiver will not crash on a weird
  one).
- `groups` a non-empty array, ≤ 50, of:
  - `const`: integer `value`.
  - `cards`: a `cards` array of 1..12 `{ id (≤16), label (≤24), rev?: bool }`.
  - `dice`: a `dice` array of 1..500, optional `sides` in `1..10000`; each die
    has integer `value` in `-100..100000` (Fate goes negative, exploded goes
    high), optional `sides`, optional `symbols` (≤12 strings ≤24), and optional
    short string tags `color` / `role` / `face` / `type` (≤24) the renderer keys
    colour and role off.
- Optional `parentId` (≤96) links a follow-up to its origin roll.
- Optional `transition` for the two-beat mechanics, `kind` one of `push`,
  `willpower`, `surge`, with `held` / `rerolled` / `added` arrays of dice indices
  (each ≤100 entries, each index `0..99`). **Rejecting an unknown transition kind
  drops the whole roll, not just its animation** — this is the bug that ate
  Willpower rerolls when the allowed set was just `push`.

### `torch` — the shared Shadowdark torch

The one piece of shared *table state* on this transport (everything else is an
announcement of a local event). Last-write-wins on `setAt`.

```json
{ "k": "torch", "at": 1723900300000, "name": "Kira", "end": 1723903900000, "setAt": 1723900300000 }
```

`end` is the absolute burn-out timestamp (or `null` for a snuffed torch, kept as
a record so a stale "lit" cannot relight a darkened room). Bounds: a torch burns
one hour, so an `end` more than two hours out is a liar's and is rejected; a
`setAt` far in the future would win every merge forever and is rejected.

## Reading a room (observe)

1. `deriveRoom(passphrase)` → `{ roomId, key }`.
2. Open the socket, send `join`, then `hello` on `joined`.
3. For each `msg`, decrypt (checking `v`, the `from`/nonce binding, and `seq`),
   then dispatch on `k`.
4. Ignore unknown kinds. A decrypt failure means a wrong passphrase, a corrupted
   frame, or tampering — indistinguishable by design; count them rather than
   reporting each, and surface "check the passphrase" only after a run of them.

The cleanest way to get all of this right is to **import `room.js` and
`room-crypto.js` directly** rather than reimplement the protocol. They are
dependency-free and already handle the nonce discipline, replay guard, presence,
and reconnect. Reimplementing from this prose is possible but is exactly the
brittle path this document exists to discourage.

## Publishing to a room (announce a roll — including as a player)

An app that publishes is just another peer. There is no separate "app" role and
no handshake to grant: a client that holds the passphrase and speaks the wire is
a full member. To roll *as a player* — the character-sheet case — the app does
its own roll and announces it under that player's name.

1. Join as above. Set `name` to the player you are rolling for. (The name is
   free; that it is "yours" is a convention between you and the table, not
   something the room enforces or can.)
2. **Produce a valid payload by reusing Dicebox's dice engine, not by
   reimplementing it.** [`system-dice.js`](../system-dice.js) and
   [`dice.js`](../dice.js) are dependency-free and produce exactly the `groups` /
   `summary` / `notation` shapes above. Hand-built payloads that miss a bound or
   a system id are dropped **silently** by the validators — you will see nothing,
   not an error. Rolling through the engine also keeps what the app displays and
   what it publishes from drifting apart.
3. Set a stable `id` (roll id) so a receiver on two transports dedupes your roll.
4. Encrypt and send. One sender per live connection; never reuse a `senderId`
   across two open sockets, or you repeat a nonce.

Because publishing is just membership, an app that rolls as you needs your
machine no more than a friend's copy of Dicebox does: it rolls and announces
under your name, whether or not your own client is open. That is the whole
mechanism — there is no remote-control channel and no authority to elect.

## What you could build on this

Two families, split by which capability they need — and the split is the whole
security story. A reader carries the passphrase to *watch* a room; a publisher
carries it to *be a member of* one. Reach for read-only whenever the job allows
it.

**Read-only — observe the feed.** These join, decrypt, and render. They publish
nothing, so the passphrase they hold is only ever "let me watch this table," and
it need live no longer than the session on screen.

- **A broadcast overlay.** An actual-play stream shows the table's latest roll,
  big and legible, in an OBS browser source — the `roll2` summary rendered in the
  show's own style. The relay never sees the rolls, the stream does.
- **A chat bridge.** Mirror each roll into Discord or a group chat as one line —
  "Kira · v5:6h2 → 4 successes, messy crit." Formatting the summary is the entire
  job; there is nothing to run server-side.
- **A session log.** Append the feed to a local file so a table keeps a full
  transcript after the game, past the app's own bounded history. A recap tool, a
  play-by-post archive, a GM's notes.
- **An ambient cue.** A text-to-speech reader that announces results for players
  who can't see the screen, or a smart-light that flushes red on a botch. Reacts
  to the feed, adds nothing to it.

**Publishing — roll as a player.** These announce rolls under a player's name, so
they need full membership, and handing one the passphrase is handing it the room.
Do it deliberately, for tools you'd trust with the link anyway.

- **A character sheet.** The canonical case. Tap "Firebolt" on your sheet and the
  roll appears at the table as yours — the sheet rolls through Dicebox's engine
  and announces it, whether or not your own Dicebox is even open.
- **A physical-dice bridge.** A Bluetooth smart-die (Pixels-style) publishes your
  real-table throws into the room under your name, so remote players see the
  actual dice you rolled on the table.
- **A GM helper.** A tool that rolls random encounters, morale checks, or an
  oracle's yes/no and drops the results into the shared feed as "GM," so the
  whole table sees the same answer at the same moment.

None of these need anything hosted, and none route through a Dicebox server — a
room is members sharing a key through a blind relay, so every one of these stays
as private as the table itself. That is the point of building on this transport
rather than a hosted API.

## What rooms deliberately do not do

- **No request/response.** You cannot ask a room to roll and receive an answer.
  A published roll is the publisher's own roll. The authority model — "ask
  Dicebox, it rolls, it answers" — exists only on the [Owlbear bridge](../owlbear/API.md).
- **No shared deck cursor.** Over the relay, a card draw is a `roll2`
  announcement of a draw the sender already made locally; there is no single deck
  every player draws from. (The shared-deck-off-one-deck behavior is an Owlbear
  feature backed by room metadata, a different transport.)
- **No tracker sync.** Hunger, Stress, and the like are per-player and stay on
  the player's device. The torch is the only shared table state here.
- **No scoped or revocable credentials.** See the trust model. A per-app key you
  could hand out and later revoke, or a "publish-only / read-only" split, would
  require adding per-sender identity to the crypto — a real change with a version
  bump, not a flag. It is out of scope for this contract as written.

## Limits and compatibility

- Rolls are fire-and-forget, never queued. `rate` errors are non-terminal.
- Messages are padded to 256-byte blocks; oversized ones are refused with
  `too_big`. Keep payloads modest — a huge symbol pool or summary can cross it.
- Rooms expire; clients must handle `expired` by leaving cleanly.
- Unknown message kinds and unknown relay frame types are ignored, not errors —
  this is the forward-compatibility contract. Adding a kind is backward safe.
- Crypto or envelope changes require bumping `PROTOCOL_VERSION`, which makes old
  clients fail closed. The `-v1` strings in the salt and HKDF info exist so a
  future version cannot silently reuse keys.

## Versioning this document

Adding a message kind, or a field to an existing kind that older readers can
ignore, is a backward-compatible change and does not bump `PROTOCOL_VERSION`.
Changing the crypto, the envelope, or the meaning of an existing field does, and
by design breaks old clients rather than letting them misread. Treat the field
bounds above as the floor an integration can rely on: they may widen, they should
not narrow without a version bump.
