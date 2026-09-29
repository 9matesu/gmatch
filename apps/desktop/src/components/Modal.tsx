import { useEffect, useRef } from 'react'

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
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null
    const el = dialogRef.current
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length > 0) {
        focusable[0].focus()
      }
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
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 pb-[calc(1rem+var(--island-clearance))] bg-black/70 animate-orbit-fade-in"
      onClick={dismissable ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className={`w-full ${maxWidth} glass-panel shadow-xl animate-orbit-pop`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <h3 className="text-sm font-semibold text-retro-fg">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-retro-muted hover:text-retro-fg p-1.5 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
