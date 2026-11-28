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
  1.5: 'p-1.5',
  2: 'p-2',
  2.5: 'p-2.5',
  3: 'p-3',
  3.5: 'p-3.5',
  4: 'p-4',
  5: 'p-5',
  6: 'p-6',
  8: 'p-8',
  10: 'p-10',
  12: 'p-12',
} as const
export const PADDING_SM = { 1.5: 'sm:p-1.5', 3: 'sm:p-3', 4: 'sm:p-4', 6: 'sm:p-6' } as const
export const PADDING_MD = { 6: 'md:p-6' } as const
export const PADDING_X = { 0: 'px-0', 1: 'px-1', 1.5: 'px-1.5', 2: 'px-2', 2.5: 'px-2.5', 3: 'px-3', 4: 'px-4', 5: 'px-5', 6: 'px-6' } as const
export const PADDING_X_SM = { 4: 'sm:px-4' } as const
export const PADDING_X_MD = { 6: 'md:px-6' } as const
export const PADDING_Y = { 0: 'py-0', 1: 'py-1', 1.5: 'py-1.5', 2: 'py-2', 2.5: 'py-2.5', 3: 'py-3', 4: 'py-4' } as const
export const GAP = { 0: 'gap-0', 0.5: 'gap-0.5', 1: 'gap-1', 1.5: 'gap-1.5', 2: 'gap-2', 2.5: 'gap-2.5', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5' } as const
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
  xs: 'shadow-xs',
  sm: 'shadow-sm',
  inset: 'shadow-inner',
  modal: 'shadow-xl',
  sheet: 'shadow-2xl',
  large: 'shadow-lg',
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
  /** Hero wordmark: the one step above `display`, shared with the boot splash. */
  brand: 'text-brand',
} as const
export const WEIGHT = {
  regular: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  heading: 'font-black',
} as const
export const MONO = 'font-mono tabular-nums'
export const ICON = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-6 h-6' } as const
export const TRACKING = {
  tight: 'tracking-tight',
  tighter: 'tracking-tighter',
  wide: 'tracking-wide',
  wider: 'tracking-wider',
} as const

// ─── Motion ─────────────────────────────────────────────────────────────────
/**
 * The ONE motion preset for shell chrome. Durations and easings are names; the
 * values live in `globals.css` @theme (`--motion-*`) and the `orbit-*` keyframes
 * read the same variables, so a timing change lands in one place. Loops
 * (spin/pulse/ping) keep their user-agent timing; game semantics (HP fill, crit
 * flash, +pts float, card tick) keep their own literals in `styles.ts`/callers.
 */
export const MOTION = {
  duration: {
    micro: 'duration-(--motion-duration-micro)',
    fade: 'duration-(--motion-duration-fade)',
    enter: 'duration-(--motion-duration-enter)',
    dramatic: 'duration-(--motion-duration-dramatic)',
  },
  ease: {
    fade: 'ease-(--motion-ease-fade)',
    enter: 'ease-(--motion-ease-enter)',
    exit: 'ease-(--motion-ease-exit)',
  },
  transition: {
    /** Hover/press/state colour change on chrome. */
    micro: classes('transition-colors', 'duration-(--motion-duration-micro)', 'ease-(--motion-ease-fade)'),
    /** Any-property micro change (tiles, chips, compact controls). */
    quick: classes('transition', 'duration-(--motion-duration-micro)', 'ease-(--motion-ease-fade)'),
    /** Opacity in/out — overlay fades and content reveals. */
    fade: classes('transition-opacity', 'duration-(--motion-duration-fade)', 'ease-(--motion-ease-fade)'),
    fadeQuick: classes('transition-opacity', 'duration-(--motion-duration-micro)', 'ease-(--motion-ease-fade)'),
    /** Panel/sheet entrance or exit. */
    enter: classes('transition', 'duration-(--motion-duration-enter)', 'ease-(--motion-ease-enter)'),
    /** Transform-only hover/press (never a hover-bump on nav pills). */
    transform: classes('transition-transform', 'duration-(--motion-duration-micro)', 'ease-(--motion-ease-enter)'),
    /** Deterministic progress/width chrome (e.g. an install progress bar). */
    width: classes('transition-[width]', 'duration-(--motion-duration-enter)', 'ease-(--motion-ease-fade)'),
  },
  /** The house keyframes only. Each class's timing comes from the preset above
   *  via globals.css; surfaces never re-time an animation at the call site. */
  keyframe: {
    fadeIn: 'animate-orbit-fade-in',
    slideUp: 'animate-orbit-slide-up',
    pop: 'animate-orbit-pop',
    slideLeft: 'animate-orbit-slide-left',
    feedIn: 'animate-orbit-feed-in',
    tierFlash: 'animate-orbit-tier-flash',
  },
} as const
/** Kept for call sites that already import TRANSITION; both names now point at
 *  the single preset, so no recipe can re-inline a duration. */
