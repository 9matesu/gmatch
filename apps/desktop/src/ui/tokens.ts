/**
 * gmatch common UI tokens — the SINGLE source every common surface imports.
 *
 * A token here is a NAME: a Tailwind utility or a CSS custom property. The raw
 * value behind it lives only in `globals.css` (`@theme`), so the dark/light
 * theme and the panel/blur sliders keep one owner. Nothing in this module
 * re-inlines a hex, an rgb() literal, a type palette or a raw length — the
 * guard (`scripts/check-ui-tokens.mjs`) enforces that across src.
 *
 * We reuse the shell's retro-glass roles verbatim: bg-retro-*, text-retro-*,
 * border-edge, glass-*, accent-*, rarity-*, surface-*. Game semantics (HP
 * fill, crit flash, +pts float, card accent) are deliberately NOT design
 * tokens: they stay literal in `styles.ts` and are allowlisted by the guard.
 */

/** Join class fragments, dropping falsy slots. Conditional recipes use this
 *  instead of string concatenation so a disabled slot cannot emit `undefined`. */
export function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export const cx = classes

// ─── Spacing ────────────────────────────────────────────────────────────────
/** The CSS scale (`--space-*`, globals.css) for inline styles/animation math. */
export const SPACE_VAR = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  8: 'var(--space-8)',
  10: 'var(--space-10)',
  12: 'var(--space-12)',
} as const
export type SpaceStep = keyof typeof SPACE_VAR
/** Utility classes are written out in full (not interpolated) so Tailwind's
 *  source scanner can see every class it must generate. */
export const PADDING = {
  0: 'p-0',
  0.5: 'p-0.5',
  1: 'p-1',
  2: 'p-2',
  3: 'p-3',
  3.5: 'p-3.5',
  4: 'p-4',
  5: 'p-5',
  6: 'p-6',
  8: 'p-8',
  10: 'p-10',
  12: 'p-12',
} as const
export const PADDING_SM = { 3: 'sm:p-3', 4: 'sm:p-4', 6: 'sm:p-6' } as const
export const PADDING_X = { 0: 'px-0', 1: 'px-1', 1.5: 'px-1.5', 2: 'px-2', 3: 'px-3', 4: 'px-4', 5: 'px-5', 6: 'px-6' } as const
export const PADDING_Y = { 0: 'py-0', 1: 'py-1', 1.5: 'py-1.5', 2: 'py-2', 3: 'py-3', 4: 'py-4' } as const
export const GAP = { 0: 'gap-0', 1: 'gap-1', 1.5: 'gap-1.5', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5' } as const
export type PaddingStep = keyof typeof PADDING
export function spaceVar(step: SpaceStep): string {
  return SPACE_VAR[step]
}

// ─── Layout ────────────────────────────────────────────────────────────────
/** Container widths and the one sheet geometry, from globals.css. The feed
 *  grid shipping default is 2 columns (docs/SPEC.md §1.6.8). */
export const LAYOUT = {
  content: 'max-w-[var(--layout-content)]',
  sheet: 'w-[var(--layout-sheet)] max-w-[var(--layout-sheet-max)]',
  feedGrid: 'grid grid-cols-2',
  feedGridSingle: 'grid grid-cols-1',
  full: 'w-full',
  center: 'mx-auto',
} as const
export const DIALOG_WIDTH = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
} as const
export type DialogWidth = keyof typeof DIALOG_WIDTH
/** Surface tones: ONE panel, or the raised glass step. */
export const SURFACE_TONE = {
  surface: 'solid-panel',
  raised: 'bg-glass-w12 border border-edge',
} as const
export type CardTone = keyof typeof SURFACE_TONE

// ─── Radius ────────────────────────────────────────────────────────────────
/** Four steps (docs/DESIGN.md): chips, controls, panels, pills. */
export const RADIUS = {
  chip: 'rounded-md',
  control: 'rounded-lg',
  panel: 'rounded-xl',
  pill: 'rounded-full',
} as const

// ─── Shadow ────────────────────────────────────────────────────────────────
/** The existing elevation ramps, promoted to @theme tokens in globals.css.
 *  No new shadow value: each one is copied from a shell material. */
export const SHADOW = {
  panel: 'shadow-panel',
  panelStrong: 'shadow-panel-strong',
  toolbar: 'shadow-toolbar',
  surface: 'shadow-surface',
  control: 'shadow-control',
  inset: 'shadow-inner',
  modal: 'shadow-xl',
  sheet: 'shadow-2xl',
  none: 'shadow-none',
} as const

