# Ideas

Things worth building, roughly in the order I'd build them. Nothing here is
committed to; this is a place to think before writing code.

Everything ships to `dev.dicebox.trollskull.cc` first.

## Shared sessions

One person hits **Share**, which creates a room and produces a passphrase.
Anyone with it joins and everyone sees everyone's rolls as they happen. For a
group at a table, or a group pretending to be at a table.

This is the biggest feature on the list and the one that most changes what the
app is. Worth being clear-eyed about the cost:

Today every claim in the README is true because rolls never leave the device —
no backend, no accounts, offline forever, and the single-file download really is
the whole app. A shared session needs a server and a connection, and "nothing
leaves your browser" stops being unconditionally true.

So it has to be **opt-in and clearly separate**. The app stays local by default,
the download keeps working with no server at all, and starting or joining a room
is a deliberate act that is visible on screen while it lasts.

### The server is a relay, not a referee

Rolls are decided on the device and only *reported* to the room. The server
never determines an outcome, so a flaky connection cannot change what you
rolled, and a hostile server cannot either.

### End-to-end encrypted

Decided: the passphrase never reaches the server. It derives a key in the
browser, and the server relays ciphertext it cannot read.

This matters most for the demo instance. Strangers rolling on
`dicebox.trollskull.cc` should not be handing the operator anything, and "we do
not look" is a weaker promise than "we cannot". It also means every self-hoster
inherits the same guarantee without having to be trusted.

What the server holds:

- A room code — randomly generated, never chosen, since chosen codes leak intent
- Encrypted blobs it cannot interpret
- Nothing on disk; rooms live in memory and evaporate when idle

What it does not hold: names, notation, results, history, accounts, email, or
anything that outlives the room.

**Honest caveat:** a relay always sees traffic *shape* — how many clients are
connected, when, and roughly how much they send. End-to-end encryption hides
content, not the existence of a session. Worth stating plainly rather than
implying more than it delivers.

Message sizes leak more than they look like they do: encrypting
`{"name":"Amber Wolf","notation":"2d6",...}` as-is means ciphertext length
correlates with dice count and name length, so a relay could infer roll sizes
and tell players apart. **Pad every message to a fixed size** — one line, closes
the whole category.

### The demo instance cannot honestly claim "we cannot"

This is the correction that matters most, and the earlier draft got it wrong.

The demo serves the JavaScript that does the encrypting. Whoever controls that
origin can ship a build that exfiltrates the key — to everyone, or to one
targeted person. Browser-delivered end-to-end encryption is a guarantee about
*policy* dressed up as one about *mathematics*, when the same party serves the
code and runs the relay.

So the claim has to be split by how you run it:

- **Self-hosted, or the downloaded single file** — genuinely "we cannot". A
  different party serves the code than runs the relay, or there is no third
  party at all. This is a real cryptographic guarantee.
- **The public demo** — "we don't, the source is public, and the relay stores
  nothing on disk." That is a good and honest promise. It is not the same
  promise.

The single-file download is the strongest asset here and the design should point
at it: someone who downloaded `dicebox.html` once and joins rooms from it is
never served code by the relay at all.

Two things that make the demo's promise harder to break quietly:

- **Pin `connect-src` to the exact relay origin.** The CSP is `connect-src
  'self'` today, which will break WebSockets to a separate origin — and the
  tempting fix is `connect-src *`, which would let a compromised build send the
  key anywhere. Pin it; self-hosters get an env var.
- **Never let the relay carry key material.** Not for join, not for re-keying,
  not for "let someone already inside pass the key to a newcomer." That last one
  sounds friendly and is a trapdoor: it puts key distribution through the party
  the encryption is meant to exclude.

### Suggested names

On join, prefill a randomly generated name — "Amber Wolf", the way Owlbear and
Google Docs do it. Editable, but a good default.

This is a privacy measure that works because it requires no decision. Asked for
a name cold, people type their real one. Handed a reasonable name already in the
box, most keep it. Names are per-session and never stored anywhere. Generate
from a wordlist so they do not repeat within a room.

