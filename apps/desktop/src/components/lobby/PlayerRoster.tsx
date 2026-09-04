"use client"

import { useMemo } from 'react'
import { parseTags, type User } from '@orbit/shared'
import { Avatar } from '../Avatar'

interface PlayerInfo {
  id: string
  display_name: string | null
  pfp_url: string | null
  tags: string[]
  queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online'
  activeMatchId?: string
  matchRound?: number
}

type Segment =
  | { kind: 'pair'; matchId: string; players: PlayerInfo[] }
  | { kind: 'solo'; player: PlayerInfo }

interface PlayerRosterProps {
  players: PlayerInfo[]
  selfId: string
  spectateRequesting: string | null
  users?: User[]
  onOpenProfile?: (user: User) => void
  onSpectate?: (matchId: string) => void
  loading?: boolean
  state?: unknown
}

function PlayerTile({
  player,
  selfId,
  users,
  onOpenProfile,
}: {
  player: PlayerInfo
  selfId: string
  users?: User[]
  onOpenProfile?: (user: User) => void
}) {
  const isPlaying = player.queueStatus === 'in_match'

  const handleClick = () => {
    const base = users?.find(u => u.id === player.id)
    const userObj: User = base
      ? {
          ...base,
          display_name: (player.display_name && player.display_name.trim()) ? player.display_name : base.display_name,
          pfp_url: player.pfp_url || base.pfp_url,
          tags: (player.tags && player.tags.length > 0 ? player.tags : base.tags) as string[],
        }
      : { id: player.id, display_name: player.display_name, pfp_url: player.pfp_url, tags: player.tags } as User
    onOpenProfile?.(userObj)
  }

  return (
    <div
      onClick={handleClick}
      title={`View ${player.display_name || 'player'}'s profile`}
      className={`relative aspect-[5/4] overflow-hidden rounded-lg border cursor-pointer group transition-all bg-surface-canvas ${
        isPlaying
          ? 'border-retro-accent/60'
          : player.queueStatus === 'in_queue'
          ? 'border-retro-warning/50'
          : player.id === selfId
          ? 'border-retro-accent/30'
          : 'border-retro-border'
      } hover:border-retro-accent/60`}
    >
      <Avatar id={player.id} imageUrl={player.pfp_url || undefined} fill />

      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

      <span
        className={`absolute top-1.5 left-1.5 z-20 text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
          isPlaying
            ? 'bg-surface-raised/90 text-retro-accent'
            : player.queueStatus === 'in_queue'
            ? 'bg-surface-raised/90 text-retro-warning'
            : player.queueStatus === 'idle'
            ? 'bg-surface-raised/90 text-retro-muted'
            : 'bg-surface-raised/90 text-retro-online'
        }`}
      >
        {isPlaying
          ? `R${player.matchRound || 1}/5`
          : player.queueStatus === 'in_queue'
          ? 'Queued'
          : player.queueStatus === 'idle'
          ? 'Idle'
          : 'Online'}
      </span>

      {player.id === selfId && (
        <span className="absolute top-1.5 right-1.5 z-20 text-[9px] font-semibold text-retro-accent">
          You
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 p-1.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleClick()
          }}
          className="text-[11px] font-medium truncate text-white drop-shadow"
          title={player.display_name || player.id}
        >
          <span className="truncate">
            {player.display_name?.trim() || 'Unknown User'}
          </span>
        </button>
        <div className="flex items-center gap-1 min-w-0 mt-0.5">
          {(() => {
            const tags = parseTags(player.tags)
            return tags.length > 0 ? (
              <span className="text-[9px] text-retro-muted truncate">
                {tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
              </span>
            ) : null
          })()}
        </div>
      </div>
    </div>
  )
}

function DuelPair({
  matchId,
  players,
  selfId,
  spectateRequesting,
  users,
  onOpenProfile,
  onSpectate,
}: {
  matchId: string
  players: PlayerInfo[]
  selfId: string
  spectateRequesting: string | null
  users?: User[]
  onOpenProfile?: (user: User) => void
  onSpectate?: (matchId: string) => void
}) {
  return (
    <div className="col-span-2 sm:col-span-3 md:col-span-4 lg:col-span-5">
      <div className="flex items-center justify-between gap-3 bg-surface-raised border border-retro-border rounded-lg px-3 py-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 text-[11px] font-medium text-retro-muted truncate">
          <span className="w-1.5 h-1.5 rounded-full bg-retro-accent flex-shrink-0" />
          {players.map((m, index) => (
            <span key={m.id} className="inline-flex min-w-0 items-center">
              {index > 0 && <span className="mx-1">vs</span>}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  const base = users?.find((u) => u.id === m.id)
                  onOpenProfile?.(base ? { ...base, display_name: m.display_name || base.display_name, pfp_url: m.pfp_url || base.pfp_url } : {
                    id: m.id,
                    display_name: m.display_name,
                    pfp_url: m.pfp_url,
                    tags: m.tags,
                  } as User)
                }}
                className="truncate text-retro-body hover:text-retro-accent hover:underline cursor-pointer"
                title={`View ${m.display_name?.trim() || 'Unknown User'}'s profile`}
              >
                {m.display_name?.trim() || 'Unknown User'}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {players.map((p) => (
          <PlayerTile
            key={p.id}
            player={p}
            selfId={selfId}
            users={users}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={spectateRequesting === matchId}
        onClick={() => void onSpectate?.(matchId)}
        className="mt-1.5 w-full py-2 text-xs font-medium text-retro-accent bg-surface-raised border border-retro-accent/30 hover:bg-surface-interactive rounded-lg cursor-pointer transition-colors disabled:opacity-40"
      >
        {spectateRequesting === matchId ? 'Connecting...' : 'Spectate'}
      </button>
    </div>
  )
}

export function PlayerRoster({
  players,
  selfId,
  spectateRequesting,
  users,
  onOpenProfile,
  onSpectate,
  loading,
  state,
}: PlayerRosterProps) {
  const segments = useMemo<Segment[]>(() => {
    const result: Segment[] = []
    const placed = new Set<string>()
    for (const p of players) {
      if (placed.has(p.id)) continue
      if (p.queueStatus === 'in_match' && p.activeMatchId) {
        const members = players.filter((m) => m.activeMatchId === p.activeMatchId)
        for (const m of members) placed.add(m.id)
        result.push({ kind: 'pair', matchId: p.activeMatchId, players: members })
      } else {
        placed.add(p.id)
        result.push({ kind: 'solo', player: p })
      }
    }
    return result
  }, [players])

  if (loading && !state) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-retro-border p-3 flex flex-col items-center gap-2 rounded">
              <div className="skeleton w-8 h-8 rounded-full" />
              <div className="skeleton w-full h-3" />
              <div className="skeleton w-16 h-2.5" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (players.length === 0) {
    return (
      <div className="border border-dashed border-retro-border rounded-lg p-8 text-center">
        <p className="text-xs text-retro-muted">Nobody online yet.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'pair') {
          return (
            <DuelPair
              key={`pair-${seg.matchId}-${segIdx}`}
              matchId={seg.matchId}
              players={seg.players}
              selfId={selfId}
              spectateRequesting={spectateRequesting}
              users={users}
              onOpenProfile={onOpenProfile}
              onSpectate={onSpectate}
            />
          )
        }
        return (
          <PlayerTile
            key={seg.player.id}
            player={seg.player}
            selfId={selfId}
            users={users}
            onOpenProfile={onOpenProfile}
          />
        )
      })}
    </div>
  )
}

export type { PlayerInfo }
