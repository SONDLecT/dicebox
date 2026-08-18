# The Dicebox design guide

What every mode, control, and screen in Dicebox agrees on. This is the
document a new system is built against and an old one is audited against —
when a rule here and a screen disagree, one of them is wrong on purpose and
the difference is worth a commit message.

## First principles

**Dice are physical things.** They stage on the tray, tumble when thrown,
push each other aside, settle, and answer a tap. Cards deal, flip, go to hand
and discard, and rise for a close look. Every interaction is designed as an
action on an object, not a form submission. The tactility lives in behaviour,
never in imitating materials.

**The roll is decided before anything moves.** Every result comes from
`crypto.getRandomValues` the instant you roll; the animation is a drawing of
that outcome, never a simulation that produces it. Nothing about frame
timing, flick strength, or device speed may influence a result.

**The notation field is the source of truth.** Every state the controls can
express is a typeable string, and typing drives the controls just as tapping
writes the field. A mode is a UI preset over notation, not a different
engine: `4d6` is numeric in every mode.

**Local first.** Rolls happen and stay on the device unless the player
explicitly shares. Nothing waits on a network — a roll that cannot be shared
still lands instantly, and the failure to share is reported, not blocking.

**Simple surface, deep capability.** The app should read as simple at first
glance while carrying everything a player might expect underneath.
Complexity is revealed by play, not displayed on the surface.

## Integrating a system's rules

**Scope: everything the dice touch, completely.** If a mechanic changes
what is rolled, how the roll is read, or what may be rerolled — pool
composition, modifiers, target numbers, criticals, pushes and rerolls,
stats the dice read, the tables the dice consult — it belongs in the mode,
and the mode is not done until nothing that touches a roll is missing.

**Boundary: Dicebox is the dice, not the sheet.** The app takes the
*resolved number* wherever a mechanic needs one — a modifier chip, a skill,
a stat — but which part of the sheet supplies that number, and everything
else the sheet tracks (XP, inventory, damage totals, session-end
procedures), stays with the player. A mechanic that never changes a throw
or its reading is out of scope, however important it is to the game.

**Fidelity: rules as written, exactly.** The arithmetic is the book's,
including its edge cases — where the book's actual reading and a common
simplification differ, the book wins. No approximations, no silent house
rules. One edition per mode, named on the label — the edition is a promise
about which book the mode implements.

**House rules live at the table, not in toggles.** The unset, table-judged
state is deliberately where they fit: the app implements the book, reports
the facts, and leaves the ruling to whoever runs the game.

**No dedicated control for what composition already expresses.** Blood
Surge is adding dice and a Rouse — it needs no button. A control earns its
place only when the mechanic cannot be played by combining the controls
that exist.

**Notation completeness.** Every mechanic a mode implements is typeable —
the string can express anything the picker can, including the flags. If a
mechanic exists only as a button, that is a bug in the notation.

**The help panel is the contract.** Each mode's help states exactly what
is implemented and how it reads — the rules of the roll, the notation, the
gestures — so what is in and out of scope is never a surprise at the table.

## The tray

- **Tap dice to build, tap staged dice to remove.** Every die button adds one
  of its dice to the staged pool; tapping any staged die on the tray takes it
  back off. The single exception class: dice whose count the rules fix (Hope
  and Fear, the Feat die, the fixed 2d6) ignore the tap. If a staged die's
  count is adjustable anywhere, a tray tap must adjust it.
- **Staging-on-open.** A system whose roll the rules fix (PbtA, Mist, Fate,
  Daggerheart, One Ring) opens with that roll staged. A system whose pool you
  assemble (numeric, V5, Genesys, Star Wars, CthulhuTech) opens empty.
- **The tray is never dead.** A tap on an empty tray rolls the current
  system's default. A flick throws with the flick's energy.
- **Post-roll dice are readable.** Dropped dice fade but stay; exploded and
  rerolled dice carry marks; percentile tens dice read 00–90. The tray after
  a roll is the record of what happened, not a cleaned-up summary.

## Pickers

- **One row.** A system's picker is a single row of controls wherever
  possible: its die buttons, then its number chips. Vertical space is the
  scarcest resource on a phone at a table.
- **Buttons that add dice are shaped like the dice.** A die button wears the
  silhouette of its die (d6 rounded square, d8 diamond, d10 kite, d12
  pentagon) or the system's own mark (the V5 ankh-in-a-d10, the Rouse maw).
  Never a generic rectangle for a die.
