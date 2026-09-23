"use client";

export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-sm',
  dismissable = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
  /** Backdrop click dismisses. Defaults to false so typed input is never
   *  lost by a stray click — close explicitly via the X button or Escape. */
  dismissable?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 pb-[calc(1rem+var(--island-clearance))] bg-black/70 animate-orbit-fade-in"
      onClick={dismissable ? onClose : undefined}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full ${maxWidth} glass-panel shadow-xl animate-orbit-pop`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <h3 className="text-sm font-semibold text-retro-fg">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-retro-muted hover:text-retro-fg p-1 rounded-md transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
