# Browser perf sweep — CDP before/after (2026-09-10)

Branch `fix/browser-perf-ui-sweep`. Methodology: chrome-devtools-mcp drives CDP;
Hermes has no MCP client, so we ran the SAME protocol directly —
`Performance.getMetrics` deltas, `Profiler.stop` CPU profiles, hit-testing via
`elementFromPoint` — through a deterministic Playwright probe
(`apps/desktop/tools/perf-cdp.mjs`, re-runnable verbatim). The cloud browser
cannot reach loopback; everything below is Chromium-on-this-machine against
`vite preview` (production bundle — the honest target for "travado no browser").

## Measurement harness
The probe seeds a real identity, mocks `/api/booru/*` with synthetic 1×1 tiles
(same trick as `e2e/helpers.mockBooruFeed` — timings must not depend on
external mirror health), then walks: load → home 3s → route sweep
(games/servers/gallery/store/idle) → 20 clicks on the idle stage → sidebar
collapse/expand cycle → 8 feed scrolls → 3s rAF fps sample.

## The complaint: "17 insights, page is laggy"
DevTools "Performance" insights are a machine-generated summary; several
pointed at one class of problem we reproduced objectively:

| Metric (prod build, standard walk) | Before | After |
|---|---|---|
| RecalcStyleDuration | 3.09 s | **0.27 s** (same walk, sheen+grain gated)* |
| TaskDuration | 7.46 s | 6.2–6.6 s (walk-bound; see note) |
| ScriptDuration | 1.29 s | 1.27 s (JS was never the problem) |
| LayoutDuration | 0.29 s | 0.25 s |
| JS heap (end) | 9.0 MB | 8.4–8.7 MB |
| fps (3s scroll sample) | 60 | 60 |
| Sidebar expand clickable when collapsed | **false (dead button)** | **true** |

*Attribution (`tools/recalc-attribution.mjs`, inject-disable groups): the
non-composited infinite `background-position` sheen owned ~3 s of recalc; the
fixed full-viewport `mix-blend-mode: soft-light` grain layer owned the rest
(recalc 0.28 → 0.00 when removed). `TaskDuration` includes Vite-free
dev-sidecar fetches and feed work; recalc + blend cost is what the user
felt as stutter on weak GPUs.

## Root causes → fixes (each its own commit)

### 1. Infinite chrome sheen (paused by default, reversible)
`.chrome-accent`, `.text-chrome`, `.chrome-border::before`, `.accent-control`,
`.create-action`, holo card frames animated `background-position` — a
main-thread property, so every visible instance forced style recalc + repaint
per frame, forever. Now gated behind `--chrome-sheen` (`animation-play-state`
via longhand; `paused` default). Settings → Display → **Animated chrome** sets
`html[data-motion="on"]` for the sparkle back. (Note: `animation-play-state`
inside a var() in the shorthand is invalid CSS — longhands required.)

### 2. Grain overlay removed
`.grain-overlay::after`: fixed, full-viewport, `mix-blend-mode: soft-light` at
opacity 0.025. The blend forces a backdrop read-back on composited frames.
At 2.5% it is invisible; deleted (`content: none`) with the measurement
documented at the site of the rule.

### 3. Re-render tickers gated
- `SidebarNav` 1 s clock existed ONLY for one boolean (hack-glow expiry) and
  re-rendered the whole nav forever → now runs only while `activeHack` is set.
- `App` 5 s `nowTick` re-rendered the 4k-line shell every 5 s forever → gated
  on `activeHacks.length` (effect moved below the declaration to avoid TDZ).

### 4. Collapsed-sidebar dead button (P4)
Reproduced by hit-test, not guessed: collapsed rail is 60 px wide but the
header packed brand-slot + Back + Forward + toggle → the expand toggle landed
partially outside the rail; `elementFromPoint` on its center returned
`expandClickableWhenCollapsed: false` in the baseline probe. Collapsed mode
now renders ONLY the centered toggle (history buttons are expanded-mode);
after-cycle restores widths `[180, 56.25, 180]` and `clickable: true`.

### 5. Glass blur adjustable + toned down (P3)
Every `backdrop-filter` blur site (16 declarations in `globals.css`) now
computes `calc(Npx * var(--glass-blur, 0.7))` — default 70% of the old frost
("um pouco" lower). Settings → Display → **Glass blur** slider (0–100%) writes
`--glass-blur` live (verified: slider 0 → var "0") and persists in AppSettings
(`glassBlur`, mirrors the existing `panelOpacity` pattern). Small controls
prefer bare icons: new `.icon-btn` (no border/shadow/blur, hover tint only)
applied to sidebar header trio + idle-stage arrows.

