# Plan: V1 public UI consistency map + gMatch aesthetic standardization sweep

## Goal

One design system, visibly: every tab/page/modal/button/settings/admin panel speaks the same tokens for color, border, radius, type scale, spacing, z-order, icons — no emojis, no orphan zinc hexes, no 7px text — verified by grep-count gates, not vibes.

## Current context / assumptions

- Repo `I:/goongrid`, app `apps/desktop` (Electron + React 19 + Tailwind + zustand). Admin panel lives INSIDE the same app at `src/admin/` (PIN-gated). All commands run in `I:/goongrid/apps/desktop` unless noted. Branch `fix/browser-perf-ui-sweep`.
- House tokens are ALREADY defined — this is a convergence job, not an invention job:
  - `src/globals.css` — `--color-glass*`, `--panel-alpha` (user slider), `retro-*` colors, `.glass-button/.glass-tab/.accent-control/.glass-inset/.glass-surface/.glass-nav`.
  - `src/ui/styles.ts` — `MONO`, `MUTED`, `PLATE`, `PANEL`, `BTN`, `BTN_SMALL`, `BTN_PRIMARY`, `BTN_DANGER` constants (idle-game shell already uses them; feed/social views re-inline equivalents).
- Measured inconsistencies (grep counts, 2026-09-10):
  1. **Two border tokens for one job**: `border-border-glass` ×423 vs `border-retro-border` ×207.
  2. **Orphan literal colors** (outside ui/styles game-semantics): BotSetupPanel ×83, GMatchFeed ×46, BabecockPanel ×38, CreatePostModal ×33, OnboardingFlow ×31, UserProfileModal ×30, InstagramPostModal ×25, LootboxAdminPanel ×24, LegalCenter ×19… (`bg-zinc-*`, `text-zinc-*`, `bg-black/<n>` ad-hoc).
  3. **Type chaos**: text-xs ×933, [10px] ×460, [11px] ×267, text-sm ×114, [9px] ×81, [8px] ×36, [7px] ×4, [6px] ×4 — a 7-step arbitrary scale; <10px fails the legibility goal.
  4. **z-index anarchy**: z-[99999] ×13, z-[100000] ×4, z-[9999]/9998/99990/99994/99995, z-[100] ×7, z-[200] ×3, z-[6]/[1]/[2].
  5. **Radius drift**: lg ×421, xl ×261, full ×234, md ×152, 2xl ×65, 3xl ×17, none ×17, sm ×4 (no documented scale).
  6. **Button padding drift**: ≥10 distinct `px-N py-M` recipes for visually identical controls.
  7. **Emojis in chrome** (hard user rule: zero): ❤️/⚡ in `CommentsModal.tsx:170,186`, ⚡ in `GMatchFeed.tsx:628`, `FlashModal.tsx:38,83,143`, `FlashOverlay.tsx:37,40`, ★ in `admin/components/tabs/ContentTab.tsx:130`, `ContextOverlay.tsx:94`, ✕ glyphs in 7 files (FlashModal, FlashOverlay, GridWorkspace, MatchRoundPanel, SpectateModal, GoonPanel, MediaViewerModal).
- `better-ui` skill packs live at `I:/goongrid/.agents/skills/` (better-ui, better-colors, better-layout, better-typography, better-writing, better-accessibility) — read each SKILL.md as domain truth before its wave; review order foundational-first per interface-audit-pass skill.
- Test gates must NOT move: desktop `npx vitest run` = 634, tsc 0, eslint 0 errors. If a UI-only change breaks a test, the test asserted markup the user owns — update the assertion in the same commit and say so.
- Playwright e2e exists (`e2e/perf.spec.ts` etc.) — run only if quick; do not block waves on it.

## The standard (single source of truth — this IS the plan's contract)

**Surfaces (pick by role, never by taste):**
- app background: `bg-retro-bg` · panel/card: `PLATE` (= `rounded-lg border border-border-glass bg-retro-panel`) · inset field: `glass-inset` · scrim: `bg-black/70` (THE only allowed scrim value) · hover-fill: `bg-glass-w10`.

**Borders:** `border-border-glass` (423×) wins; `border-retro-border` (207×) is deprecated → map all to it. `border` (1px) everywhere; never `border-2` on chrome (rarity badges are game-semantics, exempt).