export const TRANSITION = { micro: MOTION.transition.micro, enter: MOTION.transition.enter } as const

// ─── Colour roles ──────────────────────────────────────────────────────────
/** One accent, one surface family, one text hierarchy. Status roles carry
 *  tints; their -fg value is what text wears, and both flip with the theme. */
export const COLOR = {
  canvas: 'bg-retro-bg',
  canvasVeil: 'bg-retro-bg/95',
  canvasSurface: 'bg-surface-canvas',
  /** The quiet fill behind an inline status strip (media / sync feedback). */
  canvasSurfaceSoft: 'bg-surface-canvas/40',
  panel: 'solid-panel',
  panelGlass: 'bg-[var(--color-glass)]',
  edge: 'border-edge',
  edgeSubtle: 'border-edge-subtle',
  edgeStrong: 'border-edge-strong',
  glassW5: 'bg-glass-w5',
  glassW8: 'bg-glass-w8',
  glassW12: 'bg-glass-w12',
  glassW20: 'bg-glass-w20',
  hoverW8: 'hover:bg-glass-w8',
  hoverW12: 'hover:bg-glass-w12',
  accent: 'text-retro-accent',
  accentBg: 'bg-retro-accent',
  accentHover: 'hover:bg-retro-accent-hover',
  hoverAccent: 'hover:text-retro-accent',
  onAccent: 'text-retro-accent-text',
  fg: 'text-retro-fg',
  fgSoft: 'text-retro-fg/90',
  body: 'text-retro-body',
  muted: 'text-retro-muted',
  faint: 'text-retro-faint',
  scrim: 'bg-black/60',
  /** Softer scrim for the left notification rail (chrome, not a dialog). */
  scrimSoft: 'bg-black/40',
  scrimFaint: 'bg-black/30',
  scrimHover: 'hover:bg-black/80',
  /** The shell's raised plate: same `--color-glass` as `solid-panel`, without
   *  its shadow. Named so a tile never re-types `bg-surface-raised`. */
  surfaceRaised: 'bg-surface-raised',
  interactive: 'bg-surface-interactive',
  interactiveSoft: 'bg-surface-interactive/60',
  interactiveStrong: 'bg-surface-interactive/90',
  /** Selected-row fill for dense admin lists. */
  selectionBg: 'bg-retro-selection',
  /** Chrome hover roles — one each, so call sites stop re-typing them. */
  hoverFg: 'hover:text-retro-fg',
  hoverBody: 'hover:text-retro-body',
  hoverEdgeStrong: 'hover:border-edge-strong',
  accentEdge: 'border-retro-accent',
  hoverW5: 'hover:bg-glass-w5',
  hoverW10: 'hover:bg-glass-w10',
  hoverW12Soft: 'hover:bg-glass-w12/80',
  focusRing: 'focus-visible:ring-retro-accent',
  focusAccent: 'focus:border-retro-accent/60',
  /** Label ON media (image/video scrim): the only white text in the shell. */
  onMedia: 'text-white',
  /** Icon fill that accompanies `onMedia` (play glyph over a poster). */
  onMediaFill: 'fill-white',
  /** Hover veil on media tiles — on the picture, never on a dialog root. */
  mediaVeil: 'bg-black/50',
} as const
export const STATUS = {
  danger: 'text-retro-error',
  dangerBg: 'bg-retro-error/15',
  dangerEdge: 'border-retro-error/40',
  dangerHover: 'hover:bg-retro-error/25',
  warning: 'text-retro-warning',
  success: 'text-success-fg',
  info: 'text-info-fg',
  infoBg: 'bg-info/20',
  infoEdge: 'border-info/40',
  infoHover: 'hover:bg-info/30',
  warningBg: 'bg-warning/10',
  warningEdge: 'border-warning/30',
  warningEdgeSoft: 'border-warning/20',
  warningSoft: 'text-warning/90',
  warningDot: 'bg-warning/90',
  warningHoverSoft: 'hover:bg-warning/20',
  dangerSoft: 'text-retro-error/80',
  dangerFg: 'text-danger-fg',
  dangerHoverBg: 'hover:bg-retro-error/10',
  dangerTintHover: 'hover:bg-danger/20',
  dangerHoverHard: 'hover:bg-danger',
  dangerFgHover: 'hover:text-danger-fg',
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
  /** Text-only accent action ("Done", "Change photo", "Add"): no fill, one
   *  accent label. The old call sites re-typed this colour inline. */
  link: classes(COLOR.accent, 'hover:text-retro-accent-hover border border-transparent', COLOR.hoverW8, WEIGHT.semibold),
  /** The one informational action tint (validate / add-cards), kept as a
   *  named variant instead of a per-call `bg-info/20 text-info-fg`. */
  info: classes('border', STATUS.infoEdge, STATUS.infoBg, STATUS.infoHover, STATUS.info, WEIGHT.semibold),
} as const satisfies Record<string, string>
export type ButtonVariant = keyof typeof BUTTON_VARIANT
export const BUTTON_SIZE = { sm: 'px-2.5 py-1', md: 'px-3.5 py-2' } as const satisfies Record<string, string>
export type ButtonSize = keyof typeof BUTTON_SIZE
export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return classes(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra)
}