### Self-hosting

The room server is a **separate optional service**, alongside the static app
that Docker Compose already serves. Running the dice roller alone stays the
primary path and needs no server. Adding the server is a second container for
people who want rooms of their own.

### Two different no-dependency rules

The app has no runtime dependencies and that is worth protecting, but the rule
only ever applied to the *client*: the single-file build has to inline every
module into one HTML file, and a dependency there would break the thing that
makes self-hosting honest.

The relay is a separate service in its own container. Nothing it imports ever
reaches a browser, so the constraint does not apply to it — and applying it
anyway would mean hand-writing an RFC 6455 frame parser, which is untrusted
input handling with masking, fragmentation, 64-bit lengths and partial TCP
reads. That is precisely the code where a mature library has already had its
bugs found.

So: **the client stays dependency-free, and the relay uses `ws`.**

The same reasoning is worth stating for the crypto, since "don't roll your own"
is the right instinct and it is easy to think this project ignored it.
`room-crypto.js` does not implement any primitive — PBKDF2, HKDF and AES-GCM all
come from WebCrypto, which is the browser's audited implementation. What is
hand-written is the *composition*: which primitives, what parameters, how nonces
are built. That is unavoidable in any application using crypto, and it is where
the design review was aimed.

### Build order

**Build the self-hostable relay first**, not the Cloudflare one. It is a small
Node WebSocket server: `roomId -> set of sockets`, broadcast, nothing on disk.
It runs in the Docker setup that already exists, it is testable locally, and it
is the one that delivers the real "we cannot" guarantee. The Worker can come
later if the demo needs the scale.

Two implementations from day one would mean two codebases to keep behaviourally
identical, and the failure mode is quiet divergence found in production.

If the Cloudflare version does get built, use Durable Objects with
`ctx.acceptWebSocket()` — the hibernation API — rather than `ws.accept()`. A
dice room is idle between rolls, and hibernation lets the object evict from
memory while connections stay open. That is the difference between a real bill
and a rounding error.

**When the relay is unreachable, the app degrades to local rolling instantly and
visibly.** It never spins, never blocks, never queues. The local path must not
depend on any room code at runtime — that is what keeps the primary feature
primary.

### Roll integrity: social trust is the right answer

The tempting idea is commit-reveal — everyone commits a hashed seed, everyone
reveals, the roll comes from the combination, and nobody could have biased it.
It is a real technique and it does not fit here.

It solves *adversarial randomness generation*. The actual worry is different:
someone rolls a 3 and says they rolled a 20. Commit-reveal only prevents that by
making the roll a computation over everyone's seeds — which means the roll is no
longer decided on the roller's device. That destroys the best property of this
design: that a flaky connection cannot affect your roll. Every roll would need a
round trip to the slowest phone, and a player dropping mid-roll leaves it in
limbo.

And it still would not work, because it does not touch the cheat people actually
commit: rolling until you like the answer, or rolling privately and typing the
result in. Selective reporting survives every scheme of this kind.

A friend at a table can palm a die behind a screen. Nobody solves that with
cryptography — they solve it by playing with people they like. A dice roller
that makes its users feel audited is a worse product.

What is worth building instead, all of it cheap:

- **Every roll appears in the shared log immediately**, for everyone. The cheat
  that happens is quiet reporting; a visible log makes discrepancies social.
- **Show the whole roll, not the total.** `2d20kh1 → [3, 18] = 18`. An
  impossible combination is caught by anyone reading. The data already exists.
- **Sanity-check received rolls** — values in range for the notation, total
  consistent. Catches lazy tampering and typos. Label it in code as a
  typo-catcher, not a cheat detector, because that is what it is.
- **No badges.** A "verified roll" marker that can be forged is worse than none.

The README should say it plainly: rolls are generated on your own device, anyone
technical enough could report whatever they like, and rooms are for friends.

### Protocol details that are easy to get wrong

