'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/kit'

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

/**
 * The promise confirm. The shell is the shared `Modal` (ui/kit), so this keeps
 * the focus trap, Escape and the focus restore instead of re-implementing them:
 * the old backdrop was a hand-rolled div with its own `role="dialog"`.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

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

  // Enter confirms; Escape is the Modal's (it closes via onClose -> settle(false)).
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); settle(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, settle])

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title={pending.options.title}
          onClose={() => settle(false)}
          maxWidth="max-w-[380px]"
          initialFocusRef={cancelRef}
        >
          {pending.options.description && (
            <p className="text-xs text-retro-body leading-relaxed">
              {pending.options.description}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => settle(false)}
              className="px-3 py-1.5 text-xs font-medium border border-edge rounded-md text-retro-fg hover:bg-glass-w12 transition duration-150 active:scale-(--scale-press-sm) cursor-pointer"
            >
              {pending.options.cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition duration-150 active:scale-(--scale-press-sm) cursor-pointer ${
                pending.options.tone === 'danger'
                  ? 'border border-danger/30 text-danger-fg bg-danger/15 hover:bg-danger/25'
                  : 'bg-retro-accent text-retro-bg hover:bg-retro-fg'
              }`}
            >
              {pending.options.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  )
}