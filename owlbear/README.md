# Dicebox for Owlbear Rodeo

Dicebox as an Owlbear Rodeo panel. It joins a room as an ordinary member: you
type the same passphrase everyone else typed, you see their rolls, they see
yours. There is nothing special about being the one in Owlbear.

It is the same app, not a reimplementation. `tools/build-owlbear.mjs` copies the
files from the repo root and changes three things — the relay origin is baked
in, the install-to-home-screen parts come out, and the headers permit exactly
one site to frame the panel. A fix anywhere in Dicebox reaches the panel by
rebuilding it.

## What it is and is not

**It is a peer.** Everyone who wants the shared log needs the passphrase and
their own copy of Dicebox — in this panel, in a browser tab, or on a phone. They
are all the same kind of participant.

**It is not a bridge.** Rolls are not published into the Owlbear room, so
players without the passphrase see nothing. That is deliberate. A bridge would
have to hold the room key and republish plaintext to Owlbear's servers, which
would quietly break the promise the rest of this project makes — the relay never
sees a roll, and neither should anyone else's. If you want that anyway, it is a
different feature and it needs saying out loud in the privacy documentation
rather than appearing as a convenience.

**Rolls stay local if the relay is unreachable.** Same as everywhere else. The
dice land instantly and the panel says it cannot share.

## Build it

```sh
npm run build:owlbear -- --relay=wss://relay.example.com/ws
```

Output goes to `owlbear/dist/`. It is not committed — it is entirely generated,
and keeping a copy in the tree would mean two versions of the app drifting apart.

| Flag | Meaning |
| --- | --- |
| `--relay` | **Required.** The relay this panel talks to. Baked into the build and pinned in its `connect-src`: a panel has no settings screen, and an iframe is not a place to be configuring origins. |
| `--site` | Where a full copy of Dicebox lives, for the help panel's links. Defaults to the public demo. |
| `--out` | Where to build. Defaults to `owlbear/dist`. |

`wss://` rather than `ws://`. Owlbear is served over HTTPS, so a browser blocks
a plaintext socket from a page inside it as mixed content; the build warns about
this rather than failing, because a LAN test before you have a certificate is a
reasonable thing to want.

## Host it

Any HTTPS static host. There is no build step beyond the above, no server, and
nothing dynamic.

### On Cloudflare Workers, like the app

The build emits `worker.js` and `wrangler.jsonc` alongside the files, so it
deploys with the same infrastructure Dicebox already uses:

```sh
npm run build:owlbear -- --relay=wss://relay.example.com/ws
cd owlbear/dist && npx wrangler deploy
```

Set a route or attach a custom domain in the generated `wrangler.jsonc` first.
It must be a **different origin from the app** — this build permits being
framed and the app must never be.

The Worker exists purely to attach headers, and it is not optional. `_headers`
is a Pages feature that **Workers ignore silently** — the repo's own
`wrangler.jsonc` says as much. Deployed without the script, the panel would
serve no `Content-Security-Policy` at all: no `frame-ancestors`, no pinned
relay. It would install, open, roll dice and join rooms exactly as it should,
with every protection below simply absent and nothing to notice. The same is
true if `run_worker_first` is dropped, because then assets are served straight
past the script.

### Anywhere else

`owlbear/dist/_headers` is written in Cloudflare Pages format. For nginx:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://relay.example.com; base-uri 'none'; form-action 'none'; frame-ancestors https://www.owlbear.rodeo" always;
```

Two directives there are load-bearing and both are narrower than they look.

**`frame-ancestors https://www.owlbear.rodeo`.** The main Dicebox build sets
`frame-ancestors 'none'` and means it — it refuses to be embedded anywhere at
all. This build has to be embedded, by one site, so it names that site rather
than relaxing to a wildcard. A panel that any page could frame is a page holding
a room passphrase that any page could frame.

This is also why the panel belongs on **its own origin**, and why `owlbear` is
in `.assetsignore`. Serving a framable copy from the same host as the copy that
refuses to be framed gives up the protection for both.

**`connect-src 'self' wss://<your relay>`.** Pinned to one exact host, for the
reason given at length in `worker.js`: the relay is never given key material by
design, and the pin is what keeps that true if the design fails. A build
tampered with between your server and a player's browser still cannot post a
derived key anywhere, because the browser refuses the connection before the
request leaves. `wss:` would allow every relay on the internet.

### Let the relay accept the panel

The panel connects from your extension origin, not from the Dicebox origin, so
the relay has to allow it.

- **Self-hosted relay:** add it to `DICEBOX_ALLOWED_ORIGINS`, or leave that
  unset on a private network where every origin is allowed.
- **Cloudflare relay:** add it to `ALLOWED_ORIGINS` in `server/wrangler.jsonc`
  and redeploy. That worker rejects a request whose `Origin` is not on the list,
  and unlike the Node relay it also rejects a missing one.

Symptom if you forget: the panel opens, the dice roll, and joining a room never
reaches "live".

## Install it

1. Serve `owlbear/dist` at an HTTPS origin.
2. In Owlbear Rodeo, open your profile and choose **Add Extension**.
3. Paste `https://your-origin/manifest.json`.
4. Create or edit a room and enable Dicebox in the room dialog.
5. The action appears in the top left. Click it for the panel.

The panel opens at 420×700 by default, set in `manifest.json`. Dicebox is
phone-first, so that shape suits it; adjust `action.width` and `action.height`
if you would rather have it another way.

## Notes from building it

**The clipboard needs a permission.** Copying the passphrase, the invite link
and the roll log all go through `navigator.clipboard`, which an iframe may not
use unless the extension declares `clipboard-write`. It is in `manifest.json`
with its reason. Without it those buttons fail silently, which at a table means
the passphrase becomes uncopyable at the exact moment everyone needs it.

**Storage may be partitioned or denied.** An embedded copy can have
`localStorage` throw on access rather than return null. Dicebox reads it at
load, so this used to be capable of blanking the panel with no visible error;
it now goes through a guard. Losing the theme preference is the whole cost.

**No service worker.** The app skips registering one when it detects it is
framed. A panel with no address bar and no reload button, quietly serving a
build from three deploys ago, is not something you can talk a player through
fixing.

**The SDK is not used.** Owlbear's SDK exists for talking to the room — scene
items, player metadata, broadcasts — and a thin peer talks to none of that. So
the panel has no dependencies, which keeps it the same code as the app it was
built from. If a bridge is ever built, that is where the SDK comes in.

**Sixteen connections per room.** The relay's default. Someone running the panel
and a phone counts twice.
