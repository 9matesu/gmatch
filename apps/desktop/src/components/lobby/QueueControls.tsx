"use client"

import { formatCountdown, formatElapsed, countdownMs } from '../../utils/lobby'
import { MIN_GAME_CARDS } from '@orbit/shared'
import type { useLobby } from '../../hooks/useLobby'
import { Play, Pause, MessageSquare, LayoutGrid } from 'lucide-react'

type LobbyState = ReturnType<typeof useLobby>

export interface QueueControlsProps {
  state: LobbyState['state']
  match: ReturnType<LobbyState['state'] extends infer S ? S extends null ? never : () => void : never> | null
  matchRoundInfo: { seq: number; max: number; deadline: number } | null
  autoQueueEnabled: boolean
  soundEnabled: boolean
  myCardsCount: number
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

export function QueueControls({ state, match, matchRoundInfo, autoQueueEnabled, myCardsCount, queuedSinceMs, showLeagueTab, onToggleAutoQueue, onOpenCreateCard, onOpenDeckBuilder, onShowLeagueTab, onOpenCardChat, toast, now }: QueueControlsProps) {
  const hasMatch = Boolean(match)

  return (
    <div className="flex items-center gap-2 flex-nowrap ml-auto">
      <button
        type="button"
        onClick={onOpenCardChat}
        className="border border-border-glass px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors flex items-center gap-1.5"
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
          className="px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer rounded-lg whitespace-nowrap bg-surface-interactive text-retro-muted border-border-glass hover:border-retro-fg hover:text-retro-fg flex items-center gap-1.5"
        >
          <Pause className="w-3.5 h-3.5" />
          Leave Queue
        </button>
      ) : myCardsCount < MIN_GAME_CARDS ? (
        <div
          className="flex items-stretch rounded-lg border border-cyan-500/40 overflow-hidden whitespace-nowrap"
          title={`Quick Play needs ${MIN_GAME_CARDS} cards in your active deck — you have ${myCardsCount}. Build one to continue.`}
        >
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="px-4 py-1.5 text-xs font-medium bg-surface-interactive text-retro-muted/60 cursor-not-allowed flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Quick Play
          </button>
          <button
            type="button"
            onClick={() => onOpenDeckBuilder ? onOpenDeckBuilder() : onOpenCreateCard?.()}
            className="px-4 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-300 border-l border-cyan-500/40 hover:bg-cyan-500/20 cursor-pointer transition-colors flex items-center gap-1.5"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Build Deck ({myCardsCount}/{MIN_GAME_CARDS})
          </button>
        </div>
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

      <button
        type="button"
        onClick={() => onShowLeagueTab(!showLeagueTab)}
        aria-pressed={showLeagueTab}
        title={showLeagueTab ? 'Back to player roster' : 'View league standings'}
        className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap border border-border-glass rounded-lg ${showLeagueTab
          ? 'bg-surface-interactive text-retro-fg'
          : 'bg-transparent text-retro-muted hover:text-retro-fg'
          }`}
      >
        League
      </button>
    </div>
  )
}