**Type scale (exactly 6 steps, legibility floor 10px):**
| step | value | use |
|---|---|---|
| caption | `text-[10px]` | meta, counters, badges, uppercase labels |
| body | `text-xs` (12) | default UI text, buttons |
| field | `text-[13px]` | inputs |
| sub | `text-sm` (14) | modal titles, emphasized lines |
| title | `text-lg` | modal/page headers |
| display | `text-xl`/`text-2xl` | hero/rank-up only |
`text-[11px]` → map to `text-xs`; `[9px]/[8px]/[7px]/[6px]` → `text-[10px]` (floor). Numbers everywhere: `MONO` (JetBrains Mono + tabular-nums). font-black only on display titles. tracking arbitrary values → `tracking-wider` (uppercase micro-labels) or drop.

**Radius (4 steps):** `rounded-md` chips/icon-buttons · `rounded-lg` cards/buttons/inputs · `rounded-xl` modals/popovers · `rounded-full` pills/avatars. `rounded-2xl`→`rounded-xl`, `rounded-3xl`→`rounded-xl`, `rounded-sm`→`rounded-md`.

**Z scale (globals.css tokens; arbitrary values banned above z-50):**
```css
/* add to globals.css @layer utilities or :root + tailwind config extend */
--z-dropdown: 40; --z-modal: 50; --z-lightbox: 60; --z-toast: 70; --z-system: 80;
```
Map: z-[1..6] stay as local stacking, z-[100]/[200] → `z-modal`/`z-lightbox`, z-[9999+] family → `z-toast`/`z-system`. (Tailwind v4 arbitrary: `z-[var(--z-toast)]` or extend theme — follow how globals.css already extends `--color-*`.)

**Spacing rhythm:** 4px grid — gaps `gap-1/2/3`, panel padding `p-3`/`p-4`, section `space-y-2/3`. Odd values (`p-[18px]`, `py-2.5`) → nearest grid step EXCEPT the shared `BTN` constants (leave, they are the recipe).

**Button recipes (ui/styles.ts is the only factory):**
- primary CTA `BTN + BTN_PRIMARY` · secondary `BTN` · small `BTN + BTN_SMALL` · destructive `BTN + BTN_DANGER`
- icon-only control: bare `p-1.5 rounded-md hover:bg-glass-w10` + `aria-label`, NO border/blur wrapper (house rule).
- anything that is really a link/filter chip: `<button>` styled as caption chip, not a full BTN.

**Icons:** lucide set already in deps (`Zap`, `Heart`, `Star`, `X`, `Ban`, `Flame`) — every emoji/glyph in chrome becomes one, `currentColor`, `w-3.5/w-4 stroke-[1.75]`.

