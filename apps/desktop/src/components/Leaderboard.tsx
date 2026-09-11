"use client";

import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { parseTags, type User } from '@orbit/shared'
import { Trophy, Crown } from 'lucide-react'

type Timeframe = 'all' | 'today'

export function Leaderboard({
  users,
  onSelectUser,
}: {
  users: User[]
  onSelectUser: (id: string) => void
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all')

  const metricFor = (u: User) =>
    timeframe === 'all' ? (u.reputation ?? u.score ?? 0) : (u.daily_score ?? u.score ?? 0)

  const rankedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const scoreA = metricFor(a)
      const scoreB = metricFor(b)
      if (scoreA !== scoreB) return scoreB - scoreA
      const countA = a.objects_sent_count ?? 0
      const countB = b.objects_sent_count ?? 0
      if (countA !== countB) return countB - countA
      if (a.online && !b.online) return -1
      if (!a.online && b.online) return 1
      return a.id.localeCompare(b.id)
    })
  }, [users, timeframe])

  const topSender = rankedUsers[0]

  return (
    <div className="bg-surface-raised border border-border-glass rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-glass pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-retro-accent" />
          <h2 className="text-sm font-medium text-retro-fg">Leaderboard</h2>
        </div>
        <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs">
          {(['all', 'today'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={`px-2.5 py-1 rounded transition-colors capitalize cursor-pointer font-medium ${timeframe === t ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Top Player */}
      {topSender && (
        <div className="bg-surface-interactive border border-border-glass rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <Avatar id={topSender.id} imageUrl={topSender.pfp_url || undefined} size={40} />
              <span className="absolute -top-1 -right-1 bg-retro-accent text-black text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                <Crown className="w-2.5 h-2.5 fill-current" />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-retro-fg truncate">
                  {topSender.display_name?.trim() || 'Unknown User'}
                </span>
                {(() => {
                  const tags = parseTags(topSender.tags);
                  return tags.length > 0 ? (
                    <div className="flex items-center gap-1">
                      {tags.slice(0, 2).map((t, idx) => (
                        <span key={idx} className="text-[10px] text-retro-muted">
                          #{t}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="text-xs text-retro-muted mt-0.5 flex items-center gap-2 flex-wrap">
                <span>Top player &middot; <strong className="text-retro-accent font-mono font-medium">{metricFor(topSender)} {timeframe === 'all' ? 'rep' : 'pts'}</strong></span>
                {topSender.matches_total !== undefined && (
                  <span>&middot; {topSender.matches_total} duels</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectUser(topSender.id)}
            className="px-3 py-1.5 text-xs font-medium bg-surface-interactive border border-border-glass text-retro-body hover:border-zinc-500 transition-colors flex-shrink-0 cursor-pointer rounded-lg"
          >
            View
          </button>
        </div>
      )}

      {/* Leaderboard List */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto styled-scrollbar pr-1">
        {rankedUsers.map((user, idx) => {
          const rank = idx + 1
          const isTop3 = rank <= 3

          return (
            <div
              key={user.id}
              className="bg-surface-interactive border border-border-glass rounded-lg p-2.5 flex items-center gap-3 hover:border-zinc-500 transition-colors"
            >
              <span className="w-5 flex items-center justify-center text-xs flex-shrink-0">
                {isTop3 ? (
                  <Trophy className={`w-3.5 h-3.5 ${rank === 1 ? 'text-retro-accent' : rank === 2 ? 'text-retro-body' : 'text-amber-700'}`} />
                ) : (
                  <span className="text-xs font-mono text-retro-muted">#{rank}</span>
                )}
              </span>

              <div className="relative flex-shrink-0">
                <Avatar id={user.id} imageUrl={user.pfp_url || undefined} size={32} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface-interactive ${user.online ? 'bg-retro-online' : 'bg-zinc-500'
                    }`}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-retro-body truncate">
                  {user.display_name?.trim() || 'Unknown User'}
                  </span>
                  <Badge variant="default">
                    {metricFor(user)} {timeframe === 'all' ? 'rep' : 'pts'}
                  </Badge>
                </div>
                <div className="text-[10px] text-retro-muted flex items-center gap-2 mt-0.5">
                  <span>{user.matches_total ?? 0} duels</span>
                  <span>&middot; {(user.matches_won ?? 0)}W / {(user.matches_lost ?? 0)}L</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelectUser(user.id)}
                className="px-2.5 py-1 text-xs font-medium bg-surface-raised border border-border-glass text-retro-body hover:border-zinc-500 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
              >
                View
              </button>
            </div>
          )
        })}
      </div>

      {rankedUsers.length === 0 && (
        <div className="text-center py-8 text-retro-muted text-xs border border-dashed border-border-glass rounded-lg p-4">
          No network users registered yet.
        </div>
      )}
    </div>
  )
}
