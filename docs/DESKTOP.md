# gmatch Desktop (.exe) — architecture, storage, failure paths

Audience: whoever has to debug a user's install. Everything here is derived
from the code in `apps/desktop/electron/` and `apps/desktop/src/`; when a
behavior changes, update this file in the same commit.

## What the exe is

A single-file **portable** Electron app (electron-builder, `package.json`
`build:` block). No installer, no registry footprint: run it from anywhere.
First double-click can run twice (portable extraction); `requestSingleInstanceLock`
(`electron/main.cjs`) makes the second launch focus the first window instead of
spawning a second bundled server.

Two topologies, chosen once per launch in Settings → Server
(`electron/server-mode.cjs`, persisted in `userData/server-mode.json`):

- **host (default):** spawns the bundled server (bun sidecar on `:8790`,
  `electron/apiSidecar.cjs`); one world per host, LAN addresses shown for
  friends. No cloud account, no telemetry, no hosted dependency — the machine
  you are sitting at IS the node.
- **client (opt-in):** talks to someone else's node (a friend's machine, or any
  `http(s)://host[:port]` you were given). There is no hosted data default: the
  Cloudflare project at `gmatch.pages.dev` is only a directory/mail rendezvous,
  so a packaged build with no stored mode starts its own server instead of
  dialing a host that cannot hold a world.
- **A stored client pointer is resolved, never assumed.** Two shapes, two rules,
  because provenance and reachability answer different questions. A pointer
  written by an **older app** carries no `v` stamp and is **not dialed at all**:
  it is written `{ "paused": true, "pausedReason": "legacy" }`, keeping the
  address for a one-click Reconnect. An old deployment can still answer
  `/api/health` and still not be this install's world — evidence from the field,
  where exactly that left a user in an empty world while their own posts sat in
  local sqlite. A pointer **this app** wrote (`v: 2`) is health-checked once per
  launch (2.5 s bound, resolver-proof): an answer keeps it as the destination, a
  silent one is paused with `pausedReason: "unreachable"`. Either way the launch
  runs the bundled node and `server:state` carries `pausedUrl`/`pausedReason`,
  so Settings → Server explains which of the two happened and offers Reconnect /
  Forget it. No hostname list exists; nothing is deleted.

## Running with no hosted world (2026-10-24)

There is no hosted full node, so the app is self-sufficient: **host mode is the
default** and the bundled node is the world. The only shared infrastructure is
the Cloudflare rendezvous at `gmatch.pages.dev` (a signed node directory plus
sealed mail in D1), which can be disabled with `gmatch.central.url = none`.
Nothing else in the client resolves to a hosted address — the API base falls
back to `http://127.0.0.1:8790`, a stored node is kept only while it answers
(the launch probe above; the renderer also drops a stored base that fails its
own `/api/health` probe), and the server directory is read from the node you
are on.

What the local node gives you, with no third party involved:

| feature | where it lives now |
|---|---|
| feed, comments, likes, profiles, inbox | the local node's SQLite + blobs |
| media bytes | the Electron vault + IndexedDB (never uploaded) |
| DMs | sealed envelopes through the node's blind courier (`/api/mail`) |
| group chat, watch parties, groups, idle game | the local node's routes |
| posts/likes/comments between peers | signed operations, replicated peer-to-peer |

**Reaching a friend over the internet.** Your node must be reachable, or
yours and your friend's must be reachable from each other:

1. Settings → Server → *host* (the default) and note the LAN address the tab
   shows.
2. Make that port reachable from the internet: a port forward on the router,
   or a mesh/tunnel (Tailscale, Cloudflare Tunnel, a reverse proxy on a VPS you
   already have).
3. Put the PUBLIC address in the node's advertised address (Settings → Server
   → the server's address) and use *Copy share code* — the code carries the
   address, so your friend joins your node by pasting it.
