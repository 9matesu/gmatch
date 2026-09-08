# UI Simplification & Vercel-Style Desktop Polish Implementation Plan

> **For Hermes:** Use subagent-driven-development skill or execute task-by-task with strict TDD.

**Goal:** Simplify and assimilate GoonGrid desktop UI into a consistent, monochromatic, Vercel-style clean desktop app that feels private, secure, feedback-rich, and game-focused without removing any existing functionalities.

**Architecture:** 
- Strip garish/multi-color accents (cyan, lavender, pink, mint, lime gradients) and consolidate design tokens to high-contrast monochromatic neutrals (`#000000`, `#09090b`, `#18181b`, `#27272a`, `#fafafa`) with strict single-accent role assignments.
- Eliminate excessive glassmorphism blurs, rainbow glow borders, and heavy drop shadows in favor of crisp 1px borders, subtle 1-layer elevation shadows, and concentric border radii (`better-ui`, `better-layout`, `better-colors`).
- Maintain full social, P2P, idle-game, hack/domination, and admin functionalities with enhanced tactile feedback (micro-interactions, 0.96 press scale, toast/sound confirmations, state cues).

**Tech Stack:** React 19, Vite, Tailwind CSS v4, Electron, Lucide Icons, Vitest.

---

### Task 1: Audit & Refactor Design Tokens to Clean Vercel Monochromatic Palette

**Objective:** Clean up `globals.css` token definitions, eliminating multi-hued chrome palettes while establishing crisp surface, border, and typography tokens.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/globals.css:11-135`
- Test: `I:/goongrid/apps/desktop/src/ui/OfflineCard.test.tsx`

**Step 1: Write failing/verification test or token audit check**

Check existing component rendering under consolidated tokens:
Run: `npm run test --prefix apps/desktop`
Expected: PASS

**Step 2: Update `globals.css` with clean Vercel/Geist-style tokens**

Replace loud Y2K gradient tokens with clean zinc/monochrome tokens:
- `--color-surface-canvas: #09090b` (Deep black-zinc)
- `--color-surface-raised: #121215` (1st elevation)
- `--color-surface-elevated: #18181b` (Card/surface)
- `--color-surface-interactive: #27272a` (Hover/active)
- `--color-border-subtle: #27272a` (1px clean border)
- `--color-border-glass: #27272a`
- `--color-retro-accent: #ffffff` / `#f4f4f5` (Clean white primary action)
- Keep status tokens minimal and desaturated (online green, alert red, warning amber).

```css
@theme inline {
  --color-surface-canvas: #09090b;
  --color-surface-raised: #121215;
  --color-surface-elevated: #18181b;
  --color-surface-interactive: #27272a;

  --color-glass: rgba(18, 18, 21, 0.85);
  --color-glass-strong: rgba(24, 24, 27, 0.95);
  --color-glass-solid: #18181b;

  --color-border-glass: #27272a;
  --color-border-subtle: #1f1f23;
  --color-border-strong: #3f3f46;

  --color-retro-accent: #ffffff;
  --color-retro-accent-hover: #e4e4e7;
  --color-retro-accent-text: #09090b;

  --color-retro-fg: #fafafa;
  --color-retro-body: #d4d4d8;
  --color-retro-muted: #71717a;
  --color-retro-faint: #52525b;

  --color-retro-online: #22c55e;
  --color-retro-warning: #eab308;
  --color-retro-error: #ef4444;
  --color-retro-info: #3b82f6;

  --radius: 6px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
}
```

**Step 3: Run build & tests to verify**

Run: `npm run lint --prefix apps/desktop && npm run test --prefix apps/desktop`
Expected: 0 errors, all tests pass.

**Step 4: Commit**

```bash
git add apps/desktop/src/globals.css
git commit -m "style: assimilate design tokens to clean vercel monochrome palette"
```

---

### Task 2: Refactor Sidebar Navigation to Clean Modular Layout

**Objective:** Modernize `SidebarNav.tsx` with clean optical alignment, Vercel-style hover indicators, tactile active states (`better-ui` scale 0.96), and removal of rainbow borders.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/home/SidebarNav.tsx`

**Step 1: Simplify SidebarNav styles**

- Remove multicolored background badges and glowing outlines.
- Replace noisy gradients with clean `#27272a` borders and subtle background fills on active item.
- Enforce strict optical icon alignment with 1.5px/2px stroke widths matching text hierarchy.
- Add tactile `active:scale-[0.96]` feedback on navigation items.

```tsx
// Example nav item class simplification:
const navItemClass = (active: boolean) =>
  `group relative flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-all duration-150 active:scale-[0.96] ${
    active
      ? 'bg-zinc-800 text-zinc-50 font-semibold shadow-xs border border-zinc-700'
      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
  }`;
```

**Step 2: Verify component rendering and syntax**

