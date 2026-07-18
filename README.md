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

Every die is a real tumbling solid — there are no flat tokens or placeholder
shapes. Numerals are painted onto the face plane in 3D, skewed with the face so
they track the die as it turns rather than floating flat over it.

### Dice for any number of sides

A fair die must be **isohedral**: every face equivalent under the solid's
symmetry group, so each face has equal probability. Two families cover every
face count, which is how physical d10s, d14s, d24s and d30s are actually made:

| Sides | Shape | Why |
| --- | --- | --- |
| 2 | coin | no two-faced polyhedron exists |
| 4, 6, 8, 12, 20 | Platonic solid | exact regular solids |
| even N | trapezohedron | 2n kite faces; the real d10 shape |
| odd N | bipyramid | 2n triangles, one face never selected |

The trapezohedron's apex height is not a free parameter. Each kite face
`[apex, top_i, bot_i, top_i+1]` is planar only when

```
H = 2 / (1 - cos(pi/n)) - 1
```

with the rings at unit radius. Choosing it by eye bowties every face, which
renders as a tangle of crossing edges. That ratio grows fast — at n=15 the apex
sits 90x further out than the equator — so the solid is squashed along y
afterwards to get the near-spherical proportions a real die has. Scaling a
single axis preserves planarity.

Above 32 faces the facets are too fine to read as anything but a sphere, so the
geometry caps there while the die still reports its true side count.

No true odd-faced isohedron exists, so odd dice use a bipyramid with one face
left unselected — the same compromise physical dice make.

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
faces through its middle. It also verifies that every face from d2 to d120 is
coplanar, that dice settle showing a face to the camera, and that multiple dice
never come to rest overlapping.

When testing planarity, derive the face plane from three of its vertices. Using
the centroid direction as the normal is wrong for kite faces, whose plane is not
perpendicular to the centroid ray — that mistake reports every valid
trapezohedron as broken.

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
