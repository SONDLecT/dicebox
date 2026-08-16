# Dicebox for Owlbear Rodeo

Dicebox as an Owlbear Rodeo panel. Panels in the same Owlbear game share rolls
automatically over Owlbear's Broadcast API, with no Dicebox passphrase. The
ordinary end-to-end encrypted passphrase-room controls remain available as a
separate transport for phones, browser tabs, and players outside that game.

It is the same app, not a reimplementation. `tools/build-owlbear.mjs` copies the
files from the repo root and changes three things — the relay origin is baked
in, the install-to-home-screen parts come out, and the headers permit exactly
one site to frame the panel. A fix anywhere in Dicebox reaches the panel by
rebuilding it.

The action icon is copied from the project's canonical `brand/d20.svg` mark.
PWA, dashboard and Owlbear artwork therefore share the same deconstructed-d20
geometry rather than maintaining separate identities.

## What it is and is not

**It is a shared table inside Owlbear.** Enabling Dicebox enables table sending
and listening; there is no separate switch. The manifest-owned background page
waits for its own `OBR.onReady()` and remains active while the action popover is
closed. It receives completed rolls, retains bounded room-local history, and
answers typed requests from other extensions on this player's local Owlbear
connection. The Share rolls menu has only a small Owlbear-mode notice.

Owlbear relays readable Broadcast messages to the current game, so these rolls
are not Dicebox end-to-end encrypted and can be read by an extension listening
on the known channel. Rolls carry stable ids, incoming messages are deduplicated,
and received events are never republished, so neither Owlbear nor the encrypted
room transport forms a loop.

**It is also a peer.** The manual passphrase room is still here, end-to-end
encrypted, for anyone NOT in the Owlbear game — a phone, a browser tab, a player
at a different table. The table creates a room and everyone joins it; the Owlbear
players are then on both transports at once, which the id dedupe cleans up.

**The two transports fail independently.** If the Dicebox WebSocket relay is
unreachable, a passphrase-room roll still lands locally and that room reports it
cannot share. Owlbear Broadcast does not use that relay and can continue sharing
readable rolls with the current game.

## Build it

```sh
npm run build:owlbear -- --relay=wss://relay.example.com/ws
```

Output goes to `owlbear/dist/`. It is not committed — it is entirely generated,
and keeping a copy in the tree would mean two versions of the app drifting apart.

| Flag | Meaning |
| --- | --- |
| `--relay` | **Required.** The relay this panel talks to. Baked into the build and pinned in its `connect-src`: a panel has no settings screen, and an iframe is not a place to be configuring origins. |
| `--site` | Where a full copy of Dicebox lives, for the help panel's links. Defaults to the hosted service. |
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
npm run build:owlbear -- --relay=wss://relay.example.com/ws --host=vtt.example.com
npm run deploy:owlbear
```

`--host` must be a **different origin from the app**, and the deploy refuses to
publish onto the app's hostname rather than trusting anyone to remember why.
Two reasons, and the second is the one that bites:

- This build permits being framed and the app must never be. Sharing a host
  means one server sending two different `frame-ancestors` depending on the
  path, and a path check that is ever wrong makes the whole app framable
  without breaking anything visible.
- The app registers a service worker at `/` with scope `/`, and a service
  worker controls every page beneath it. A panel served from a path on the
  app's origin is served out of the app's offline cache — inside a frame with
  no address bar and no reload button. A stale cache there is close to
  undiagnosable.

The deploy is the same REST upload `tools/deploy.mjs` uses; wrangler would work
too where it runs.

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

**`connect-src 'self' wss://<your relay>`.** Pinning the relay prevents a
compromised build from connecting to arbitrary third-party origins. It does not
protect against a compromised panel origin or relay: `self` and that relay are
still allowed destinations. Using `wss:` instead would widen the policy to
every secure WebSocket relay on the internet.

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

**Owlbear reads the manifest cross-origin, so it needs CORS.** The install
dialog fetches `manifest.json` from Owlbear's own page, and the action icon the
same way. Without `Access-Control-Allow-Origin` the browser refuses to hand over
a response that was served perfectly correctly, and the only thing you see is a
red **failed to fetch** — which looks like the URL is wrong or the host is down.
The worker grants it on those two files and nothing else.

**Changing only headers will not bust the edge cache.** Adding that header did
not change a byte of the manifest body, so its ETag was unchanged, so
revalidation returned 304 and Cloudflare kept serving its stored headers —
including the missing one. `Cache-Control: no-cache` does not help; it forces
revalidation, and revalidation is exactly what succeeded. Bump the manifest
version, which changes the body, or purge the URL.


**The clipboard needs a permission.** Copying the passphrase, the invite link
and the roll log all go through `navigator.clipboard`, which an iframe may not
use unless the extension declares `clipboard-write`. It is in `manifest.json`
with its reason. Without it those buttons fail silently, which at a table means
the passphrase becomes uncopyable at the exact moment everyone needs it.

**Storage may be partitioned or denied.** An embedded copy can have synchronous
storage APIs throw instead of returning null, so all fallbacks are guarded.
Background history primarily uses IndexedDB and is bounded by count and bytes;
when IndexedDB is unavailable it falls back to the guarded room-local cache.
The panel still rolls if persistence is unavailable, but retained history and
other preferences may not survive a reload.

**No service worker.** The app skips registering one when it detects it is
framed. A panel with no address bar and no reload button, quietly serving a
build from three deploys ago, is not something you can talk a player through
fixing.

**The SDK, vendored.** The VTT artifact loads Owlbear's SDK in two independent
contexts. The action panel imports it lazily behind the build-only
`dicebox-owlbear` marker; `background.html` loads its own entry point and waits
for its own `OBR.onReady()`. The SDK, background entries, coordinator, and
IndexedDB repository are copied only by `tools/build-owlbear.mjs`; the ordinary
site and offline bundle do not initialize them.

The typed version-1 request/result contract uses only `cc.dicebox.rolls`.
Requests and correlated responses are `LOCAL`; completed table events and push
transitions are explicitly `REMOTE`. Dicebox keeps 4 KiB of headroom below
Owlbear's 16 KiB Broadcast ceiling, pages history, serialises stateful work, and
returns explicit timeout, rate, queue, validation, and payload-limit errors.
See the root README's **For extension developers** section for schemas and trust
limits.

Regenerate it when bumping the SDK:

```sh
npm install @owlbear-rodeo/sdk --no-save
node_modules/.bin/esbuild node_modules/@owlbear-rodeo/sdk/lib/index.js \
  --bundle --format=esm --platform=browser --minify --outfile=owlbear/obr-sdk.js
```

It bundles clean — no node built-ins survive — so it needs no polyfills. It uses
`window`, so it runs in the browser panel and cannot be imported under Node.

**Sixteen connections per room.** The relay's default. Someone running the panel
and a phone counts twice.