Small things, but each is a real bug if missed:

- **Replay.** Every message carries a per-sender sequence number *inside* the
  ciphertext; clients reject non-increasing ones. `roomId` goes in the AEAD's
  additional data so a message cannot be replayed into a different room.
- **Nonce reuse.** Every client encrypts under the same key, and AES-GCM fails
  catastrophically on a repeated nonce — it leaks the authentication key. Random
  nonces across several senders rely on birthday bounds. Use
  `senderId || counter` instead, which removes the possibility rather than
  making it unlikely.
- **A protocol version field, from the first message.** If a crypto bug is ever
  fixed, an old client needs to fail closed rather than interoperate badly. This
  cannot be retrofitted, and the service worker's cache-first strategy means old
  clients stick around.
- **Absolute room expiry, not just idle.** Someone who leaves keeps the
  passphrase forever, and there is no revocation. An idle timeout does nothing
  for a room that stays busy. A hard cap — say 12 hours — means a departed
  member's access expires on a schedule instead of never.

### The operational cost

This is the first part of the project that has to be *operated*. If the room
server is down, rooms are down, and someone at a table is affected. Everything
else in this app can fail quietly; this cannot. That is an ongoing commitment,
not a one-off build.

### Shared tray, unsynchronised animation

Decided, and it removes the hard problem rather than solving it.

The animation was never a physics simulation — it is a drawing of an outcome
that was already decided. So there is nothing to synchronise. Send the
*result*, and every client animates it locally.

Everyone sees the same dice land on the same numbers. If one phone renders half
a second behind another, nobody can tell, because the dice were never agreeing
on a trajectory in the first place — only on what they landed on.

That means a shared tray costs about what a shared log costs. One small message
per roll: who, the notation, each die's value, the total. No clock sync, no
animation state, no reconciliation. A slow connection delays a roll appearing;
it cannot make it stutter or land wrong.

### Joining

A **Share** button opens a dialog with two things: a button to create a room,
and a box to type a code into.

Creating a room gives you both:

- a **short code** to read aloud over voice chat
- a **link** to paste into a group chat

Both are the **same passphrase** — five words from the EFF wordlist, something
like `anchor-tundra-vellum-quartz-bramble`. Readable aloud over voice chat,
pasteable into a group chat, and one artifact rather than two.

An earlier draft split a short spoken code from a separate high-entropy key.
Five words removes the need: it carries ~64 bits, which is enough to be the
whole secret, so there is nothing to reconcile and no way to end up in a room
you cannot read.

Everything derives from it:

```
K       = Argon2id(passphrase, salt = "dicebox-room-v1")
roomId  = HKDF(K, "id")    -> sent to the server
roomKey = HKDF(K, "key")   -> never sent, never leaves the device
```

The server sees `roomId` and learns nothing about `roomKey` from it. The
passphrase itself never reaches the server in any form.

**Argon2id rather than raw HKDF** because 64 bits is strong for a spoken phrase
but not for a modern offline attack. A deliberately slow KDF puts a real cost on
each guess. Four words (~52 bits) would be too few for that margin; five is the
floor, not a preference.

The link is a convenience wrapper: `https://host/#anchor-tundra-vellum-...`.
Fragments are never sent in HTTP requests, so the link leaks nothing to the
host — but it does land in browser history and sync, so **the fragment is
stripped with `history.replaceState` immediately on load**.

## Owlbear Rodeo integration

Probably the same feature wearing a different hat. Owlbear extensions are web
apps in an iframe with a room-scoped sync channel, so this likely reuses the
shared-session model with Owlbear's room as the transport instead of ours.

Build the generic version first; this becomes a wrapper rather than a second
implementation. Needs a read of their extension docs before promising that.

## Narrative / outcome dice

Dice whose faces are *outcomes* rather than numbers. You roll a pool, opposing
symbols cancel, and you read what survives — so the result is "you succeed, but
something goes wrong" rather than a total. Genesys and FFG's Star Wars games are
the well-known users; the purple d8s are the ones people remember.

