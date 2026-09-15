'use client'

// Watch Party dock: room SWITCHER beside the feed (chat-dock idiom). The
// theater (Watch tab) is the single player surface; two <video> elements
// per room meant double decode + double sync, so the dock no longer embeds
// slots. Switch sets the theater's active room; open jumps to the tab.

import { useState } from 'react'
import { X } from 'lucide-react'
import { Avatar } from '../Avatar'
import { BTN, MUTED } from '../../ui/styles'
import { useWatchParty, leaveParty } from '../../hooks/watchPartyStore'
import { WatchPartyUrlModal } from './WatchPartyUrlModal'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  displayName?: string
}

export function WatchPartyDock({
  identity,
  profilePics,
  onClose,
}: {
  identity: IdentityLike
  profilePics: Record<string, string>
  onClose: () => void
}) {
  const { parties } = useWatchParty()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const active = parties.find((p) => p.id === activeId) || parties[parties.length - 1] || null

  return (
    <aside className="relative h-full w-[min(560px,38vw)] shrink-0 glass-toolbar flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
        <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg">Watch Party</h3>
        <div className="flex items-center gap-2">
          {active && active.members.length > 0 && (
            <div className="flex -space-x-1.5" aria-label="Party members">
              {active.members.slice(0, 6).map((m) => (
                <Avatar key={m.id} id={m.id} size={20} imageUrl={profilePics[m.id] || null} />
              ))}
            </div>
          )}
          {active && (
            <button
              type="button"
              onClick={() => { leaveParty(active.id); setActiveId(null) }}
              className={`${BTN} px-2 py-1 text-[10px] uppercase tracking-wider`}
            >
              Leave
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close watch party" className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 styled-scrollbar">
        {parties.length === 0 && (
          <button type="button" onClick={() => setModalOpen(true)} className={`${BTN} w-full py-2 text-[10px] uppercase tracking-wider`}>
            Start a party
          </button>
        )}
        {parties.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { location.hash = '#/watch' }}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors duration-150 cursor-pointer ${p.id === active?.id ? 'border-border-glass bg-glass-w10' : 'border-transparent hover:bg-glass-w5'}`}
          >
            <span className="block truncate text-xs font-semibold text-retro-fg">{p.mediaName || p.name}</span>
            <span className={`block truncate text-[10px] uppercase tracking-wider ${MUTED}`}>{p.members.length} watching</span>
          </button>
        ))}
      </div>

      {modalOpen && (
        <WatchPartyUrlModal identity={identity} onClose={() => setModalOpen(false)} />
      )}
    </aside>
  )
}