4. Your friend's client then talks to your node as its courier and rendezvous:
   the sealed messages pass through it (it cannot read them) and the media and
   the signed operations travel **directly** between the two apps over WebRTC.

**Updates from a page and from peers.** The public manifest is
`https://gmatch.pages.dev/release.json`, staged from the shipped exe so its
sha256 describes the bytes users download. A node can also serve
`/release.json` and `/releases/<file>` from `userData/releases`: `npm run dist`
ends with `stage:release`, which copies the built exe there and writes the
manifest (version + sha256 + size), so the builder's own node serves the new
build to its peers. The updater asks the node this install is connected to
first, then the Pages manifest (skipped when it does not answer). The sha256
in the manifest is what makes it safe: the updater verifies it and discards a
mismatch. A plain-http feed is accepted only for a host on the user's own
network (loopback or a private LAN address).

**The honest limits.** Two nodes that are both unreachable from the public
internet cannot meet — that is NAT, not architecture, and no client-side code
fixes it. STUN covers most home connections; a symmetric NAT needs a reachable
node or a TURN relay. And when the direct WebRTC channel is blocked, the
swarm falls back to the node's WebSocket relay: the media still arrives, but
it travels through that node in the clear (the chunks are hash-verified, not
sealed — the DMs and the room messages stay sealed either way). The direct
path is what keeps the media private from the node. When neither the Pages
manifest nor the connected node answers, the updater says "no host answered"
rather than pretend the app is current, and the artifact can still be copied
by hand.

## Boot flow (`electron/main.cjs`)

1. `requestSingleInstanceLock` — duplicate launches exit after focusing.
2. `migrateUserData()` — one-shot move from the legacy `@goongrid` profile.
3. `mainLog()` + `uncaughtException`/`unhandledRejection` handlers — a fatal
   shows a native dialog AND writes `%APPDATA%\gmatch\main.log`.
4. Blocklist load — `userData/blocklist.json` (user-edited, Settings →
   Blocklist) overrides the packaged `shared/blocklist.json` (SPEC §8).
5. `initSecureKV()` (DPAPI) + `log:renderer` IPC — renderer `logger.error`
   calls ride the preload bridge into main.log.
6. `server-mode` decision; host mode spawns the sidecar with `ADMIN_PIN`
   (see below), `STORAGE_ENCRYPTION_KEY`, sqlite + blob paths.
7. Window: 1440x900 default, or the last bounds that still fit a screen
   (`userData/window-bounds.json`, validated by `window-bounds-core.cjs`).
8. Updater scheduled (packaged only).

## Where things live

All under `%APPDATA%\gmatch\` (`app.getPath('userData')`; also reachable via
Help → Troubleshooting → Open log folder):

| File | What | Notes |
|---|---|---|
| `main.log` (+`.1`) | main + renderer errors | rotates at ~1MB, one generation |
| `window-bounds.json` | last size/position | rejected if off-screen |
| `server-mode.json` | host/client + friend URL | env `gmatch_SERVER_URL` overrides |
| `blocklist.json` | user blocklist | overrides packaged default |
| `admin-pin.txt` | host-mode admin PIN | 8 hex, minted per install |
| `storage.key` | 64-hex blob/PM encryption key | losing it = losing the local world |
| `orbit.sqlite`, `blobs/` | the host-mode world | server-managed |
| `media-vault/` | saved keepsake bytes + `manifest.json` | AES-256-GCM when `storage.key` exists; content-addressed |
| `secure-*.json` | DPAPI-encrypted KV | identity keys etc. |

Feed images are served from the main-process cache over the `gmcache://`
protocol (`imageCache.cjs`) into `diskImageCache.cjs`: bytes are **encrypted on
disk** (AES-256-GCM, `userData/imgcache/*.enc`, 500 MB LRU-by-last-use), not
held in RAM as this doc previously claimed. Nothing sensitive is stored
unencrypted — but bytes *do* survive a shutdown and are re-used next launch.