// ─── Type ──────────────────────────────────────────────────────────────────
/** Six steps (docs/DESIGN.md, floor 10px). `font-mono` resolves to the sans
 *  face; MONO only buys tabular alignment. */
export const TYPE = {
  caption: 'text-2xs',
  body: 'text-xs',
  base: 'text-base',
  field: 'text-field',
  sub: 'text-sm',
  title: 'text-lg',
  display: 'text-xl',
} as const
export const WEIGHT = {
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  heading: 'font-black',
} as const
export const MONO = 'font-mono tabular-nums'
export const ICON = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4' } as const
export const TRACKING = { tight: 'tracking-tight', wide: 'tracking-wide' } as const
export const TRANSITION = { micro: 'transition-colors duration-150', enter: 'transition duration-300' } as const

// ─── Colour roles ──────────────────────────────────────────────────────────
/** One accent, one surface family, one text hierarchy. Status roles carry
 *  tints; their -fg value is what text wears, and both flip with the theme. */
export const COLOR = {
  canvas: 'bg-retro-bg',
  canvasSurface: 'bg-surface-canvas',
  panel: 'solid-panel',
  panelGlass: 'bg-[var(--color-glass)]',
  edge: 'border-edge',
  edgeSubtle: 'border-edge-subtle',
  edgeStrong: 'border-edge-strong',
  glassW5: 'bg-glass-w5',
  glassW8: 'bg-glass-w8',
  glassW12: 'bg-glass-w12',
  hoverW8: 'hover:bg-glass-w8',
  hoverW12: 'hover:bg-glass-w12',
  accent: 'text-retro-accent',
  accentBg: 'bg-retro-accent',
  accentHover: 'hover:bg-retro-accent-hover',
  onAccent: 'text-retro-accent-text',
  fg: 'text-retro-fg',
  body: 'text-retro-body',
  muted: 'text-retro-muted',
  faint: 'text-retro-faint',
  scrim: 'bg-black/60',
} as const
export const STATUS = {
  danger: 'text-retro-error',
  dangerBg: 'bg-retro-error/15',
  dangerEdge: 'border-retro-error/40',
  dangerHover: 'hover:bg-retro-error/25',
  warning: 'text-retro-warning',
  success: 'text-success-fg',
  info: 'text-info-fg',
} as const
/** Rarity is game semantics, but the TEXT colours are card chrome read in
 *  both themes — one named token per tier keeps that ladder readable. */
export const RARITY = {
  common: 'text-rarity-common',
  copper: 'text-rarity-copper border-rarity-copper/50',
  silver: 'text-rarity-silver border-rarity-silver/50',
  gold: 'text-rarity-gold border-rarity-gold/50',
  diamond: 'text-rarity-diamond border-rarity-diamond/60',
} as const satisfies Record<string, string>
export type RarityTier = keyof typeof RARITY

// ─── Button ────────────────────────────────────────────────────────────────
/** Press feedback and the one disabled contract are shared by every button
 *  recipe — the kit component and the legacy BTN class cannot drift. */
export const BUTTON_FEEDBACK = classes(
  'cursor-pointer select-none',
  TRANSITION.micro,
  'active:scale-(--scale-press)',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
)
/** The legacy BTN recipe (no inline flex) and the kit's <Button> base share
 *  one press/disabled contract; only the layout wrapper differs. */
export const BUTTON_CONTRACT = classes(RADIUS.control, TYPE.body, WEIGHT.semibold, BUTTON_FEEDBACK)
export const BUTTON_BASE = classes(
  'inline-flex items-center justify-center',
  GAP[1.5],
  BUTTON_CONTRACT,
)
export const BUTTON_VARIANT = {
  primary: classes(COLOR.accentBg, COLOR.onAccent, COLOR.accentHover, 'border border-transparent', WEIGHT.bold),
  secondary: classes('border', COLOR.edge, COLOR.glassW8, COLOR.hoverW12, COLOR.fg),
  danger: classes(STATUS.dangerBg, STATUS.dangerEdge, STATUS.danger, STATUS.dangerHover, 'border'),
  ghost: classes(COLOR.muted, 'hover:text-retro-fg border border-transparent', COLOR.hoverW8),
} as const satisfies Record<string, string>
export type ButtonVariant = keyof typeof BUTTON_VARIANT
export const BUTTON_SIZE = { sm: 'px-2.5 py-1', md: 'px-3.5 py-2' } as const satisfies Record<string, string>
export type ButtonSize = keyof typeof BUTTON_SIZE
export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return classes(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra)
}

