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
| `secure-*.json` | DPAPI-encrypted KV | identity keys etc. |

Feed images are RAM-only (`gmcache://` protocol, `imageCache.cjs`) — bytes
never hit disk, nothing sensitive survives a shutdown.

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
- **Update:** see below.

## Self-update (`electron/updater.cjs`, `updater-core.cjs`)

Feed: `https://gmatch-wcz1.onrender.com/release.json` (GitHub Releases is a mirror).
Check on boot + every 24h. Auto-downloads the new portable exe with a
progress percent, **verifies SHA-256 against the published digest** (an
unpublished digest is shown honestly as unverified), then Settings → Update's
"Install & Restart" hands a detached cmd.exe a retry-move script, quits, and
the script swaps the file and relaunches. Downgrade/bad-asset releases are
rejected by `planCheck` (`updater-core.cjs`).

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
   imageCacheMemory, secureStore, mainlog, window-bounds, booru-sources,
   server-mode, updater).
4. `cd apps/desktop && npm run dist` → `release/gmatch-<version>-portable.exe`.
5. Smoke the artifact: single-instance, log writes, server switch panel,
   window bounds restore, update check.
6. Publish hashes/version where the site's release block expects them
   (single-source blocklist build notes, commit 282a348 pattern), then tag
   `v<version>` — `.github/workflows/release.yml` gates on lint/typecheck/
   tests and mirrors the exe to the GitHub release.
