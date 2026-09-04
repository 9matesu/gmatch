export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state space-y-3">
      {icon && <span className="text-3xl opacity-40">{icon}</span>}
      <div>
        <p className="text-sm font-bold text-retro-muted">{title}</p>
        {description && (
          <p className="text-[11px] text-retro-muted/60 mt-1 max-w-xs mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
