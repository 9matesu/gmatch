'use client'

// Watch: in a room the theater is the WHOLE tab — the video fills the frame
// (letterbox bars stay black so the app header pills through transparently),
// chrome lives in the rail, and the pill bar fades out (hover bottom to
// revive). Browse mode keeps the solid glass-card like every other tab.

import { useEffect, useState } from 'react'
import { Clapperboard, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Avatar } from '../Avatar'
import { MUTED } from '../../ui/styles'
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
  const [railOpen, setRailOpen] = useState(false)
  const active = parties.find((p) => p.id === activeId) || parties[parties.length - 1] || null
  const isHost = active?.host === identity.orbitId

  // Invite deep link: #/watch?room=<id> joins, then cleans the URL so a
  // refresh does not re-join. The theater is now ALWAYS mounted, so the
  // link can arrive via a later hash change (dock click, pasted link):
  // listen, don't just read once at mount.
  useEffect(() => {
    const tryJoin = () => {
      const roomId = watchRoomFromHash(window.location.hash)
      if (!roomId) return
      window.history.replaceState(null, '', stripWatchRoom(window.location.hash))
      void joinPartyById(identity, roomId)
    }
    tryJoin()
    window.addEventListener('hashchange', tryJoin)
    return () => window.removeEventListener('hashchange', tryJoin)
  }, [identity])

  const inRoom = parties.length > 0
  return (
    <div className={inRoom
      ? 'group/watch relative h-full flex-1 flex min-h-0 overflow-hidden'
      : 'p-2 sm:p-4 h-full flex-1 flex flex-row gap-3 min-h-0 overflow-hidden'}>
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden ${inRoom ? '' : 'glass-card'}`}>
        {!inRoom && (
          <div className="glass-header flex items-center justify-between px-4 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg flex items-center gap-2">
              <Clapperboard className="w-4 h-4" />
              Watch
            </h3>
          </div>
        )}

        {parties.length === 0 ? (
          <WatchPartyRoomList identity={identity} onNewParty={() => setModalOpen(true)} kickedNotice={kickedNotice} />
        ) : (
          <div className={`relative flex-1 min-h-0 ${inRoom ? '' : 'p-2'}`}>
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
            <WatchPartyTimeline party={active} />
          </div>
        )}
      </div>

      {/* Room info + participants + queue + chat rail: floats over the
          video only while open; closed by default (nothing on screen). */}
      <aside className={`w-72 shrink-0 h-full flex-col min-h-0 overflow-hidden ${inRoom ? `absolute inset-y-0 right-0 z-20 glass-card ${railOpen ? 'flex animate-orbit-fade-in' : 'hidden'}` : `md:flex hidden glass-card`}`}>
        {active ? (
          <WatchRoomHeader party={active} identity={identity} profilePics={profilePics} />
        ) : (
          <div className="px-3 py-2 border-b border-border-glass">
            <p className={MUTED}>No room open</p>
          </div>
        )}
        <div className="flex items-start justify-between gap-2 px-3 py-1.5 border-b border-border-glass">
          <p className="text-[10px] font-bold uppercase tracking-wider text-retro-fg">In this room</p>
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
        <button type="button" onClick={() => setRailOpen(true)} aria-label="Show side panel" className="absolute top-3 right-2 z-30 p-1.5 rounded-md text-retro-muted hover:text-retro-fg cursor-pointer transition-opacity duration-300 group-hover/watch:opacity-100 opacity-0 focus-visible:opacity-100">
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
