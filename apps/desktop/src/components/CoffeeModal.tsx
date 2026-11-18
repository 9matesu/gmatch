'use client'

import { Coffee, ShieldCheck, Database, MessageSquare, ExternalLink } from 'lucide-react'
import { Modal, Button } from '../ui/kit'

type Props = {
  open: boolean
  reason: 'time' | 'matches' | null
  onDismiss: (mode: 'later' | 'never') => void
}

const COFFEE_URL = 'https://buymeacoffee.com/stacksondeck'

export function CoffeeModal({ open, reason, onDismiss }: Props) {
  if (!open) return null

  const blurb =
    reason === 'matches'
      ? "You've played more than a dozen duels. Server snapshots, encrypted blob storage, and bandwidth aren't free. If GMatch has been worth your time, consider supporting development."
      : "You've spent over an hour in duels. Server snapshots, encrypted blob storage, and bandwidth aren't free. If GMatch has been worth your time, consider supporting development."

  return (
    <Modal title="Support GMatch" onClose={() => onDismiss('later')} maxWidth="max-w-md">
      <p className="text-xs leading-relaxed text-retro-body">{blurb}</p>

      <ul className="text-xs text-retro-muted space-y-1.5">
        <li className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-success-fg shrink-0" />
          <span>AES-GCM at-rest encryption + SSRF-guarded media streaming</span>
        </li>
        <li className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-info-fg shrink-0" />
          <span>Local-first storage: posts, cards and media live on your machine, not a rented volume</span>
        </li>
        <li className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-chrome-lav-fg shrink-0" />
          <span>Lobby chat, WebSocket bus, PMs & server-side reports escalation</span>
        </li>
      </ul>

      <div className="pt-3 border-t border-border-glass space-y-2">
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onDismiss('later')}
          className="w-full text-center py-2.5 text-xs font-bold tracking-wide bg-warning hover:bg-warning text-retro-fg rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Coffee className="w-4 h-4" />
          <span>Buy me a coffee</span>
          <ExternalLink className="w-3.5 h-3.5 opacity-70" />
        </a>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => onDismiss('later')}>
            Maybe later
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => onDismiss('never')}>
            Don&apos;t show again
          </Button>
        </div>
      </div>
    </Modal>
  )
}