**Compaction (user: "nem tudo precisa ser botão"):**
- Redundant helper paragraphs under controls (settings labels that restate the title) → drop, keep `title=` tooltip. Candidates found this session: ServerTab help paragraph (keep IP-mask note only), CreateCardModal subtitle, MatchRoundPanel notice lines.
- Button pairs that toggle one state → one pill toggle (aria-pressed).
- Settings modal sections: group related rows, one caption header per group, no border per row.
→ Do this ONLY where the element is provably redundant (copy duplicates its sibling's text); list each deletion in the commit message. YAGNI red flag: don't merge distinct-feature buttons into menus.

## Step-by-step tasks

Wave gates after EVERY task:
`npx tsc -p tsconfig.json --noEmit` → 0 · `npx vitest run` → 634 pass · `npm run lint` → 0 errors.

### Task 1 — codify the standard (docs only)

Write `docs/DESIGN.md` containing exactly the tables above + the grep-gate commands from Tasks 2-8 as the acceptance list. No code.
Verify: `git add docs/DESIGN.md && git commit -m "docs(design): V1 UI standard — tokens, type/radius/z scales, emoji ban"`.

### Task 2 — border token convergence (mechanical)

```bash
grep -rl "border-retro-border" src --include=*.tsx | xargs sed -i 's/border-retro-border/border-border-glass/g'
```
Verify: `grep -rc "border-retro-border" src --include=*.tsx | grep -v ':0' || echo GONE` → GONE. Gates. Commit `refactor(ui): unify borders on border-border-glass` (expect ~207 hunks, zero logic).
If vitest breaks: a test snapshotted the class — update the assertion in the same commit.

### Task 3 — z-index scale

3a. Add to `src/globals.css` next to the `--color-glass-w*` block:
```css
  --z-dropdown: 40;
  --z-modal: 50;
  --z-lightbox: 60;
  --z-toast: 70;
  --z-system: 80;
```
3b. Mappings (grep -rl per family):
```bash
sed -i 's/z-\[100000\]/z-[var(--z-system)]/g; s/z-\[99999\]/z-[var(--z-system)]/g; s/z-\[99995\]/z-[var(--z-toast)]/g; s/z-\[99994\]/z-[var(--z-toast)]/g; s/z-\[99990\]/z-[var(--z-toast)]/g; s/z-\[9999\]/z-[var(--z-lightbox)]/g; s/z-\[9998\]/z-[var(--z-lightbox)]/g; s/z-\[200\]/z-[var(--z-lightbox)]/g; s/z-\[1200\]/z-[var(--z-lightbox)]/g' $(grep -rlE "z-\[9[0-9]{3,5}\]|z-\[1200\]|z-\[200\]" src --include=*.tsx)
```
Keep `z-[1000]` CreateCardModal→`z-[var(--z-modal)]`? — audit each of the ~12 files with z-[100..1000]: modal→`--z-modal`, dropdown→`--z-dropdown`, toast→`--z-toast`. Verify: `grep -rhoE "z-\[[0-9]{3,}\]" src --include=*.tsx | wc -l` → 0. Gates. Commit `refactor(ui): named z-index scale`.

### Task 4 — type scale + legibility floor

```bash
sed -i 's/text-\[11px\]/text-xs/g; s/text-\[9px\]/text-[10px]/g; s/text-\[8px\]/text-[10px]/g; s/text-\[7px\]/text-[10px]/g; s/text-\[6px\]/text-[10px]/g' $(grep -rl "text-\[\(6\|7\|8\|9\|11\)px\]" src --include=*.tsx)
```
Then manual sweep where the bump to 10px overflows: badges/counters get `tracking-tight` or drop a decorative char (list per-file in commit). Verify: `grep -rhoE "text-\[(6|7|8|9|11)px\]" src --include=*.tsx | wc -l` → 0. Gates (markup tests that assert copy may need assertion updates — allowed, note in commit). Commit `refactor(ui): 6-step type scale, 10px legibility floor`.

### Task 5 — radius convergence

```bash
sed -i 's/rounded-3xl/rounded-xl/g; s/rounded-2xl/rounded-xl/g; s/rounded-sm /rounded-md /g' $(grep -rlE "rounded-(2xl|3xl|sm)" src --include=*.tsx)
```
Check MediaViewerModal/flash overlays for intentional 3xl (the user-approved 22px) — if present keep and note. Verify: `grep -rho "rounded-3xl" src --include=*.tsx | wc -l` → 0. Gates. Commit `refactor(ui): 4-step radius scale`.

### Task 6 — emoji/glyph purge in chrome

Per site (lucide is already imported almost everywhere):
- `src/components/feed/CommentsModal.tsx:170,186`: the two buttons APPEND " ❤️"/" ⚡" text to a comment — keep the semantic (users may still type emoji into content) but the BUTTON becomes `<Heart className="w-3.5 h-3.5 fill-current text-rose-400" />` / `<Zap …>` with `aria-label="Add heart"/"Add boost"`.
- `src/components/FlashModal.tsx` + `FlashOverlay.tsx`: ⚡→`<Zap>` (w-4/w-7), "⚡ FIRE FLASH"→"Fire flash" caption+icon, `✕`→`<X className="w-3.5 h-3.5" />` with aria-label.
- `src/components/feed/GMatchFeed.tsx:628`: ⚡→inline `<Zap className="inline w-3 h-3" />`.
- `src/admin/components/tabs/ContentTab.tsx:130`, `ContextOverlay.tsx:94`: ★→`<Star className="w-3 h-3 fill-current" />`.
- `✕` in GridWorkspace/MatchRoundPanel/SpectateModal/GoonPanel/MediaViewerModal → `<X>` (keep aria-labels).
`playPress` toast strings: `toast('⚡ Flash sent…')` → `'Flash sent to everyone online!'`.
Verify: `grep -rn "❤️\|⚡\|★\|✕" src --include=*.tsx | grep -v test | grep -v "content-type\|user comment" | wc -l` → 0 (game-art strings exempt with a comment). Gates. Commit `fix(ui): replace emoji chrome with lucide icons`.

### Task 7 — orphan literal colors → tokens (per file, top offenders first)

Files (descending count): `admin/BotSetupPanel.tsx`, `feed/GMatchFeed.tsx`, `BabecockPanel.tsx`, `feed/CreatePostModal.tsx`, `firstRun/OnboardingFlow.tsx`, `UserProfileModal.tsx`, `feed/InstagramPostModal.tsx`, `admin/LootboxAdminPanel.tsx`, `LegalCenter.tsx`, `home/CardTile.tsx`.
Mechanical map (apply per file, then eyeball leftovers):
```
bg-zinc-900        → bg-retro-panel     (or PLATE when it is a card)
bg-zinc-800        → bg-glass-w10
border-zinc-700/800→ border-border-glass
text-zinc-400/500  → text-retro-muted
text-zinc-100/200/300 → text-retro-fg
bg-black/40|50|60|70|80|85|90 → scrim: keep ONLY bg-black/70 (dialogs), others → bg-black/70 or bg-glass-w*
hover:bg-white/10  → hover:bg-glass-w10
```
EXEMPT (documented game semantics, do not touch): `GAME_AD_TEMPLATES` gradients, HP_FILL/crit/rarity badges in `ui/styles.ts` + MatchRoundPanel rarity chips (shared RARITY badgeClass).
Verify per file: `grep -c "zinc" src/components/feed/GMatchFeed.tsx` → 0 (minus exempt lines listed in the commit). Full: `grep -rl "bg-zinc\|border-zinc\|text-zinc" src/components src/firstRun --include=*.tsx | wc -l` → only exempt files. Gates. Commit per 2-3 files: `refactor(ui): token colors in <area>`.

### Task 8 — button-recipe convergence + compaction pass

8a. Replace inline button recipes with `BTN`/`BTN_SMALL` constants where the string contains `glass-button`-equivalent trio (`rounded-* px-* py-* text-xs font-medium`): candidates cluster at `px-3 py-2` (×124) and `px-3 py-1.5` (×116). Import from `../ui/styles` (already the pattern in idle views). Do NOT restyle: the constant equals the current visual (rounded-xl px-4 py-2.5 13px) — where the current control is smaller, use `BTN + BTN_SMALL`; where icon-only, apply the bare icon rule from the standard.
8b. Compaction (only provable redundancy, one item per hunk):
- `ServerTab.tsx`: the "how to join" paragraph → shorten to the masked-URL sentence; the rest lives in `title=` tooltip.
- `GMatchSettingsModal.tsx`: settings rows that duplicate their section caption → drop the row description, keep the label.
- `CreateCardModal.tsx:212` "Build the look now…" subtitle → drop.
- Toggle pairs (on/off buttons side by side): convert to ONE `aria-pressed` pill (find: `grep -rn "set.*(!.*)` patterns beside two buttons — only if both do the same state).
Verify: gates + `git diff --stat` review; visual sanity `npm run dev` once at the end of the wave (curl the dev server CSS per interface-audit-pass skill — localhost browser is blocked).
Commit `refactor(ui): button recipes from shared constants, drop redundant copy`.

### Task 9 — admin panel alignment pass

`src/admin/**` already speaks tokens partially (12-58 hits/file) but BotSetup/Lootbox are zinc-heavy (Tasks 7 covers those two). Remaining: admin tab bars use their own `Badge`/button kit — check they consume `BTN`/caption scale, NOT restyle the whole kit (YAGNI — admin is internal). Gate: same greps (`zinc`, `text-[6-9]px`, emoji, `z-[999..]`) scoped to `src/admin` → 0.
Commit `refactor(admin): align on V1 UI standard`.

### Task 10 — final map + evidence

Run the acceptance greps from docs/DESIGN.md, produce `docs/UI-CHECKUP-2026-09-11.md`: findings table (grep count before/after per rule) + anything deliberately kept with a one-line why. Full gates + CJS suites. Portable build ONLY if user says build (standing "deixe o build pra depois" on design iterations).

## Tests / validation

- No new unit tests (pure style migration) — the RED/GREEN is the grep count before/after each sed (record in commit body).
- vitest 634 stays green; any test that fails did not "prove markup wrong" — it pinned a class string; update the pin in the same commit, list it.
- Playwright journeys NOT required for this wave; the repo's flaky-single-journey rule applies if run.

## Risks, tradeoffs, open questions

- `text-[9px]`→10px bumps can overflow dense chips (feed counters, rarity badges). Mitigation: `tracking-tight`/truncate allowed per case; rarity badge CSS lives in shared `card-valuation` (do NOT touch — game semantics).
- z-index token mapping could regress stacking between two modals that relied on 9999 vs 10000 ordering. Audit pairs that coexist (flash overlay + lightbox, card-detail + create-card) when mapping; document coexistence order in DESIGN.md.
- `border-retro-border`→glass shifts contrast ~1 step lighter (glass token scales with --panel-alpha; retro-border does not). If a dense table (admin) looks washed, that file keeps its border via a one-line exception — flag, don't fork the system.
- The two skills say the admin kit has its own Badge components — converging them fully is out of scope (internal tool), only the four greps gate it.
- Open: user said "fluido" — animation tokens (durations/easings) were NOT part of the measured findings; add a motion line in DESIGN.md §future only if asked.
