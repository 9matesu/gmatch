'use client'

// Watch: full theater section on the CommandIsland pill bar. Room list
// first; open parties render big (2x2 stack when multiple) with the shared
// timeline and the party chat + roster rail.

import { useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { BTN, MUTED, PLATE } from '../../ui/styles'
import { Avatar } from '../Avatar'
import { useWatchParty, leaveParty, MAX_SLOTS } from '../../hooks/watchPartyStore'
import { WatchPartySlot } from './WatchPartySlot'
import { WatchPartyTimeline } from './WatchPartyTimeline'
import { WatchPartyChat } from './WatchPartyChat'
import { WatchPartyRoomList } from './WatchPartyRoomList'
import { WatchPartyUrlModal } from './WatchPartyUrlModal'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyView({ identity, profilePics }: { identity: IdentityLike; profilePics: Record<string, string> }) {
  const { parties } = useWatchParty()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const active = parties.find((p) => p.id === activeId) || parties[parties.length - 1] || null

  return (
    <div className="p-2 sm:p-4 h-full flex-1 flex flex-row gap-3 min-h-0 overflow-hidden">
      {/* Stage */}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-xl ${PLATE} overflow-hidden`}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-glass">
          <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg flex items-center gap-2">
            <Clapperboard className="w-4 h-4" />
            Watch
          </h3>
          {active && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-retro-muted">{active.name}</span>
              <button
                type="button"
                onClick={() => { leaveParty(active.id); setActiveId(null) }}
                className={`${BTN} px-2 py-1 text-[10px] uppercase tracking-wider`}
              >
                Leave
              </button>
            </div>
          )}
        </div>

        {parties.length === 0 ? (
          <WatchPartyRoomList identity={identity} onNewParty={() => setModalOpen(true)} />
        ) : (
          <>
            <div className="flex-1 min-h-0 p-2">
              {parties.length === 1 ? (
                <WatchPartySlot
                  party={parties[0]}
                  identity={identity}
                  active
                  fill
                  onSelect={() => {}}
                  onEmptyClick={() => setModalOpen(true)}
                />
              ) : (
                <div className="grid grid-cols-2 h-full min-h-0 place-items-center gap-2">
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
              )}
            </div>
            <WatchPartyTimeline party={active} />
          </>
        )}
      </div>

      {/* Roster + chat rail */}
      <aside className={`w-64 shrink-0 hidden md:flex flex-col min-h-0 rounded-xl ${PLATE} overflow-hidden`}>
        <div className="px-3 py-2 border-b border-border-glass">
          <p className="text-[10px] font-bold uppercase tracking-wider text-retro-fg">In this room</p>
          <p className={MUTED}>{active ? `${active.members.length}/8 watching` : 'No room open'}</p>
        </div>
        {active && active.members.length > 0 && (
          <ul className="px-3 py-2 space-y-1.5 border-b border-border-glass">
            {active.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Avatar id={m.id} size={18} imageUrl={profilePics[m.id] || null} />
                <span className="text-xs text-retro-fg truncate">{m.name || m.id}</span>
                {m.id === identity.orbitId && <span className="text-[10px] uppercase tracking-wider text-retro-muted">you</span>}
              </li>
            ))}
          </ul>
        )}
        <WatchPartyChat party={active} profilePics={profilePics} myId={identity.orbitId} />
      </aside>

      {modalOpen && <WatchPartyUrlModal identity={identity} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
