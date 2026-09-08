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
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-orbit-fade-in">
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 w-[380px] max-w-[90vw] shadow-2xl animate-orbit-pop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title" className="font-semibold text-sm text-zinc-100 mb-1.5">
              {pending.options.title}
            </h2>
            {pending.options.description && (
              <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                {pending.options.description}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => settle(false)}
                className="px-3 py-1.5 text-xs font-medium border border-zinc-700/80 rounded-md text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all duration-150 active:scale-[0.96] cursor-pointer"
              >
                {pending.options.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs cursor-pointer ${
                  pending.options.tone === 'danger'
                    ? 'border border-red-500/30 text-red-300 bg-red-500/15 hover:bg-red-500/25'
                    : pending.options.tone === 'accent'
                      ? 'bg-white text-zinc-950 hover:bg-zinc-200'
                      : 'bg-white text-zinc-950 hover:bg-zinc-200'
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
