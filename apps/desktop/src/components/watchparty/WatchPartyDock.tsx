'use client'

// Watch Party dock: same-layer flex sibling of the feed column (chat-dock
// idiom). 2x2 slot grid + shared center timeline + member strip.

import { useState } from 'react'
import { X } from 'lucide-react'
import { Avatar } from '../Avatar'
import { BTN } from '../../ui/styles'
import { useWatchParty, leaveParty, MAX_SLOTS } from '../../hooks/watchPartyStore'
import { WatchPartySlot } from './WatchPartySlot'
import { WatchPartyTimeline } from './WatchPartyTimeline'
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
    <aside className="relative h-full w-[min(560px,38vw)] shrink-0 border-l border-border-glass bg-glass-w5 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-glass">
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

      <div className="flex-1 min-h-0 overflow-y-auto p-3 styled-scrollbar">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: MAX_SLOTS }, (_, i) => {
            const party = parties[i] || null
            return (
              <WatchPartySlot
                key={party ? party.id : `empty-${i}`}
                party={party}
                identity={identity}
                active={active?.id === party?.id && party !== null}
                onSelect={() => party && setActiveId(party.id)}
                onEmptyClick={() => setModalOpen(true)}
              />
            )
          })}
        </div>
      </div>

      <WatchPartyTimeline party={active} />

      {modalOpen && (
        <WatchPartyUrlModal identity={identity} onClose={() => setModalOpen(false)} />
      )}
    </aside>
  )
}
