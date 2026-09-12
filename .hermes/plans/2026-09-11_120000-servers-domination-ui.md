# Servers + PC Domination UI convergence — plan

## Goal
Converge Servers tab and PC Domination tab onto `docs/DESIGN.md` V1 tokens and the Gallery/Cards chrome (glass-card + header + inset rows), with Servers as a complete node browser list and Domination as one panel with subtabs, zero floating docks, transparency via vars only.

## Current context / assumptions
- Repo: `goongrid/` (Electron + Vite + React 19 + TS strict + Tailwind 4). Desktop app at `goongrid/apps/desktop/`. Verified by read.
- Source of truth: `goongrid/docs/DESIGN.md` (77 lines), tokens in `goongrid/apps/desktop/src/globals.css`, recipes in `goongrid/apps/desktop/src/ui/styles.ts` (`PLATE`, `BTN`, `MONO`, `MUTED`). Read all three before touching code.
- Gallery reference: `goongrid/apps/desktop/src/components/GalleryView.tsx` (glass-card + glass-header + glass-inset 7x7 icon + `text-xs font-bold uppercase tracking-wider` title + `text-[10px]` sub), `goongrid/apps/desktop/src/components/home/CardTile.tsx` (tile = `rounded-lg border border-border-glass bg-retro-bg overflow-hidden`), `goongrid/apps/desktop/src/components/grid/IdleGalleryView.tsx` (filter input + `grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6`, aspect-square thumbs).
- Servers now: `goongrid/apps/desktop/src/components/servers/ServersView.tsx` (867 lines). Already one continuous `glass-surface grid lg:grid-cols-[minmax(320px,34%)_1fr]` (audit fix), left = node hero + rooms + member list, right = central directory with `glass-toolbar` search/sort/filter + `glass-inset` rows + Join/unregister. Gap: rows don't read as gallery list; header/title case and toolbar don't match `glass-card`/`glass-header` language; raw `bg-retro-bg/80`-style fills bypass `--panel-alpha`.
- Domination now: `goongrid/apps/desktop/src/components/domination/PCDominationTab.tsx` (825 lines, 4 stacked `<section>`s: Send / My consent / History / Hacks) + `goongrid/apps/desktop/src/components/domination/HacksPanel.tsx` (79 lines, wraps `StoreTab arsenalOnly` + `HackSpyView`) + `goongrid/apps/desktop/src/components/domination/ActionModal.tsx` (285 lines) + wrapper `goongrid/apps/desktop/src/components/views/PCDominationView.tsx` (46 lines). Gap: long scroll, not one panel with subtabs; "floating docks" = any `fixed`/`absolute` bar or second panel outside the single card (verify; `ActionModal` modal itself is allowed, stays `z-[var(--z-modal)]` + `bg-black/70` scrim only).
- Transparency system: `globals.css` `--panel-alpha` (0.35–1) + `--glass-blur`; every glass-* fill scales with it. Raw `bg-retro-bg/80`, `bg-black/*` (non-scrim), `bg-surface-raised/40`, `hover:bg-surface-interactive/60` bypass the slider and read as wrong opacity. Fix = delete those, use glass tokens only.
- Tests exist: `goongrid/apps/desktop/src/components/servers/ServersView.test.tsx` (284 lines, jsdom + mocked fetch), `goongrid/apps/desktop/src/components/domination/PCDominationTab.test.ts` (23 lines, preset constants only). `@radix-ui/react-tabs` already in `goongrid/apps/desktop/package.json` — reuse it, add zero deps.
- Grill (taste guards, non-negotiable): no new card/panel component — reuse `glass-card`, `glass-header`, `glass-inset`, `glass-field`, `glass-action`, `glass-nav-active`. No `border-retro-border`, no `rounded-3xl`, no `z-[999]`, no emoji/glyph chrome (lucide only, `w-3.5`/`w-4`), no new durations/keyframes, no `transition-all`. Type floor 10px. One panel per tab; subtabs live inside it.

## Architecture / proposed approach
Wrap each tab in one `glass-card` with a `glass-header` (Gallery pattern) and put all content inside as lists or in-panel subtabs; reuse existing fetch/join/send logic verbatim, changing chrome classes only. Fix transparency by removing every non-token alpha fill so `--panel-alpha`/`--glass-blur` drive the whole surface. Land as small TDD commits, acceptance greps at zero.

## Step-by-step tasks

