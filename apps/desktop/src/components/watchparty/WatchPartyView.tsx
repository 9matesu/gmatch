'use client'

// Watch tab. Browse mode is one aligned gallery: a single create action, one
// join field, and room cards with equal edges. In-room mode keeps the video
// full-bleed and the rail docked; secondary room facts live in ONE Details
// disclosure so the player reads title / host / controls / queue only.

import { useEffect, useState } from 'react'
import { ChevronDown, Clapperboard, Film, Users } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Avatar } from '../Avatar'
import {
  CHROME,
  COLOR,
  ICON,
  MOTION,
  PADDING_X,
  PADDING_Y,
  RADIUS,
  TRACKING,
  TYPE,
  cx,
} from '../../ui/tokens'
import { MUTED } from '../../ui/styles'
import { useWatchParty, joinPartyById, canControlParty, MAX_SLOTS, type PartyRuntime } from '../../hooks/watchPartyStore'
import { useObjectImage } from '../../hooks/useObjectImage'
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

/**
 * Compact "now playing" card for the rail. Hovering it reveals a small, muted,
 * looping preview of what the room is playing RIGHT NOW — resolved through the
 * same media ladder as the slot, so a consent-shared local file shows its bytes
 * only once they are actually local (transfer-first, never a sender path).
 */