Run: `npm run lint --prefix apps/desktop`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/home/SidebarNav.tsx
git commit -m "refactor(ui): simplify sidebar nav to vercel desktop layout"
```

---

### Task 3: Assimilate Feed & Social Post Components (Clean Hierarchy)

**Objective:** Clean up `GoonMatchFeed.tsx`, `CreatePostModal.tsx`, and `InstagramPostModal.tsx` by removing heavy glow overlays, standardizing cards on 1px crisp borders and consistent padding.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/feed/GoonMatchFeed.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/feed/InstagramPostModal.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/feed/CreatePostModal.tsx`

**Step 1: Replace glassmorphic heavy borders with clean card layout**

- Use concentric border radius (`rounded-lg` container, `rounded-md` inner image/button).
- Standardize image outlines with 1px low-opacity border (`border border-white/10`).
- Ensure feedback actions (like, repost, comment, tip g$) show instant tactile response and count updates without jarring full-page reflows.

**Step 2: Verify component tests and build**

Run: `npm run test --prefix apps/desktop`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/components/feed/
git commit -m "style(feed): streamline feed and post modals to minimalist vercel style"
```

---

### Task 4: Streamline Idle Game & Card Tiles (Game Focus with Visual Clarity)

**Objective:** Refactor `GridWorkspace.tsx`, `BabecockPanel.tsx`, `CardTile.tsx`, and `grid-animations.css` to strip distracting flashing animations while preserving high-impact game telemetry and feedback.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/ui/grid-animations.css`
- Modify: `I:/goongrid/apps/desktop/src/components/home/CardTile.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/BabecockPanel.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/grid/GridWorkspace.tsx`

**Step 1: Clean animation keyframes**

- Keep float-up numbers (`gg-float-up`) and critical state indicators (low HP, crit).
- Remove excessive multi-color border pulsing (`gg-pulse`) in favor of crisp highlight borders.

**Step 2: Simplify CardTile & Idle Game HUD**

- Monochromatic compact counters with tabular numbers (`font-mono tracking-tight`).
- Clear visual hierarchy for g$ generation, multipliers, and upgrade buttons.
- Clear tactile feedback on clicks (`active:scale-[0.96]`, audio chime retained).

**Step 3: Run lint & test suite**

Run: `npm run test --prefix apps/desktop`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/ui/grid-animations.css apps/desktop/src/components/home/CardTile.tsx apps/desktop/src/components/BabecockPanel.tsx apps/desktop/src/components/grid/GridWorkspace.tsx
git commit -m "refactor(game): polish idle workspace and card tile hierarchy"
```

---

### Task 5: Standardize Modals, Overlays, and Feedback UI (Security & Privacy Polish)

**Objective:** Clean up `UserProfileModal.tsx`, `AttachmentUploadModal.tsx`, `TosModal.tsx`, `AgeGateModal.tsx`, `OfflineWarningBanner.tsx`, and `Toast.tsx` for consistent, trustworthy desktop dialogs.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/UserProfileModal.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/OfflineWarningBanner.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/Toast.tsx`
- Modify: `I:/goongrid/apps/desktop/src/components/ConfirmDialog.tsx`

**Step 1: Apply unified modal and surface treatment**

- Background overlay: `bg-black/80 backdrop-blur-xs` (subtle, high legibility).
- Dialog surface: `bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl`.
- Action buttons: Primary (`bg-white text-zinc-950 hover:bg-zinc-200`), Secondary (`bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700`), Destructive (`bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20`).
- Privacy & P2P security indicators: Clean shield/lock icons with neutral styling and clear tooltip feedback.

**Step 2: Verify full app build & type safety**

Run: `npm run build --prefix apps/desktop`
Expected: Build succeeds with 0 errors.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/UserProfileModal.tsx apps/desktop/src/components/OfflineWarningBanner.tsx apps/desktop/src/components/Toast.tsx apps/desktop/src/components/ConfirmDialog.tsx
git commit -m "style(modals): standardize desktop dialogs and feedback toasts"
```

---

## Verification & Acceptance Criteria

1. **Visual Hierarchy:** Clean, dark zinc palette matching Vercel/Linear standards; no rainbow gradients or uncoordinated neon accents.
2. **Functionality Preservation:** 100% of P2P chat, feeds, card collection, idle clicker, hack/domination, and admin tools remain fully functional.
3. **Tactile Feedback:** Buttons maintain `active:scale-[0.96]`, toasts provide clear action confirmation, and sound effects fire correctly.
4. **Code Quality Gates:** `npm run lint` (0 errors), `npm run test` (100% passing), and `npm run build` succeed across packages.

---

## Risks & Tradeoffs

- **Risk:** Custom game animation keyframes tied to specific classes might lose emphasis if over-simplified.
  - **Mitigation:** Retain gameplay floating damage/g$ text and crit feedback while pruning purely decorative border glows.
- **Risk:** Contrast drops on muted text in dark theme.
  - **Mitigation:** Enforce minimum APCA/WCAG contrast using zinc-400 (`#a1a1aa`) for secondary text and zinc-100 (`#f4f4f5`) for primary text.
