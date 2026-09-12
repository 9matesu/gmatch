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
    default: 'bg-retro-panel text-retro-muted border-border-glass',
    success: 'bg-surface-raised text-retro-fg border-white font-extrabold',
    warning: 'bg-retro-panel text-white border-border-glass font-bold',
    danger: 'bg-retro-bg text-retro-muted border-border-glass',
    info: 'bg-retro-panel text-retro-fg border-border-glass',
    accent: 'bg-surface-raised text-retro-fg border-white font-bold',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