// ─── Fields ────────────────────────────────────────────────────────────────
/** ONE text-field recipe for `<input>`, `<textarea>` and `<select>`: the same
 *  canvas fill, hairline edge, radius, body type and single accent focus border.
 *  Callers pass only layout (`w-full`, `flex-1`) via the kit's `className`;
 *  there is no per-call `focus:border-retro-accent/50` or glass-tier choice. */
export const FIELD = {
  base: classes(
    RADIUS.control, 'border', COLOR.edge, 'bg-surface-canvas',
    TYPE.body, COLOR.fg, 'placeholder:text-retro-muted',
    'focus:outline-none focus:border-retro-accent', TRANSITION.micro,
  ),
  input: classes('w-full px-3 py-2'),
  textarea: classes('w-full p-3 resize-none'),
  select: classes('px-2.5 py-1.5 cursor-pointer'),
  /** Transparent, borderless field embedded in an already-shelled control. */
  bare: classes('w-full bg-transparent border-none focus:outline-none', COLOR.fg, 'placeholder:text-retro-muted'),
  /** The bordered wrapper around a `bare` field with a leading icon. */
  shell: classes(RADIUS.control, 'border', COLOR.edge, 'bg-surface-canvas', PADDING_X[3], PADDING_Y[2]),
  /** Compact search shell — the chat-player-search single-line height contract. */
  compactShell: classes(RADIUS.control, 'border', COLOR.edge, 'bg-surface-canvas', PADDING_X[3], PADDING_Y[1.5]),
  /** Checkboxes/radios: one accent and one disabled contract, no bespoke fills. */
  check: 'w-4 h-4 accent-retro-accent cursor-pointer disabled:opacity-30',
} as const
export type FieldTone = keyof Pick<typeof FIELD, 'base' | 'bare'>

// ─── Logo / wordmark ───────────────────────────────────────────────────────
/**
 * ONE brand lockup: the shipped icon (favicon, PWA icon, boot splash) as the
 * mark plus the name as live text — no baked raster wordmark, no new face or
 * colour. Mark size, gap, clear-space and the minimum size are names whose
 * values live in `globals.css` @theme, so the header, the splash and onboarding
 * cannot drift apart. Call sites render `<Brand>`; they never rebuild the lockup.
 */
