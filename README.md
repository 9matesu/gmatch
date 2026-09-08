# goonMatch · Grid

Adults-only (18+) desktop app — one multiplayer idle game. The goonMatch
social/gaming shell (feed, card duels, chat, P2P, hacks, moderation, admin
dashboard) wrapping **Babecock · Idle** (ex-GoonGrid): click booru pictures to
earn g$, buy tags that steer your feed, collect a gallery, pop GoonCaps,
brainmelt for prestige. Idle earnings share the server g$ ledger with duels,
lootboxes, hacks and trades.

Built by merging 9matesu/orbit into 9matesu/goongrid (2026-09, tag
`v0.2.0-orbit-merge`). See `docs/SPEC.md` for the full product spec and
`AGENTS.md` for dev rules.

## Run

```
npm install             # dev box: with NODE_ENV unset (or != production) so devDeps install
npm run electron        # desktop app (spawns the local Bun API sidecar)
# or browser dev:
npm run serve:api       # terminal 1 (needs bun: npm i -g --allow-scripts=bun bun)
npm run dev             # terminal 2
```

## Release .exe (no central server)

```
cd apps/desktop
npm run dist            # icon -> stage api (bun.exe + self-contained server) ->
                        # vite build -> electron-builder portable
# artifact: release/goonMatch-Grid-<version>-portable.exe  (single file, runs straight)
```

Every copy bundles its own server: **host** mode (default) runs it locally and
Settings → Server shows the LAN addresses (`http://192.168.x.x:8790`) to give
friends; a friend switches their copy to **client** mode with that address.
One world per host — no cloud account, no telemetry. Pushing a `v*` tag runs
`.github/workflows/release.yml`, which gates on lint/typecheck/tests and
publishes the exe to the GitHub release.

## Verify

```
npm run lint && npm run typecheck && npm run test   # all workspaces
cd apps/desktop && NODE_ENV=test npx playwright test  # e2e journeys
```

18+ only. Hard content blocklist enforced client- and server-side (SPEC §8).
