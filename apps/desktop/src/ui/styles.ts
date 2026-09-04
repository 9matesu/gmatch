/**
 * Shared Tailwind class recipes for the idle-game UI (was goongrid.css).
 * Shell tokens (bg-retro-panel, text-retro-fg, text-retro-muted,
 * border-border-glass) carry the design system; the anodized pink (#ff2d78)
 * and its deep shadow (#8f0e42) are the idle game's signature accent, kept
 * as literal values.
 */

/** Monospace + tabular figures for every number readout. */
export const MONO =
  "font-['JetBrains_Mono',ui-monospace,'Cascadia_Mono',Consolas,monospace] tabular-nums"

/** Small uppercase-muted helper text (was .muted). */
export const MUTED = 'text-xs text-retro-muted'

/** Display face for headings/labels — the shell's sans (Outfit); the legacy
    'Chakra Petch' stack was never loaded and fell back to system-ui anyway. */
export const DISPLAY = 'font-sans'

/** Machined plate surface (was .plate / .glass). */
export const PLATE =
  'rounded-lg border border-[#05070a] bg-retro-panel shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-4px_8px_rgba(0,0,0,0.4),0_12px_28px_rgba(0,0,0,0.5)]'

/** Scrollable panel body (was .panel). */
export const PANEL = 'min-h-0 overflow-y-auto p-[18px]'

/** Raised button (was .btn). */
export const BTN =
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-[#05070a] bg-surface-elevated px-4 py-2.5 text-[13px] font-semibold tracking-[0.5px] text-retro-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_3px_0_#05070a] transition-[transform,box-shadow,border-color,filter] duration-75 enabled:hover:border-[#ff2d78] enabled:hover:brightness-115 enabled:active:translate-y-0.5 enabled:active:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_0_#05070a] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none'

export const BTN_SMALL = 'rounded-lg px-3 py-1.5 text-xs'

/** Ink-on-pink primary action (was .btn.primary). */
export const BTN_PRIMARY =
  'border-[#05070a] bg-[#ff2d78] text-[#0a0a0f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_3px_0_#8f0e42] enabled:active:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_0_#8f0e42]'

/** Destructive prestige action (was .btn.danger). */
export const BTN_DANGER =
  'border-[#05070a] bg-[#c22430] font-bold tracking-[1px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_3px_0_#5f0f18] enabled:active:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_0_#5f0f18]'

/** Bundled gif skin behind an inline backgroundImage (was .has-skin). */
export const SKIN =
  'bg-cover bg-center bg-no-repeat [text-shadow:0_1px_3px_#000]'

/** Feed stage frame: black well with machined bevel (was .image-stage/.grid-board). */
export const STAGE_FRAME =
  'overflow-hidden rounded-xl border border-[#05070a] bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_0_4px_#161b23,0_8px_22px_rgba(0,0,0,0.55)] select-none'

/** HP bar track + fill (was .hp-bar / .hp-fill). */
export const HP_BAR =
  'h-3 overflow-hidden rounded-full border border-white/10 bg-black shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]'
export const HP_FILL =
  'h-full rounded-full bg-[#ff2d78] shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] transition-[width] duration-[120ms] ease-linear'
export const HP_FILL_LOW =
  'bg-[#ffb02e] animate-[gg-hp-low_0.7s_ease-in-out_infinite]'

/** Floating +GP popup (was .float-gc). Centering rides on `transform` so the
    keyframes (which animate the independent `translate` property) stack. */
export const FLOAT_GC =
  'pointer-events-none absolute z-[2] animate-[gg-float-up_0.9s_ease-out_forwards] text-lg font-bold text-[#3fd68c] [text-shadow:0_2px_4px_rgba(0,0,0,0.8)] [transform:translate(-50%,-50%)]'
export const FLOAT_GC_CRIT = 'text-[28px] text-[#ffd75e]'

/** Full-bleed feed image (was .goon-image). */
export const GOON_IMAGE = 'block h-full w-full object-contain [content-visibility:auto]'

/** Rarity badge palette (was .rarity-*). */
export const RARITY: Record<string, string> = {
  common: 'text-[#b8b8c4]',
  copper: 'text-[#e08a4c] border-[rgba(224,138,76,0.5)]',
  silver: 'text-[#cfd6e6] border-[rgba(207,214,230,0.5)]',
  gold: 'text-[#ffd75e] border-[rgba(255,215,94,0.5)]',
  diamond:
    'text-[#5ee0ff] border-[rgba(94,224,255,0.6)] [text-shadow:0_0_10px_rgba(94,224,255,0.6)]',
}
