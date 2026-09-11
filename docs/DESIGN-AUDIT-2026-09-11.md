# Design audit 2026-09-11 (bencium protocol)

Method: bencium `design-audit` 15 dimensions + reduction filter, executed INSIDE
`docs/DESIGN.md` V1 (the skill's own break-the-rules clause: honor the existing
chosen aesthetic — retro-glass zinc stays; no rebrand). Evidence: source greps +
Playwright captures at 1366px and 375px via the seeded e2e harness
(`e2e/capture.spec.ts` pattern), stored in `tmp/audit/` (scratch, not committed).
Copy was audited separately today (see the humanize sweep commits); not re-litigated.

## Fixed this wave

- EmptyState emoji chrome → lucide prop (commit "ui: EmptyState takes lucide
  icons, emoji chrome out").
- `tracking-wider` on all 45 uppercase labels lacking it
  (commit "ui: tracking-wider on all uppercase micro-labels").
- Glyph chrome (`♥ ⚠ ♦ ♪ ➜ ◧ ⛶ 🎁 🔥 📷 📁 🔔`) out of ~14 sites, CommentsModal
  reaction-inserts documented as the content exemption in DESIGN.md
  (commit "ui: glyph/emoji chrome out"; docs: exemption note).
- TourDock CTA wrapped its chevron to a second line at narrow widths —
  `whitespace-nowrap` (verified: desk-servers.png, mob-feed.png).
- TourDock flush to the mobile bottom edge — safe-area inset on `bottom-4`
  (verified: mob-feed.png).

## Explicit non-findings (checked, already correct)

- focus-visible (globals.css:182), reduced-motion kill switch, 2-font cap
  (Outfit + JetBrains Mono via MONO recipe), tabular figures on number readouts,
  sentence-case headings (swept in copy wave), scrim = single `bg-black/70`,
  z-scale vars, 3 durations, acceptance greps all read 0 post-sweep.
- `bg-surface-raised`: alias token (`--color-surface-raised: #121215` ==
  retro-panel, globals.css:14). Same value, two names — Phase 3 consolidation,
  not a violation.
- desk-feed.png captured fully black: capture-timing artifact, NOT a defect —
  mob-feed.png at the same route renders full chrome; journey tests pass.

## Phase 1 — critical (real UX cost, fix next wave)

1. Idle canvas shows TWO offline indicators at once: corner `OFFLINE` badge
   (`src/ui/GoonPanel.tsx:430` and `:531`) plus the `OfflineCard` centered in the
   same canvas (`GoonPanel.tsx:~535`). Same state, two chrome layers. Fix: kill
   the corner badge where OfflineCard renders (single source per surface).
2. Grid mode segmented control (1×1/1×2/2×2/3×3, `src/components/grid/`) shows no
   visible active state at desktop width — current mode uncommunicated. Needs one
   active-class check (may be the `bg-glass-w10` being too subtle on that surface;
   raise to the sidebar's active language).

## Phase 2 — refinement

3. Servers header: three clusters (server title | orphaned Rename | CENTRAL
   DIRECTORY + buttons) fight for H1 on one row (desk-servers.png header).
   Demote `CENTRAL DIRECTORY` to a section caption under the panel, left-align
   Rename with the title group. Files: `src/components/servers/ServersView.tsx`
   header block (~line 380-420 region).
4. Servers directory column split is fixed ~1:2 regardless of content
   (ServersView two-column body); 1 online server + empty directory wastes the
   frame. Try `grid-cols-[minmax(280px,1fr)_minmax(0,1.4fr)]` or stack when
   both lists are short. Judgment call — screenshot both.
5. Active tab language in the Online/Last-24h pills is faint border-only
   (ServersView ~line 200); unify with the feed pager's filled-white language.
6. Green means three things at once: presence dot, unread badge, selected feed
   tag. Pick one green usage (presence is the load-bearing one) and move the
   unread badge to `retro-accent`. Evidence: desk-servers.png sidebar +
   mob-feed.png tag pills. Semantic-color work, app-wide grep, phased.
7. "post" micro-label inside the sidebar Create button
   (`src/components/home/SidebarNav.tsx:448`) restates nothing and looks orphaned
   at desktop (vision flagged it twice). Reduction filter: remove, keep the `title=`.

## Phase 3 — polish / backlog

- 2-digit z-10..z-50 legacy values (~130 sites) → named z vars. Only when a real
  stacking bug appears; DESIGN.md doesn't require it.
- `transition-all` x110 → property-scoped. Only when one measurably repaints.
- `bg-surface-raised` vs `bg-retro-panel` dual-name convergence (58 files) —
  one-way sed wave when the tree is quiet.
- Monospace usage: DESIGN.md says numbers MONO; "(gmatch.fly.dev)", "online now",
  server-id hex also wear mono (ServersView) — narrow the rule to numerals only,
  decide case-by-case.
- Touch-target floor at 375px (header icon row ~24px glyphs, mob-feed.png):
  gMatch desktop app ships Electron-first; mobile is browser-mode fallback.
  Raise icon hit areas to 40px with padding, not glyph size, if mobile usage
  data ever justifies a wave.

## Scope notes

No functional changes were made or proposed beyond the doc; the one-line
whitespace-nowrap and safe-area fixes are pure chrome. Anything in Phase 1-2
needing product judgment (green semantics, servers layout) waits for approval
per the design-audit protocol.
