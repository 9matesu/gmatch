'use client'

// Watch tab: in a room the video viewer and docked side rail fit neatly side-by-side.
// When the rail is toggled off, the video expands to 100% width.
// Browse mode (no active room) renders the two-column layout with room list on the left and side rail on the right.

import { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { Avatar } from '../Avatar'
import { MUTED } from '../../ui/styles'
import { useWatchParty, joinPartyById, canControlParty, MAX_SLOTS } from '../../hooks/watchPartyStore'
import { watchInviteFromHash, stripWatchRoom } from './invite'
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
  const canControl = active ? canControlParty(active, identity.orbitId) : false

  // Deep link joining
  useEffect(() => {
    const tryJoin = () => {
      const invite = watchInviteFromHash(window.location.hash)
      if (!invite) return
      window.history.replaceState(null, '', stripWatchRoom(window.location.hash))
      void joinPartyById(identity, invite.room, invite.invite)
    }
    tryJoin()
    window.addEventListener('hashchange', tryJoin)
    return () => window.removeEventListener('hashchange', tryJoin)
  }, [identity])

  const inRoom = parties.length > 0

  // BROWSE MODE: Full-width gallery layout (room list gallery without placeholder chat rail)
  if (!inRoom) {
    return (
      <div className="p-2 sm:p-4 h-full flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden glass-card rounded-xl border border-border-glass bg-surface-canvas/60 backdrop-blur-md">
          <div className="glass-header flex items-center justify-between px-4 py-3 border-b border-border-glass">
            <h3 className="text-xs font-bold uppercase tracking-wider text-retro-fg flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-retro-accent" />
              Watch
            </h3>
          </div>
          <WatchPartyRoomList
            identity={identity}
            onNewParty={() => setModalOpen(true)}
            kickedNotice={kickedNotice}
            joinedIds={parties.map((p) => p.id)}
          />
        </div>

        {modalOpen && (
          <WatchPartyUrlModal
            identity={identity}
            onClose={() => setModalOpen(false)}
            joinPartyId={null}
            queueMode={false}
            party={null}
          />
        )}
      </div>
    )
  }

  // ROOM MODE: Full-bleed theater layout with video viewer and docked side rail
  return (
    <div className="group/watch relative h-full flex-1 flex flex-row min-h-0 overflow-hidden bg-black">
      {/* Video Viewer Container: takes remaining width, resizes automatically */}
      <div className="flex-1 min-w-0 min-h-0 relative flex flex-col bg-black overflow-hidden">
        {parties.length === 1 ? (
          <WatchPartySlot
            party={parties[0]}
            identity={identity}
            active
            fill
            onSelect={() => parties[0] && setActiveId(parties[0].id)}
            onEmptyClick={() => setModalOpen(true)}
          />
        ) : (
          <div className="grid grid-cols-2 h-full min-h-0 place-items-center gap-2 p-2">
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

        {/* Cohesive Video Player Controls */}
        <WatchPartyTimeline
          party={active}
          isHost={!!canControl}
          onToggleRail={() => setRailOpen((v) => !v)}
          railOpen={railOpen}
        />
      </div>

      {/* Docked Side Rail (Room info + Participants + Queue + Chat) */}
      <aside
        className={`w-72 lg:w-80 shrink-0 h-full flex-col min-h-0 overflow-hidden border-l border-border-glass solid-panel z-20 ${
          railOpen ? 'flex animate-orbit-fade-in' : 'hidden'
        }`}
      >
        {active && <WatchRoomHeader party={active} identity={identity} profilePics={profilePics} />}

        <div className="flex items-start justify-between gap-2 px-3 py-1.5 border-b border-border-glass">
          <p className="text-[10px] font-bold uppercase tracking-wider text-retro-fg">In this room</p>
        </div>

        {active && active.members.length > 0 && (
          <ul className="px-3 py-2 space-y-1.5 border-b border-border-glass max-h-36 overflow-y-auto styled-scrollbar">
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
          party={active}
        />
      )}
    </div>
  )
}