- **Tap adds; hold scales with the pool.** Where a pool plausibly stays small
  (a handful of a kind), holding a die button removes one — the quick
  gesture. Where counts run high (a V5 pool, the narrative and Year Zero
  chips, a CthulhuTech pool), hold opens the shared rotary count dial on that
  die instead — scroll a big handful on in one gesture, or scroll the lot
  back to nothing. A menu appears only where a die has real per-die options
  (the numeric picker's modifier sheet). Tapping staged dice on the tray
  removes regardless.
- **Numbers are chips or the dial, and unset is the default.** A non-dice
  number (Difficulty, Target, a modifier) is never a bare input: small ranges
  are spin-chips (tap up, hold down), wide ranges open the shared number
  dial. Where the number is a resolution target the table may judge, the
  control defaults to unset — it reads "—", the roll reports raw facts, and
  setting the number is what buys a resolved outcome.
- **Buttons stage; the player rolls.** A control that assembles or selects a
  roll puts it on the tray — a pool button adds dice, a named-roll tile
  (Duality, Action, an oracle ask, Check/Save) selects and stages its roll —
  and only the Roll control and the tray itself throw. Clicking a button and
  being told what you rolled is no fun.
- **Post-roll actions pop in, above the row.** A button that exists only
  after a roll (Push, the Willpower reroll) appears above the picker row when
  eligible and disappears when spent, rather than reserving space.

## Two-beat partial rerolls

A mechanic that rethrows part of a completed roll (Year Zero/Blade Runner/
Twilight push, the V5 Willpower reroll) never happens in one click.

Beat one — **pick up**: the eligible dice are decided (by rule for a push; by
the player tapping up to N dice for Willpower), the kept dice **lock in
place** holding their faces, and the picked dice **blank and gather aside** —
visibly in hand, not yet thrown. During a player-choice pick, rings mark
state: solid on picked dice, faint on eligible, nothing on ineligible, and an
ineligible die refuses the tap with a buzz. The readout narrates ("2 of 3
picked — tap the tray to reroll") and the arming button becomes the cancel.

Beat two — **throw**: a tap or flick on the felt throws only the picked
handful toward the final grid; the locked dice never move. The result
re-resolves from all faces and the action is spent — the button disappears.

Cancel paths: the arming button, building the pool, switching modes, or
rolling anything fresh all put the picked dice back. Over every transport,
the transition travels as held/rerolled/added indexes so a peer's tray plays
the same two beats, never a fresh throw.

## Tracked stats

**A stat is tracked iff its value is an input to the dice.** Hunger changes
which dice are in the pool; Stress is the number the Panic die resolves
against — the app cannot roll correctly without them. Willpower's level never
changes a roll — the reroll works the same at 5 dots or 1 — so the app needs
only the decision, not the number. Track what the dice read; never track
what only the sheet reads.

A tracked stat persists across reload and mode switches, moves only at its
own control or by its own rule (a failed Rouse, a failed check), is cleared
by the X as part of a full table sweep, and syncs through the Owlbear
background so every surface agrees.

**No unearned resolution.** Without the table-set number, report the facts —
successes, criticals, Hunger events — and assert no outcome. Never guess a
win.

## Visual language

**Character.** Dicebox is a modern, elegant, minimal app — dark-first,
quiet, and precise. It is deliberately *not* skeuomorphic: no paper texture,
no felt, no rendered plastic. The tactility lives in how things behave —
dice you tap, throw, and pick back up — never in imitating materials. The
design reads as simple while carrying everything a player might expect
underneath.

**Values, in order.** Readable, clear, intuitive, tactile, beautiful. When
two choices tie on the first four, choose the beautiful one; never buy
beauty with any of the others.

**Color.** Seven functional tokens (`--paper`, `--face`, `--line`,
`--muted`, `--hair`, `--accent`, `--danger`) carry every surface, chrome and
canvas alike — nothing colors itself outside them, which is why the tray and
the UI can never disagree. **Dark is the primary scheme** and is designed
first: warm near-black (`#141413`), warm off-white ink (`#F2F0EA`) — warmth,
not clinical grey, is where the elegance comes from. Light is a first-class
sibling, designed rather than inverted. The accent is spent like a currency:
8–18% tints for loaded states, hairline borders for set states, full
strength reserved for the moments that matter — a count badge, a set value,
and above all **the result**, which at 56–104px in the accent is the largest
visual event in the app. One answer, unmissable.

**The signature: wireframe dice.** Dice are unfilled line drawings — true
geometry, drawn in strokes, tumbling in space. This is the app's visual
identity: honest shapes (a d17 has seventeen faces), no fill, no shading,
alive in motion. Everything else stays quiet so the dice read as the
subject.

**The counterpoint: historical artifacts.** The card decks are hand-traced
from real historical objects — 1650s woodcuts, an 1890s Neapolitan deck,
Moronobu's 1680 illustrations — modernized into clean SVG line and stencil
color. The pleasure is the deliberate contrast: centuries-old artifacts,
redrawn to sit naturally inside a modern minimal app. New systems with
physical props should look for the same move — respect the artifact,
modernize the rendering.

**Type, three voices.** Inter Tight speaks for the interface. Iosevka
Etoile (mono, tabular) speaks for anything that is *dice data* — notation,
breakdowns, totals, history, build ids — so the math always looks like math.
Serif appears only inside a card's own world (a tarot label, a poem), never
in the chrome. The wordmark is letterspaced smallcaps: the one piece of
typographic ceremony.

**Shape and depth.** Surfaces are flat and separated by hairlines; shadows
exist only under things that genuinely float (popovers, dialogs, the card
close-up) — depth signals layering, never decoration. Radius vocabulary:
12px for die buttons and cards, full-round for pills and badges, 8px for
small controls. Touch targets ≥44px. Density is one row wherever a row will
do.

**System identity.** Every system re-tints the whole app through the same
seven tokens, dark and light both — the accent is its signature (V5 blood,
Mothership acid green, Fate slate), the neutrals shift to set its
temperature. Small text holds WCAG AA on both surfaces in both schemes,
enforced by test. Dice take the theme's ink **unless the physical game
colors its dice** — Genesys types, Year Zero pools, step-die roles,
percentile outcome tints — the one place a system out-votes the theme.

**Glyphs.** Every symbol is original line art drawn at dice stroke-weight,
sized to the face's inscribed circle. System names are community shorthand
with a one-line disclaimer; nothing traced from a trademark.

**Motion.** Animation is testimony: it narrates a real event — a throw, a
landing, a push's pick-up, a card's flip — and never decides anything. Two
tempos: controls answer in 120–160ms; physical events take the time physics
needs (240–700ms). Idle trays freeze to a cached frame. No motion exists
purely to be looked at.

## Results

- **A headline and a detail line.** The headline is the answer read the way
  the table would say it ("Failure · 1 Threat", "Blood holds", "66"), tinted
  by an outcome variant where the system has tiers. The detail line beneath
  carries the full arithmetic — every die, every cancellation — so the
  headline never has to.
- **The same words everywhere.** The readout, the history log, the room
  share, and the Owlbear toast all read a roll through the same shared
  formatters. If two surfaces describe one roll differently, that is a bug.

## Modes and navigation

- The mode picker is a compact anchored popover: Dicebox (numeric) pinned
  first, then the dice systems alphabetical by label, then the card decks.
- Every mode has a short URL slug (`/vtmv5`, `/mosh1e`, …); old slugs stay
  as read-side aliases forever.
- Each mode ships its help panel section: the full rules of the roll, its
  notation, and its picker's gestures.

## Sharing

- Sharing is transport-agnostic at the system level: any roll whose result
  carries `system`, `notation`, `groups`, and `summary` shares over
  encrypted rooms and Owlbear alike, animating identically on the far side.
  A new system gets sharing for free; per-system sharing code is a smell.
- The Owlbear toast is the readout in miniature — same dice colours, same
  headline and detail — and stands in only for a closed panel.

## Writing

- UI copy is terse and active. No marketing, no exclamation points, no
  semicolons in interface text. Errors say what went wrong and what to do.
- The voice is the table's: "Blood holds", "the Beast stirs", "1 die ready",
  "Tap the tray to throw the pushed dice". Flavour is allowed exactly where
  the system's own language earns it.

## Conformance backlog

Known places the app predates a rule above, queued for adjustment:

1. **Daggerheart's Duality button and Ironsworn's tiles/odds pills roll on
   click** — they become select-and-stage (visual design unchanged; the DH
   tray's look is a keeper).
2. **Tray taps are silent no-ops on some adjustable dice** — Twilight ammo,
   Blade Runner's advantage die, Mothership's advantage copies, CoC
   bonus/penalty dice.
3. **Blade Runner and Twilight's Push buttons sit below their rows** — they
   move above, like Year Zero's and Willpower.
4. **Mothership Stress is not cleared by the X** — it aligns with the
   tracked-stat rule (swept by the X, kept across modes).
5. **The numeric picker's die buttons are plain rectangles** without die
   silhouettes — the oldest screen in the app vs. the die-shaped rule;
   flagged for design rather than assumed.