export const LOGO = {
  /** The one brand mark asset: the shipped 512px icon.png, same bytes as the
   *  favicon, the PWA icons and the pre-bundle splash (font-independent raster,
   *  so no SVG text can reflow between the splash and the mounted lockup). */
  markSrc: '/icon.png',
  /** Mark + wordmark on one axis, with the one gap and a floor width. */
  lockup: classes('inline-flex items-center', 'gap-(--logo-gap)', 'min-w-(--logo-min-width)'),
  /** Clear-space belongs to the lockup, not to the layout around it. */
  clearSpace: 'p-(--logo-clear-space)',
  /** The mark; its min-size keeps it legible when a tight header shrinks it. */
  mark: classes('block shrink-0', 'h-(--logo-mark-size) w-(--logo-mark-size)', 'min-w-(--logo-mark-min-size)'),
  /** Compact mark for the 36px title bar. */
  markCompact: classes('block shrink-0', 'h-(--logo-mark-size-sm) w-(--logo-mark-size-sm)', 'min-w-(--logo-mark-min-size)'),
  /** Hero mark for the boot splash and onboarding (same asset, same lockup). */
  markHero: classes('block shrink-0', 'h-(--logo-mark-size-hero) w-(--logo-mark-size-hero)', 'min-w-(--logo-mark-min-size)'),
  /** Wordmark: top of the type scale, the existing type and fg roles. */
  wordmark: classes(WEIGHT.heading, TRACKING.tight, COLOR.fg, TYPE.title),
  /** Hero wordmark for onboarding/boot: same face and fg, one type step up. */
  wordmarkHero: classes(WEIGHT.heading, TRACKING.tight, COLOR.fg, TYPE.brand),
  /** Compact wordmark: same face/role, the field step for a slim title bar. */
  wordmarkCompact: classes(WEIGHT.heading, TRACKING.wide, COLOR.fg, TYPE.field),
} as const

/** Typographic wordmark: the brand name is text, never a baked raster. The
 *  mark takes the one accent role; the name takes the top of the type scale. */
