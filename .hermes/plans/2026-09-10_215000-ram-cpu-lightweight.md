# Plan: lightweight portable app — RAM & CPU to the core

## Goal

Cut steady-state RAM and CPU of the packaged gMatch portable app with measured, evidence-driven changes, keeping the idle game honest (offline accrual intact).

## Current context / assumptions

- Repo `I:/goongrid`, app `apps/desktop` (Electron 33 + Vite + React 19), branch `fix/browser-perf-ui-sweep`. Gates: `npm run lint` (0 err), `npx tsc -p tsconfig.json --noEmit` (clean), `npx vitest run` (green desktop), `node electron/*.test.cjs` (4 files), api suite (`cd apps/api && npx vitest run`, 843).
- Two prior sweeps already exist — DO NOT redo them: `docs/BROWSER-PERF.md` (sheen/grain/tickers/blur, recalc 3.09s→0.27s) and `docs/PERF.md` (image LRU 256→96MB, feed memo 100→40 queries, poller hidden-gating for App/Babecock/HackSpy, blob-URL revocations; Playwright `e2e/perf.spec.ts` tripwires: heap growth <60MiB, post-GC <120MiB; probe `tools/perf-cdp.mjs`, fps probe `tools/fps-idle.mjs`).
- Baseline before touching anything: run `node tools/perf-cdp.mjs` against `vite preview` and note `TaskDuration`, `ScriptDuration`, JS heap; run `node tools/fps-idle.mjs`. (Playwright probe mocks `/api/booru/*` with 1×1 tiles — timings independent of mirror health.)
- Remaining suspects found this planning pass (each becomes a task):
  1. `src/services/booru.ts` `persistSeen()` JSON.stringifies up to 50k ids + 50k urls (multi-MB) to localStorage on EVERY `markSeen()` call — and `src/game/store.ts` calls `markSeen` per dropped/advanced post. That is the dominant steady-state CPU + GC + disk-write source.
  2. 1 s `tick(1000)` (`src/App.tsx:92`) runs full zustand updates while the window is hidden; idle accrual must survive hiding, but it does not need 1 s granularity — dt-accumulator on visibility restore gives identical earnings with ~0 work while hidden.
  3. Sidecar: `electron/main.cjs` calls `apiSidecar.startApi()` unconditionally on boot (~line 915-922) — a whole bun.exe process (~60-120MB) even when the app talks to the central server. Plan 213000 flips the default to gmatch.fly.dev; the sidecar must then start ONLY in host mode.
  4. Ungated timers still alive: `src/admin/AdminApp.tsx:219`, `tabs/DashboardTab.tsx:58`, `tabs/GamesTab.tsx:81` (15s intervals), `src/components/auth/BooruSlideshow.tsx:144`, `src/components/GMatchStories.tsx:191`, `src/components/domination/PCDominationTab.tsx:238` — none check `document.hidden`.
  5. `toasts` array has no push cap (store.ts adds on every event; unbounded list → re-render cost + save bloat if persisted).
- opencode may still be active in the worktree: NEVER `git add -A`; commit explicit paths.

## Architecture / proposed approach

Debounce the one hot write path (seen-set persistence) inside its single choke function, make the idle loop sleep-aware via a dt accumulator, start the bun sidecar only when hosting, gate the last six timers behind `document.hidden`, and cap the toast log. Then re-measure with the existing probes and only tune further if data says so.

## Step-by-step tasks

### Task 0 — Baseline capture (no code)

