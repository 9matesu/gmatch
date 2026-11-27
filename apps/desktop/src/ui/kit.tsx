"use client";

/**
 * The UI kit — the FEW primitives every view composes (docs/UI-AUDIT.md).
 *
 * One Button, one Card surface, one Modal shell, one Tab bar, one Title.
 * Every class recipe comes from `ui/tokens.ts` (the single source behind the
 * globals.css @theme): surfaces speak the shell's own tokens — solid-panel,
 * glass-w8/w12, border-edge, retro accent — with one glass layer per surface
 * and the same scrim, radius, type and press feedback everywhere. Game
 * semantics (HP/rarity/crit) stay in ui/styles.ts, not in this kit.
 */
import {
  useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import {
  buttonClass,
  classes,
  COLOR,
  DIALOG_WIDTH,
  FEEDBACK,
  FIELD,
  GAP,
  ICON,
  LAYOUT,
  PADDING_X,
  RECIPE,
  SURFACE_TONE,
  TYPE,
  WEIGHT,
  type ButtonSize,
  type ButtonVariant,
  type CardTone,
} from './tokens'

export type { ButtonVariant, ButtonSize, CardTone } from './tokens'
/** The motion preset is part of the kit's public surface: surfaces consume
 *  MOTION (not a duration literal) when they need a shell transition. */
export { MOTION } from './tokens'

// ─── Overlay priority (one stack, one Escape owner) ─────────────────────────

interface OverlayEntry {
  id: number
  close: () => void
}

/**
 * Every overlay opts into ONE stack. Mount order IS priority: the newest layer
 * is painted above older ones and owns Escape, so a dialog opened on top of
 * another dialog is reachable and one Escape closes only that top layer. A
 * layer is removed on unmount, so nothing sticky is left to trap the pointer.
 *
 * The z-index is derived from the mount sequence as `calc(<base> + <n>)`: no
 * raw 3-digit literal, and the base stays the token owned by globals.css.
 */
const overlayStack: OverlayEntry[] = []
let overlaySeq = 0
let escapeOwnerInstalled = false

function handleOverlayEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const top = overlayStack[overlayStack.length - 1]
  if (!top) return
  // Capture phase + stopPropagation: the event never reaches the lower layers'
  // own handlers, so one Escape cannot dismiss the whole stack at once.
  e.preventDefault()
  e.stopPropagation()
  top.close()
}

function ensureEscapeOwner() {
  if (escapeOwnerInstalled || typeof window === 'undefined') return
  window.addEventListener('keydown', handleOverlayEscape, true)
  escapeOwnerInstalled = true
}

function releaseEscapeOwner() {
  if (!escapeOwnerInstalled || overlayStack.length || typeof window === 'undefined') return
  window.removeEventListener('keydown', handleOverlayEscape, true)
  escapeOwnerInstalled = false
}

export interface OverlayLayer {
  /** Inline z-index value for the overlay root. */
  zIndex: string
}

/**
 * Register an overlay for the lifetime of `active`. Callers apply `zIndex` to
 * their root; Escape is owned centrally and only ever closes the top layer.
 */
export function useOverlayLayer(active: boolean, onClose: () => void, base = 'var(--z-modal)'): OverlayLayer {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [priority, setPriority] = useState(0)

  useEffect(() => {
    if (!active) return
    overlaySeq += 1
    const id = overlaySeq
    overlayStack.push({ id, close: () => closeRef.current() })
    setPriority(id)
    ensureEscapeOwner()
    return () => {
      const i = overlayStack.findIndex((o) => o.id === id)
      if (i >= 0) overlayStack.splice(i, 1)
      if (!overlayStack.length) overlaySeq = 0
      releaseEscapeOwner()
    }
  }, [active])

  return { zIndex: `calc(${base} + ${priority})` }
}

// ─── Button ─────────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Async work in flight: the label is replaced and the button is disabled. */
  loading?: boolean
  loadingLabel?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  loading = false,
  loadingLabel,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <>
          <span className={RECIPE.spinner} aria-hidden />
          {loadingLabel ?? 'Working…'}
        </>
      ) : (
        children
      )}
    </button>
  )
}

// ─── Fields ─────────────────────────────────────────────────────────────────

/** `bare` renders the transparent variant for an input that sits INSIDE an
 *  already-bordered shell (search rows, website/location/tags rows). */
export interface FieldProps {
  bare?: boolean
  className?: string
}

/**
 * ONE text field. Every colour, radius and focus border comes from `FIELD` in
 * tokens; a caller only supplies layout through `className`. `ref` is a normal
 * prop here (React 19), so callers keep focus management and autoFocus.
 */
export function Input({ bare = false, className = '', ...rest }: ComponentProps<'input'> & FieldProps) {
  return <input className={classes(bare ? FIELD.bare : classes(FIELD.base, FIELD.input), className)} {...rest} />
}

