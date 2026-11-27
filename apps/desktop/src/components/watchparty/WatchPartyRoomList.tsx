'use client'

// Watch browse gallery. One create action, one join field, then room cards on
// a shared grid. Every card has the same edges, the same thumbnail ratio and
// the same footer alignment — no gradients, no decorative badges over media.

import { useEffect, useState } from 'react'
import { Film, History, Play, Plus, Ticket, Users } from 'lucide-react'
import { cn } from '../../lib/utils'
import { orbitFetch } from '../../utils/api'
import { joinPartyById, rememberedRooms, type RememberedRoom } from '../../hooks/watchPartyStore'
import { watchInviteFromHash } from './invite'
import { useObjectImage } from '../../hooks/useObjectImage'
import { Button, Input } from '../../ui/kit'
import {
  CHROME,
  COLOR,
  ICON,
  MONO,
  MOTION,
  PADDING,
  PRESENCE,
  RADIUS,
  SHADOW,
  STATUS,
  TRACKING,
  TYPE,
  cx,
} from '../../ui/tokens'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

interface RoomItem {
  id: string
  name: string
  members: number
  mediaName?: string
  mediaUrl?: string
}

function RoomThumbnail({
  mediaUrl,
  name,
  identity,
}: {
  mediaUrl?: string
  name: string
  identity: IdentityLike
}) {
  const media = useObjectImage(mediaUrl || null, identity, { enabled: Boolean(mediaUrl) })

  if (media.url) {
    const isVideo = media.isVideo || mediaUrl?.includes('.mp4') || mediaUrl?.includes('.webm') || mediaUrl?.includes('/stream')
    return (
      <div className={cx('relative w-full h-full overflow-hidden', COLOR.canvas)}>
        {isVideo ? (
          <video
            src={media.url}
            muted
            preload="metadata"
            playsInline
            aria-label={name}
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <img src={media.url} alt={name} className="w-full h-full object-cover" />
        )}
      </div>
    )
  }

  return (
    <div className={cx('w-full h-full flex flex-col items-center justify-center border-b', COLOR.canvasSurface, COLOR.edgeSubtle)}>
      <span className={cx('p-3', RADIUS.panel, COLOR.surfaceRaised, 'border', COLOR.edge, SHADOW.sm)}>
        <Film className={cx(ICON.lg, COLOR.muted)} aria-hidden />
      </span>
    </div>
  )
}