1. `cd /i/goongrid/apps/desktop && npm run build && npx vite preview --port 4173 &` then `node tools/perf-cdp.mjs` and `node tools/fps-idle.mjs`.
2. Record the numbers in a scratch file `$LOCALAPPDATA/Temp/perf-baseline.txt` (kill the preview after: `taskkill //F //IM node.exe` is overkill — instead track the PID and `kill <pid>` it via the terminal tool's bg handle).
3. If `tools/perf-cdp.mjs` crashes (needs a seeded identity/localStorage per its header), note it in the plan's risks and fall back to `npx playwright test e2e/perf.spec.ts` which seeds the app.

### Task 1 — Debounce `persistSeen` (biggest CPU win)

File: `apps/desktop/src/services/booru.ts` (lines 45-89). Test: `apps/desktop/src/services/booru.test.ts`.

1. RED — add to `booru.test.ts` (follow the file's existing style; it already stubs globals via `vi.stubGlobal`):
```ts
it('persists the seen-set at most once per burst (debounced)', async () => {
  vi.useFakeTimers()
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => {} })
  markSeen('a', 'u1'); markSeen('b', 'u2'); markSeen('c', 'u3')
  expect(setItem).not.toHaveBeenCalled() // nothing written synchronously
  vi.advanceTimersByTime(5_000)
  expect(setItem).toHaveBeenCalledTimes(1)
  vi.useRealTimers(); vi.unstubAllGlobals()
})
```
   Run: `cd /i/goongrid/apps/desktop && npx vitest run src/services/booru.test.ts -t "debounced"` → FAIL (setItem called 3x today).
2. GREEN — replace the body of `persistSeen` (booru.ts:81) with a trailing debounce and flush on page hide:
```ts
let seenTimer: ReturnType<typeof setTimeout> | null = null
function persistSeen(): void {
  if (seenTimer) return
  seenTimer = setTimeout(() => {
    seenTimer = null
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: [...seenIds], urls: [...seenUrls] }))
    } catch { /* storage unavailable — memory still works for this session */ }
  }, 5_000)
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSeen()
  })
}
function flushSeen(): void {
  if (!seenTimer) return
  clearTimeout(seenTimer); seenTimer = null
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: [...seenIds], urls: [...seenUrls] }))
  } catch { /* ignore */ }
}
export { flushSeen }
```
   Note: the debounce timer itself is set inside `persistSeen` above (the `if (seenTimer) return` line) — do not also call the raw write there. Keep the existing `// ponytail:` comment on SEEN_CAP and add `// ponytail: 5s debounce; a burst of drops writes once` on the timer.
3. Re-run: PASS. `npx tsc -p tsconfig.json --noEmit` clean; `npm run lint` no new warnings (exported symbol is used by the flush test — if `no-unused-vars` fires on `flushSeen`, it is exported, it won't).
4. Commit: `git add src/services/booru.ts src/services/booru.test.ts && git commit -m "perf(feed): debounce seen-set persistence to one write per 5s burst"`

### Task 2 — Sleep-aware idle tick (CPU while hidden → ~0)

File: `apps/desktop/src/App.tsx` (lines 90-99).

Offline accrual is computed from wall-clock deltas elsewhere (`collectOffline` on load; `tick(dtMs)` takes a dt argument), so while hidden we can skip the 1s store writes and catch up on restore with a single big-dt tick. `backgroundThrottling` is Electron-default (true), which already throttles the interval to ~1/min when hidden — meaning dt passed to `tick(1000)` is a LIE while hidden (actual gap ≥60s) and passive income is UNDER-accrued today. The fix therefore improves correctness AND cuts CPU.

1. Read the exact current effect first: `sed -n '88,100p' src/App.tsx` (verify lines before replacing).
2. Replace the tick interval (keep the 10s save untouched):
```ts
    let lastBeat = Date.now()
    const beat = () => {
      const now = Date.now()
      const dt = now - lastBeat
      lastBeat = now
      if (document.hidden && dt < 60_000) return // catch up on restore, not per-second
      useIdleGame.getState().tick(dt)
    }
    const t = setInterval(beat, 1000)
    const onVis = () => { lastBeat = Date.now() }
    document.addEventListener('visibilitychange', onVis)
```
   and in the cleanup return add `document.removeEventListener('visibilitychange', onVis)`. `onVis` resets the anchor so the FIRST beat after restore computes the full hidden gap in one call (economy math already handles big dt — verify: `grep -n "tick: (dtMs" src/game/store.ts` → body at line 1129 applies `passiveGps * dt/1000`; no per-iteration loop, so big dt is safe; if the body instead LOOPS dt in 1s chunks, cap at `Math.min(dt, 600_000)` and note why).
3. TDD: this is wiring inside a component — instead pin the pure contract in `src/game/store.test.ts` if absent: `tick(60000)` yields exactly 60× `tick(1000)` income for a fixture state (assert `gc` delta). Run `npx vitest run src/game/store.test.ts` before/after.
4. Commit: `git add src/App.tsx src/game/store.test.ts && git commit -m "perf(idle): wall-clock dt ticks; no per-second store churn while hidden"`

### Task 3 — Sidecar only in host mode (~100MB + process gone by default)

Files: `apps/desktop/electron/main.cjs` (~lines 910-925), maybe `electron/serverMode.cjs` (name from `grep -n "serverMode" electron/main.cjs`).

Prerequisite: plan 213000 task 10 (default server gmatch.fly.dev) is ALREADY MERGED — check with `git log --oneline -15 | grep "default server"`. If absent, do it first (separate plan's task), because a packaged app in client mode pointed at localhost:8790 NEEDS the sidecar.

1. Locate both `startApi()` call sites; wrap each:
```js
    const mode = serverMode.readServerMode() // exact export name from electron/serverMode.cjs — read the file
    if (mode.mode === 'host') await apiSidecar.startApi()
```
   and at line 800, `--api-base` for packaged builds already reads `packagedServer || serverMode.readServerMode()).url` — no change. Browser dev path (`apiSidecar.API_BASE` in non-packaged) keeps spawning the sidecar via the vite plugin (`devApiPlugin` in vite.config.ts) — do not touch dev behavior.
2. Test: `node -e` script asserting the guard exists? No harness for main.cjs boot — instead add a CJS regression test if one exists for serverMode (`ls electron/*.test.cjs`). If none, the verification is manual (Task 6) + grep: `grep -n "startApi" electron/main.cjs` must show both calls inside `if` blocks mentioning `mode`.
3. `before-quit` `stopApi()` is safe when never started (apiSidecar should no-op; verify with `grep -n "function stopApi" electron/apiSidecar.cjs` and that it checks the handle; if it throws on null handle, add the guard there — 2 lines, include in same commit).
4. Commit: `git add apps/desktop/electron/main.cjs apps/desktop/electron/apiSidecar.cjs && git commit -m "perf(desktop): bun sidecar launches only in host mode"`

### Task 4 — Gate the last six timers behind document.hidden

Files + lines (pattern already in App.tsx:652: `if (!document.hidden) ...`):
- `src/admin/AdminApp.tsx:219` → `const interval = setInterval(() => { if (!document.hidden) void loadDashboardData(); }, 15000);`
- `src/admin/components/tabs/DashboardTab.tsx:58` and `GamesTab.tsx:81` → same wrapper around `fetchDashboard` / `fetchData`.
- `src/components/auth/BooruSlideshow.tsx:144` → skip the slide-advance body when hidden (the interval is a slideshow; freezing while hidden is the desired behavior).
- `src/components/GMatchStories.tsx:191` and `src/components/domination/PCDominationTab.tsx:238` → same `if (!document.hidden)` first line.
These are UI timers (network or animation) — no earnings math involved; a component-level assertion test is not worth it (YAGNI): verification is `npm run lint && npx tsc -p tsconfig.json --noEmit && npx vitest run` (existing stories/slideshow/domination tests stay green) + visual: console of the preview shows fetch cadence drop when `document.hidden` (manual, Task 6).
Commit: `git add src/admin src/components/auth/BooruSlideshow.tsx src/components/GMatchStories.tsx src/components/domination/PCDominationTab.tsx && git commit -m "perf(ui): pause slideshow/admin/domination timers while window is hidden"`

### Task 5 — Toast log cap

File: `apps/desktop/src/game/store.ts`. Test: `src/game/store.test.ts`.

1. RED:
```ts
it('toast log caps at 5 (oldest dropped)', () => {
  for (let i = 0; i < 9; i++) useGame.getState().notify(`t${i}`)
  expect(useGame.getState().toasts.length).toBeLessThanOrEqual(5)
})
```
   Run → FAIL.
2. GREEN: wherever `set({ toasts: [...` appears in the store (3 sites: progress pushes at 814/1425 + notify), pipe through a cap: `const capToasts = (list: Toast[]) => list.slice(-5)` and use `toasts: capToasts([...])`. DRY: one helper, all sites.
3. PASS → commit: `git add src/game/store.ts src/game/store.test.ts && git commit -m "perf(store): bound toast log at 5"`

### Task 6 — Re-measure, then decide the last 10%

1. Full gate: desktop `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, `npx vitest run`; api `npx vitest run`; `node electron/imageCache.test.cjs && node electron/imageCacheMemory.test.cjs && node electron/customFolders.test.cjs && node electron/secureStore.test.cjs`.
2. `npx playwright test e2e/perf.spec.ts` → tripwires must still pass (heap growth <60MiB, post-GC <120MiB) and, expected, drop well below baseline because per-frame `localStorage.setItem` storms are gone.
3. `node tools/perf-cdp.mjs` again; diff vs `$LOCALAPPDATA/Temp/perf-baseline.txt`; paste both in the final report.
4. Conditional follow-ups ONLY if numbers demand them (do not pre-build):
   - `ScriptDuration` still >2s in walk → lazy-route the admin suite (`src/admin/AdminApp.tsx` behind `React.lazy` in the router).
   - heap post-GC >40MiB → run `tools/perf-cdp.mjs` with the feed open; suspect `SEEN_CAP` sets are fine (strings, not objects), next suspect is `api.ts` response cache size.
   - RAM in Task Manager of the portable exe still >~450MB working set → drop image LRU 96→64MB (`electron/imageCacheMemory.cjs` line 5 constant, one-line revert knob documented there).
5. Rebuild: `npm run dist` (EPERM fallback: `npx electron-builder --win portable -c.directories.output="C:/Users/matco/AppData/Local/gmatch-build"` then copy the exe back to `release/`).

## Tests / validation

TDD where logic exists (tasks 1, 2-contract, 5): RED run → FAIL output recorded → minimal implementation → PASS → commit. Style/wiring tasks (3, 4) gate on lint+tsc+existing suites, with grep-based structural verification stated inline. Final truth is the before/after probe numbers (Task 0 vs Task 6) — the wave is done when perf.spec tripwires pass AND ScriptDuration/TaskDuration/heap are all ≤ baseline.

## Risks, tradeoffs, and open questions

- Tick dt-accumulation (Task 2): if `tick(dtMs)` internally clamps or loops dt, big-dt catch-up could under/over-pay vs the current buggy-under-accrual hidden behavior. Read the body first; the test pins `tick(60000) === 60×tick(1000)` so a mismatch surfaces as RED before any commit. Server `idleEnvelope` headroom (1.5×) tolerates the corrected higher claims; a 1M-chunk flush path already exists in walletSync.
- Debounced seen-set: a crash within the 5s window loses at most one batch of "seen" marks → at worst one duplicate image after a hard kill. Accepted; `visibilitychange→flush` covers normal hide/close flows.
- Sidecar-off-by-default changes offline behavior: a packaged CLIENT-mode app without internet now fails to `gmatch.fly.dev` instead of a local sidecar. Login/ledger features need network — that is the product direction (central default), but call it out in the PR body.
- Timer gating uses `document.hidden`, which Electron keeps false when the window is minimized-to-tray? Chromium sets hidden on minimize — verify during Task 6 manual pass (minimize, watch CDP metrics drop; if tray keeps it visible, gate on the existing idle-state instead).
- Open: whether to also trim `HISTORY_CAP`/prefetch 27→18 — NOT assumed; only revisit if Task 6 heap data says the image working set dominates.
