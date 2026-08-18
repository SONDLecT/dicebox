# The Dicebox design guide

What every mode, control, and screen in Dicebox agrees on. This is the
document a new system is built against and an old one is audited against —
when a rule here and a screen disagree, one of them is wrong on purpose and
the difference is worth a commit message.

## First principles

**Dice are physical things.** They stage on the tray, tumble when thrown,
push each other aside, settle, and answer a tap. Cards deal, flip, go to hand
and discard, and rise for a close look. Every interaction is designed as an
action on an object, not a form submission.

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

## The tray

- **Tap dice to build, tap staged dice to remove.** Every die button adds one
  of its dice to the staged pool; tapping any staged die on the tray takes it
  back off. The single exception class: dice whose count the system fixes
  (Hope and Fear, the Feat die, the fixed 2d6) ignore the tap. If a staged
  die's count is adjustable anywhere, a tray tap must adjust it.
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
  scarcest resource on a phone in landscape at a table.
- **Buttons that add dice are shaped like the dice.** A die button wears the
  silhouette of its die (d6 rounded square, d8 diamond, d10 kite, d12
  pentagon) or the system's own mark (the V5 ankh-in-a-d10, the Rouse maw).
  Never a generic rectangle for a die.
- **Tap adds, hold removes.** One gesture everywhere (`bindTapHold`): tap a
  die button to add one, long-press to take one back. Count badges sit on the
  button's corner.
- **Numbers are spin-chips or dials.** A non-dice parameter (Difficulty,
  Target, Power, a modifier) is a subordinate pill — tap-to-raise/
  hold-to-lower for small ranges, or opening the shared number dial for wide
  ones, always with a "table sets it" unset state where the rules allow it.
- **Buttons stage; the player rolls.** A control that touches the pool puts
  dice in hand for the player to throw — it never rolls on the click.
  (Rouse pulls a Hunger die into hand; the Roll button and the tray do the
  throwing.) Clicking a button and being told what you rolled is no fun.
- **Contextual actions pop above the row.** A button that exists only after a
  roll (Push, the Willpower reroll) appears above the picker row when
  eligible and disappears when spent, rather than reserving space.

## Two-beat actions

A partial reroll (Year Zero/Blade Runner/Twilight push, the V5 Willpower
reroll) is two beats: first the kept dice **lock** in place and the
rerollable dice are **picked up** (blanked, gathered aside); then a tap on
the felt throws just that handful. Where the player chooses the dice
(Willpower), the choice is made by tapping dice on the tray, with rings
marking picked and eligible, and ineligible dice refusing the tap.

## Trackers

A persistent resource the rules track between rolls (V5 Hunger, Mothership
Stress) is a **tracked stat**: it survives reload and mode switches, lives in
localStorage, moves only at its own control or by its own rule (a failed
Rouse, a failed check), and is cleared by the X/clear-pool button as part of
a full table reset. Its control shows the level as a count badge or pill, and
in Owlbear it syncs through the background so every surface agrees.

Willpower is deliberately **not** tracked: the reroll is the mechanic; the
point is spent on the player's own sheet. Do not add trackers whose only job
is bookkeeping the player already does elsewhere.

## Colour and identity

- **Every system has a palette** — a dark and a light scheme in
  `SYSTEM_THEMES`, retinting the whole app. The accent is the system's
  identity (V5 blood, Mothership acid green, Fate slate) and must hold WCAG
  AA for small text on both paper and face colours in both schemes.
- **Dice take the theme's ink unless the game colours its dice.** Genesys and
  Star Wars type-coloured dice, Year Zero's Base/Skill/Gear/Stress, Blade
  Runner and Twilight's roles, outcome tints for percentile systems — these
  carry per-die colour because the physical game does. A system whose dice
  are uniform uses ink and accent.
- **Symbols are drawn, not borrowed.** Every glyph (the ankh, the Genesys
  symbols, the Feat die's Eye and Gandalf rune, Fate's faces) is original
  line art sized from the face's inscribed circle. Mechanics are not
  protectable; art and names are — the names used are community shorthand,
  with a one-line disclaimer in the help panel.

## Results

- **A headline and a detail line.** The headline is the answer read the way
  the table would say it ("Failure · 1 Threat", "Blood holds", "66"), tinted
  by an outcome variant where the system has tiers. The detail line beneath
  carries the full arithmetic — every die, every cancellation — so the
  headline never has to.
- **No unearned resolution.** A roll that cannot be resolved without a value
  the table sets (difficulty, target) reports the raw facts and asserts no
  outcome. Never guess a win.
- **The same words everywhere.** The readout, the history log, the room
  share, and the Owlbear toast all read a roll through the same shared
  formatters. If two surfaces describe one roll differently, that is a bug.

## Modes and navigation

- The mode picker is a compact anchored popover: Dicebox (numeric) pinned
  first, then systems alphabetical by label, each row a coloured mark, the
  community-shorthand name, and a dice one-liner.
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