export function WatchPartyRoomList({
  identity,
  onNewParty,
  kickedNotice,
  joinedIds = [],
}: {
  identity: IdentityLike
  onNewParty: () => void
  kickedNotice?: string
  /** Rooms currently open — a remembered room you are IN is not "recent". */
  joinedIds?: string[]
}) {
  const [rooms, setRooms] = useState<RoomItem[]>([])
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joinText, setJoinText] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState('')
  // Rooms this device remembers but is not currently in. Re-read whenever the
  // list mounts so a room left a moment ago shows up immediately.
  const [recents, setRecents] = useState<RememberedRoom[]>(() => rememberedRooms(joinedIds))
  const joinedKey = joinedIds.join(',')

  useEffect(() => {
    let dead = false
    void orbitFetch('/api/watchparty', {}, identity)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((b: any) => {
        if (!dead && Array.isArray(b.parties)) {
          setRooms(b.parties)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!dead) setFailed(true)
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
    return () => { dead = true }
  }, [identity])

  // Drop anything the server also lists (it is already a card below) and any
  // room we are currently in. Re-run when either changes, so leaving a room
  // makes it appear here immediately. joinedKey carries the joinedIds value
  // (the array identity changes on every render).
  useEffect(() => {
    if (loading) return
    const listed = rooms.map((r) => r.id)
    setRecents(rememberedRooms([...joinedIds, ...listed]))
  }, [rooms, loading, joinedKey])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 styled-scrollbar">
      {kickedNotice && (
        <p role="status" className={cx('mb-4 text-center', PADDING[3], RADIUS.control, 'border', STATUS.dangerEdge, STATUS.dangerBg, TYPE.body, STATUS.danger)}>
          {kickedNotice}
        </p>
      )}

      {/* One join field, one join action. The id or token never touches storage. */}
      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const raw = joinText.trim()
          if (!raw || joinBusy) return
          const parsed = watchInviteFromHash(raw.includes('?') || raw.includes('#') ? raw : `#/watch?room=${raw}`)
          if (!parsed) {
            setJoinError('Enter a room id or paste an invite link.')
            return
          }
          setJoinBusy(true)
          setJoinError('')
          void joinPartyById(identity, parsed.room, parsed.invite).then((ok) => {
            setJoinBusy(false)
            if (ok) setJoinText('')
            else setJoinError('Could not join that room. The id may be wrong, the invite expired, or the room closed.')
          })
        }}
      >
        <Ticket className={cx(ICON.md, COLOR.muted, 'shrink-0')} aria-hidden />
        <Input
          type="text"
          value={joinText}
          onChange={(e) => setJoinText(e.target.value)}
          placeholder="Room id or invite link"
          aria-label="Room id or invite link"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={!joinText.trim() || joinBusy} className="shrink-0">
          {joinBusy ? 'Joining…' : 'Join'}
        </Button>
      </form>
      {joinError && <p className={cx('mb-4', TYPE.body, STATUS.danger)}>{joinError}</p>}

      {/* Private rooms are hidden from the listing, so a room left a moment ago
          would otherwise vanish. These chips are the way back into it. */}
      {recents.length > 0 && (
        <div className="mb-5">
          <h3 className={cx(TYPE.body, 'font-bold', TRACKING.wider, COLOR.muted, 'mb-2 text-balance')}>
            Recently watched
          </h3>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => void joinPartyById(identity, r.id)}
                aria-label={`Reopen room ${r.name}`}
                className={cn(
                  CHROME.badge, COLOR.hoverW12, COLOR.hoverFg,
                  MOTION.transition.micro, 'cursor-pointer active:scale-(--scale-press)',
                )}
              >
                <History className={cx(ICON.sm, 'inline mr-1.5 -mt-0.5')} aria-hidden />
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* The single create action. */}
        <button
          type="button"
          onClick={onNewParty}
          aria-label="Create a new room"
          className={cn(
            'group relative flex flex-col aspect-video w-full items-center justify-center text-center',
            PADDING[5], RADIUS.panel, 'border border-dashed', COLOR.edge,
            COLOR.canvasSurfaceSoft, COLOR.hoverEdgeStrong,
            MOTION.transition.micro, 'cursor-pointer active:scale-(--scale-press)',
          )}
        >
          <span className={cx(
            'size-12 flex items-center justify-center', RADIUS.pill, COLOR.surfaceRaised,
            'border', COLOR.edge, COLOR.muted, COLOR.hoverFg, COLOR.hoverEdgeStrong,
            MOTION.transition.quick,
          )}>
            <Plus className={cx(ICON.lg, 'stroke-[2.5]')} aria-hidden />
          </span>
          <span className={cx(TYPE.body, 'font-bold', COLOR.fg)}>Create Room</span>
          <span className={cx(TYPE.body, COLOR.muted)}>Start a new watch party</span>
        </button>

        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void joinPartyById(identity, r.id)}
            aria-label={`Join room ${r.name}`}
            className={cn(
              'group relative flex flex-col w-full text-left overflow-hidden',
              RADIUS.panel, 'border', COLOR.edge, COLOR.surfaceRaised, SHADOW.sm,
              COLOR.hoverEdgeStrong, MOTION.transition.micro,
              'cursor-pointer active:scale-(--scale-press)',
            )}
          >
            <div className={cx('relative aspect-video w-full overflow-hidden', COLOR.canvas)}>
              <RoomThumbnail mediaUrl={r.mediaUrl} name={r.name} identity={identity} />

              <span className={cx(
                'absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5',
                CHROME.mediaChip, 'border', COLOR.edge, SHADOW.sm,
              )}>
                <Users className={ICON.sm} aria-hidden />
                <span className={MONO}>{r.members}</span>
              </span>

              <span className={cx(
                'absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100',
                COLOR.mediaVeil, MOTION.transition.fade,
              )}>
                <span className={cx('flex items-center justify-center', RADIUS.pill, COLOR.accentBg, COLOR.onAccent, SHADOW.sm)}>
                  <Play className={cx(ICON.md, 'fill-current ml-0.5')} aria-hidden />
                </span>
              </span>
            </div>

            <div className={cx(PADDING[3], 'flex flex-col flex-1 justify-between gap-1', 'border-t', COLOR.edgeSubtle)}>
              <div className="space-y-0.5 min-w-0">
                <h4 className={cx(TYPE.body, 'font-bold', COLOR.fg, 'truncate')}>{r.name}</h4>
                <p className={cx(TYPE.body, COLOR.muted, 'truncate')}>{r.mediaName || 'No media playing'}</p>
              </div>

              <div className={cx(
                'flex items-center justify-between pt-1.5 border-t',
                COLOR.edgeSubtle, TYPE.caption, COLOR.muted,
              )}>
                <span className="flex items-center gap-1.5">
                  <span className={cx('w-1.5 h-1.5 rounded-full', r.members > 0 ? PRESENCE.currentDot : PRESENCE.idleDot)} />
                  {r.members > 0 ? 'Active' : 'Persistent'}
                </span>
                <span className={cx(MONO, 'uppercase')}>{r.id.slice(0, 8)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {failed && (
        <p className={cx(
          'mt-8 mx-auto max-w-md flex items-center justify-center',
          PADDING[4], RADIUS.panel, 'border', STATUS.dangerEdge, STATUS.dangerBg,
          TYPE.body, STATUS.danger, 'text-pretty',
        )}>
          Could not load watch rooms. Check your connection and reopen Watch.
        </p>
      )}
    </div>
  )
}