function NowPlayingCard({ party, identity }: { party: PartyRuntime; identity: IdentityLike }) {
  const [hovering, setHovering] = useState(false)
  const currentItem = party.queue.find((q) => q.id === party.current) || null
  const currentUrl = currentItem?.url || party.url || null
  const media = useObjectImage(currentUrl, identity, { enabled: Boolean(currentUrl) })
  const thumb = useObjectImage(currentItem?.thumb ?? null, identity, { enabled: Boolean(currentItem?.thumb) })
  const name = currentItem?.name || party.mediaName || 'Nothing playing'
  const canPreview = Boolean(media.url) && (media.isVideo || /\.mp4\b|\.webm\b|\/stream/.test(currentUrl || ''))

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cx('relative border-b', COLOR.edge)}
    >
      <div className={cx('flex items-center', PADDING_X[3], PADDING_Y[2], 'gap-2')}>
        <span className={cx('relative size-9 shrink-0 overflow-hidden', RADIUS.chip, COLOR.canvasSurface, 'border', COLOR.edge)}>
          {thumb.url ? (
            <img src={thumb.url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <Film className={cx(ICON.md, COLOR.muted)} aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block uppercase', TYPE.caption, TRACKING.wider, COLOR.muted)}>Now playing</span>
          <span className={cx('block truncate', TYPE.body, COLOR.fg)}>{name}</span>
        </span>
      </div>

      {hovering && canPreview && (
        <video
          data-testid="now-playing-preview"
          src={media.url || undefined}
          poster={thumb.url || undefined}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          aria-label={`Preview of ${name}`}
          className={cx('absolute inset-0 size-full object-cover pointer-events-none', COLOR.canvas, MOTION.transition.fade)}
        />
      )}
    </div>
  )
}

/** Secondary room facts: shown only when the player asks for them. */
function RoomDetails({ party, identity, profilePics }: {
  party: PartyRuntime
  identity: IdentityLike
  profilePics: Record<string, string>
}) {
  const currentEntry = party.queue.find((q) => q.id === party.current) || null
  const readyCount = currentEntry ? (party.ready?.[currentEntry.id] || []).length : 0
  const syncLabel = !currentEntry
    ? null
    : currentEntry.local
      ? `${readyCount}/${party.members.length} ready`
      : 'synced'

  return (
    <details className={cx('border-b', COLOR.edge, 'group/details')}>
      <summary
        className={cx(
          'flex items-center justify-between cursor-pointer list-none',
          PADDING_X[3], PADDING_Y[2],
          TYPE.caption, 'font-bold uppercase', TRACKING.wider, COLOR.muted,
          COLOR.hoverW10, COLOR.hoverFg, MOTION.transition.micro,
        )}
      >
        Details
        <ChevronDown className={cx(ICON.sm, MOTION.transition.transform, 'group-open/details:rotate-180')} aria-hidden />
      </summary>
      <div className={cx(PADDING_X[3], PADDING_Y[2], 'space-y-1')}>
        <p className={cx('flex items-center gap-1.5', MUTED)}>
          <Users className={ICON.sm} aria-hidden />
          {party.members.length} watching
        </p>
        {party.mediaName && <p className={cx('truncate', MUTED)}>{party.mediaName}</p>}
        {currentEntry && (
          <p className={cx('truncate font-mono text-2xs', MUTED)}>
            via {currentEntry.provider || 'direct'} · {syncLabel}
          </p>
        )}
        <p className={cx(TYPE.caption, 'font-bold uppercase', TRACKING.wider, COLOR.fg)}>In this room</p>
        {party.members.length > 0 && (
          <ul className="space-y-1.5 max-h-36 overflow-y-auto styled-scrollbar">
            {party.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Avatar id={m.id} size={18} imageUrl={profilePics[m.id] || null} />
                <span className={cx(TYPE.body, COLOR.fg, 'truncate flex-1')}>{m.name || m.id}</span>
                {m.muted && <span className={cx(TYPE.caption, 'uppercase', TRACKING.wider, MUTED)}>muted</span>}
                {m.id === party.host && <span className={cx(TYPE.caption, 'uppercase', TRACKING.wider, MUTED)}>host</span>}
                {m.id === identity.orbitId && <span className={cx(TYPE.caption, 'uppercase', TRACKING.wider, MUTED)}>you</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

export function WatchPartyView({ identity, profilePics }: { identity: IdentityLike; profilePics: Record<string, string> }) {
  const { parties, kickedNotice } = useWatchParty()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  // Small windows start with the rail tucked away so the video keeps focus.
  const [railOpen, setRailOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 900,
  )
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

  // BROWSE MODE: one panel, one action to create, one field to join.
  if (!inRoom) {
    return (
      <div className="p-2 sm:p-4 h-full flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className={cn('flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden', COLOR.panel, RADIUS.panel, 'border', COLOR.edge)}>
          <div className={CHROME.barHeader}>
            <h3 className={cx(TYPE.body, 'font-bold', TRACKING.wider, COLOR.fg, 'flex items-center gap-2 text-balance')}>
              <Clapperboard className={cx(ICON.md, COLOR.accent)} aria-hidden />
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

  // ROOM MODE: full-bleed video; the rail holds only the room identity, the
  // queue and chat. Everything else is one Details disclosure away.
  return (
    <div
      data-testid="watch-room-root"
      className={cn(
        'group/watch relative h-full flex-1 flex flex-row min-h-0 overflow-hidden',
        // Reserve the floating CommandIsland's strip so the rail's bottom (the
        // chat composer) never slides under it. The whole view is height-bounded
        // (min-h-0 + overflow-hidden) and the rail scrolls internally, so the
        // page itself never overflows.
        'pb-[var(--island-clearance)]',
      )}
    >
      {/* The theater owns the remaining height. The transport bar is anchored to
          this bounded column's bottom, so the controls never reach the island
          strip the root reserves below it. */}
      <div data-testid="watch-theater" className={cn('flex-1 min-w-0 min-h-0 relative flex flex-col overflow-hidden', COLOR.canvas)}>
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

        <WatchPartyTimeline
          party={active}
          isHost={!!canControl}
          onToggleRail={() => setRailOpen((v) => !v)}
          railOpen={railOpen}
        />
      </div>

      <aside
        className={cn(
          'w-72 lg:w-80 shrink-0 h-full flex-col min-h-0 overflow-hidden border-l z-20',
          COLOR.edge, COLOR.panel,
          railOpen ? ['flex', MOTION.keyframe.fadeIn] : 'hidden',
        )}
      >
        {active && <WatchRoomHeader party={active} identity={identity} profilePics={profilePics} />}
        {active && <NowPlayingCard party={active} identity={identity} />}
        {active && <RoomDetails party={active} identity={identity} profilePics={profilePics} />}

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
