'use client'

// Watch section room gallery (theater landing before a party is open).
// Displays a responsive grid of 16:9 cards:
// 1. First card: "Create Room" dashed silhouette card
// 2. Open rooms with video miniature/thumbnail, title, media title, and member count badge.

import { useEffect, useState } from 'react'
import { Plus, Users, Play, Film } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { joinPartyById } from '../../hooks/watchPartyStore'
import { useObjectImage } from '../../hooks/useObjectImage'

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
    if (media.isVideo || mediaUrl?.includes('.mp4') || mediaUrl?.includes('.webm') || mediaUrl?.includes('/stream')) {
      return (
        <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
          <video
            src={media.url}
            muted
            preload="metadata"
            playsInline
            className="w-full h-full object-cover pointer-events-none opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        </div>
      )
    }
    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
        <img
          src={media.url}
          alt={name}
          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-retro-panel to-surface-canvas flex flex-col items-center justify-center overflow-hidden border-b border-border-subtle group-hover:border-retro-fg/20 transition-colors">
      <div className="absolute inset-0 bg-radial from-retro-accent/5 to-transparent opacity-60" />
      <div className="p-3 rounded-2xl bg-surface-raised/80 border border-border-glass shadow-lg group-hover:scale-110 group-hover:border-retro-fg/30 transition-all duration-200">
        <Film className="w-6 h-6 text-retro-muted group-hover:text-retro-fg transition-colors" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
    </div>
  )
}

export function WatchPartyRoomList({
  identity,
  onNewParty,
  kickedNotice,
}: {
  identity: IdentityLike
  onNewParty: () => void
  kickedNotice?: string
}) {
  const [rooms, setRooms] = useState<RoomItem[]>([])
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 styled-scrollbar">
      {kickedNotice && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-retro-error/10 border border-retro-error/30 text-center text-xs text-retro-error">
          {kickedNotice}
        </div>
      )}

      {/* Gallery Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Create Room Silhouette Card */}
        <button
          type="button"
          onClick={onNewParty}
          aria-label="Create a new room"
          className="group relative flex flex-col aspect-video sm:aspect-auto sm:min-h-[220px] rounded-xl border border-dashed border-border-glass hover:border-retro-fg bg-surface-canvas/40 hover:bg-glass-w8 p-5 items-center justify-center text-center transition-all duration-200 cursor-pointer active:scale-[0.98] shadow-sm"
        >
          <div className="w-12 h-12 rounded-full border border-border-glass bg-surface-raised flex items-center justify-center text-retro-muted group-hover:text-retro-fg group-hover:border-retro-fg/50 group-hover:scale-110 transition-all duration-200 mb-3 shadow-md">
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </div>
          <span className="text-xs font-bold text-retro-fg group-hover:text-white transition-colors">
            Create Room
          </span>
          <span className="text-[11px] text-retro-muted mt-1">
            Start a new watch party
          </span>
        </button>

        {/* Existing Room Cards */}
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void joinPartyById(identity, r.id)}
            aria-label={`Join room ${r.name}`}
            className="group relative flex flex-col rounded-xl border border-border-glass hover:border-retro-fg/60 bg-surface-canvas/60 hover:bg-surface-raised/80 overflow-hidden text-left transition-all duration-200 cursor-pointer active:scale-[0.98] shadow-md hover:shadow-xl"
          >
            {/* 16:9 Thumbnail Area */}
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <RoomThumbnail mediaUrl={r.mediaUrl} name={r.name} identity={identity} />

              {/* Top-Right Member Badge */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-white border border-white/10 shadow-sm z-10">
                <Users className="w-3 h-3 text-retro-muted" />
                <span>{r.members}/8</span>
              </div>

              {/* Hover Play Button Overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40 backdrop-blur-[2px] z-10">
                <div className="p-3 rounded-full bg-white text-black shadow-lg transform group-hover:scale-110 transition-transform">
                  <Play className="w-4 h-4 fill-black text-black ml-0.5" />
                </div>
              </div>
            </div>

            {/* Room Info Bottom Area */}
            <div className="p-3 flex flex-col flex-1 justify-between gap-1 border-t border-border-glass/40">
              <div className="space-y-0.5 min-w-0">
                <h4 className="text-xs font-bold text-retro-fg truncate group-hover:text-white transition-colors">
                  {r.name}
                </h4>
                <p className="text-[11px] text-retro-muted truncate font-sans">
                  {r.mediaName || 'No media playing'}
                </p>
              </div>

              <div className="flex items-center justify-between pt-1.5 border-t border-border-subtle/40 text-[10px] text-retro-muted">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${r.members > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-retro-muted/40'}`} />
                  {r.members > 0 ? 'Active' : 'Persistent'}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-retro-muted/60">
                  {r.id.slice(0, 8)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {failed && (
        <div className="mt-8 p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-center max-w-md mx-auto text-xs text-red-400">
          Could not load watch rooms. Please check your network connection.
        </div>
      )}
    </div>
  )
}