Saved keepsakes use a second store, `media-vault/` (`electron/vault.cjs`):
`manifest.json` maps a store key (source url / `local://<hash>`) to an on-disk
file, plus mime, bytes, atime, pins and the content hash when it is known. The
vault is content-addressed (`sha256(bytes)`, the renderer's `localRef`), so
re-pinning identical content reuses the file, and the renderer reads it back
over the loopback vault server (`vaultServer.cjs` → `/f/<file>`, Range-capable)
or the privileged `vault://` scheme.

Two edges matter when debugging a user's "my keepsake is gone":

- **Legacy rows** predate the recorded content hash: they are keyed by source
  url and named `sha256(url).<ext>` on disk, so `vault://f/<localRef>` used to
  resolve nothing even though the bytes were there. `vault.get()` now backfills
  on the first hash miss — it reads each hash-less row once (decrypting if
  `enc`), binds `hash`, and persists the manifest — so the cost is paid once per
  file, not per launch. Bytes that cannot be read or decrypted are skipped by
  the backfill and reported by `vault.probe()` (below).
- **`vault.probe(ref)`** (the `vault:get` IPC) distinguishes
  `{ state: 'local' }` / `{ state: 'absent' }` / `{ state: 'unreadable', reason }`
  (`missing-file` | `decrypt` | `read` | `ipc`) and never drops a row on a
  transient read failure. `vault.get()` still exists for internal callers.
- **Object-id lookup** (`entryFor`): manifest keys are the URL that served the
  bytes, so a post row that survives a world move (it knows only its
  `/api/objects/<id>`) now matches any stored key ending in that id. The feed
  probes this before asking the node (which stores no media) or a peer.
- **Terminal miss:** when the vault has no bytes, the path is a P2P descriptor
  and the bounded swarm ask times out, the tile reports a miss instead of
  "waiting for poster" forever. The feed hides posts in that state behind
  `N posts hidden - media not on this device` with Show/Hide (Show remounts the
  tiles for one explicit retry); nothing is deleted.

## Failure paths (what the user sees when each layer breaks)

- **Renderer component throws:** ErrorBoundary → "This screen hit an error."
  with a Reload button; the stack lands in main.log.
- **Unhandled renderer error/rejection:** `src/main.tsx` listeners → main.log.
- **Main-process fatal:** native dialog + main.log; never a silent zombie.
- **Bundled server fails at boot:** dialog pointing at Settings → Server.
- **Bundled server dies later:** one automatic restart (main.log
  `sidecar restarted ok`); a second death shows a dialog.
- **Central node unreachable:** every fetch resolves to an honest HTTP 503
  (`src/utils/api.ts` `offlineErrorResponse`); UI shows offline chrome, never
  fabricated data.
- **Server switch saved:** "Saved. Restart now to switch servers." — the app
  never force-quits the user.
- **Keepsake bytes present but unreadable:** the viewer shows "Local media could
  not be read (reason)" — never "Media unavailable locally", which is reserved
  for a completed lookup that found nothing. Source url drift is not a failure:
  the vault is re-queried by content ref (`sha256(bytes)`) first.
- **Update:** see below.

## Self-update (`electron/updater.cjs`, `updater-core.cjs`)

Feed: the project site's `release.json` at
`https://gmatch.pages.dev/release.json`, plus the manifest of the node this
install talks to when that node serves one. Both are asked on every check; the
winner is the highest version among the hosts that answered. The manifest
carries the absolute `downloadUrl` (the GitHub Release asset) plus the
sha256/size of those exact bytes, and the updater verifies both before the
swap. A host that is asleep, **stuck** or down is skipped (8 s budget each)
instead of blocking the check, and a stale host cannot hide a newer release.
There is no second public deployment to keep alive.

Check on boot + every 24h. Auto-downloads the new portable exe with a
progress percent, **verifies SHA-256 and the published size** (an
unpublished digest is shown honestly as unverified and is never installed),
then Settings → Update's "Install & Restart" hands a **hidden** cmd.exe a
retry-move script, quits, and the script swaps the file and relaunches.
Downgrade/bad-asset releases are rejected by `planCheck` (`updater-core.cjs`).

The cmd runs `windowsHide` **without** `detached`: a detached cmd has no
console, so every console exe the batch calls (the retry `ping`) allocates its
own visible window — the "reappearing command prompts" report. The batch
retries the move with a 3s/6s/10s backoff (30 tries, ~3 min) and, if it still
cannot replace the file, relaunches the OLD exe so no failure path ends with a
closed app.

**Verifying the swap on a real machine:** `node electron/updater-swap.e2e.cjs`
(Windows only) is the end-to-end check — it proves the A/B difference
(`windowsHide` without `detached` shows no console window; `detached` shows
one), then runs the real updater against a local feed with the installed file
locked (the antivirus-scan case) and asserts that the file is replaced, that
the batch needed a retry, and that **no console window appeared**. The
scripted checks live in `electron/updater-core.test.cjs` and
`electron/updater.test.cjs`.

**Hosting the artifact:** the site tree carries ONLY the current release exe
(`site/releases/gMatch-<version>-portable.exe`); older versions live in their
GitHub Releases. A tree with every historical exe (1 GB+) is a build-context
problem for the host, not a convenience. `site/release.json` is generated from
the bytes that are actually served, so the published hash is never hand-typed.

## Admin console in the exe

Host-mode installs show the admin passcode in Settings → Server
(click-to-copy; `electron/admin-pin.cjs`). Trust argument (in the file
header): whoever can read `userData` already owns the sqlite, so the PIN
keeps casual LAN visitors out, not the disk owner.

## Troubleshooting quick table

| Symptom | Check |
|---|---|
| Double-click does nothing | `%APPDATA%\gmatch\main.log` (migration/boot failure) |
| Feed images dead / OFFLINE badge | idle grid shows source health; sources are public boorus, outages are normal |
| Friends cannot join | host mode + same LAN/VPN; Settings → Server shows the shareable addresses |
| Switched server, nothing changed | Settings → Server → Restart now |
| Locked out of admin console | Settings → Server (host mode) shows the passcode |
| Friend node code rejected | the code is ONE line starting `gmatch://node/`; re-copy via Servers -> Share. Joining needs the same LAN (or a port-forwarded host) |
| Server missing from the directory | host mode must be running (the heartbeat lists it while online); rows expire after 24h of silence |
| Update says "sha256 mismatch" | network middlebox; retry, or grab the .exe from the releases link |

## Release checklist

1. `apps/desktop/package.json`: bump `version`.
2. `npm run lint && npm run typecheck && npm run test` (0 errors, green).
3. `node electron/*.test.cjs` battery (admin-pin, customFolders, imageCache,
   secureStore, mainlog, window-bounds, booru-sources, server-mode,
   apiSidecar). `imageCacheMemory` was
   removed with the RAM cache it covered — the disk cache is exercised by
   `imageCache.test.cjs` plus the vitest suites. `apiSidecar.test.cjs` exists
   because two undefined identifiers in that file meant **every packaged
   host-mode launch threw before spawning the node** (empty world over an intact
   database); it asserts the spawn actually happens and that dev still lets
   `apps/api/.env.local` own `ADMIN_PIN`. `no-undef` is an eslint **error** for
   `electron/**`/`scripts/**` for the same reason.
4. `cd apps/desktop && npm run dist` → `release/gmatch-<version>-portable.exe`.
5. Smoke the artifact: single-instance, log writes, server switch panel,
   window bounds restore, update check.
6. Publish hashes/version where the site's release block expects them
   (single-source blocklist build notes, commit 282a348 pattern), then tag
   `v<version>` — `.github/workflows/release.yml` gates on lint/typecheck/
   tests and mirrors the exe to the GitHub release.
