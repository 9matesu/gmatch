# gMatch Design System v1.2 (Monochrome Slate HUD)

One design system for every tab, page, modal, button, settings and admin panel.
Convergence contract — raw values live ONLY in `src/globals.css` (@theme).
`src/ui/tokens.ts` is the SINGLE typed source of token names (spacing, layout,
radius, shadow, type, colour roles, button variants/sizes, wordmark, class
recipes). `src/ui/styles.ts` re-exports it for existing imports and adds only
the game-semantic literals; `src/ui/kit.tsx` composes the kit from the same
module. Components consume these names, they never re-inline equivalents.
`node apps/desktop/scripts/check-ui-tokens.mjs` gates raw `#hex`, `rgb(`,
`text-gray-*`, `p-[13px]` and numeric inline padding across `src`; the few
legacy exceptions (HP fill, crit flash, rarity, generated art) are scoped by
file + smell + exact value in `check-ui-tokens.allowlist.json` with a reason.

Reviewed absorption of the Antigravity "Social-Native Gaming HUD" plan
(2026-09-12): cyber-slate canvas + electric-blue interactive accent + floating
CommandIsland are the system. Sheets/drawers and the second audio engine were
rejected (dead code). Everything decorative that does not carry information
(glow, hover-float, saturate tricks, emoji, hype copy) is banned.

## Surfaces (pick by role)
- ONE panel opacity knob: `--panel-alpha` (Settings → Panel Opacity). Every panel
  colour is a `var(--color-glass*|--color-surface-*)` token scaled by it — a
  component never re-inlines a solid hex, or the slider silently stops reaching it.
- app bg: `bg-retro-bg` (the only opaque plate) · card/panel: `PLATE` (`solid-panel`)
- inset field: `glass-inset` · scrim: `bg-black/70` (the ONLY scrim value)
- hover fill: `bg-glass-w10`
- blur: the shell's `.app-glass` material pass (globals.css) supplies the panel
  gradient + ONE backdrop blur; the `--blur-*` scale is pinned to the same Glass
  blur setting, so no component re-inlines a fixed radius. The pass keys off the
  surface utilities — a component picks a token colour, never a literal, or it
  drops out of the material and reads as a different panel.
- media overlay chip (label ON image/video): `bg-black/60` — the only black-alpha
  outside scrims

## Accent — one color, one role
`--color-retro-accent` IS classic monochrome: white #ffffff on ink #0b0e14
(user revert 2026-09-12 — the cyber-blue steam tone felt off). There is
exactly one interactive accent; `hud-accent` is an alias, not a second
palette. Focus ring = `--ring`.

## Borders
`border-edge`, 1px. Two quieter steps for dense tables and disabled rows:
`border-edge-subtle` and `border-edge-strong`. The token was `--color-border-glass`
until 2026-11: the utility it compiled to (`border-border-glass`) read its property
word twice, in 920 call sites. The role is EDGE, so it now reads once.

## Type scale (6 steps, floor 10px)
caption `text-2xs` (10px: meta, counters, uppercase labels) -> body `text-xs` ->
field `text-sm` -> sub `text-lg` -> title `text-xl` -> display `text-2xl` (hero only).
`text-2xs` is a named step since 2026-11: 585 `text-[10px]` arbitrary values and 15
`text-[11px]` collapsed into it, line-height 1.5 so nothing moved. Instructional copy
(a sentence a person must read, not a label) is `text-xs` or larger, never 10px.

## Radius (4 steps)
`rounded-md` chips/icon-buttons · `rounded-lg` cards/buttons/inputs ·
`rounded-xl` modals/popovers · `rounded-full` pills/avatars.

## Z scale (CSS vars in globals.css; arbitrary 3+ digits banned)
`--z-dropdown:40 --z-modal:50 --z-lightbox:60 --z-toast:70 --z-system:80`
use `z-[var(--z-toast)]` etc. Coexistence order: modal < lightbox < toast < system
A dialog uses `z-[var(--z-modal)]` — never `z-system`: 18 of them sat on the
  system layer (80) and covered toasts (70), so a toast was invisible while any
  dialog was open (fixed 2026-11). Context menus and floating panels use
  `z-lightbox`; the age gate and the virus overlay alone stay on `z-system`.
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
- tw-animate classes (`animate-in`/`animate-out`/`fade-in`/`slide-in-from-*`) are
  banned — the `orbit-*` keyframe family only. No JS timelines.

## Tactile rules (the anti-cafonho clause)
- NO glow on chrome: box-shadow `0 0 Npx rgba(...)` outside the game-semantics
  exemption list. Buttons/panels/island: flat fills + 1px borders only.
- NO hover scale/translate on nav pills or cards (press = `active:scale-[0.98]` on
  buttons only). Exception: `CardTile` 3D tilt + holo foil = game semantics (loot).
- NO backdrop saturate/filter tricks; `backdrop-blur` allowed ONLY on
  `.command-island` and scrims.

## Buttons (ui/tokens.ts is the only factory; styles.ts re-exports it)
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

## Post anatomy (feed card)
One media-first tile. The author identity (avatar, name, timestamp, `⋯`) rides
INSIDE the media as a top overlay over a `bg-gradient-to-b from-black/75` scrim:
no header bar, no separator rule, no quality badge on the video. Actions
(like/comment/share/save) sit BELOW the media with no fill or border. The scrim
is `pointer-events-none` and its controls opt back in, so the media keeps its own
click-to-expand surface; it reserves `pr-12` for the video player's top-right
control, which shares the strip.

