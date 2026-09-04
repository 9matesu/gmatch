"use client"

import { formatCountdown, formatElapsed, countdownMs } from '../../utils/lobby'
import { MIN_GAME_CARDS } from '@orbit/shared'
import type { useLobby } from '../../hooks/useLobby'
import { Play, Pause, MessageSquare, LayoutGrid } from 'lucide-react'

type LobbyState = ReturnType<typeof useLobby>

interface QueueControlsProps {
  state: LobbyState['state']
  match: ReturnType<LobbyState['state'] extends infer S ? S extends null ? never : () => void : never> | null
  matchRoundInfo: { seq: number; max: number; deadline: number } | null
  autoQueueEnabled: boolean
  soundEnabled: boolean
  myCardsCount: number
  mergedPlayersCount: number
  queuedSinceMs: number
  showLeagueTab: boolean
  onToggleAutoQueue: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  onOpenCreateCard?: () => void
  onOpenDeckBuilder?: () => void
  onShowLeagueTab: (show: boolean) => void
  onOpenCardChat?: () => void
  toast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  now: number
}

export function QueueControls({
  state,
  match,
  matchRoundInfo,
  autoQueueEnabled,
  soundEnabled,
  myCardsCount,
  mergedPlayersCount,
  queuedSinceMs,
  showLeagueTab,
  onToggleAutoQueue,
  onOpenCreateCard,
  onOpenDeckBuilder,
  onShowLeagueTab,
  onOpenCardChat,
  toast,
  now,
}: QueueControlsProps) {
  const hasMatch = Boolean(match)

  return (
    <div className="flex items-center gap-2 flex-nowrap ml-auto">
      {onOpenDeckBuilder && !match && (
        <button
          type="button"
          onClick={onOpenDeckBuilder}
          className="border border-retro-border px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors flex items-center gap-1.5"
          title="Manage and select your active duel deck"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-cyan-300" />
          Decks
        </button>
      )}

      <button
        type="button"
        onClick={onOpenCardChat}
        className="border border-retro-border px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors flex items-center gap-1.5"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Card Chat
      </button>

      {hasMatch && matchRoundInfo ? (
        <span className="text-xs font-medium text-retro-accent whitespace-nowrap tabular-nums">
          In match R{matchRoundInfo.seq}/{matchRoundInfo.max} · {formatCountdown(countdownMs(matchRoundInfo.deadline, now))}
        </span>
      ) : autoQueueEnabled ? (
        <span className="text-xs font-medium text-retro-warning whitespace-nowrap tabular-nums">
          Queued · {state?.waiting_count || 1} waiting · {formatElapsed(queuedSinceMs)}
        </span>
      ) : null}

      {match ? null : autoQueueEnabled ? (
        <button
          type="button"
          onClick={() => { void onToggleAutoQueue(false); }}
          className="px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer rounded-lg whitespace-nowrap bg-surface-interactive text-retro-muted border-retro-border hover:border-retro-fg hover:text-retro-fg flex items-center gap-1.5"
        >
          <Pause className="w-3.5 h-3.5" />
          Leave Queue
        </button>
      ) : myCardsCount < MIN_GAME_CARDS ? (
        <button
          type="button"
          title={`Build a 5-card deck to play — you need at least ${MIN_GAME_CARDS} cards in your active deck.`}
          onClick={() => onOpenDeckBuilder ? onOpenDeckBuilder() : onOpenCreateCard?.()}
          className="px-4 py-1.5 text-xs font-bold bg-surface-interactive text-cyan-300 border border-cyan-500/40 rounded-lg whitespace-nowrap cursor-pointer hover:bg-cyan-500/10 flex items-center gap-1.5"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Build Deck ({myCardsCount}/5)
        </button>
      ) : (
        <button
          type="button"
          onClick={async () => { const r = await onToggleAutoQueue(true); if (!r.ok) { toast(r.error || 'Could not join the queue.', 'warning'); } }}
          className="px-4 py-1.5 text-xs font-medium bg-retro-accent text-black hover:bg-retro-accent-hover transition-colors cursor-pointer rounded-lg whitespace-nowrap flex items-center gap-1.5"
        >
          <Play className="w-3.5 h-3.5" />
          Queue for Perverts
        </button>
      )}

      <div className="flex items-center border border-retro-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => onShowLeagueTab(false)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${!showLeagueTab
            ? 'bg-surface-interactive text-retro-fg'
            : 'bg-transparent text-retro-muted hover:text-retro-fg'
            }`}
        >
          Gooners ({mergedPlayersCount})
        </button>
        <div className="w-px h-4 bg-retro-border" />
        <button
          type="button"
          onClick={() => onShowLeagueTab(true)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${showLeagueTab
            ? 'bg-surface-interactive text-retro-fg'
            : 'bg-transparent text-retro-muted hover:text-retro-fg'
            }`}
        >
          League
        </button>
      </div>
    </div>
  )
}
