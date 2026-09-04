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
npm install
npm run electron        # desktop app (spawns the Bun API sidecar)
# or browser dev:
npm run serve:api       # terminal 1 (needs bun: npm i -g --allow-scripts=bun bun)
npm run dev             # terminal 2
```

## Verify

```
npm run lint && npm run test && npm run build   # all workspaces
```

18+ only. Hard content blocklist enforced client- and server-side (SPEC §8).
