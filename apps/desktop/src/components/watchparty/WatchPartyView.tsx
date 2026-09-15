'use client'

// Watch: full theater section on the CommandIsland pill bar. Room list
// first; open rooms render big (2x2 stack when multiple) with the shared
// timeline, the queue, and the chat + participants rail.

import { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { Avatar } from '../Avatar'
import { BTN, MUTED, PLATE } from '../../ui/styles'
import { useWatchParty, joinPartyById, MAX_SLOTS } from '../../hooks/watchPartyStore'
import { watchRoomFromHash, stripWatchRoom } from './invite'
import { WatchPartySlot } from './WatchPartySlot'
import { WatchPartyTimeline } from './WatchPartyTimeline'
import { WatchPartyChat } from './WatchPartyChat'
import { WatchPartyQueue } from './WatchPartyQueue'
import { WatchPartyRoomList } from './WatchPartyRoomList'
import { WatchPartyUrlModal } from './WatchPartyUrlModal'
import { WatchRoomHeader } from './WatchRoomHeader'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyView({ identity, profilePics }: { identity: IdentityLike; profilePics: Record<string, string> }) {
  const { parties, kickedNotice } = useWatchParty()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const active = parties.find((p) => p.id === activeId) || parties[parties.length - 1] || null
  const isHost = active?.host === identity.orbitId

  // Invite deep link: #/watch?room=<id> joins once, then cleans the URL so a
  // refresh does not re-join. The view only mounts with an identity, so the
  // gated-app rule (no traffic before login/server pick) holds by placement.
  useEffect(() => {
    const roomId = watchRoomFromHash(window.location.hash)
    if (!roomId) return
    window.history.replaceState(null, '', stripWatchRoom(window.location.hash))
    void joinPartyById(identity, roomId)
  }, [identity])

  return (
    <div className="p-2 sm:p-4 h-full flex-1 flex flex-row gap-3 min-h-0 overflow-hidden">
      {/* Stage */}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-xl ${PLATE} overflow-hidden`}>
        {active ? (
          <WatchRoomHeader party={active} identity={identity} profilePics={profilePics} />
        ) : (
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-glass">
            <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg flex items-center gap-2">
              <Clapperboard className="w-4 h-4" />
              Watch
            </h3>
          </div>
        )}

        {parties.length === 0 ? (
          <WatchPartyRoomList identity={identity} onNewParty={() => setModalOpen(true)} kickedNotice={kickedNotice} />
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
            <WatchPartyTimeline party={active} onLoadVideo={() => setModalOpen(true)} canLoad={Boolean(active) && (isHost || !active?.lockVideo)} />
          </>
        )}
      </div>

      {/* Participants + queue + chat rail */}
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
                <span className="text-xs text-retro-fg truncate flex-1">{m.name || m.id}</span>
                {m.muted ? <span className={`text-[10px] uppercase tracking-wider ${MUTED}`}>muted</span> : null}
                {m.id === active.host && <span className="text-[10px] uppercase tracking-wider text-retro-muted">host</span>}
                {m.id === identity.orbitId && <span className="text-[10px] uppercase tracking-wider text-retro-muted">you</span>}
              </li>
            ))}
          </ul>
        )}
        {active && <WatchPartyQueue party={active} identity={identity} />}
        <WatchPartyChat party={active} profilePics={profilePics} myId={identity.orbitId} isHost={isHost} />
      </aside>

      {modalOpen && (
        <WatchPartyUrlModal
          identity={identity}
          onClose={() => setModalOpen(false)}
          joinPartyId={active?.id || null}
          queueMode
          lockVideo={Boolean(active?.lockVideo) && !isHost}
        />
      )}
    </div>
  )
}
