'use client'

import { useEffect } from 'react'
import { Coffee, ShieldCheck, Database, MessageSquare, ExternalLink } from 'lucide-react'

type Props = {
  open: boolean
  reason: 'time' | 'matches' | null
  onDismiss: (mode: 'later' | 'never') => void
}

const COFFEE_URL = 'https://buymeacoffee.com/stacksondeck'

export function CoffeeModal({ open, reason, onDismiss }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss('later')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  const blurb =
    reason === 'matches'
      ? "You've played more than a dozen duels. Server snapshots, encrypted blob storage, and bandwidth aren't free — if GMatch has been worth your time, consider supporting development."
      : "You've spent over an hour in duels. Server snapshots, encrypted blob storage, and bandwidth aren't free — if GMatch has been worth your time, consider supporting development."

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/80 backdrop-blur-md animate-orbit-fade-in p-4">
      <div className="bg-surface-canvas/95 border border-zinc-800 rounded-xl w-[440px] max-w-[92vw] shadow-2xl animate-orbit-pop overflow-hidden backdrop-blur-md">
        {/* Header */}
        <div className="bg-surface-canvas/60 px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Coffee className="w-4 h-4" />
            </div>
            <h2 className="text-xs font-bold tracking-wider text-retro-fg uppercase">
              Support GMatch
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs leading-relaxed text-retro-body">{blurb}</p>

          <div className="bg-surface-canvas/50 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-retro-muted font-bold">
              Infrastructure & Maintenance
            </p>
            <ul className="text-xs text-retro-muted space-y-1.5">
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>AES-GCM at-rest encryption + SSRF-guarded media streaming</span>
              </li>
              <li className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Persistent Fly.io volume storage so cards survive every deploy</span>
              </li>
              <li className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Lobby chat, WebSocket bus, PMs & server-side reports escalation</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-1 flex flex-col gap-2">
          <a
            href={COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onDismiss('later')}
            className="w-full text-center py-2.5 text-xs font-bold tracking-wide bg-amber-500 hover:bg-amber-400 text-retro-fg rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 cursor-pointer"
          >
            <Coffee className="w-4 h-4" />
            <span>Buy me a coffee</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </a>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => onDismiss('later')}
              className="flex-1 py-1.5 text-xs font-semibold text-retro-muted hover:text-retro-body border border-zinc-800 hover:bg-surface-canvas rounded-lg transition-colors cursor-pointer"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={() => onDismiss('never')}
              className="flex-1 py-1.5 text-xs font-semibold text-retro-muted hover:text-retro-body border border-transparent hover:border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              Don&apos;t show again
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
