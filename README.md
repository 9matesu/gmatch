# gmatch

Adults-only (18+) desktop app. One multiplayer idle game. The gmatch
social/gaming shell (feed, card duels, chat, P2P, hacks, moderation, admin
dashboard) wrapping **Babecock · Idle** (ex-GoonGrid): click booru pictures to
earn g$, buy tags that steer your feed, collect a gallery, pop GoonCaps,
brainmelt for prestige. Idle earnings share the server g$ ledger with duels,
lootboxes, hacks and trades.

See `docs/SPEC.md` for the full product spec, `docs/DESKTOP.md` for the
exe's architecture, log locations and troubleshooting, and
`AGENTS.md` for dev rules.

## Run

```
npm install             # dev box: with NODE_ENV unset (or != production) so devDeps install
npm run electron        # desktop app (spawns the local Bun API sidecar)
# or browser dev:
npm run serve:api       # terminal 1 (needs bun: npm i -g --allow-scripts=bun bun)
npm run dev             # terminal 2
```

## Release .exe

```
cd apps/desktop
npm run dist            # icon -> stage api (bun.exe + self-contained server) ->
                        # vite build -> electron-builder portable
# artifact: release/gmatch-<version>-portable.exe  (single file, runs straight)
```

The packaged default is **client** mode pointing at the central node
(`https://gmatch-wcz1.onrender.com`, a blind courier: it relays encrypted envelopes it
cannot open). **Host** mode is opt-in in Settings → Server: every copy still
bundles its own full server (bun sidecar on `:8790`), shows the LAN addresses
to give friends, and one world lives per host. No cloud account, no telemetry.
Pushing a `v*` tag runs
`.github/workflows/release.yml`, which gates on lint/typecheck/tests and
publishes the exe to the GitHub release.

## Verify

```
npm run lint && npm run typecheck && npm run test   # all workspaces
cd apps/desktop && NODE_ENV=test npx playwright test  # e2e journeys
```

18+ only. Hard content blocklist enforced client- and server-side (SPEC §8).