The shape of it:

| Die | Rolls | Carries |
| --- | --- | --- |
| Ability | d8 | success, advantage |
| Proficiency | d12 | success, advantage, triumph |
| Difficulty | d8 | failure, threat |
| Challenge | d12 | failure, despair |
| Boost | d6 | advantage, minor success |
| Setback | d6 | failure, threat |

Success cancels failure, advantage cancels threat, and whatever is left is the
result. Triumph and despair survive cancellation and always mean something.

The accessibility case is the strongest argument for anything on this list.
These dice are expensive, sold in fixed bundles, frequently out of stock, and
essentially unusable if you cannot make out a small embossed glyph or cannot
distinguish the colours the system leans on — the symbols are *also* colour
coded, which is a real barrier. A digital version fixes availability and cost,
and can name every symbol in text for a screen reader, which the physical object
cannot do at any price.

The engine mostly fits: a die is already a solid with a per-face value. The work
is real but bounded:

- Faces carry symbols, not numerals — the same drawing problem already solved
  for numbers, with line art in place of digits
- Some faces are blank and some carry *two* symbols, which numerals never do
- The result is a cancelled tally, not a sum, so the readout and roll log need a
  second display mode
- Notation needs names rather than side counts — `2a 1p 3d` or similar, since
  "d8" is ambiguous between Ability and Difficulty

Symbols must be original artwork. The mechanic is not ownable but the specific
glyphs are, so this needs its own set — which also means it can be designed for
legibility at phone size and to work without relying on colour.

Worth building before the room server: it is self-contained, it has the
strongest case per hour spent, and it does not commit anyone to operating
anything.

## Colour palettes

A settings menu offering different colour schemes for the dice.

Listed last, and worth questioning before building. The white-on-white wireframe
*is* the app's look, and it is the reason it does not resemble every other dice
roller. A palette picker invites making it resemble every other dice roller.

If the real goal is contrast or readability, fix that directly — that is a
legibility bug, and a colour menu is a roundabout fix that leaves the default
still hard to read for whoever needed it.

If the goal is genuinely decoration, then it is worth doing, but as a small set
of considered themes rather than a colour picker.

## Smaller things

- **Modifiers can be silently wrong for the pool.** Picking advantage on `3d6`
  yields `3d6kh1` — mathematically correct, keeps the highest one die, discards
  two — but nobody choosing "advantage" on three dice means that. The sheet
  should say what a modifier will do to *this* pool, or refuse combinations that
  are almost certainly a mistake.

- **Numerals can sit at up to 44 degrees of tilt** on faces where no edge runs
  near-level. Cube faces always have a level edge available and could be
  special-cased.

- **Colour is load-bearing in the narrative dice**, which is exactly the trap
  the palette menu should avoid. If those ship, the symbols have to be
  distinguishable in monochrome — which the wireframe look enforces for free,
  and which the physical dice fail at.

## Tried and reverted: pinning the numeral to one facet

The numeral is painted on whichever face points at the camera, so it appears to
move between facets while a die tumbles. Binding it to a single facet was
attempted and reverted.

Both obvious approaches fail, in opposite directions:

- **Bind the facet before the throw**, and the die has to rotate to bring that
  facet up when it lands. It reads as the die being picked up and turned by hand.
- **Bind it when the die stops**, and there is no facet to paint during flight,
  so the numeral falls back to riding the frontmost face — which is the original
  problem, now with a visible snap at the end.

The trap for anyone trying again: orientations are equal mod 360 degrees, so
every test comparing final poses passes while the animation is visibly wrong.
A die that spins seven full turns to reach the correct face scores identically
to one that does not move. Measure the **arc actually travelled**, frame by
frame, not the distance between endpoints.

Doing this properly probably means deciding the resting orientation at throw
time and *authoring* the tumble toward it, rather than simulating a tumble and
correcting it afterwards. That is a rewrite of the settle, not a patch.
