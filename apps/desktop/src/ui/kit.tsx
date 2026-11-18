"use client";

/**
 * The UI kit — the FEW primitives every view composes (docs/UI-AUDIT.md).
 *
 * One Button, one Card surface, one Modal shell, one Tab bar, one Title.
 * Surfaces speak the shell's own tokens (solid-panel, glass-w8/w12,
 * border-edge, retro accent). Transparency rule: one glass layer per
 * surface, backdrops always bg-black/60. Radius: lg (cards/controls) and full
 * (pills). Colors: fg/muted + one accent + one danger + the frozen game set
 * (HP/rarity/crit, in ui/styles.ts).
 */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

// ─── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BTN_BASE =
  'cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold text-xs transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 select-none'

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-retro-accent text-retro-accent-text! hover:bg-retro-accent-hover border border-transparent font-bold',
  secondary: 'border border-edge bg-glass-w8 hover:bg-glass-w12 text-retro-fg',
  danger: 'bg-retro-error/15 border border-retro-error/40 text-retro-error hover:bg-retro-error/25',
  ghost: 'text-retro-muted hover:text-retro-fg border border-transparent hover:bg-glass-w8',
}

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1',
  md: 'px-3.5 py-2',
}

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
      className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
          {loadingLabel ?? 'Working…'}
        </>
      ) : (
        children
      )}
    </button>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

export type CardTone = 'surface' | 'raised'

const CARD_TONE: Record<CardTone, string> = {
  surface: 'solid-panel',
  raised: 'bg-glass-w12 border border-edge',
}

/** ONE card: solid panel + hairline border + rounded-lg. */
export function Card({
  tone = 'surface',
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return (
    <div className={`rounded-lg border border-edge ${CARD_TONE[tone]} ${className}`} {...rest}>
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
    <div className={`flex items-center justify-between gap-2 px-4 py-3 bg-glass-w8 border-b border-edge ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0 text-retro-muted">{icon}</span>}
        <div className="min-w-0">
          <div className="text-xs font-semibold text-retro-fg truncate">{title}</div>
          {caption != null && <div className="text-2xs text-retro-muted truncate">{caption}</div>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

/**
 * THE modal shell. Renders conditionally (parent does `{show && <Modal/>}`).
 * Focus-trapped (Tab cycles, focus restored on close), Escape closes, and the
 * backdrop click dismisses ONLY with `dismissable` — typed input is never lost
 * to a stray click. Sits at the --z-modal layer with island clearance.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-sm',
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
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 pb-[calc(1rem+var(--island-clearance))] bg-black/60 animate-orbit-fade-in"
      onClick={dismissable ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} glass-panel shadow-xl animate-orbit-pop`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-edge">
          <h2 id={titleId} className="text-base font-black tracking-tight text-retro-fg truncate">
            {title}
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close dialog" onClick={onClose} className="px-1.5">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
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
  width = 'w-[420px] max-w-[92vw]',
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
    <div className={`fixed inset-0 ${zIndexClass} flex justify-end pointer-events-none`} onClick={onClose}>
      <aside
        role="complementary"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`pointer-events-auto ${width} h-full bg-[var(--color-glass)] backdrop-blur-xl border-l border-edge shadow-2xl flex flex-col animate-orbit-slide-left`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-edge shrink-0">
          <h2 className="text-base font-black tracking-tight text-retro-fg truncate">{title}</h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} className="px-1.5">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-3">{children}</div>
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
  return (
    <div role="tablist" className={`flex bg-glass-w5 p-0.5 rounded-lg border border-edge ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold cursor-pointer transition-colors duration-150 ${
            value === t.id ? 'bg-glass-w12 text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
          }`}
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
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-retro-fg truncate">{title}</h1>
        {meta != null && meta !== '' && (
          <div className="text-2xs text-retro-muted mt-0.5 truncate">{meta}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Section title. ONE label that says what it does — no sub-subtitles. */
export function Title({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-sm font-semibold text-retro-fg ${className}`}>{children}</div>
}

/** Caption / helper text. Used once per control, never stacked. */
export function Caption({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-xs text-retro-muted ${className}`}>{children}</div>
}
