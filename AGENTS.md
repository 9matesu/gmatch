# GoonGrid — Babecock Idle

Adults-only (18+) desktop idle-clicker game. Electron + Vite + React + TypeScript.
Inspired by the `babecock` module and game-registry patterns of the ORBIT/goonMatch
platform (see docs/reference/). This repo is standalone — ORBIT is NOT a dependency.

> **18+ / SAFETY (non-negotiable):** the app gates on an age confirmation screen at
> first launch. The booru client MUST apply a hard blocklist (see docs/SPEC.md §8)
> that rejects any tag suggesting minors or prohibited content, and must only
> request `rating:explicit`/adult pools. No telemetry, no uploads — images are
> fetched read-only from public booru APIs.

## Stack

- electron (main process does booru HTTP fetches → IPC; renderer never hits boorus directly)
- vite + react 18 + typescript (strict)
- zustand for game state; localStorage for saves
- vitest for tests; eslint flat config — **0 errors is the gate**

## Dev procedure (mandatory)

1. Read this file + docs/SPEC.md before touching code.
2. branch -> TDD (economy logic first, tests in `src/game/*.test.ts`) -> `npm run lint` (0 err) -> `npm run test` (green) -> `npm run build` -> merge.
3. DRY / simple code. Small injectable units. No clever monoliths.
4. Never fabricate: if an API is down, the game must fall back to offline SVG
   placeholders (docs/SPEC.md §6) and say so in the UI.

## Commands

- `npm run dev` — vite dev server (browser mode, offline placeholders)
- `npm run electron` — desktop app
- `npm run lint` / `npm run test` / `npm run build`

## Layout

- `src/game/` — pure logic: economy, tags, rarity, prestige (unit-tested, no DOM)
- `src/services/` — booru client (shared), ipc bridge, offline fallback
- `src/ui/` — React components (dark glassy style, see SPEC §7)
- `electron/` — main + preload
