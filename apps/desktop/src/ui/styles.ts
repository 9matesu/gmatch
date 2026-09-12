/**
 * Shared Tailwind class recipes for the idle-game UI (was goongrid.css).
 * All chrome now speaks the Orbit shell design system: shell tokens
 * (bg-retro-panel/bg-retro-bg, text-retro-fg, text-retro-muted,
 * border-border-glass) plus the shell's own .glass-button / .glass-tab /
 * .accent-control classes from globals.css. Literal pink remains ONLY where
 * it is game semantics: HP fill, crit flash, +pts float, cap-active glow,
 * rarity badges (see HP_FILL / FLOAT_GC / RARITY below).
 */

/** Monospace + tabular figures for every number readout (theme token = one mono). */
export const MONO = 'font-mono tabular-nums'

/** Small uppercase-muted helper text (was .muted). */
export const MUTED = 'text-xs text-retro-muted'

/** Display face for headings/labels — the shell's sans (Outfit). */
export const DISPLAY = 'font-sans'

/** Panel surface — flat cyber-slate card on the hairline border token. */
export const PLATE = 'rounded-lg border border-border-glass bg-glass-w5'

/** Scrollable panel body. */
export const PANEL = 'min-h-0 overflow-y-auto p-3.5 sm:p-4'

/** Contract button: flat glass fill, 1px border, press = 0.98 scale. */
export const BTN =
  'cursor-pointer rounded-lg border border-border-glass bg-glass-w8 hover:bg-glass-w12 active:scale-[0.98] px-3.5 py-2 text-xs font-semibold text-retro-fg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100'

export const BTN_SMALL = 'rounded-lg px-2.5 py-1 text-xs'

/** Primary action — the one blue accent, ink label. No glow. */
export const BTN_PRIMARY =
  'bg-retro-accent text-retro-accent-text hover:bg-retro-accent-hover border-transparent font-bold'

/** Destructive prestige action. */
export const BTN_DANGER =
  'bg-retro-error/15 border-retro-error/40 text-retro-error hover:bg-retro-error/25'

/** Bundled skin behind an inline backgroundImage. */
export const SKIN =
  'bg-cover bg-center bg-no-repeat [text-shadow:0_1px_3px_#000]'

/** Feed stage frame: canvas well with hairline border. */
export const STAGE_FRAME =
  'overflow-hidden rounded-lg border border-border-glass bg-surface-canvas shadow-xl select-none'

/** HP bar track + fill. Modern precision gauge. */
export const HP_BAR =
  'h-1.5 overflow-hidden rounded-full border border-white/10 bg-black/80 shadow-inner'
export const HP_FILL =
  'h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)] transition-[width] duration-[120ms] ease-linear'
export const HP_FILL_LOW =
  'from-amber-500 to-orange-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-[gg-hp-low_0.7s_ease-in-out_infinite]'

/** Floating +GP popup. Refined tabular figures with clean drop shadow. */
export const FLOAT_GC =
  'pointer-events-none absolute z-[10] animate-[gg-float-up_0.9s_ease-out_forwards] text-sm font-bold text-emerald-400 font-mono drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [transform:translate(-50%,-50%)]'
export const FLOAT_GC_CRIT = 'text-xl text-amber-300 font-black drop-shadow-[0_0_8px_rgba(252,211,77,0.6)]'

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
