"use client";

/**
 * Single entry point for server actions: join an existing server with an
 * invitation code, or host one on this machine. Two steps, one primary action
 * each — a chooser, then the chosen form — inside the existing `Modal`. The
 * host form is owned by ServersView (its state and restart flow live there) and
 * handed in as `hostForm`, so there is one dialog and one modal implementation.
 * Device-local groups are a separate, secondary flow (GroupsDialog): a label is
 * not a server and must never be offered as one.
 *
 * All chrome (choice tiles, labels, captions, buttons) reads ui/tokens; the
 * dialog itself is the kit Modal, so the surface and type ladder have one owner.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Modal } from '../../ui/kit';
import {
  classes, COLOR, GAP, PADDING_X, PADDING_Y, RADIUS,
  STATUS, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';

/** The two chooser cards share one raised-glass surface recipe. */
const choice = classes(
  'w-full text-left cursor-pointer border',
  RADIUS.control, COLOR.edge, COLOR.glassW5, COLOR.hoverW10,
  PADDING_X[3], 'py-2.5', TRANSITION.micro,
);

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
      className={classes('flex items-center cursor-pointer', GAP[1], TYPE.body, COLOR.muted, COLOR.hoverFg, TRANSITION.micro)}
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
            className={choice}
          >
            <span className={classes('block', TYPE.body, WEIGHT.bold, COLOR.fg)}>Join with code</span>
            <span className={classes('mt-0.5 block', TYPE.caption, COLOR.muted)}>
              Paste the code the host sent you.
            </span>
          </button>
          {hostForm && (
            <button
              type="button"
              onClick={() => setStep('host')}
              className={choice}
            >
              <span className={classes('block', TYPE.body, WEIGHT.bold, COLOR.fg)}>Host a server</span>
              <span className={classes('mt-0.5 block', TYPE.caption, COLOR.muted)}>
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
          <label className={classes('block', TYPE.body, COLOR.muted)}>
            Invite code
            <input
              ref={firstRef}
              aria-label="Invite code"
              value={code}
              onChange={(e) => { setCode(e.target.value); setJoinError('') }}
              placeholder="gmatch://node/…"
              aria-invalid={joinError ? true : undefined}
              className={classes('glass-field mt-1 w-full px-2.5 py-1.5', TYPE.body)}
            />
          </label>
          {joinError ? (
            <p role="alert" className={classes(TYPE.caption, STATUS.danger)}>{joinError}</p>
          ) : (
            <p className={classes(TYPE.caption, COLOR.muted)}>
              Paste the code the host sent you. It carries the address, not a secret.
            </p>
          )}
          <div className={classes('flex justify-end pt-1', GAP[2])}>
            <button type="button" onClick={onClose} className={classes('glass-action cursor-pointer', PADDING_X[3], PADDING_Y[1.5], RADIUS.control, TYPE.body, COLOR.muted)}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!code.trim() || joining}
              className={classes('glass-action glass-action-primary cursor-pointer disabled:opacity-50', PADDING_X[3], PADDING_Y[1.5], RADIUS.control, TYPE.body, WEIGHT.bold)}
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
