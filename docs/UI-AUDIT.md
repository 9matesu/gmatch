# UI Census & Simplification Plan (the "catado")

> Status: audit, not yet implemented. Numbers measured over `apps/desktop/src`
> on the working tree (Nov 2026). Companion to `docs/DESIGN.md`.

## 1. What exists (inventory)

42 component files >300 lines; the 12 largest carry the whole product:

| File | Lines | Role |
|---|---|---|
| servers/ServersView.tsx | 1901 | directory + host + join |
| feed/GMatchFeed.tsx | 1640 | timeline |
| chat/GMatchDMs.tsx | 1589 | DMs/rooms/groups chat |
| grid/IdleGalleryView.tsx | 1429 | idle 3×3 gallery |
| BabecockPanel.tsx | 1041 | idle center panel |
| settings/GMatchSettingsModal.tsx | 938 | settings |
| domination/PCDominationTab.tsx | 931 | domination |
| ContextOverlay.tsx | 901 | context menu + report |
| MatchRoundPanel.tsx | 817 | duel round |
| feed/CreatePostModal.tsx | 742 | composer |
| StoreTab.tsx | 688 | store |
| SpectateModal.tsx | 638 | spectate |

Primitives that already exist and should anchor the system:
- `src/ui/styles.ts` — idle-game recipes: `PLATE`, `BTN`, `BTN_PRIMARY`, `BTN_DANGER`, `MUTED`, `HP_BAR`, `RARITY`. Good vocabulary, confined to the idle view.
- `globals.css` — shell tokens: `--color-glass-w4..w20` (alpha scaled by `--panel-alpha`), `solid-panel`, `border-border-glass`, retro accent.
- `media/MediaPickerModal.tsx` — already the ONE media picker (post/story/profile/forge/domination) with Browse/Upload/URL.

## 2. Measured sprawl (the evidence)

**Surfaces (the transparency problem the audit targets).** A card face is picked
by hand from 16 distinct fills:

| Fill family | Variants | Occurrences |
|---|---|---|
| `bg-glass-w4/w5/w8/w10/w12/w20` | 6 | 542 |
| `bg-black/30..90` | 10 | 196 |
| `bg-white/10..15` | 2 | 4 |

6 white glass tiers + 10 black overlay tiers = every screen mixes a different
depth. `solid-panel` (the honest opaque panel) is used 25×; everything else
floats.

**Radii.** `rounded-md` 220 · `rounded-lg` 501 · `rounded-xl` 332 ·
`rounded-full` 280 · `rounded-2xl` 0 (spec says 2xl, code says lg — the spec is
stale). Cards are lg, xl and md depending on the file.

**Color.** Accent semantics sprawl: amber 92, rose 58, emerald 60, cyan 47,
red 71, purple 19, blue 4 — at 20+ shades. Only pink HP/crit/rarity is game
semantics (styles.ts keeps those correctly).

**Motion.** 746 transitions; 11 named `gg-*` keyframes, several duplicated
`animate-[gg-shake-a…][gg-shake-b…]` pairs.

**Z-index.** `z-10..50` plain + 8 arbitrary `z-[n]` values; 118 total. No
layer table.

**Buttons.** 851 `<button>` elements. The shell has no shared Button — only the
idle view imports `BTN`. Every screen re-types its own padding/hover/focus.

**Duplications.** Modal shells (backdrop + close X + panel) re-implemented in
≥12 files. Tab bars re-implemented in ≥8 (ServersView, GMatchSettingsModal,
GMatchDMs, StoreTab, GamesView, IdleGalleryView, Config tabs…).
`text-retro-muted` 1247× (fine, but subtitles under subtitles).

**Flavor text.** "goon"/"Pervert" appear 40×/2× as UI copy beyond the game's own
semantics; taglines, sub-labels and stats captions repeat per-tab.

**Drag & drop.** `draggable`/`onDrop` exist in ~15 places (DeckBuilder, gallery,
composer) with no shared DragLayer, no snap, no drop-hint surface.

## 3. The target system (few things, strongly made)

Six primitives in `src/ui/kit.tsx` — everything else composes them:

1. **`Button`** — variants: `primary` (one accent, ink label), `secondary`
   (glass w8 + border), `danger`, `ghost`. Sizes `sm|md`. One focus ring,
   `active:scale-[0.98]`, disabled state. Replaces 851 hand-typed buttons;
   `BTN*` from styles.ts folds in.
