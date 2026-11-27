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
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  buttonClass,
  classes,
  COLOR,
  DIALOG_WIDTH,
  GAP,
  ICON,
  LAYOUT,
  PADDING_X,
  RECIPE,
  SURFACE_TONE,
  TYPE,
  type ButtonSize,
  type ButtonVariant,
  type CardTone,
} from './tokens'

export type { ButtonVariant, ButtonSize, CardTone } from './tokens'

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
          <div className={classes(TYPE.body, 'font-semibold', COLOR.fg, 'truncate')}>{title}</div>
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
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

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

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' && el) {
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
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prevActive?.focus()
    }
  }, [onClose, initialFocusRef])

  return (
    <div
      className={RECIPE.modalOverlay}
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
  zIndexClass = 'z-[var(--z-modal)]',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
  /** Stacking override when the sheet is hosted inside a higher-z overlay. */
  zIndexClass?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={classes('fixed inset-0', zIndexClass, RECIPE.sheetOverlay)}>
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