### Task 0 — Read the contract (5 min, no code)
1. Read `goongrid/docs/DESIGN.md`, `goongrid/docs/DESIGN-AUDIT-2026-09-11.md`, `goongrid/docs/UI-CHECKUP-2026-09-11.md`.
2. Read `goongrid/apps/desktop/src/globals.css` lines 304–620 (glass-surface/card/header/inset/field/nav/action) and `goongrid/apps/desktop/src/ui/styles.ts`.
3. Skim `GalleryView.tsx` lines 129–160 (card+header pattern) and `CardTile.tsx` lines 111–120 (tile pattern).
- Verify: can recite PLATE recipe, z-scale vars, 6-step type scale from memory. No command.

### Task 1 — Baseline gates (3 min)
Run from repo root (Git Bash):
```bash
cd C:/Users/matco/goongrid/apps/desktop && npm run lint 2>&1 | tail -5
cd C:/Users/matco/goongrid/apps/desktop && npm run test 2>&1 | tail -8
cd C:/Users/matco/goongrid/apps/desktop && npm run typecheck 2>&1 | tail -5
```
Expected: lint 0 errors, tests green (≈634 passed), typecheck clean. If red, stop — fix tree first, do not start UI work on red.

### Task 2 — Servers: directory becomes a gallery-style browser list (TDD)
File: `goongrid/apps/desktop/src/components/servers/ServersView.tsx` (right `<main>`, lines ~592–862).
Keep: `visibleServers` memo, `query/sort/passwordOnly` state, `join`/`unregister` handlers verbatim. Change chrome only:
1. Wrap right column in `glass-card overflow-hidden`; header becomes `glass-header p-4 flex flex-wrap items-center justify-between gap-3` with Gallery title block:
```tsx
<div className="glass-header p-4 flex flex-wrap items-center justify-between gap-3">
  <div className="flex items-center gap-2">
    <div className="glass-inset w-7 h-7 rounded-lg flex items-center justify-center text-retro-muted">
      <Globe className="w-4 h-4" />
    </div>
    <div>
      <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">
        Server browser ({visibleServers.length})
      </h2>
      <p className="text-[10px] text-retro-muted">Every public node on this central — search, join, or host your own</p>
    </div>
  </div>
  <div className="flex items-center gap-1.5">
    {/* Central admin + Create server buttons unchanged, glass-action classes */}
  </div>
</div>
```
2. Toolbar row: keep search/sort/password-only/refresh, but search input uses `glass-field`, buttons use `glass-action` + `aria-pressed` (already there). No new controls.
3. Rows: `<ul className="space-y-1.5">` stays; each `<li>` keeps `glass-inset p-2.5 rounded-xl` but title line becomes `text-xs font-bold` + `text-[10px] font-mono` meta (matches domination history rows). Do NOT lift rows into floating cards — flat list inside the card.
- Test (add to `goongrid/apps/desktop/src/components/servers/ServersView.test.tsx`):
```tsx
it('renders the directory as a single browser list with count', async () => {
  mockFetch(async (url) => {
    if (url.includes('/api/servers/dashboard')) return json({ name: 'c', users: [], posts_24h: 0, members_total: 1 })
    if (url.includes('/api/servers')) return json({ servers: [
      { id: 'aaa', name: 'Friend World', description: 'chill', owner_id: 'o1', password_required: 1, endpoint_hint: '192.168.0.9:8790', last_seen: 'x' },
      { id: 'bbb', name: 'Quiet Node', owner_id: 'o2', password_required: 0, last_seen: 'x' },
    ] })
    return json({})
  })
  render(<ServersView identity={identity} toast={() => {}} />)
  await waitFor(() => expect(screen.getByText('Friend World')).toBeInTheDocument())
  expect(screen.getByText(/server browser \(2\)/i)).toBeInTheDocument()
  expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
})
```
- Verify:
```bash
cd C:/Users/matco/goongrid/apps/desktop && npx vitest run src/components/servers/ServersView.test.tsx 2>&1 | tail -6
cd C:/Users/matco/goongrid/apps/desktop && npm run lint 2>&1 | tail -3
```
Expected: new test fails before chrome edit (no "Server browser" heading), passes after; lint 0 errors. Commit: `ui(servers): gallery-style browser list in single card`.

### Task 3 — Servers: left column matches, no new surfaces (5 min)
File: same `ServersView.tsx` left `<aside>` (~lines 383–589).
1. Keep the outer unified `glass-surface` (audit decision) OR if it fights the new `glass-card` right column, wrap left as second `glass-card` — pick one, never nest glass-surface inside glass-card.
2. Member rows already `glass-inset`; keep. Replace `hover:bg-surface-interactive/60`, `bg-retro-bg/80`, `bg-glass-w20` dot with `hover:bg-glass-w10` / token fills. Offline dot: `bg-retro-muted`, online dot `bg-emerald-400` (presence semantics, exempt).
3. Sentence-case headings only (`Central directory`, not all-caps).
- Verify: `npm run test` green + eyeball at 1366px: two flat columns, no floating drawer. Commit: `ui(servers): left hub token fills only`.