2. **`Card`** — ONE surface: `solid-panel` + `border-border-glass` +
   `rounded-lg`. Optional `tone="raised"` (glass-w12) only for the single
   elevated card on screen (composer, active duel). **Glass tiers collapse
   16→2: w8 (default surface) and w12 (raised); `bg-black/*` allowed only as
   `bg-black/60` (modal backdrop) and `bg-black/70` (image scrim).**
3. **`Panel/Modal`** — backdrop (bg-black/60) + Card + `ModalHeader` (title +
   X) + body. 12 re-implementations deleted.
4. **`Tabs`** — underline-style bar: one component for every tab row.
5. **`Title`** — `text-sm font-semibold` (section) / `text-xs text-retro-muted`
   (caption). **Kill sub-subtitles and flavor taglines; one label per control,
   the label says what it does.**
6. **`DragLayer`** — shared draggable + drop-zone hook: `draggable`, drag
   preview (the element at 0.9 opacity), drop target highlight (accent border +
   snap point calculation), release animation. Feeds gallery ⇄ composer,
   deck building, chat attachments, profile attachments.

**Type scale:** display 16 · body 14 · caption 12 · mono numbers only where
they tick (`MONO`). **Radius:** `lg` for cards/controls, `full` for pills.
**Color:** one accent (retro), one danger, plus the game-semantic set already
frozen in styles.ts (HP/rarity/crit). Everything else → fg/muted.

**Z-layer table (fixed):** content 0 · sticky rail 10 · chat dock 20 · modal
backdrop 30 · modal 40 · toast 50 · debug 90.

## 4. Per-view simplification plan

| View | Cut | Rebuild |
|---|---|---|
| **Idle (BabecockPanel + IdleGalleryView)** | sub-captions under stats, cap descriptions repeated in two tabs | HP bar + counter + tabs; cards become `Card` + `DragLayer` (drag a gallery square into the composer to share it); keep the pink HP/rarity vocabulary |
| **Cards (DeckBuilder, MatchRoundPanel, CardDetailView, SendPanel)** | valuation footnotes, duplicate stat rows | deck builder is a drop-grid: `DragLayer` with snapping; card face = one `Card` + rarity token |
| **Chat (GMatchDMs)** — bigger & more dynamic | header sub-labels, per-block dividers | full-height conversation pane, composer with `MediaPicker` attach + drag-drop of any gallery object, jump-to-quote, reaction bar; unread derived from existing stamps (no new state) |
| **Feed (GMatchFeed, CreatePostModal)** | flavor taglines, double filters | composer strip (already exists) + timeline of `Card`s; drop an image anywhere on the feed → composer opens with it attached |
| **Media picker** | tab chrome | keep the single picker; add multi-select and drag-out (source for the DragLayer everywhere) |
| **Profile (GMatchProfile, UserProfileModal)** | static grid | **attachable canvas**: profile widgets (posts, cards, keepsakes, links) are `DragLayer` tiles with snapping to a 2-col grid, attach anything (image, card, trackable link), moves persist; visual feedback = accent outline + snap ghost while dragging |
| **Servers, Settings, Domination, Admin** | repeated intros/subtitles | everything becomes Modal/Tabs/Button; admin primitives (`AdminModal`, `AdminTable`) stay as the dense variant |

**Transparency rule:** one translucent layer is allowed per surface (glass-w8 or
w12, already `--panel-alpha` scaled). Never glass-on-glass over glass — if two
float, the lower one becomes `solid-panel`. Backdrops are always `bg-black/60`.

**Responsiveness:** every view keeps its existing sm:/md: breakpoints — the
audit changes *how many different things* render, not the grid math. The chat
dock keeps `md:right-[min(720px,40vw)]`.

## 5. Migration order (mechanical, per commit, gate after each)

1. `kit.tsx` primitives + adopt in BabecockPanel + IdleGalleryView (kill flavor copy).
2. Modal/Tabs sweep (12 modal shells, 8 tab bars deleted).
3. Chat rebuild (bigger pane, dynamic composer).
4. DragLayer + drop-zones (composer, deck builder, gallery→chat).
5. Profile attachable canvas with snapping.
6. Z-layer + color-tier enforcement (`globals.css` tokens only; grep gate for
   `bg-glass-w(4|5|20)`, `bg-black/[0-35]`, `rounded-xl` outside kit).

Each step: lint 0 errors → typecheck → tests → build. No behavior change except
where the plan says (drag-drop, chat pane).
