# Dicebox

An offline dice roller for tabletop RPGs. No build step, no dependencies, no
network.

Try it at **[dicebox.trollskull.cc](https://dicebox.trollskull.cc)** — that is a
demo instance, not a service. Run your own copy if you want one that stays put;
see [Running it yourself](#running-it-yourself).

## About

This is a personal project. I kept running into the same problem — there was no
clean, open source, offline-capable web app for rolling dice — so I built one.
If you have had the same problem, you are welcome to it.

It was made with Claude Code. If that is not your bag, that is completely fine:
write your own, fork this, do whatever you want with it. Questions, comments,
issues, pull requests and forks are all welcome.

MIT licensed.

## Using it

Tap dice to build a pool: tap `d20` twice and `d6` once and you have `2d20+1d6`,
staged on the tray and written into the notation field. Press **Roll**, or flick
the tray, to throw them. The pool survives the roll, so re-rolling the same
handful is one more tap.

Typing notation by hand works the same way — the field is the source of truth,
and tapping a die extends whatever is already there.

The number on the left is how many dice each tap adds, so `100` then `d6` gives
you `100d6` without a hundred taps.

**Hold a die** for advantage, disadvantage, drop high/low, exploding and reroll.
Modifiers that answer different questions stack — `4d6dl1!` drops the lowest and
explodes — while two that answer the same one replace each other.

The `d?` button opens a picker for any side count from 1 to 1000, and a die you
choose there gets a button of its own.

## Running it yourself

There is no build step and no backend. The app is a handful of static files, so
anything that serves a directory over HTTP will do — it only needs `http://`
rather than `file://` so the service worker can register.

```sh
python3 -m http.server 8080     # or: npx serve, php -S localhost:8080, caddy file-server
```

### Docker

If you would rather run it as a container:

```sh
docker compose up -d            # http://localhost:8080
```

The image is nginx with the app copied in — nothing is compiled and nothing is
fetched at runtime. The bundled nginx config applies the same security and cache
headers the hosted copy uses. To serve on a different port, change the mapping in
`docker-compose.yml`.

For a home network, put it behind whatever reverse proxy you already run. It
needs HTTPS only if you want to install it to a phone's home screen; browsers
require a secure context for that, with `localhost` exempt.

To install on a phone, open the page and use **Add to Home Screen** — or the
**Install as an app** button in the help panel on Android. After the first load
it runs fully offline.

## Deploying

Deploys to Cloudflare as static assets, with no Worker script in front of them:

```sh
npm run deploy    # runs the tests, then wrangler deploy
npm run dev       # local preview through wrangler
```

`.assetsignore` keeps tests and tooling out of the upload. `_headers` sets a
strict CSP and marks `sw.js` `no-cache` — a stale service worker would pin every
other asset to its old version.

**Bump `CACHE` in `sw.js` whenever you change an asset**, or installed copies
will keep serving the old app.

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

The button row carries every rung of the Dungeon Crawl Classics chain:

```
d1 d2 d3 d4 d5 d6 d7 d8 d10 d12 d14 d16 d20 d24 d30
```

## Design

White dice on a white field, drawn as pure line work — no fill, no shadow. Depth
comes only from back-facing edges at 22% opacity. A faint ellipse sits under each
resting die so it reads as touching a surface.

Every die is a real tumbling solid — there are no flat tokens or placeholder
shapes. Numerals are painted onto the face plane in 3D, skewed with the face so
they track the die as it turns rather than floating flat over it.

### Dice for any number of sides

A fair die must be **isohedral**: every face equivalent under the solid's
symmetry group, so each face has equal probability. Two families cover every
face count, which is how physical d10s, d14s, d24s and d30s are actually made:

| Sides | Shape | Why |
| --- | --- | --- |
| 1 | notched cylinder | topples onto its one face however it lands |
| 2 | coin | no two-faced polyhedron exists |
| 4, 6, 8, 12, 20 | Platonic solid | exact regular solids |
| even N ≤ 22 | trapezohedron | 2n kite faces; the real d10 shape |
| odd N ≤ 22 | prism barrel | n faces around the equator; the real d7 shape |
| N > 22 | banded drum | stays legible where pointed solids blur |

A barrel gives an *exact* face count for any N, so a `d17` has seventeen
numbered faces rather than an eighteen-faced solid pretending to be one.

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

Pointed solids are the constraint, not facet count: a trapezohedron runs every
facet to one of two apexes, so it is already crowded at 24 faces and unreadable
by 40. A banded drum has no such convergence and stays countable past 120, so
dice above 22 sides use one. That is what lets a `d100` carry a hundred facets
instead of pretending with twelve — 108 of the 118 dice from d3 to d120 have
exactly one facet per side. Above that the shape becomes representative, since
more facets than the die is drawn wide cannot be told apart.

### Animation

Rolls of 24 dice or fewer are thrown across the tray, easing toward the grid slot
each was assigned and pushing apart on contact. Larger rolls spin in place: the
dice land in the same grid either way, so the flight and collision work buys
nothing and costs every frame.

Choosing a resting orientation is the most expensive thing in the frame, so it is
rationed — a few dice per frame, with a floor so nothing waits forever. That
keeps 200d50 inside the 16.7ms frame budget on a Raspberry Pi. Past 220 dice the
result appears immediately; the total is what anyone rolling that many wants.

## Randomness

`crypto.getRandomValues` with rejection sampling, so there's no modulo bias.
`Math.random()` is not used anywhere in the roll path.

## Tests

```sh
npm test                      # every suite
node tools/test.mjs           # notation, ranges, modifiers, distribution
node tools/test-render.mjs    # polyhedron geometry + settling simulation
node tools/test-pool.mjs      # tap-to-build pool, modifiers, round-tripping
node tools/test-markup.mjs    # html/css/js seams, manifest, offline integrity
node tools/test-load.mjs      # app.js against the real markup in a DOM shim
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
index.html          markup
style.css           tokens + layout
dice.js             notation parser and roller (no DOM)
render.js           polyhedra, wireframe drawing, throw simulation
app.js              controller, canvas loop, input, the pool
sw.js               cache-first service worker
worker.js           sets headers at the edge; serves the assets
wrangler.jsonc      Cloudflare static-assets config
_headers            reference copy of the header policy
.assetsignore       keeps tooling out of the upload
.env.example        the variables tools/deploy.mjs expects
Dockerfile          nginx image for self-hosting
docker-compose.yml  one-command local instance
docker/             nginx config and security headers
tools/              icon generation, tests, preview sheet, deploy
```

`dice.js` and `render.js` have no DOM dependency, so both can be tested directly.

## Regenerating assets

```sh
node tools/make-icons.cjs   # PWA icons
node tools/preview.cjs      # contact sheet of every die shape
```
