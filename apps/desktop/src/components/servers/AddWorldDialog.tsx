"use client";

/**
 * Single entry point for server actions: join an existing server with an
 * invitation code, or host one on this machine. Two steps, one primary action
 * each — a chooser, then the chosen form — inside the existing `Modal`. The
 * host form is owned by ServersView (its state and restart flow live there) and
 * handed in as `hostForm`, so there is one dialog and one modal implementation.
 * Device-local groups are a separate, secondary flow (GroupsDialog): a label is
 * not a server and must never be offered as one.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Modal } from '../Modal';

export function AddWorldDialog({
  open,
  onClose,
  onJoinCode,
  hostForm,
}: {
  open: boolean
  onClose: () => void
  onJoinCode: (code: string) => Promise<boolean>
  hostForm?: ReactNode
}) {
  const [step, setStep] = useState<'choose' | 'join' | 'host'>('choose')
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setStep('choose')
    setCode('')
    setJoinError('')
    setJoining(false)
  }, [open])

  // After Modal's own first-focus pass: land the caret in the useful field.
  useEffect(() => {
    if (!open || step !== 'join') return
    const t = setTimeout(() => firstRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open, step])

  if (!open) return null

  const back = (
    <button
      type="button"
      onClick={() => setStep('choose')}
      className="flex items-center gap-1 text-xs text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
    >
      <ArrowLeft className="w-3 h-3" /> All options
    </button>
  )

  return (
    <Modal title="Add server" onClose={onClose} maxWidth="max-w-md">
      {step === 'choose' && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setStep('join')}
            className="w-full rounded-lg border border-border-glass bg-glass-w5 hover:bg-glass-w10 px-3 py-2.5 text-left cursor-pointer transition-colors duration-150"
          >
            <span className="block text-xs font-bold text-retro-fg">Join with code</span>
            <span className="mt-0.5 block text-[10px] text-retro-muted">
              Paste the code the host sent you.
            </span>
          </button>
          {hostForm && (
            <button
              type="button"
              onClick={() => setStep('host')}
              className="w-full rounded-lg border border-border-glass bg-glass-w5 hover:bg-glass-w10 px-3 py-2.5 text-left cursor-pointer transition-colors duration-150"
            >
              <span className="block text-xs font-bold text-retro-fg">Host a server</span>
              <span className="mt-0.5 block text-[10px] text-retro-muted">
                Run a world on this computer and share its code.
              </span>
            </button>
          )}
        </div>
      )}

      {step === 'join' && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const entered = code.trim()
            if (!entered || joining) return
            setJoining(true)
            setJoinError('')
            const accepted = await onJoinCode(entered)
            setJoining(false)
            // Entered code is preserved on a recoverable failure; the dialog
            // only closes once the attempt left the dialog.
            if (accepted) onClose()
            else setJoinError('That does not look like a node code. Paste the whole gmatch://node/… string.')
          }}
        >
          {back}
          <label className="block text-xs text-retro-muted">
            Invite code
            <input
              ref={firstRef}
              aria-label="Invite code"
              value={code}
              onChange={(e) => { setCode(e.target.value); setJoinError('') }}
              placeholder="gmatch://node/…"
              aria-invalid={joinError ? true : undefined}
              className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
            />
          </label>
          {joinError ? (
            <p role="alert" className="text-[10px] text-retro-error">{joinError}</p>
          ) : (
            <p className="text-[10px] text-retro-muted">
              Paste the code the host sent you. It carries the address, not a secret.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!code.trim() || joining}
              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {joining ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>
      )}

      {step === 'host' && hostForm && (
        <div className="space-y-2">
          {back}
          {hostForm}
        </div>
      )}
    </Modal>
  )
}
