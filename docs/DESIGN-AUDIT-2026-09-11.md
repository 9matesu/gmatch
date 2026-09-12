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
- Double OFFLINE on the idle canvas: corner badge suppressed whenever the
  centered OfflineCard renders (both sites; grid keeps the badge only while
  images are still up). Verified by DOM assertion (never co-render).
- Default viewMode 'single' rendered NO active segment in the 1x1/1x2/2x2/3x3
  control (the 'single' alias matched no button) — 1x1 is 'single'; it now
  presses at default. This was the real cause behind finding 2, not the
  highlight color. Verified: exactly one aria-pressed.
- Sidebar Create button: stray "post" micro-label merged into the label
  ("Create post", one aria-label, per reduction filter).
- Unread sidebar badge moved off green (bg-retro-fg); green now means presence
  only. Tag dots/online dots untouched.
- Servers "Central DIRECTORY" all-caps H3 demoted to sentence case.
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

## Phase 1 — critical (fixed same-day; see "Fixed this wave")

1. Idle canvas double OFFLINE indicator (GoonPanel badge + OfflineCard). FIXED.
2. Grid segmented control without active state. FIXED — root cause was the
   'single' viewMode alias matching no button, not a contrast problem.

## Phase 2 — refinement

3. Servers "CENTRAL DIRECTORY" H1 competition. FIXED (sentence case, h3 role
   already correct; Rename already lives in the title group's action cluster —
   the screenshot's "orphan" read was the flex gap, left as-is).
4. Servers column split softened to `minmax(320px,34%)_1fr`. Full
   content-driven stacking: skip until the directory routinely holds >5 rows.
5. REVERSED under source audit: Online/Last-24h pills already use the house
   `glass-nav-active` language (globals.css:529); the screenshot's faint read
   was the seeded one-member server, not the styling.
6. Green triple-meaning: FIXED for the unread badge. Tag-selection dots stay
   green (they read as "live tag", a presence metaphor — one family, accepted).
7. Create "post" micro-label. FIXED (merged).

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
