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
import { Button, Input, Modal } from '../../ui/kit';
import {
  classes, COLOR, DIALOG_WIDTH, GAP, ICON, MONO, PADDING_X, PADDING_Y,
  RECIPE, STATUS, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';

/** The two chooser cards share one raised-glass surface recipe. */
const choice = classes(
  'w-full text-left cursor-pointer',
  RECIPE.card, COLOR.surfaceRaised, COLOR.hoverW10, TRANSITION.micro,
  PADDING_X[4], PADDING_Y[3], GAP[0.5],
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
      <ArrowLeft className={ICON.sm} /> All options
    </button>
  )

  return (
    <Modal title="Add server" onClose={onClose} maxWidth={DIALOG_WIDTH.md}>
      {step === 'choose' && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setStep('join')}
            className={choice}
          >
            <span className={classes('block', TYPE.body, WEIGHT.bold, COLOR.fg)}>Join with code</span>
            <span className={classes('block', TYPE.caption, COLOR.muted)}>
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
              <span className={classes('block', TYPE.caption, COLOR.muted)}>
                Run a world on this computer and share its code.
              </span>
            </button>
          )}
        </div>
      )}

      {step === 'join' && (
        <form
          className={classes('space-y-2')}
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
            <Input
              ref={firstRef}
              aria-label="Invite code"
              value={code}
              onChange={(e) => { setCode(e.target.value); setJoinError('') }}
              placeholder="gmatch://node/…"
              aria-invalid={joinError ? true : undefined}
              className={classes('mt-1', MONO)}
            />
          </label>
          {joinError ? (
            <p role="alert" className={classes(TYPE.caption, STATUS.danger)}>{joinError}</p>
          ) : (
            <p className={classes(TYPE.caption, COLOR.muted)}>
              Paste the code the host sent you. It carries the address, not a secret.
            </p>
          )}
          <div className={classes('flex justify-end', GAP[2], 'pt-1')}>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={!code.trim() || joining}>
              {joining ? 'Joining…' : 'Join'}
            </Button>
          </div>
        </form>
      )}

      {step === 'host' && hostForm && (
        <div className={classes('space-y-2')}>
          {back}
          {hostForm}
        </div>
      )}
    </Modal>
  )
}
