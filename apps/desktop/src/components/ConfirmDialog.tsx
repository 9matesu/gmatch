'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type ConfirmOptions = {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' renders the confirm button in error-border red. */
  tone?: 'default' | 'danger' | 'accent'
}

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<ConfirmContextValue>(() => Promise.resolve(false))

export function useConfirm() {
  return useContext(Ctx)
}

type Pending = {
  id: number
  options: Required<ConfirmOptions>
  resolve: (v: boolean) => void
}

const DEFAULTS: Required<ConfirmOptions> = {
  title: 'Are you sure?',
  description: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  tone: 'default',
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmContextValue>((opts) => {
    const id = Date.now()
    return new Promise<boolean>((resolve) => {
      setPending({ id, options: { ...DEFAULTS, ...opts }, resolve })
    })
  }, [])

  const settle = useCallback((v: boolean) => {
    setPending(prev => {
      prev?.resolve(v)
      return null
    })
  }, [])

  // Keyboard: Enter confirms, Escape cancels.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); settle(true) }
      else if (e.key === 'Escape') { e.preventDefault(); settle(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, settle])

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="bg-retro-panel border border-retro-border rounded-lg p-5 w-[360px] max-w-[90vw] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title" className="font-bold text-sm text-retro-fg tracking-wide uppercase mb-2">
              {pending.options.title}
            </h2>
            {pending.options.description && (
              <p className="text-[12px] text-retro-muted leading-relaxed mb-4">
                {pending.options.description}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => settle(false)}
                className="px-3 py-1.5 text-[11px] font-bold uppercase border border-retro-border rounded text-retro-muted hover:bg-retro-bg hover:text-retro-fg transition-colors"
              >
                {pending.options.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase rounded transition-colors ${
                  pending.options.tone === 'danger'
                    ? 'border border-red-500/60 text-red-400 bg-red-500/10 hover:bg-red-500/20'
                    : pending.options.tone === 'accent'
                      ? 'border border-retro-accent text-retro-accent bg-retro-accent/10 hover:bg-retro-accent/20'
                      : 'border border-retro-fg/40 text-retro-fg bg-retro-fg/5 hover:bg-retro-fg/10'
                }`}
              >
                {pending.options.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
