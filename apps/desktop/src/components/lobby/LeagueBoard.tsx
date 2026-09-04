"use client"

import type { LeagueEntry, User } from '@orbit/shared'
import { Avatar } from '../Avatar'

interface LeagueBoardProps {
  league: LeagueEntry[]
  users?: User[]
  onOpenProfile?: (user: User) => void
}

export function LeagueBoard({ league, users, onOpenProfile }: LeagueBoardProps) {
  if (league.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-retro-muted">
        No ranked matches recorded yet. Complete 5-round duels to earn League Points!
      </div>
    )
  }

  return (
    <div className="space-y-1.5 max-h-96 overflow-y-auto styled-scrollbar">
      {league.map((entry, rank) => (
        <div
          key={entry.user_id}
          onClick={() => {
            const userObj = users?.find(u => u.id === entry.user_id) || { id: entry.user_id, display_name: entry.display_name } as User
            onOpenProfile?.(userObj)
          }}
          className="border border-retro-border rounded p-2.5 bg-retro-panel flex items-center justify-between gap-3 hover:border-retro-accent transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-xs font-black font-mono w-6 text-center ${
              rank === 0 ? 'text-yellow-400' : rank === 1 ? 'text-retro-body' : rank === 2 ? 'text-amber-600' : 'text-retro-muted'
            }`}>
              {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
            </span>
            <Avatar id={entry.user_id} size={28} />
            <div className="min-w-0 truncate">
              <span className="text-xs font-bold text-retro-fg truncate">{entry.display_name?.trim() || 'Unknown User'}</span>
              <span className="text-[10px] text-retro-muted ml-2">{entry.wins} Wins · Tier {entry.tier}</span>
            </div>
          </div>
          <div className="text-xs font-black text-retro-accent font-mono shrink-0">
            {entry.points} PTS
          </div>
        </div>
      ))}
    </div>
  )
}
