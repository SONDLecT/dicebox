# The Dicebox broadcast API

Dicebox's Owlbear extension runs a background service for the whole session,
and other extensions on the same Owlbear client can ask it for rolls, draws,
and history over Owlbear's [Broadcast API](https://docs.owlbear.rodeo/extensions/apis/broadcast/).
Dicebox stays the authority — you send intent, it sends outcomes.

This document is the contract. The implementation lives in
[`owlbear-session.js`](../owlbear-session.js) and
[`owlbear-history.js`](../owlbear-history.js); those assets ship only in the
VTT artifact, so ordinary dicebox.cc, the PWA, and standalone self-hosted
builds never initialise any of this.

## The channel

Every Owlbear iframe is a separate SDK context. Wait for `OBR.onReady()` in
your own context, then use the single channel:

```text
cc.dicebox.rolls
```

Protocol messages carry `v: 1` and a typed `type`. Requests and their
correlated responses are local RPC — send with `destination: 'LOCAL'`:

```js
await OBR.broadcast.sendMessage('cc.dicebox.rolls', {
  v: 1,
  type: 'roll.request',
  requestId: 'forms-123',
  notation: 'yz:5b3s2g'
}, { destination: 'LOCAL' });
```

A stateful follow-up references a Dicebox-owned authoritative roll id:

```js
await OBR.broadcast.sendMessage('cc.dicebox.rolls', {
  v: 1,
  type: 'action.request',
  requestId: 'forms-124',
  action: 'push',
  rollId: 'dicebox-roll-789'
}, { destination: 'LOCAL' });
```

## Request types

| Type | Purpose | Correlated response |
| --- | --- | --- |
| `roll.request` | Numeric notation, all built-in systems, five deck modes, Rouse checks, and Ironsworn/Starforged oracles | `roll.result` or `roll.error` |
| `action.request` | `push` by authoritative `rollId`, `surge` (V5 Blood Surge) by `rollId` plus `dice` (1-4 surge dice; the background rolls the ride-along Rouse and moves Hunger), deck `shuffle`/`reset`, or `state.set` for the Hunger/Stress trackers | `roll.result`, `action.result`, or `roll.error` |
| `history.request` | Ask the local background for retained room history | One or more paged `history.result` messages |

`requestId` is 1–96 characters and is echoed only in local responses. Reusing
one `requestId` for different work fails with `request_id_conflict`. Stateful
requests are serialised through a bounded queue, deduplicated, rate-limited,
and time out explicitly.

## Who owns what

Dicebox owns RNG, notation interpretation, Hunger, Stress, decks, oracle
lookup, push and surge eligibility, history, timestamps, roll ids, and player
attribution. Callers provide intent, not precomputed outcomes. Deck state is
shared across the whole Owlbear room (it lives in room metadata), so a draw
requested through the bridge comes off the same deck every player at the table
is drawing from.

## Completed events

Completed table rolls are published with explicit `destination: 'REMOTE'` as
`roll.event`. Pushes use `roll.transition` with `parentId` and exact `held`,
`rerolled`, and `added` indexes so receiving Dicebox panels preserve held dice
and animate only changed or new dice. Incoming events are displayed and
archived but never republished — there is no relay amplification loop. Legacy
untyped completed-roll payloads remain readable during the v1 migration.

## Limits

Owlbear Broadcast messages must be JSON-serialisable and cannot exceed 16 KiB.
Dicebox uses a 12 KiB application ceiling for envelope headroom. Oversized
requests and results receive correlated `request_too_large` or
`result_too_large` errors rather than disappearing. History is split into
bounded pages. The public bridge caps numeric requests at 100 dice across 64
terms, while the standalone notation engine still permits up to 500 dice per
term. Completed-event retention admits at most 100 new Broadcast events per
ten seconds before persistence.

History is local to the browser and Owlbear room, not server or cross-device
synchronisation. The primary cache is IndexedDB, bounded to 20,000 records and
8 MiB; a guarded local-storage cache is used only when IndexedDB is
unavailable.

## Trust

Local responses are HMAC-signed with a per-origin key so a Dicebox panel only
trusts its own background; requests are executed only for this player's local
Owlbear connection. Neither is a cryptographic identity: Owlbear connection
metadata does not reveal which local extension sent a request, and no
transport here proves a roll came from an unmodified client. Broadcast
payloads are readable by any extension that deliberately listens on the known
channel — that is the deal the VTT mode makes, and it is disclosed in the
app's share menu. Dicebox's end-to-end encrypted passphrase rooms are a
separate transport with a separate trust boundary; see the
[main README](../README.md#rooms).

## Delivery semantics

`sendMessage()` resolving means Owlbear accepted the SDK command; it is not a
receiver acknowledgement. Use the correlated result or error message as the
application-level answer. Broadcast is ephemeral — do not expect Owlbear to
replay anything you missed; Dicebox's retained history is its own bounded
local cache, and `history.request` is how you read it.
