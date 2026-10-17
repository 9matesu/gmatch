"use client";

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Single contextual entry point for world actions: create a device-local
 * group label, or join via an invite code. Host-server creation lives
 * elsewhere (toolbar Create) because it restarts the app into host mode.
 */
export function AddWorldDialog({
  open,
  onClose,
  onCreateLabel,
  onJoinCode,
}: {
  open: boolean
  onClose: () => void
  onCreateLabel: (name: string) => void
  onJoinCode: (code: string) => void
}) {
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [labelName, setLabelName] = useState('')
  const [code, setCode] = useState('')
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return
    setTab('create')
    setLabelName('')
    setCode('')
    const t = setTimeout(() => firstRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add world"
        className="bg-surface-raised border border-border-glass rounded-xl max-w-sm w-full shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Add world</h2>
          <button type="button" onClick={onClose} aria-label="Close add world dialog" className="p-1 rounded-md text-retro-muted hover:text-retro-fg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3" role="tablist" aria-label="Add world method">
          {(['create', 'join'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors ${tab === t ? 'bg-glass-w12 text-retro-fg' : 'text-retro-muted hover:text-retro-fg'}`}
            >
              {t === 'create' ? 'New group' : 'Join code'}
            </button>
          ))}
        </div>
        {tab === 'create' ? (
          <form
            className="p-4 space-y-2"
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
            <p className="text-[11px] text-retro-muted">A label on this device for grouping known peers — not a network, visible to nobody else.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">Cancel</button>
              <button type="submit" disabled={!labelName.trim()} className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">Create group</button>
            </div>
          </form>
        ) : (
          <form
            className="p-4 space-y-2"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) { onJoinCode(code.trim()); onClose() } }}
          >
            <label className="block text-xs text-retro-muted">
              Invite code
              <input
                ref={firstRef}
                aria-label="Invite code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="gmatch://node/…"
                className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs font-mono"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">Cancel</button>
              <button type="submit" disabled={!code.trim()} className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50">Join</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
