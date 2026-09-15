'use client'

// Watch: full theater section on the CommandIsland pill bar. Room list
// first; open rooms render big (2x2 stack when multiple) with the shared
// timeline, the queue, and the chat + participants rail.

import { useEffect, useState } from 'react'
import { Clapperboard, PanelRightClose, PanelRightOpen } from 'lucide-react'
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
  const [railOpen, setRailOpen] = useState(true)
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

  const inRoom = parties.length > 0
  return (
    <div className={inRoom
      ? 'relative h-full flex-1 flex min-h-0 overflow-hidden'
      : 'p-2 sm:p-4 h-full flex-1 flex flex-row gap-3 min-h-0 overflow-hidden'}>
      {/* Stage: full-bleed in a room (video touches all edges), plate+pad in browse */}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden ${inRoom ? '' : `rounded-xl ${PLATE}`}`}>
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
            <div className={`flex-1 min-h-0 ${inRoom ? '' : 'p-2'}`}>
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

      {/* Participants + queue + chat rail: in a room it floats OVER the
          full-bleed stage (video keeps full width); browse keeps the column */}
      <aside className={`w-72 shrink-0 h-full flex-col min-h-0 overflow-hidden bg-glass backdrop-blur-md ${inRoom ? `absolute inset-y-0 right-0 z-20 border border-border-glass ${railOpen ? 'flex' : 'hidden'}` : `md:flex hidden rounded-xl ${PLATE}`}`}>
        <div className="px-3 py-2 border-b border-border-glass flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-retro-fg">In this room</p>
            <p className={MUTED}>{active ? `${active.members.length}/8 watching` : 'No room open'}</p>
          </div>
          {inRoom && (
            <button type="button" onClick={() => setRailOpen(false)} aria-label="Hide side panel" className="p-1.5 rounded-md text-retro-muted hover:bg-glass-w10 hover:text-retro-fg cursor-pointer transition-colors duration-150">
              <PanelRightClose className="w-4 h-4" />
            </button>
          )}
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

      {inRoom && !railOpen && (
        <button type="button" onClick={() => setRailOpen(true)} aria-label="Show side panel" className="absolute bottom-16 right-2 z-30 p-2 rounded-md glass-toolbar text-retro-muted hover:text-retro-fg cursor-pointer transition-colors duration-150">
          <PanelRightOpen className="w-4 h-4" />
        </button>
      )}

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
