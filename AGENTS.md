# gmatch — Babecock Idle

Adults-only (18+) desktop app: an Electron + React shell (feed, duels, chat,
P2P, hacks, moderation) wrapping the **Babecock · Idle** clicker game. Read
`docs/SPEC.md` (product + merge plan) and `docs/ARCHITECTURE-P2P.md` before
large changes; `docs/DESKTOP.md` covers the exe's runtime internals.

> **18+ / SAFETY (non-negotiable):** the app gates on an age screen at first
> launch. The desktop client MUST apply the blocklist (docs/SPEC.md §8) rejecting
> any tag suggesting minors or prohibited content, and must only request
> `rating:explicit`/adult pools. Enforcement is client-side only — the API stores
> tags verbatim and never hard-blocks them. No telemetry, no uploads; images are
> fetched read-only from public booru APIs.
>
> Blocklist single source of truth is `shared/blocklist.json`; the renderer rule
> (`apps/desktop/src/game/tagFilter.ts`) and the identical `hitsAtTokenStart` in
> `apps/desktop/electron/main.cjs` must not drift — a parity test guards it.

## Layout (npm workspaces — there is no root `src/`)

- `apps/desktop/src/` — renderer (Vite + React 19 + Tailwind 4). Import via `@/` → `apps/desktop/src`.
- `apps/desktop/electron/` — main + preload, **CommonJS `.cjs`** (package is `type: module`, so keep `require`).
- `apps/api/` — Hono + SQLite on Bun (`bun run src/serve.ts`); packaged as a local sidecar on `:8790`.
- `packages/{crypto,protocol,shared}` — vendored `@orbit/*` libraries, consumed through TS path aliases in `apps/desktop/tsconfig.json` (no build step).
- `shared/{blocklist,sources}.json` — imported by main + vite config and shipped via electron-builder `extraResources`.

## Commands

Root commands fan out with `--workspaces --if-present`.

- `npm install` · `npm run lint` · `npm run typecheck` · `npm run test` — full gate, all workspaces. **Lint gate = 0 errors** (warnings allowed); `packages/*` have no lint script.
- `npm run build` — vite build of `apps/desktop` only.
- `npm run electron` — desktop app; `npm run dev` — browser dev.
- Single desktop test (from `apps/desktop`): `npx vitest run src/services/vault.test.ts`. Even one file takes ~1 min to start (setup + jsdom env) — not a hang.
- Single API test: `npm test -w @orbit/api -- src/routes/<file>.test.ts`.
- **Electron main tests have no vitest/npm runner.** Each `apps/desktop/electron/*.test.cjs` is a standalone node script: `cd apps/desktop && node electron/vault.test.cjs`. They are invisible to `npm run test`.
- E2E: `cd apps/desktop && NODE_ENV=test npx playwright test` — boots vite on `:5273` plus a hermetic Bun sidecar on `:8791` with a fresh DB under `I:/tmp/gmatch-e2e` (Windows paths are pinned in `playwright.config.ts`; workers=1 because every spec drives one node).
- Release exe: `cd apps/desktop && npm run dist` (icon → stage api → vite build → electron-builder portable).

## Testing quirks

- Desktop vitest runs `environment: 'node'`; component tests opt into jsdom per file with `// @vitest-environment jsdom` on line 1.
- Desktop vitest only includes `src/**/*.test.{ts,tsx}` — nothing under `electron/`.
- `apps/desktop/vitest.config.ts` pins `NODE_ENV=test` deliberately: a shell exporting `NODE_ENV=production` would otherwise ship React's production build and break `React.act`.
- `tsc` covers `src/**` + `vite.config.ts` only. `electron/*.cjs` are guarded by eslint + their node tests, not typecheck.

## Runtime wiring worth knowing

- The renderer never calls booru APIs directly: the idle feed fetches in the
  main process over IPC (one client, `apps/desktop/src/services/booru.ts`); the
  social feed carries peer uploads over the swarm, never from a booru. Any
  fetch failure must fall back to offline SVG placeholders (SPEC §6), never
  crash or fabricate.
- `npm run dev` boots a local Bun sidecar and talks to it only (`vite.config.ts`); there is no remote dev mode. The Cloudflare Pages project (`site/functions/`) is a **blind courier** (directory + sealed mail only) and 404s every stateful route — the local sidecar (or a self-hosted full node) is required for feed/DMs. Sealed mail defaults to that courier so peers on different worlds still reach each other; the courier has no WebSocket, so `MailClient` polls it.
- Two separate economies, never bridged (SPEC §2): idle `pts` live only in the localStorage save (`gmatch.save.v1`); server `g$` is the authoritative `EconomyService` ledger.
- Single 18+ gate is the shell's `AgeGateModal` (mirrored into the idle store); don't add a second one.

## Dev procedure (mandatory)

1. Read this file + `docs/SPEC.md` before touching code.
2. branch → TDD (economy logic first, tests next to the code) → `npm run lint` (0 err) → `npm run test` (green) → `npm run build` → merge.
3. DRY, small injectable units. No clever monoliths, no fabricated data.
4. Behavior changes update the doc that describes them (`docs/SPEC.md`, `docs/DESKTOP.md`) in the same commit.
5. Release: bump the version in `apps/desktop/package.json`, run the full gate, `npm run dist`, then tag `v*` — `.github/workflows/release.yml` re-runs lint/typecheck/test on the tag.