## Compaction
"nem tudo é botão": drop a description when it restates its sibling label (keep
`title=` tooltip); group settings rows under one caption header. Never merge
distinct features into menus.

## Status colours (4 roles, 2 values each)
`danger`, `warning`, `success`, `info`. The base (`--color-danger`) carries tints
and borders (`bg-danger/10`, `border-danger/30`); the `-fg` value is what text
wears. The pair flips per theme, so one class reads in both:

| role | dark fg | on #09090b | light fg | on #f2f2f4 |
|---|---|---|---|---|
| danger | #fca5a5 | 10.48 | #b91c1c | 5.79 |
| warning | #fcd34d | 13.80 | #92400e | 6.34 |
| success | #34d399 | 10.35 | #047857 | 4.90 |
| info | #67e8f9 | 13.73 | #155e75 | 6.50 |

Before this, 869 palette classes (`text-rose-400`, `bg-amber-500/10`, ...) did the
job with no name and no light-theme answer; 806 now read a role. Gradients
(`from-*` / `via-*` / `to-*`) are decoration and stay literal.

## Exemptions (game semantics — do not tokenize)
HP fill, crit flash, +g$ float, rarity badge colors (shared card-valuation),
GAME_AD_TEMPLATES gradients, NSFW media itself, `gg-*` grid keyframes,
`.holo-*` foil + CardTile 3D tilt, island backdrop blur,
media overlay chips (`bg-black/*` on image/video, not dialog roots),
runtime data colors: card accent (#9FE3FF, user-editable payload), generated
avatar palette (Avatar.tsx), admin Sparkline series colors, canvas raster fills,
Instagram-brand story-add badge.

## Acceptance greps (must read 0)
```
grep -rc "border-border-" src --include=*.tsx | grep -v ':0'
grep -rhoE "z-\[[0-9]{3,}\]" src --include=*.tsx
grep -rhoE "text-\[(6|7|8|9|11)px\]" src --include=*.tsx
grep -rho "rounded-3xl" src --include=*.tsx
grep -rhoE "rounded-(2xl|3xl)" src --include=*.tsx
grep -rn "#[0-9a-fA-F]\{6\}" src --include=*.tsx | grep -v test | grep -viE "e08a4c|cfd6e6|ffd75e|5ee0ff|b8b8c4|9fe3ff|sparkline|color=|avatar.tsx|babecockpanel|0b0e14|0095f6|d6c6ff|ffd6f0"
grep -rn "bg-white/\|border-white/" src --include=*.tsx | grep -v test | grep -v holo | grep -v "bg-black/"
grep -rhoE "duration-(75|100|200|1000)\b" src --include=*.tsx
grep -rhoE "duration-\[[0-9]+ms\]" src --include=*.tsx
grep -rhoE "scale-\[1\.0" src --include=*.tsx
grep -rn "animate-in \|animate-out \|slide-in-from" src --include=*.tsx | grep -v orbit
grep -rn "shadow-\[0_0" src --include=*.tsx | grep -v test | grep -vE "CardBack|FlashOverlay|CardTile|Babecock|styles.ts"
grep -rn "Welcome to\|successfully\|seamless\|effortless\|unleash\|cutting-edge\|Dive into" src --include=*.tsx | grep -v test
grep -rn "metro-rule" src
# Exemption (2026-09-11 audit): CommentsModal quick-reaction buttons insert emoji
# into the user's comment BODY (content, not chrome); their chrome is lucide.
# Same for the DM reaction palette (GMatchDMs): the glyph IS the reaction
# payload stored on the message, so it is content — the buttons around it are
# lucide.
grep -rn "❤️\|⚡\|★\|✕" src --include=*.tsx | grep -v test | grep -v CommentsModal | grep -v GMatchDMs
grep -rn "animate-fade-in\|animate-slide-up\|animate-slide-down" src --include=*.tsx | grep -v orbit
grep -nE "^\s*--color-(surface-raised|surface-elevated|surface-interactive|retro-panel):\s*#" src/globals.css
grep -n "text-sm" src/components/feed/GMatchFeed.tsx src/components/feed/PostComments.tsx
```
Codified (with the exemption lists and the em-dash/placeholder nuances):
`bash apps/desktop/design-gates.sh` — every count must read 0, all scrims /70.

## Text over a wallpaper (measured, 2026-11)

A wallpaper replaces the canvas the type tokens were measured against, so the
worst case is the scrim composited over an adversarial photo (white in the dark
theme, black in the light one). Measured at the shipped values:

| theme | scrim | worst plate | fg | body | muted | faint |
|---|---|---|---|---|---|---|
| dark | `rgba(9,9,11,.45)` | `rgb(144,144,145)` | 3.04 | 2.15 | 1.08 | 1.34 |
| light | `rgba(244,244,246,.55)` | `rgb(134,134,135)` | 4.88 | 2.88 | 2.13 | 1.05 |

So the scrim is a plate, not a guarantee: no scrim below ~0.85 alpha can carry
`muted` over an adversarial photo (that is an opaque canvas, i.e. no wallpaper).
The rule that actually holds is the one already written above `.glass-toolbar`:
**text sits on chrome, and chrome is opaque**. Hence the title bar uses
`bg-retro-bg` (it is the window frame, and a `drag` region), and the scrim
exists for the gaps between panels, which carry no text by construction.