// ─── Wordmark ──────────────────────────────────────────────────────────────
/** Typographic wordmark: the brand name is text, never a baked raster. The
 *  mark takes the one accent role; the name takes the top of the type scale. */
export const WORDMARK = {
  root: classes('inline-flex items-baseline', GAP[1]),
  mark: classes(COLOR.accent, WEIGHT.heading, TYPE.title),
  name: classes(COLOR.fg, WEIGHT.heading, TRACKING.tight, TYPE.title),
} as const

// ─── Class recipes ─────────────────────────────────────────────────────────
/** One recipe per repeated surface shape; surfaces compose these, they do not
 *  re-inline the same utility list. */
export const RECIPE = {
  muted: classes(TYPE.caption, COLOR.muted),
  plate: classes(RADIUS.control, 'border', COLOR.edge, COLOR.panel),
  panel: classes('min-h-0 overflow-y-auto', PADDING[3.5], PADDING_SM[4]),
  stageFrame: classes(
    'overflow-hidden select-none',
    RADIUS.control,
    'border', COLOR.edge,
    'bg-surface-canvas/60 backdrop-blur-md',
    SHADOW.modal,
  ),
  hpBar: classes('h-1.5 overflow-hidden rounded-full border', COLOR.edge, 'bg-surface-canvas/80', SHADOW.inset),
  goonImage: 'block h-full w-full object-contain',
  spinner: 'w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin',
  glassChip: classes(RADIUS.chip, COLOR.glassW8),
  modalOverlay: classes(
    'fixed inset-0 z-[var(--z-modal)] flex items-center justify-center',
    PADDING[4],
    'pb-[calc(1rem+var(--island-clearance))]',
    COLOR.scrim,
    'animate-orbit-fade-in',
  ),
  modalDialog: classes(LAYOUT.full, 'max-h-full overflow-y-auto styled-scrollbar glass-panel', SHADOW.modal, 'animate-orbit-pop'),
  modalHeader: classes('flex items-center justify-between', GAP[2], PADDING_X[4], 'py-2.5 border-b', COLOR.edge),
  modalBody: classes(PADDING[4], 'space-y-3'),
  dialogTitle: classes(TYPE.base, WEIGHT.heading, TRACKING.tight, COLOR.fg, 'truncate'),
  sheetOverlay: 'flex justify-end pointer-events-none',
  sheetPanel: classes(
    'pointer-events-auto shrink-0',
    'h-[calc(100%-4.5rem)]', COLOR.panelGlass, 'backdrop-blur-xl border-l', COLOR.edge,
    SHADOW.sheet, 'flex flex-col animate-orbit-slide-left',
  ),
  sheetHeader: classes('flex items-center justify-between shrink-0', GAP[2], PADDING_X[4], 'py-2.5 border-b', COLOR.edge),
  sheetBody: classes('flex-1 overflow-y-auto styled-scrollbar', PADDING[4], 'space-y-3'),
  card: classes(RADIUS.control, 'border', COLOR.edge),
  cardHeader: classes('flex items-center justify-between', GAP[2], PADDING_X[4], 'py-3', COLOR.glassW8, 'border-b', COLOR.edge),
  tabList: classes('flex', COLOR.glassW5, PADDING[0.5], RADIUS.control, 'border', COLOR.edge),
  tab: classes('flex-1 py-1.5 px-2', RADIUS.chip, TYPE.body, WEIGHT.semibold, 'cursor-pointer', TRANSITION.micro),
  tabActive: classes(COLOR.glassW12, COLOR.fg),
  tabIdle: classes(COLOR.muted, 'hover:text-retro-fg'),
  pageHeader: classes('flex items-start justify-between', GAP[3]),
  pageTitle: classes(TYPE.title, 'sm:text-xl', WEIGHT.semibold, TRACKING.tight, COLOR.fg, 'truncate'),
  pageMeta: classes(TYPE.caption, COLOR.muted, 'mt-0.5 truncate'),
  title: classes(TYPE.sub, WEIGHT.semibold, COLOR.fg),
  caption: classes(TYPE.body, COLOR.muted),
} as const
