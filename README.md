# Dicebox

An offline dice roller for tabletop RPGs. No build step, no dependencies, no
network.

Try it at **[dicebox.trollskull.cc](https://dicebox.trollskull.cc)** — that is a
demo instance, not a service. To keep a copy of your own, see
[Getting it offline](#getting-it-offline): download it as a single file, install
it from the browser, or host it yourself.

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

## How the dice are drawn

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

## Randomness

`crypto.getRandomValues` with rejection sampling, so there's no modulo bias.
`Math.random()` is not used anywhere in the roll path.

## The roll log

Every roll is kept for the session, with what each die landed on and when.
**Full history** under the recent rolls opens the lot, and exports it:

- **Copy** puts a readable log on the clipboard
- **CSV** gives one row per die — time, notation, total, sides, value, and
  whether it was kept, exploded or rerolled — which is the shape you want for
  counting faces or checking whether a die is drifting
- **JSON** is the same data with the structure intact

Nothing leaves the browser unless you export it.

## Getting it offline

Three ways, easiest first.

### Download one file

Grab **[dicebox.html](https://dicebox.trollskull.cc/dicebox.html)** — or the copy
in [`dist/`](dist/dicebox.html) — and open it. That is the entire app in a single
file: no server, no install, no network. Put it on a USB stick, email it to
yourself, keep it in a folder with your character sheets. It works the same on a
laptop with the wifi off.

The help panel inside the app links to it too.

### Install it from the web

Open [the demo](https://dicebox.trollskull.cc) and install it. After the first
load it runs offline, because a service worker keeps a local copy.

| Browser | How |
| --- | --- |
| Chrome, Edge (desktop) | Install icon in the address bar, or ⋮ → Cast, save and share → Install page as app |
| Chrome (Android) | The **Install as an app** button in the help panel, or ⋮ → Add to Home screen |
| Safari (iOS/iPadOS) | Share → Add to Home Screen |
| Safari (macOS) | File → Add to Dock |
| Firefox | No install support on desktop. Bookmark it — it still works offline once loaded — or use the single-file build above |

### Run your own copy

There is no build step and no backend, so anything that serves a directory over
HTTP will do. It needs `http://` rather than `file://` only so the service worker
can register; the single-file build has no such requirement.

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

## Working on it

```sh
npm test          # every suite, including a build of the single-file bundle
npm run bundle    # rebuild dist/dicebox.html on its own
```

The demo is deployed to Cloudflare Workers with `node tools/deploy.mjs`, which
reads the credentials in `.env` — see `.env.example`. A small Worker fronts the
static assets to set security and cache headers.

**Bump `CACHE` in `sw.js` whenever you change an asset**, or installed copies
will keep serving the old version.