### Task 4 — Domination: one panel + in-panel subtabs (TDD, the big one)
Files: `goongrid/apps/desktop/src/components/domination/PCDominationTab.tsx`, wrapper `goongrid/apps/desktop/src/components/views/PCDominationView.tsx` (leave wrapper logic alone).
1. Replace the outer `max-w-5xl ... gap-5` stack with one panel:
```tsx
<div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-6 font-sans select-none">
  <div className="glass-card overflow-hidden">
    <div className="glass-header p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="glass-inset w-7 h-7 rounded-lg flex items-center justify-center text-retro-muted">
          <Monitor className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">PC Domination</h2>
          <p className="text-[10px] text-retro-muted">Opt-in pranks between friends — every effect costs g$ and needs consent</p>
        </div>
      </div>
      {/* receiving switch + pause stays here, compact; delete the old hero <h1> block */}
    </div>
    {/* Radix Tabs bar: Send | My consent | History | Hacks — glass-inset p-0.5 rounded-lg, active = glass-nav-active */}
    {/* tab panels render existing sections verbatim, minus their <h3> section titles (tab label already says it) */}
  </div>
</div>
```
2. Use `@radix-ui/react-tabs` (already installed): `Tabs.Root defaultValue="send"`, `Tabs.List` with 4 `Tabs.Trigger`, 4 `Tabs.Content`. Subtab switching is instant, no route, no floating dock. Delete `pb-24 lg:pb-16` spacer and `dominationTopRef` scroll hack (replace `onExitSpy` scroll with `undefined`/noop — spy view sits in Hacks panel now).
3. Send tab keeps target list + effects grid; Consent keeps preset + `CONSENT_ROWS`; History keeps incoming/outgoing toggle; Hacks keeps `HacksPanel`. Zero logic changes — move JSX blocks into tab panels.
4. No `fixed`/`absolute` positioning anywhere in this file except the modal root. Grep to prove it.
- Test (extend `goongrid/apps/desktop/src/components/domination/PCDominationTab.test.ts` with jsdom render or keep constants + add):
```tsx
// @vitest-environment jsdom
it('renders one panel with four subtabs', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { PCDominationTab } = await import('./PCDominationTab')
  render(<PCDominationTab identity={null} users={[]} allUsers={[]} profilePics={{}} points={0} toast={() => {}} activeHack={null} setActiveHack={() => {}} onOpenFlash={() => {}} />)
  // unauthenticated shell still single-panel copy path; authed tab bar asserted in Servers-style integration
  expect(screen.getByText('PC Domination')).toBeInTheDocument()
})
```
(Better: render with a stub identity + mocked `orbitFetch` and assert `Send`/`My consent`/`History`/`Hacks` tab roles exist and only one panel shows at a time — write that version if the harness allows; minimum above must pass.)
- Verify:
```bash
cd C:/Users/matco/goongrid/apps/desktop && npx vitest run src/components/domination/PCDominationTab.test.ts 2>&1 | tail -6
cd C:/Users/matco/goongrid/apps/desktop && npm run lint 2>&1 | tail -3
```
Expected: fail before (no tab roles), pass after; lint clean. Commit: `ui(domination): single panel with Send/Consent/History/Hacks subtabs`.

### Task 5 — Transparency pass: kill raw alphas, keep slider authoritative (5 min)
Files: `PCDominationTab.tsx`, `HacksPanel.tsx`, `ServersView.tsx`, `ActionModal.tsx`.
1. Delete/replace: `bg-retro-bg/80` → `glass-inset` (or bare, parent glass already tints); `bg-surface-raised/40` → `glass-inset`; `hover:bg-surface-interactive/60` and `hover:bg-surface-interactive/20` → `hover:bg-glass-w10`; `bg-glass-w20` offline dot → `bg-retro-muted`. Scrim stays `bg-black/70` ONLY on the modal root; `bg-black` stays ONLY on media letterboxing.
2. Confirm no new `backdrop-filter`/`opacity` inline styles; `--panel-alpha` and `--glass-blur` remain the only transparency knobs (plus `@media (prefers-reduced-transparency: reduce)` kill-switch already in globals.css).
- Verify:
```bash
cd C:/Users/matco/goongrid/apps/desktop && grep -rn "bg-retro-bg/80\|bg-surface-raised/40\|bg-surface-interactive/60\|bg-surface-interactive/20\|bg-glass-w20" src/components/servers src/components/domination src/components/views/PCDominationView.tsx || echo CLEAN
cd C:/Users/matco/goongrid/apps/desktop && grep -rn "fixed \|absolute " src/components/domination/PCDominationTab.tsx | grep -v "ActionModal" || echo NO_FLOATING_DOCK
```
Expected: both print `CLEAN` / `NO_FLOATING_DOCK`. Commit: `ui: transparency via panel-alpha only, no floating docks`.