export const WORDMARK = {
  root: classes('inline-flex items-baseline', GAP[1]),
  mark: classes(COLOR.accent, WEIGHT.heading, TYPE.title),
  name: LOGO.wordmark,
  lockup: LOGO.lockup,
  clearSpace: LOGO.clearSpace,
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
    MOTION.keyframe.fadeIn,
  ),
  modalDialog: classes(LAYOUT.full, 'max-h-full overflow-y-auto styled-scrollbar glass-panel', SHADOW.modal, MOTION.keyframe.pop),
  modalHeader: classes('flex items-center justify-between', GAP[2], PADDING_X[4], 'py-2.5 border-b', COLOR.edge),
  modalBody: classes(PADDING[4], 'space-y-3'),
  dialogTitle: classes(TYPE.base, WEIGHT.heading, TRACKING.tight, COLOR.fg, 'truncate'),
  sheetOverlay: 'flex justify-end pointer-events-none',
  sheetPanel: classes(
    'pointer-events-auto shrink-0',
    'h-[calc(100%-4.5rem)]', COLOR.panelGlass, 'backdrop-blur-xl border-l', COLOR.edge,
    SHADOW.sheet, 'flex flex-col', MOTION.keyframe.slideLeft,
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

// ─── SURFACE + TYPOGRAPHY chrome ───────────────────────────────────────────
/**
 * The recurring card / header / badge / icon shapes. Every value is composed
 * from names above: no raw colour, size, radius or weight is re-inlined at a
 * call site. Both themes flip with the roles, and the retro-glass identity
 * (one hairline edge, one raised plate, one scrim) stays owned here.
 */
export const CHROME = {
  /** Raised tile: one hairline edge + the raised plate + card radius. */
  tile: classes(RECIPE.card, COLOR.surfaceRaised),
  /** Inset dropdown / popover floating over a tile. */
  popover: classes(RECIPE.card, COLOR.surfaceRaised, PADDING[3], SHADOW.modal),
  /** Icon-only control (close, search clear, ...). */
  iconButton: classes('p-1.5 cursor-pointer', RADIUS.chip, COLOR.muted, COLOR.hoverFg, COLOR.hoverW10, TRANSITION.micro),
  /** Small label that sits ON media — the one white text in the shell. */
  mediaChip: classes(RADIUS.chip, COLOR.scrim, COLOR.onMedia, TYPE.caption),
  /** Neutral metadata pill / count badge. */
  badge: classes(RADIUS.pill, COLOR.glassW8, COLOR.fg, TYPE.caption),
  /** Warning-tinted status pill. */
  warningPill: classes(RADIUS.pill, STATUS.warningEdge, STATUS.warningBg, STATUS.warning, TYPE.body, WEIGHT.medium),
  /** Section header label (card chrome / list title). */
  headerTitle: classes(TYPE.body, WEIGHT.bold, COLOR.fg),
  /** Danger text action (no fill): one role, one hover. */
  dangerLink: classes(WEIGHT.semibold, STATUS.danger, STATUS.dangerHoverBg, COLOR.hoverFg, 'cursor-pointer', TRANSITION.micro),
  /** Header strip shared by panels and the notification sidebar. */
  barHeader: classes('flex items-center justify-between shrink-0', GAP[2], PADDING_X[4], 'py-2.5 border-b', COLOR.edge),
  /** Panel / sidebar body that scrolls. */
  scrollBody: classes('flex-1 overflow-y-auto styled-scrollbar', PADDING[4]),
  /** Muted caption under a title. */
  subCaption: classes(TYPE.body, COLOR.muted),
  /** Monospaced metadata line. */
  metaMono: classes(MONO, TYPE.caption, COLOR.muted),
  /** Modal plate for surfaces that own a custom z-layer or a bespoke body. */
  overlayPanel: classes(COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.panel, SHADOW.modal),
  /** Compact dashboard/stat tile: one hairline, one plate, one padding step. */
  statTile: classes(RECIPE.card, COLOR.panel, PADDING[3.5]),
  /** Dense list row inside a panel. */
  rowTile: classes(RECIPE.card, COLOR.interactiveSoft, PADDING_X[3], PADDING_Y[1.5]),
  /** Short uppercase section label above a list or grid. */
  sectionLabel: classes(TYPE.body, WEIGHT.bold, COLOR.fg, TRACKING.wide),
  /** ONE chip on a premium (HoloCard) card surface — rarity, value, state.
   *  It sits on art, so it uses the media scrim and the one on-media text role. */
  cardChip: classes(RADIUS.chip, COLOR.scrim, COLOR.onMedia, TYPE.caption, WEIGHT.semibold, PADDING_X[1.5], 'py-0.5', 'border', COLOR.edge),
  /** Footer plate under a premium card's art. */
  cardFooter: classes(PADDING[2], COLOR.canvasSurface, 'border-t', COLOR.edge, 'text-left'),
  cardFooterTitle: classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate'),
  cardFooterMeta: classes(TYPE.caption, MONO, COLOR.muted, 'truncate'),
} as const

/**
 * ONE premium TCG card object: a rarity-tinted metal frame, a foil layer, an
 * embossed title plate, an inset art window, a value row and a card back for a
 * row whose bytes are nowhere. The skin (bevels, lattice, foil) lives in
 * globals.css; these are the NAMES a card surface composes, so no call site
 * re-inlines a border, a gradient or a raw colour. The accent is runtime card
 * data passed as `--card-accent`, never a second palette here.
 */
export const TCG_CARD = {
  frame: classes('tcg-card', RADIUS.panel, 'select-none', 'overflow-hidden', SHADOW.panel),
  inner: classes('flex flex-col h-full', 'tcg-card-inner'),
  foil: 'tcg-foil',
  plate: classes('tcg-title-plate', 'flex items-center justify-between', GAP[2]),
  plateTitle: classes(TYPE.body, WEIGHT.bold, TRACKING.wide, COLOR.fg, 'uppercase truncate'),
  plateGem: 'tcg-title-gem shrink-0',
  artWindow: 'tcg-art-window',
  back: classes('tcg-card-back', 'absolute inset-0 flex items-center justify-center', COLOR.muted, TYPE.caption, MONO),
  backCore: 'tcg-card-back-core',
  statRow: classes('tcg-stat-row', 'flex items-baseline justify-between', GAP[2]),
  statLabel: classes(TYPE.caption, WEIGHT.semibold, TRACKING.wider, COLOR.muted, 'uppercase'),
  statValue: classes(TYPE.body, WEIGHT.bold, MONO, COLOR.fg, 'tabular-nums'),
  rarityChip: classes(
    'tcg-rarity-chip absolute top-2 left-2 z-20', RADIUS.chip, PADDING_X[1.5], 'py-0.5',
    TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider, 'border backdrop-blur-xs',
  ),
  footer: classes(CHROME.cardFooter, 'flex flex-col', GAP[1]),
} as const

/**
 * ONE message-bubble shape for every chat surface (DMs, rooms, groups, the
 * card-game match chat). Opaque fills, fully rounded, a subtle hover lift; the
 * shape and motion live here so no surface re-types them, and each surface adds
 * only its own padding/type step and one of the fills below.
 */
export const CHAT = {
  bubbleShape: classes(
    'rounded-2xl cursor-pointer select-text break-words whitespace-pre-wrap',
    'motion-safe:animate-orbit-fade-in',
    MOTION.transition.quick,
    'hover:brightness-110',
  ),
  fillOwn: classes('bg-retro-accent', COLOR.onAccent),
  fillOther: classes(COLOR.interactive, COLOR.body, 'border', COLOR.edge),
  fillDeleted: classes('bg-surface-canvas border border-dashed', COLOR.edge, COLOR.muted, 'italic'),
  /** Compact emoji reaction input strip shown under a bubble. */
  reactStrip: classes('flex items-center', GAP[0.5], 'mt-1'),
} as const

/**
 * Feedback states — empty / loading / error and the inline status strip.
 * ONE recipe per shape, built from the same type, surface and status roles as
 * every other common surface. Views use `center` (or `centerCompact` inside a
 * panel); rows use `strip`. Callers supply words, an icon and an action — never
 * a per-call colour, size, radius or weight.
 */
export const FEEDBACK = {
  center: classes('flex flex-col items-center justify-center text-center', GAP[2], PADDING[6]),
  centerCompact: classes('flex flex-col items-center justify-center text-center', GAP[1.5], PADDING[3]),
  /** One-line status strip: feed sync, media unavailable, list footers. */
  strip: classes(
    'w-full flex items-center', GAP[1.5], PADDING_X[3], PADDING_Y[2],
    TYPE.caption, MONO, COLOR.muted, COLOR.canvasSurfaceSoft,
  ),
  stripCenter: 'justify-center',
  stripStart: 'justify-start',
  icon: classes(ICON.lg, COLOR.faint, 'shrink-0'),
  spinner: classes(ICON.lg, COLOR.muted, 'animate-spin shrink-0'),
  spinnerSm: classes(ICON.sm, COLOR.muted, 'animate-spin shrink-0'),
  errorIcon: classes(ICON.lg, STATUS.danger, 'shrink-0'),
  errorIconSm: classes(ICON.sm, STATUS.danger, 'shrink-0'),
  title: classes(TYPE.body, WEIGHT.semibold, COLOR.fg),
  titleStrong: classes(TYPE.base, WEIGHT.heading, TRACKING.tight, COLOR.fg),
  titleDisplay: classes(TYPE.display, WEIGHT.heading, TRACKING.tighter, COLOR.fg),
  errorTitle: classes(TYPE.body, WEIGHT.semibold, STATUS.danger),
  description: classes(TYPE.body, COLOR.muted),
  descriptionTight: classes(TYPE.caption, COLOR.muted),
  meta: classes(MONO, TYPE.caption, COLOR.muted),
  /** A transient toast row inside the unified notification centre. */
  toastRow: classes('flex items-start', GAP[2], PADDING_X[3], PADDING_Y[2]),
} as const

/** Peer-presence dot + text roles. A measured status is chrome, so the three
 *  states share one owner here instead of being re-typed per roster row. */
export const PRESENCE = {
  currentDot: 'bg-retro-online',
  connectingDot: 'bg-retro-warning',
  idleDot: 'bg-retro-muted/40',
  currentText: 'text-retro-online',
  connectingText: 'text-retro-warning',
  idleText: 'text-retro-muted',
} as const
