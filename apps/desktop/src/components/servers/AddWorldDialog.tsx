"use client";

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../Modal';

/**
 * Single entry point for world actions: name a device-local group, join with an
 * invite code, or host a server on this machine. The host form is owned by
 * ServersView (its state and restart flow live there) and is handed in as
 * `hostForm`, so there is one dialog and one modal implementation.
 */
export function AddWorldDialog({
  open,
  onClose,
  onCreateLabel,
  onJoinCode,
  hostForm,
  initialTab = 'group',
}: {
  open: boolean
  onClose: () => void
  onCreateLabel: (name: string) => void
  onJoinCode: (code: string) => Promise<boolean>
  hostForm?: ReactNode
  /** Which method the caller's entry point implies (the empty state points at hosting). */
  initialTab?: 'group' | 'join' | 'host'
}) {
  const [tab, setTab] = useState<'group' | 'join' | 'host'>('group')
  const [labelName, setLabelName] = useState('')
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setLabelName('')
    setCode('')
    setJoinError('')
    setJoining(false)
    // After Modal's own first-focus pass: land the caret in the useful field.
    const t = setTimeout(() => firstRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open, initialTab])

  if (!open) return null

  const tabs: Array<{ id: 'group' | 'join' | 'host'; label: string }> = [
    { id: 'group', label: 'New group' },
    { id: 'join', label: 'Join code' },
    ...(hostForm ? [{ id: 'host' as const, label: 'Host a server' }] : []),
  ]

  return (
    <Modal title="Add world" onClose={onClose} maxWidth="max-w-md">
      <div className="flex gap-1" role="tablist" aria-label="Add world method">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors duration-150 ${
              tab === t.id ? 'bg-glass-w12 text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'group' && (
        <form
          className="pt-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (labelName.trim()) { onCreateLabel(labelName.trim()); onClose() } }}
        >
          <label className="block text-xs text-retro-muted">
            Group name
            <input
              ref={firstRef}
              aria-label="New group name"
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder="e.g. Friday crew"
              maxLength={40}
              className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
            />
          </label>
          <p className="text-[10px] text-retro-muted">
            A label on this device for grouping known peers. Not a network, and visible to nobody else.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!labelName.trim()}
              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              Create group
            </button>
          </div>
        </form>
      )}

      {tab === 'join' && (
        <form
          className="pt-3 space-y-2"
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
          <label className="block text-xs text-retro-muted">
            Invite code
            <input
              ref={firstRef}
              aria-label="Invite code"
              value={code}
              onChange={(e) => { setCode(e.target.value); setJoinError('') }}
              placeholder="gmatch://node/…"
              aria-invalid={joinError ? true : undefined}
              className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs font-mono"
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

      {tab === 'host' && hostForm && <div className="pt-3">{hostForm}</div>}
    </Modal>
  )
}
