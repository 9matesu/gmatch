import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  /** Tighten the 3rem block padding when the state sits inside a panel body
   *  (the tag browser, the profile tabs) rather than owning a whole view. */
  compact?: boolean
}) {
  return (
    <div
      className="empty-state space-y-3"
      style={compact ? ({ '--empty-state-padding': '1.5rem' } as React.CSSProperties) : undefined}
    >
      {Icon && <Icon className="w-7 h-7 text-retro-muted opacity-60" strokeWidth={1.5} aria-hidden />}
      <div>
        <p className="text-sm font-bold text-retro-muted">{title}</p>
        {description && (
          <p className="text-xs text-retro-muted/60 mt-1 max-w-xs mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
