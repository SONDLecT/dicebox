# Under the hood

How Dicebox is put together, and the rules that keep twenty systems from
becoming twenty codebases. [`DESIGN.md`](DESIGN.md) is what the player sees;
this is what a contributor (or an audit) holds the code against.

## The module map

Everything is plain ES modules, no build step for the site itself.

| Module | One job |
| --- | --- |
| `app.js` | The application: UI wiring, pickers, tray orchestration, mode switching, sharing fan-out. Big by design — it is the integration layer — but it must contain no logic another surface needs. |
| `dice.js` | The numeric engine: notation parse, fair rolls, describe. |
| `system-dice.js` | Every game system's parse/roll/summarize/format, pure functions on data. No DOM, no state. |
| `render.js` | The canvas: `Die`, `Surface`, glyph drawing, physics-as-presentation. System-agnostic — it paints what fields on a die tell it to paint. |
| `tray-faces.js` | How a rolled die looks: per-system colours and face stamps. The single source for the tray, the toast, and any future surface. |
| `result-text.js` | What a roll says: headline/detail dispatch. Single source for the readout, history, rooms, toast. |
| `system-themes.js` | Every system's dark+light palette. Single source for the app chrome and the toast. |
| `shared-decks.js` | The table's decks: room-metadata state with local fallback, used by the Owlbear background and the panel's fallback path. |
| `room.js`, `room-crypto.js` | Encrypted rooms: relay protocol, validation bounds, E2E crypto. |
| `owlbear-session.js` | The Owlbear background service: the broadcast API, history, toasts. Ships only in the panel build. |
| `owlbear-auth.js`, `owlbear-history.js` | HMAC for local responses; IndexedDB room history. |
| `oracle-dice.js`, `*-oracles.js` | Oracle tables and lookup. |
| `*-art.js` | The card decks' vector art, lazy-loaded. |

**The drift doctrine.** Anything two surfaces both need — a colour, a
sentence, a palette, a deck — lives in exactly one shared module. History has
been consistent: every time a surface carried its own copy (the toast's
colours, the toast's wording, the panel's deck stubs), the copies drifted and
a user filed the difference as a bug. When a second surface needs something
`app.js` owns, the move is extraction, not duplication.

## The result object

The one contract everything meets — rolling, rendering, describing, sharing,
history, the bridge:

```js
{
  schema: 2,
  system: 'v5',              // wire id — not always the picker slug
  notation: 'v5:8h3@3',
  groups: [{ kind: 'dice' | 'cards' | 'const', ... }],
  summary: { kind: 'v5', ... }   // everything the formatters read
}
```

A system that produces this shape gets the tray, the readout, the log,
rooms, Owlbear, and the toast for free. Push-style transitions add
`parentId` and `transition: { kind, held, rerolled, added }` with exact
indexes so receivers animate only what changed.

## Adding a system: the checklist

A new system touches every one of these, in lockstep, or it half-works.
This list is the audit; the closing sections of the V5 memory doc trace it
in anger.

1. `system-dice.js` — parse/roll/summarize/headline/describe (+ push or
   reroll transforms if the system has them), pure and tested.
2. `detectSystem` regex; `rollAny` and `doRoll` dispatch.
3. `result-text.js` — headline/detail dispatch entries.
4. `tray-faces.js` — flatten fields + `stampTrayDie` branch (colours, faces).
5. `render.js` — a glyph function and a `Die.drawValue` branch, if the system
   has symbol faces.
6. `system-themes.js` — dark + light palette; contrast-checked.
7. `app.js` — picker controls + `sync*`/`reset*`/notation round-trip
   (`sync*FromField`), `systemStageDescriptors` case,
   `removeSystemStageKind` case, `emptyTrayRoll`, badge, hint, help/picker
   visibility in `setSystem`, `SYSTEM_TO_SLUG` + aliases, `applySystemTheme`.
8. `index.html` — mode row (alphabetical), mode icon, picker section, help
   section.