### Task 6 — Modals + Hacks converge (5 min)
Files: `goongrid/apps/desktop/src/components/domination/ActionModal.tsx`, `goongrid/apps/desktop/src/components/domination/HacksPanel.tsx`.
1. `ActionModal`: keep behavior/validation verbatim; chrome = modal card `rounded-xl border border-border-glass bg-retro-panel`, scrim `bg-black/70`, `z-[var(--z-modal)]`, inputs `glass-field`, buttons `BTN`/`BTN_PRIMARY` from `src/ui/styles.ts`. No floating offset — centered dialog.
2. `HacksPanel`: delete inner `glass-panel ... bg-surface-raised/40` empty-state box → `glass-inset`; delete duplicate inner `Hacks` `<h3>` (parent subtab already labels it); `StoreTab arsenalOnly` stays untouched.
- Verify: `npm run test` green. Commit: `ui(domination): modal + hacks token convergence`.

### Task 7 — Final gates + capture (5 min)
```bash
cd C:/Users/matco/goongrid/apps/desktop && npm run lint 2>&1 | tail -3
cd C:/Users/matco/goongrid/apps/desktop && npm run test 2>&1 | tail -5
cd C:/Users/matco/goongrid/apps/desktop && npm run typecheck 2>&1 | tail -3
cd C:/Users/matco/goongrid/apps/desktop && grep -rc "border-retro-border" src --include=*.tsx | grep -v ':0' || echo BORDERS_OK
cd C:/Users/matco/goongrid/apps/desktop && grep -rhoE "z-\[[0-9]{3,}\]" src --include=*.tsx || echo Z_OK
cd C:/Users/matco/goongrid/apps/desktop && grep -rhoE "text-\[(6|7|8|9|11)px\]" src --include=*.tsx || echo TYPE_OK
cd C:/Users/matco/goongrid/apps/desktop && grep -rho "rounded-3xl" src --include=*.tsx || echo RADIUS_OK
cd C:/Users/matco/goongrid/apps/desktop && grep -rhoE "duration-(75|100|200|1000)\b" src --include=*.tsx || echo MOTION_OK
```
Expected: lint 0 errors, tests green, typecheck clean, all greps print `*_OK`. Screenshot Servers + each Domination subtab at 1366px and 375px before merge (Playwright `e2e/capture.spec.ts` pattern, scratch `tmp/` only).

## Tests / validation
- TDD per task: write failing test → run, see red → minimal chrome edit → run, see green → commit. No logic rewrites; mocked-fetch integration tests already pattern in `ServersView.test.tsx`.
- Gates held throughout: `npm run lint` (0 errors), `npm run test` (green), `npm run typecheck` (clean), `npm run build` before merge.
- DESIGN.md acceptance greps read 0 (Task 7 list). New chrome uses only: `glass-card/header/inset/field/action/nav-active`, `border-border-glass`/`border-border-subtle`, `text-retro-fg/muted`, `text-xs`/`text-[10px]`/`text-[13px]`, `rounded-md/lg/xl/full`, `duration-150/300`, `z-[var(--z-*)]`, lucide icons.

## Risks, tradeoffs, and open questions
- Risk: second Hermes agent editing same files → merge conflicts. Mitigation: this plan touches ONLY `ServersView.tsx`, `PCDominationTab.tsx`, `HacksPanel.tsx`, `ActionModal.tsx` (+2 test files); coordinate file ownership, merge via branch, never commit to main.
- Risk: Radix Tabs default styles leak (its own borders). Mitigation: style triggers with glass classes only, `value`-controlled, no Radix CSS import.
- Tradeoff: single Domination panel means more clicks to reach Hacks (one subtab away). Accepted: brief demands it; sending stays default tab.
- Tradeoff: flat `glass-inset` server rows instead of rich per-node cards. Accepted: YAGNI — browser list scales to hundreds of nodes, cards don't; node detail stays on click/join path.
- Open: does "floating docks" include `TourDock`/bottom nav overlapping these tabs? Assumed no — scope is in-tab chrome; confirm with requester if TourDock overlaps Domination subtabs on small screens.
- Open: server-node "different nodes" — assumed central-directory nodes (already listed). If per-node room/user drill-down is wanted, that's a follow-up, not this wave.
- YAGNI cuts: no virtualized list (add when directory >200 rows), no new filter dimensions beyond search/sort/password-only, no motion tokens, no admin-kit restyle.
