export function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
  className?: string
}) {
  const variants = {
    default: 'bg-retro-panel text-retro-muted border-edge',
    success: 'bg-surface-raised text-retro-fg border-edge font-extrabold',
    warning: 'bg-retro-panel text-retro-fg border-edge font-bold',
    danger: 'bg-retro-bg text-retro-muted border-edge',
    info: 'bg-retro-panel text-retro-fg border-edge',
    accent: 'bg-surface-raised text-retro-fg border-edge font-bold',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-bold border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
