"use client";

/**
 * The UI kit — the FEW primitives every view composes (docs/UI-AUDIT.md).
 *
 * One Button, one Card surface, one Modal shell, one Tab bar, one Title.
 * Surfaces speak the shell's own tokens (solid-panel, glass-w8/w12,
 * border-border-glass, retro accent). Transparency rule: one glass layer per
 * surface, backdrops always bg-black/60. Radius: lg (cards/controls) and full
 * (pills). Colors: fg/muted + one accent + one danger + the frozen game set
 * (HP/rarity/crit, in ui/styles.ts).
 */
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

// ─── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BTN_BASE =
  'cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold text-xs transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 select-none'

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-retro-accent text-retro-accent-text! hover:bg-retro-accent-hover border border-transparent font-bold',
  secondary: 'border border-border-glass bg-glass-w8 hover:bg-glass-w12 text-retro-fg',
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
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`} {...rest} />
}

// ─── Card ───────────────────────────────────────────────────────────────────

export type CardTone = 'surface' | 'raised'

const CARD_TONE: Record<CardTone, string> = {
  surface: 'solid-panel',
  raised: 'bg-glass-w12 border border-border-glass',
}

/** ONE card: solid panel + hairline border + rounded-lg. */
export function Card({
  tone = 'surface',
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return (
    <div className={`rounded-lg border border-border-glass ${CARD_TONE[tone]} ${className}`} {...rest}>
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
    <div className={`flex items-center justify-between gap-2 px-4 py-3 bg-glass-w8 border-b border-border-glass ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0 text-retro-muted">{icon}</span>}
        <div className="min-w-0">
          <div className="text-xs font-semibold text-retro-fg truncate">{title}</div>
          {caption != null && <div className="text-[10px] text-retro-muted truncate">{caption}</div>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: string
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
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <Card
        tone="raised"
        className={`w-full ${width} max-h-[90vh] overflow-y-auto p-4 space-y-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-border-glass">
          <div className="text-xs font-semibold text-retro-fg">{title}</div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} className="px-1.5">
            <X className="w-4 h-4" />
          </Button>
        </div>
        {children}
      </Card>
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
    <div role="tablist" className={`flex bg-glass-w4 p-0.5 rounded-lg border border-border-glass ${className}`}>
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

/** Section title. ONE label that says what it does — no sub-subtitles. */
export function Title({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-sm font-semibold text-retro-fg ${className}`}>{children}</div>
}

/** Caption / helper text. Used once per control, never stacked. */
export function Caption({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-xs text-retro-muted ${className}`}>{children}</div>
}
