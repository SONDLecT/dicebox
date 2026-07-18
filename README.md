# Dicebox

An offline dice roller for tabletop RPGs. No build step, no dependencies, no network.

## Running it

Any static file server works — service workers need `http://`, not `file://`:

```sh
npm run serve     # http://localhost:8080
```

To install on a phone, serve it over HTTPS (or `localhost`), open it, and use
**Add to Home Screen**. After the first load it runs fully offline.

## Notation

| Input | Meaning |
| --- | --- |
| `3d6` | three six-sided dice |
| `d20` | one d20 (count defaults to 1) |
| `1d20+5` | with a modifier |
| `2d6+1d8-1` | any number of terms |
| `d%` | percentile, same as `d100` |
| `4d6kh3` | keep highest 3 (ability scores) |
| `2d20kl1` | keep lowest 1 (disadvantage) |
| `4d6dl1` | drop lowest 1 |
| `1d6!` | exploding — reroll and add on a max face |
| `1d10r2` | reroll any result of 2 or lower |

Sides are arbitrary from 1 to 10000, so Mothership's `d100`, DCC's `d14`/`d24`,
and anything else all work. Dropped dice stay visible in parentheses rather than
disappearing.

## The dice chain

Dungeon Crawl Classics steps rolls up and down a fixed chain:

```
d1 d2 d3 d4 d5 d6 d7 d8 d10 d12 d14 d16 d20 d24 d30
```

The `−` and `+` buttons move one rung and roll immediately; tapping a rung
directly selects and rolls it. Steps clamp at both ends.

## Design

White dice on a white field, drawn as pure line work — no fill, no shadow. Depth
comes only from back-facing edges at 22% opacity. The table is a single hairline
that ripples when a die lands.

The five Platonic solids (d4, d6, d8, d12, d20) render as true 3D wireframes.
Every other side count draws as a flat token with the value stroked on it —
faking a barrel for `d7` or `d100` would read worse than an honest token, and
arbitrary sides are a first-class feature here.

Flick the tray to throw. A flick re-rolls the last notation; a tap rolls the
currently selected chain die.

## Randomness

`crypto.getRandomValues` with rejection sampling, so there's no modulo bias.
`Math.random()` is not used anywhere in the roll path.

## Tests

```sh
npm test                      # notation, ranges, modifiers, chain, distribution
node tools/test-render.mjs    # polyhedron geometry + settling simulation
```

The geometry suite checks Euler's `V - E + F = 2` for every solid, which is what
catches bad face recovery — the kind of bug that shows up as a d12 with phantom
faces through its middle.

## Files

```
index.html      markup
style.css       tokens + layout
dice.js         notation parser and roller (no DOM)
render.js       polyhedra, wireframe drawing, throw simulation
app.js          controller, canvas loop, input
sw.js           cache-first service worker
tools/          icon generation, tests, preview sheet
```

`dice.js` has no DOM dependency, so it can be tested and reused directly.

## Regenerating assets

```sh
node tools/make-icons.cjs   # PWA icons
node tools/preview.cjs      # contact sheet of every die shape
```

## Changing the cache

Bump `CACHE` in `sw.js` when you edit any asset, or installed copies will keep
serving the old version.
