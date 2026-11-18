/**
 * Shared Tailwind class recipes for the idle-game UI (was goongrid.css).
 * All chrome now speaks the Orbit shell design system: shell tokens
 * (bg-retro-panel/bg-retro-bg, text-retro-fg, text-retro-muted,
 * border-edge) plus the shell's own .glass-button / .glass-tab /
 * .accent-control classes from globals.css. Literal pink remains ONLY where
 * it is game semantics: HP fill, crit flash, +pts float, cap-active glow,
 * rarity badges (see HP_FILL / FLOAT_GC / RARITY below).
 */

/** Tabular figures for every number readout. Mono was retired 2026-10-17 (user
 * directive): the theme token resolves to the sans stack, so this class only
 * buys the digit alignment. See docs/DESIGN.md "Type scale". */
export const MONO = 'font-mono tabular-nums'

/** Small uppercase-muted helper text (was .muted). */
export const MUTED = 'text-xs text-retro-muted'

/** Display face for headings/labels — the shell's sans (Outfit). */
export const DISPLAY = 'font-sans'

/** Panel surface — unified solid-panel glass card. */
export const PLATE = 'rounded-lg border border-edge solid-panel'

/** Scrollable panel body. */
export const PANEL = 'min-h-0 overflow-y-auto p-3.5 sm:p-4'

/** Contract button: flat glass fill, 1px border, press = 0.98 scale. */
export const BTN =
  'cursor-pointer rounded-lg border border-edge bg-glass-w8 hover:bg-glass-w12 active:scale-(--scale-press) px-3.5 py-2 text-xs font-semibold text-retro-fg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100'

export const BTN_SMALL = 'rounded-lg px-2.5 py-1 text-xs'

/** Primary action — the one blue accent, ink label. No glow.
 *  The text colour is marked important on purpose: it is the one property
 *  here that BTN also sets, and Tailwind emits `text-retro-fg` AFTER
 *  `text-retro-accent-text`, so without the bang the ink label loses to
 *  BTN's white one and the button renders white-on-white. */
export const BTN_PRIMARY =
  'bg-retro-accent text-retro-accent-text! hover:bg-retro-accent-hover border-transparent font-bold'

/** Destructive prestige action. */
export const BTN_DANGER =
  'bg-retro-error/15 border-retro-error/40 text-retro-error hover:bg-retro-error/25'

/** Bundled skin behind an inline backgroundImage. */
export const SKIN =
  'bg-cover bg-center bg-no-repeat [text-shadow:0_1px_3px_#000]'

/** Feed stage frame: canvas well with hairline border. */
export const STAGE_FRAME =
  'overflow-hidden rounded-lg border border-edge bg-surface-canvas/60 backdrop-blur-md shadow-xl select-none'

/** HP bar track + fill. Modern precision gauge. */
export const HP_BAR =
  'h-1.5 overflow-hidden rounded-full border border-edge bg-surface-canvas/80 shadow-inner'
export const HP_FILL =
  'h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 transition-[width] duration-[120ms] ease-linear'
export const HP_FILL_LOW =
  'from-amber-500 to-orange-500 animate-[gg-hp-low_0.7s_ease-in-out_infinite]'

/** Floating +GP popup. Refined tabular figures with clean drop shadow. */
export const FLOAT_GC =
  'pointer-events-none absolute z-[10] animate-[gg-float-up_0.9s_ease-out_forwards] text-sm font-bold text-success-fg font-mono drop- [transform:translate(-50%,-50%)]'
export const FLOAT_GC_CRIT = 'text-xl text-warning-fg font-black drop-'

/** Full-bleed feed image (was .goon-image). */
export const GOON_IMAGE = 'block h-full w-full object-contain'

/** Rarity badge palette (was .rarity-*): game semantics, but these are TEXT
 *  colours on a card, so one token per tier keeps them readable in both
 *  themes (a light grey label on a white card was a 1.4:1 rumour). The
 *  diamond glow went with the rest of the shadows (flat UI). */
export const RARITY: Record<string, string> = {
  common: 'text-rarity-common',
  copper: 'text-rarity-copper border-rarity-copper/50',
  silver: 'text-rarity-silver border-rarity-silver/50',
  gold: 'text-rarity-gold border-rarity-gold/50',
  diamond: 'text-rarity-diamond border-rarity-diamond/60',
}
