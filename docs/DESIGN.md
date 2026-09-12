# gMatch V1 UI Standard

One design system for every tab, page, modal, button, settings and admin panel.
Convergence contract — tokens already exist in `src/globals.css` (@theme) and
`src/ui/styles.ts`; components consume them, they never re-inline equivalents.

## Surfaces (pick by role)
- app bg: `bg-retro-bg` · card/panel: `PLATE` (`rounded-lg border border-border-glass bg-retro-panel`)
- inset field: `glass-inset` · scrim: `bg-black/70` (the ONLY scrim value)
- hover fill: `bg-glass-w10`

## Borders
`border-border-glass`, 1px. `border-retro-border` is deprecated (exception line
allowed per file if a dense admin table washes out — flagged in code, never forked).

## Type scale (6 steps, floor 10px)
caption `text-[10px]` (meta/counters/uppercase labels) · body `text-xs` ·
field `text-[13px]` (inputs) · sub `text-sm` (modal titles) · title `text-lg` ·
display `text-xl`/`text-2xl` (hero/rank-up only).
Numbers: `MONO` (JetBrains Mono + tabular-nums). `font-black` only on display.
tracking: `tracking-wider` on uppercase micro-labels, else default.

## Radius (4 steps)
`rounded-md` chips/icon-buttons · `rounded-lg` cards/buttons/inputs ·
`rounded-xl` modals/popovers · `rounded-full` pills/avatars.

## Z scale (CSS vars in globals.css; arbitrary 3+ digits banned)
`--z-dropdown:40 --z-modal:50 --z-lightbox:60 --z-toast:70 --z-system:80`
use `z-[var(--z-toast)]` etc. Coexistence order: modal < lightbox < toast < system
(flash overlay is system; card-detail vs create-card: create-card on top).

## Motion (3 durations, 1 easing per direction, loop = UA)
- `duration-150` micro (hover/press/color) · `duration-300` entrances/exits ·
  `duration-700` dramatic (tier-flash, rank-up) — map 75/100/200→150, 300 stays,
  700/1000→700.
- easing: enter `ease-out`, exit `ease-in`; loops (spin/pulse/ping) stay UA.
- named keyframes are the house set only: `orbit-fade-in`, `orbit-pop`,
  `orbit-slide-up`, `orbit-pulse-soft`, `orbit-tier-flash`, `orbit-feed-in`.
  Bare `animate-fade-in`/`animate-slide-up`/`animate-slide-down` converge onto
  the orbit set (or stay UA `animate-pulse`/`animate-spin` when that's the job).
- Interruptible transitions only (Tailwind duration classes, not JS timelines);
  `prefers-reduced-motion` kill-switch already lives in globals.css — keep it first.

## Buttons (ui/styles.ts is the only factory)
primary `BTN + BTN_PRIMARY` · secondary `BTN` · small `BTN + BTN_SMALL` ·
destructive `BTN + BTN_DANGER` · icon-only: bare `p-1.5 rounded-md
hover:bg-glass-w10` + `aria-label`, NO border/blur wrapper · toggle = one pill
with `aria-pressed`, never two buttons for one boolean.

## Icons
`@phosphor-icons/react` is the HUD chrome icon set (user directive 2026-09-12 —
CommandIsland, NativeHeaderBar, arena pills); the rest of the app keeps lucide
(`currentColor`, `w-3.5`/`w-4` `stroke-[1.75]`). ZERO emoji/glyph in
chrome (❤️⚡★✕→Heart/Zap/Star/X). User-typed content may still contain emoji.
Sanctioned disclosure glyphs (user directive 2026-09-11): ⌃ ⌄ on the messages
rail handle and the chat panel close control — functional toggles, not
decoration. The Unicode sweep skips exactly these two.

## Compaction
"nem tudo é botão": drop a description when it restates its sibling label (keep
`title=` tooltip); group settings rows under one caption header. Never merge
distinct features into menus.

## Exemptions (game semantics — do not tokenize)
HP fill, crit flash, +g$ float, rarity badge colors (shared card-valuation),
GAME_AD_TEMPLATES gradients, NSFW media itself.

## Acceptance greps (must read 0)
```
grep -rc "border-retro-border" src --include=*.tsx | grep -v ':0'
grep -rhoE "z-\[[0-9]{3,}\]" src --include=*.tsx
grep -rhoE "text-\[(6|7|8|9|11)px\]" src --include=*.tsx
grep -rho "rounded-3xl" src --include=*.tsx
# Exemption (2026-09-11 audit): CommentsModal quick-reaction buttons insert emoji
# into the user's comment BODY (content, not chrome); their chrome is lucide.
grep -rn "❤️\|⚡\|★\|✕" src --include=*.tsx | grep -v test | grep -v CommentsModal
grep -rhoE "duration-(75|100|200|1000)\b" src --include=*.tsx
grep -rn "animate-fade-in\|animate-slide-up\|animate-slide-down" src --include=*.tsx | grep -v orbit
```
