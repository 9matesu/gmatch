/**
 * Shared Tailwind class recipes for the idle-game UI (was goongrid.css).
 * All chrome now speaks the Orbit shell design system: shell tokens
 * (bg-retro-panel/bg-retro-bg, text-retro-fg, text-retro-muted,
 * border-border-glass) plus the shell's own .glass-button / .glass-tab /
 * .accent-control classes from globals.css. Literal pink remains ONLY where
 * it is game semantics: HP fill, crit flash, +pts float, cap-active glow,
 * rarity badges (see HP_FILL / FLOAT_GC / RARITY below).
 */

/** Monospace + tabular figures for every number readout. */
export const MONO =
  "font-['JetBrains_Mono',ui-monospace,'Cascadia_Mono',Consolas,monospace] tabular-nums"

/** Small uppercase-muted helper text (was .muted). */
export const MUTED = 'text-xs text-retro-muted'

/** Display face for headings/labels — the shell's sans (Outfit). */
export const DISPLAY = 'font-sans'

/** Panel surface (was .plate / .glass) — the shell's raised panel token. */
export const PLATE =
  'rounded-lg border border-border-glass bg-retro-panel shadow-[0_12px_28px_rgba(0,0,0,0.5)]'

/** Scrollable panel body (was .panel). */
export const PANEL = 'min-h-0 overflow-y-auto p-[18px]'

/** Shell glass button (was the machined .btn recipe). */
export const BTN =
  'glass-button cursor-pointer rounded-xl px-4 py-2.5 text-[13px] font-semibold tracking-[0.5px] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_SMALL = 'rounded-lg px-3 py-1.5 text-xs'

/** Primary action — the shell's animated chrome-spark accent control. */
export const BTN_PRIMARY = 'accent-control'

/** Destructive prestige action — shell error token on the glass button. */
export const BTN_DANGER =
  'bg-retro-error/20 font-bold tracking-[1px] text-retro-error enabled:hover:bg-retro-error/30'

/** Bundled gif skin behind an inline backgroundImage (was .has-skin). */
export const SKIN =
  'bg-cover bg-center bg-no-repeat [text-shadow:0_1px_3px_#000]'

/** Feed stage frame: black well with a glass border (was .image-stage/.grid-board). */
export const STAGE_FRAME =
  'overflow-hidden rounded-xl border border-border-glass bg-black shadow-[0_8px_22px_rgba(0,0,0,0.55)] select-none'

/** HP bar track + fill (was .hp-bar / .hp-fill). Pink fill is game semantics. */
export const HP_BAR =
  'h-3 overflow-hidden rounded-full border border-white/10 bg-black shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]'
export const HP_FILL =
  'h-full rounded-full bg-[#ff2d78] shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] transition-[width] duration-[120ms] ease-linear'
export const HP_FILL_LOW =
  'bg-[#ffb02e] animate-[gg-hp-low_0.7s_ease-in-out_infinite]'

/** Floating +GP popup (was .float-gc). Green/gold gain colors are game semantics. */
export const FLOAT_GC =
  'pointer-events-none absolute z-[2] animate-[gg-float-up_0.9s_ease-out_forwards] text-lg font-bold text-[#3fd68c] [text-shadow:0_2px_4px_rgba(0,0,0,0.8)] [transform:translate(-50%,-50%)]'
export const FLOAT_GC_CRIT = 'text-[28px] text-[#ffd75e]'

/** Full-bleed feed image (was .goon-image). */
export const GOON_IMAGE = 'block h-full w-full object-contain'

/** Rarity badge palette (was .rarity-*) — game semantics, kept as content colors. */
export const RARITY: Record<string, string> = {
  common: 'text-[#b8b8c4]',
  copper: 'text-[#e08a4c] border-[rgba(224,138,76,0.5)]',
  silver: 'text-[#cfd6e6] border-[rgba(207,214,230,0.5)]',
  gold: 'text-[#ffd75e] border-[rgba(255,215,94,0.5)]',
  diamond:
    'text-[#5ee0ff] border-[rgba(94,224,255,0.6)] [text-shadow:0_0_10px_rgba(94,224,255,0.6)]',
}