### 6. Idle stage image-first (P5)
Prev/next were 48×80 glass slabs (`glass-button h-20 w-12`, blurred chrome
floating over the art). Now 38×38 round ghost icons on the image edge
(`icon-btn` + `bg-black/45`, DOM-verified geometry). Bottom strip lost its
bordered plate (one slim row: mode toggles, HP, heat chip). Float hygiene:
budget capped at 20 live `+g$` spans, all float/crit-flash timers tracked in
a ref and cleared on unmount (was leaking `setTimeout`s; the stage is where
users click fastest).

### 7. Switches compact (P6)
Settings had three hand-rolled switch variants (w-11 h-6 fat pills ×2, w-10
h-5 ×1). One `<Switch>` component (`src/ui/Switch.tsx`, h-4 w-8 track, h-3 w-3
knob, same role="switch"/aria-checked contract) now drives all three rows;
Domination (w-9 h-5) and CustomSources (h-5 w-9) already matched that size
class and were left alone.

### 8. Timeline compact (P7)
Feed media `max-h-[65vh]` → `max-h-[min(420px,60vh)]` (cards no longer
dominate a laptop screen); column gaps and card rhythm 4→3. Home density up,
nothing removed.

### 9. Servers view tidy (P8)
Two header rows said nearly the same thing ("This server" strip + big name h2
with a 3-col user grid eating half the card). Now: one hero row (radio dot,
name, `N members · M posts/24h` under it, actions right), members rendered as
compact online-chips (cap 12 + `+N`), toolbar buttons unified to h-9.
`ServersView.test.tsx` pins the merged counts line AND the absence of the
duplicate header.

## 401s/429s in the walk (honest note)
Every walk logs `401 /api/pm` — the PM sync fires once before the sealed
session is established; the app retries successfully after. DevTools counts
these as insight noise; the walk reproduces it, fix = defer the first poll
until session-ready (follow-up, not in this sweep).

User-reported follow-up (same class, fixed; later mooted — the idle→ledger bridge was removed 2026-09-11): `429 /api/economy/idle-credit`
spammed the console because the wallet sync loop (30s) hammered the server's
60s credit throttle blind, and `orbitFetch`'s own 429 retry used the GLOBAL
fetch instead of the injected impl (double bug: untestable + double-traffic
against a stale key). Now: 65s sync cadence, 429 carries `retryInMs` +
`Retry-After`, the loop backs off, retries go through `fetchImpl`. Verified
live: credit#2 → `429 Retry-After: 60 {"retryInMs":59991}`.

## Post-script: the "low fps" report after the sweep was NOT code
After the fixes shipped, the app still felt locked and the probe threw
ERR_INSUFFICIENT_RESOURCES on every new page. Root cause: **C: drive at
100% full (0 bytes)** — Chrome cannot write GPU/tab cache, Windows stalls,
everything crawls. Disk fixed (2.1 GB+ free), re-measured with the same
tools: prod walk RecalcStyle 0.885s / scroll **fps 60**; dev walk 0.954s /
**fps 59** (dev Script 3.9s = hundreds of unbundled vite modules — a
dev-mode artifact, not felt lag). Idle-stage probe (`tools/fps-idle.mjs`,
the screen the report named): 60 fps, 0 long tasks, 0 running animations,
both bases. Lesson for "before it was fluid, now it stutters": check `df`
before profiling — a full system drive mimics a perf regression perfectly.

## Repro commands
```
cd apps/desktop
npm run build && node node_modules/.../vite.js preview --port 4173   # background
node tools/perf-cdp.mjs http://localhost:4173/          # metrics+profile+sidebar hit-test
node tools/recalc-attribution.mjs                        # which CSS owns the recalc
node tools/verify-pin-live.mjs <PIN>                     # signed verify-pin (401 wrong/200 right)
node tools/ui-verify.mjs                                 # arrows/slider/switches DOM checks
```

## Admin PIN (local machine)
Verified live this sweep: `POST /api/admin/verify-pin` → 200 with the PIN,
401 without. Dev sidecar: `ADMIN_PIN=<pin> npm run dev` (vite spawns bun with
`{...process.env}`, `vite.config.ts:66`; `apps/api/src/serve.ts` wires it into
`c.env`). Packaged app: `apiSidecar.cjs` also spreads `...process.env`, so a
system/user env var `ADMIN_PIN` reaches the bundled server on next launch.
PIN for this machine: 318b98f8 (LOCAL DEV ONLY — plaintext PIN is a dev
convenience; central keeps the hash). Wrong PIN → 401;
5 tries/15 min → 429 lockout. Central node (gmatch-wcz1.onrender.com) keeps
`ADMIN_PIN_HASH` — untouched.