export function Textarea({ bare = false, className = '', ...rest }: ComponentProps<'textarea'> & FieldProps) {
  return <textarea className={classes(bare ? FIELD.bare : classes(FIELD.base, FIELD.textarea), className)} {...rest} />
}

export function Select({ className = '', ...rest }: ComponentProps<'select'> & FieldProps) {
  return <select className={classes(FIELD.base, FIELD.select, className)} {...rest} />
}

/** Checkboxes are inputs too: one named recipe instead of an accent/fill
 *  re-typed at every call site. */
export function Checkbox({ className = '', ...rest }: ComponentProps<'input'>) {
  return <input type="checkbox" className={classes(FIELD.check, className)} {...rest} />
}

// ─── Card ───────────────────────────────────────────────────────────────────

/** ONE card: solid panel + hairline border + rounded-lg. */
export function Card({
  tone = 'surface',
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return (
    <div className={classes(RECIPE.card, SURFACE_TONE[tone], className)} {...rest}>
      {children}
    </div>
  )
}

/** Card header strip: icon + title + caption + right slot. */
export function CardHeader({
  title,
  caption,
  icon,
  right,
  className = '',
}: {
  title: ReactNode
  caption?: ReactNode
  icon?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={classes(RECIPE.cardHeader, className)}>
      <div className={classes('flex items-center min-w-0', GAP[2])}>
        {icon && <span className={classes('shrink-0', COLOR.muted)}>{icon}</span>}
        <div className="min-w-0">
          <div className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate')}>{title}</div>
          {caption != null && <div className={classes(TYPE.caption, COLOR.muted, 'truncate')}>{caption}</div>}
        </div>
      </div>
      {right && <div className={classes('flex items-center shrink-0', GAP[2])}>{right}</div>}
    </div>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

/**
 * THE modal shell. Renders conditionally (parent does `{show && <Modal/>}`).
 * Focus-trapped (Tab cycles, focus restored on close), Escape closes, and the
 * backdrop click dismisses ONLY with `dismissable` — typed input is never lost
 * to a stray click. Sits at the --z-modal layer with island clearance.
 * The dialog caps its height to the overlay and scrolls: a centred dialog that
 * outgrew a short viewport used to push its own close button off-screen.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = DIALOG_WIDTH.sm,
  dismissable = false,
  initialFocusRef,
  zIndexBase = 'var(--z-modal)',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  maxWidth?: string
  /** Backdrop click dismisses. Defaults to false so typed input is never
   *  lost by a stray click — close explicitly via the X button or Escape. */
  dismissable?: boolean
  /** Element to focus on open (e.g. a form input). Defaults to the first
   *  focusable in the dialog. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Token expression this dialog stacks from. A modal opened inside a
   *  lightbox can opt into a higher base without a raw z-index literal. */
  zIndexBase?: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { zIndex } = useOverlayLayer(true, onClose, zIndexBase)

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null
    const el = dialogRef.current
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const target = initialFocusRef?.current ?? focusable[0]
      target?.focus()
    }

    // Escape is owned by the overlay stack (top layer only). This handler is
    // the Tab focus trap; it deliberately leaves Escape alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return
      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prevActive?.focus()
    }
  }, [initialFocusRef])

  return (
    <div
      className={RECIPE.modalOverlay}
      style={{ zIndex }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={classes(RECIPE.modalDialog, maxWidth)}
      >
        <div className={RECIPE.modalHeader}>
          <h2 id={titleId} className={RECIPE.dialogTitle}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close dialog" onClick={onClose} className={PADDING_X[1.5]}>
            <X className={ICON.md} />
          </Button>
        </div>
        <div className={RECIPE.modalBody}>{children}</div>
      </div>
    </div>
  )
}

// ─── SideSheet ──────────────────────────────────────────────────────────────

/**
 * Right-anchored side panel ("abrir ao lado"): the page stays visible and
 * usable while the sheet carries a detail view — feed comments, a profile
 * post, anything that used to expand inline and push content down.
 * Escape or backdrop click closes; the sheet slides in.
 */