9. `style.css` — picker layout, `--sys` colour, any variants.
10. `room.js` — `SYSTEM_ROLL_KINDS` gets the **wire id** (`result.system`,
    which is not always the slug: CoC travels as `coc`, Alien as `yearzero`,
    Starforged as `ironsworn`).
11. `worker.js` — slug rewrites.
12. `tools/bundle.mjs` — `SYSTEM_EXPORTS` for every new export `app.js` or a
    shared module imports. Missing names break only the single-file build,
    and only at roll time.
13. Tests — reducer tests in `test-systems.mjs`, the room round-trip guard,
    the markup order string.

**Adding a shared module** is four registrations, every time: `sw.js`
precache, `tools/bundle.mjs` moduleScope (in dependency order, with its
pulls), the app-scope export union, `tools/build-owlbear.mjs` `APP_FILES`.
The test suites enforce the panel and precache lists; the bundle's scoping
they can only partially see, so treat it as the dangerous one.

## Pipelines

**A roll:** `doRoll(notation)` → system dispatch → result →
`throwResult`/`finish` → tray animation (`flattenRollDice` +
`buildTrayDice`) → readout (`resultHeadline`/`resultDetail`) → history →
share fan-out (rooms `roll2`, Owlbear publish). `finish` is the single
funnel; anything every roll needs happens there once.

**Staging:** picker state → `systemStageDescriptors()` (blank-die
descriptors with a removable `kind`) → `stageSystemPool()` → tray. A tap on
a staged die → `removeDieAt` → `removeSystemStageKind(kind)` → the owning
system's state → its `sync*` restages. State drives the tray; the tray never
owns state.

**Receiving a shared roll:** validate shape and bounds (`validateSystemRoll`
— permissive on values, strict on structure and size), rebuild a result, and
reuse the same flatten/stamp/format helpers the local path uses. Transitions
replay held/rerolled by index, re-stamping faces.

## The Owlbear split

The panel build is the same app plus: a meta tag gate (`owlbearPanel`), the
vendored SDK, and the background service. The background is the authority
for rolls, decks, trackers, and history; the panel is its client over a
LOCAL, HMAC-signed RPC — but never its dependent: every request path has a
local fallback, because dice that do not land is the one unacceptable
failure. Deck state lives in room metadata (one deck per table); completed
rolls publish REMOTE (plus ALL for fallback rolls, pre-marked seen). The
16 KiB broadcast ceiling is respected with a 12 KiB application cap and
paged history. The public contract is [`owlbear/API.md`](../owlbear/API.md).

## Builds and deploys

Three artifacts, three origins, one repo: the site (static + header worker),
the relay (Durable Objects), the panel (generated dir, own origin, framed by
Owlbear only). The single-file `dist/dicebox.html` is the fourth, built by
`tools/bundle.mjs` module-scoping — its export lists are the price of having
no bundler anywhere else. Everything deploys with `Cache-Control: no-cache`
revalidation because heuristic caching of mixed module versions is how "one
browser works, the other is haunted" happens. The panel deploy refuses a
dist older than its sources.

## Tests

`npm test` runs every suite: reducers per system, room validation
round-trips for every system (the wire-id regression guard), crypto, relay
behaviour, markup structure (including picker order and WCAG contrast on
palettes), the bundle's load, the panel build's file graph and headers, the
Owlbear bridge behaviour (real protocol against a fake SDK), history, auth,
shared decks (two sessions, one room). The pattern for a new guard: when a
bug crosses module boundaries silently — a wire id, a missing export, a
stale build — the fix ships with a test that rolls or builds for real, not
one that checks a string.

## Comments

Comments explain **why**, at the level of the decision: what rule of the
game, what user call, what bug the shape prevents. The voice is narrative
("a departed player keeps the passphrase forever, so expiry is the only
thing here that resembles taking access away") and it is load-bearing
documentation — an auditor should be able to reconstruct the design doc from
the comments. Code that needs a *what* comment usually needs a rename
instead.
