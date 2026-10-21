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

- **client (default):** talks to the central node `https://gmatch-wcz1.onrender.com`
  (a blind courier: relays encrypted envelopes it cannot open). No local server.
- **host:** spawns the bundled server (bun sidecar on `:8790`,
  `electron/apiSidecar.cjs`); one world per host, LAN addresses shown for
  friends. No cloud account, no telemetry.

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

Feed: the site's `release.json`, tried on **two hosts** (Render, then Fly):
`https://gmatch-wcz1.onrender.com/release.json` and
`https://gmatch.fly.dev/release.json`. Both are asked on every check; the
winner is the highest version among the hosts that answered, and the download
URL always comes from the SAME host that served the feed (the hash and the
bytes must share an origin). A host that is asleep or down therefore cannot
block an update, and a stale host cannot hide a newer release. GitHub Releases
is a mirror, not the feed (the repo is private).

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
keeps casual LAN visitors out, not the disk owner. The central fly node stays
dark by design.

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
   secureStore, mainlog, window-bounds, booru-sources). `imageCacheMemory` was
   removed with the RAM cache it covered — the disk cache is exercised by
   `imageCache.test.cjs` plus the vitest suites.
4. `cd apps/desktop && npm run dist` → `release/gmatch-<version>-portable.exe`.
5. Smoke the artifact: single-instance, log writes, server switch panel,
   window bounds restore, update check.
6. Publish hashes/version where the site's release block expects them
   (single-source blocklist build notes, commit 282a348 pattern), then tag
   `v<version>` — `.github/workflows/release.yml` gates on lint/typecheck/
   tests and mirrors the exe to the GitHub release.
