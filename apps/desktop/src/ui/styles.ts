/**
 * Shared Tailwind class recipes for the idle-game UI (was goongrid.css).
 *
 * Every common recipe now drinks from `ui/tokens.ts` — the single source of
 * design names behind `globals.css` @theme. Re-exporting the token module here
 * keeps older `ui/styles` imports working while new surfaces can import tokens
 * directly. Literal pink remains ONLY where it is game semantics: HP fill,
 * crit flash, +pts float, cap-active glow, rarity badges (see HP_FILL /
 * FLOAT_GC / RARITY); the token guard allowlists those, not the shell chrome.
 */
import {
  BUTTON_CONTRACT,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  classes,
  COLOR,
  GAP,
  RADIUS,
  RECIPE,
  SHADOW,
  SURFACE_TONE,
  TYPE,
} from './tokens'

export * from './tokens'

/** Small uppercase-muted helper text (was .muted). */
export const MUTED = RECIPE.muted

/** Panel surface — unified solid-panel glass card. */
export const PLATE = RECIPE.plate

/** Scrollable panel body. */
export const PANEL = RECIPE.panel

/** Contract button: flat glass fill, 1px border, press = 0.98 scale. */
export const BTN = classes(
  BUTTON_CONTRACT,
  'border',
  COLOR.edge,
  COLOR.glassW8,
  COLOR.hoverW12,
  COLOR.fg,
  BUTTON_SIZE.md,
)

export const BTN_SMALL = BUTTON_SIZE.sm

/** Primary action — the one blue accent, ink label. No glow.
 *  The text colour is marked important on purpose: it is the one property
 *  here that BTN also sets, and Tailwind emits `text-retro-fg` AFTER
 *  `text-retro-accent-text`, so without the bang the ink label loses to
 *  BTN's white one and the button renders white-on-white. */
export const BTN_PRIMARY = BUTTON_VARIANT.primary

/** Feed stage frame: canvas well with hairline border. */
export const STAGE_FRAME = RECIPE.stageFrame

/** HP bar track. Modern precision gauge. */
export const HP_BAR = RECIPE.hpBar

/** ── Game semantics. These are NOT design tokens and stay literal. ─────── */
export const HP_FILL =
  'h-full rounded-full bg-pink-500 transition-[width] duration-[120ms] ease-linear'
export const HP_FILL_LOW =
  'bg-amber-500 animate-[gg-hp-low_0.7s_ease-in-out_infinite]'
export const FLOAT_GC =
  'pointer-events-none absolute z-[10] animate-[gg-float-up_0.9s_ease-out_forwards] text-sm font-bold text-success-fg font-mono drop- [transform:translate(-50%,-50%)]'
export const FLOAT_GC_CRIT = 'text-xl text-warning-fg font-black drop-'

/** Full-bleed feed image (was .goon-image). */
export const GOON_IMAGE = RECIPE.goonImage

/** Card tone alias kept for callers that used the styles module. */
export const CARD_TONE = SURFACE_TONE

/** Glow-free tab strip, composed from the same tokens as the kit Tabs. */
export const TAB_LIST = RECIPE.tabList
export const TAB = RECIPE.tab
export const TAB_ACTIVE = RECIPE.tabActive
export const TAB_IDLE = RECIPE.tabIdle

/** Chip gap used by the drop tray and inline meta rows. */
export const CHIP_GAP = GAP[1]
export const RADIUS_CHIP = RADIUS.chip
export const SHADOW_INSET = SHADOW.inset
export const TEXT_BODY = TYPE.body