export function SideSheet({
  open,
  onClose,
  title,
  children,
  width = LAYOUT.sheet,
  zIndexClass,
  zIndexBase = 'var(--z-modal)',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
  /** Explicit stacking class when the sheet is hosted inside a higher-z
   *  overlay. Omit it and the overlay priority manager owns the layer. */
  zIndexClass?: string
  zIndexBase?: string
}) {
  const { zIndex } = useOverlayLayer(open, onClose, zIndexBase)

  if (!open) return null
  return (
    <div
      className={classes('fixed inset-0', zIndexClass, RECIPE.sheetOverlay)}
      style={zIndexClass ? undefined : { zIndex }}
    >
      {/* Click-catcher for the page area BESIDE the sheet. It is a SIBLING of
          the aside, so it never covers the sheet itself, and it is the only
          element that owns the outside-click handler. The overlay used to
          carry `pointer-events-none` on the whole thing, so an outside click
          could never reach a handler and the sheet stayed open until Escape —
          the user asked for "clicking out of it intentionally should close it". */}
      <div
        data-side-sheet-backdrop
        aria-hidden="true"
        onClick={onClose}
        className="pointer-events-auto flex-1"
      />
      <aside
        role="complementary"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        className={classes(RECIPE.sheetPanel, width)}
      >
        <div className={RECIPE.sheetHeader}>
          <h2 className={RECIPE.dialogTitle}>{title}</h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} className={PADDING_X[1.5]}>
            <X className={ICON.md} />
          </Button>
        </div>
        <div className={RECIPE.sheetBody}>{children}</div>
      </aside>
    </div>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  /** A tablist is one composite control: arrow keys move between tabs (WAI-ARIA
   *  tabs pattern). Without this, a keyboard user had to Tab through every tab
   *  and press Enter, and focus stayed on a tab that was no longer selected.
   *  Only handle keys that originate ON a tab — never from a control a caller
   *  puts inside a tab's label. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const index = buttons.indexOf(target as HTMLButtonElement)
    if (index < 0) return
    e.preventDefault()
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : (index - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
    onChange(tabs[next].id)
  }

  return (
    <div role="tablist" onKeyDown={onKeyDown} className={classes(RECIPE.tabList, className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={classes(RECIPE.tab, value === t.id ? RECIPE.tabActive : RECIPE.tabIdle)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Title ──────────────────────────────────────────────────────────────────

/**
 * Page title + optional action. The top of the type scale: a page title is
 * clearly bigger than a section title (Title), and there is at most ONE per
 * screen. No subtitle that repeats the title — put the fact in the body.
 */
export function PageHeader({
  title,
  action,
  meta,
  className = '',
}: {
  title: ReactNode
  action?: ReactNode
  meta?: ReactNode
  className?: string
}) {
  return (
    <div className={classes(RECIPE.pageHeader, className)}>
      <div className="min-w-0">
        <h1 className={RECIPE.pageTitle}>{title}</h1>
        {meta != null && meta !== '' && (
          <div className={RECIPE.pageMeta}>{meta}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Section title. ONE label that says what it does — no sub-subtitles. */
export function Title({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={classes(RECIPE.title, className)}>{children}</div>
}

/** Caption / helper text. Used once per control, never stacked. */
export function Caption({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={classes(RECIPE.caption, className)}>{children}</div>
}

// ─── FeedbackState ──────────────────────────────────────────────────────────

export type FeedbackTone = 'empty' | 'loading' | 'error'

/**
 * ONE feedback surface: an empty timeline, a loading read or a failed read —
 * centred in a view, or as an inline strip under a header / inside a media tile.
 * Every colour, size, weight and surface comes from `FEEDBACK` in tokens; a
 * caller supplies only the honest words, an optional icon and an action.
 *
 * The state is supplied by the caller, never inferred: an empty list is not a
 * failed read, and a read in flight is not an empty list.
 */
export function FeedbackState({
  state = 'empty',
  layout = 'center',
  align = 'center',
  icon,
  title,
  description,
  meta,
  action,
  compact = false,
  size = 'sm',
  className = '',
  ref,
}: {
  state?: FeedbackTone
  layout?: 'center' | 'strip'
  align?: 'center' | 'start'
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  compact?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** The host element (e.g. a media tile's deferred-load observer target). */
  ref?: React.Ref<HTMLDivElement>
}) {
  if (layout === 'strip') {
    return (
      <div
        ref={ref}
        role="status"
        className={classes(FEEDBACK.strip, align === 'start' ? FEEDBACK.stripStart : FEEDBACK.stripCenter, className)}
      >
        {state === 'loading' && <Loader2 className={FEEDBACK.spinnerSm} aria-hidden />}
        {(state === 'error' || state === 'empty') && (
          icon ?? (state === 'error' ? <AlertCircle className={FEEDBACK.errorIconSm} /> : null)
        )}
        <span>{title}</span>
        {action}
      </div>
    )
  }

  const titleClass = state === 'error'
    ? FEEDBACK.errorTitle
    : size === 'lg' ? FEEDBACK.titleDisplay : size === 'md' ? FEEDBACK.titleStrong : FEEDBACK.title

  return (
    <div
      ref={ref}
      className={classes(compact ? FEEDBACK.centerCompact : FEEDBACK.center, className)}
    >
      {state === 'loading' ? (
        <Loader2 className={FEEDBACK.spinner} aria-hidden />
      ) : state === 'error' ? (
        icon ?? <AlertCircle className={FEEDBACK.errorIcon} />
      ) : (
        icon
      )}
      <div>
        <div className={titleClass}>{title}</div>
        {description != null && <div className={classes(FEEDBACK.description, 'mt-1')}>{description}</div>}
        {meta != null && <div className={FEEDBACK.meta}>{meta}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
