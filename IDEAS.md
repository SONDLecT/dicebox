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

Sketch: a Cloudflare Worker with a Durable Object per room for the hosted demo,
and a small standalone WebSocket server for self-hosters. Both are relays, so
they can stay close in behaviour, and the client should be able to point at
either.

### The operational cost

This is the first part of the project that has to be *operated*. If the room
server is down, rooms are down, and someone at a table is affected. Everything
else in this app can fail quietly; this cannot. That is an ongoing commitment,
not a one-off build.

### Open question

Does a room need a shared *tray* — everyone watching the same dice tumble — or
just a shared log? The log is most of the value for a fraction of the work, and
a synchronised tray means reconciling animation state across clients.

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
