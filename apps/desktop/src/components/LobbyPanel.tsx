"use client";

import { useMemo, useState, useRef, useEffect } from 'react'
import { type OrbitObject, type User, type LeagueEntry } from '@orbit/shared'
import type { OrbitIdentity } from '@orbit/crypto'
import { currentMatch } from '../utils/lobby'
import type { useLobby } from '../hooks/useLobby'
import { MatchRoundPanel } from './MatchRoundPanel'
import { YourMatchTab } from './YourMatchTab'
import { orbitFetch } from '../utils/api'
import { playQueueJoin, playMatch } from '../utils/sounds'
import { SpectateModal } from './SpectateModal'
import { useToast } from './Toast'
import { useConfirm } from './ConfirmDialog'
import { MatchChat } from './MatchChat'



import { LeagueBoard } from './lobby/LeagueBoard'
import { PlayerRoster } from './lobby/PlayerRoster'
import { QueueControls } from './lobby/QueueControls'
import { CardTile } from './home/CardTile'
import { openCardDetail } from '../utils/openCard'

type IdentityLike = OrbitIdentity | null;

interface Props {
  lobby: ReturnType<typeof useLobby>
  identity: IdentityLike | null
  myCards: OrbitObject[]
  soundEnabled: boolean
  onOpenImage?: (url: string) => void
  onExpandItem?: (itemId: string) => void
  onOpenHelp?: () => void
  onOpenProfile?: (user: User) => void
  users?: User[]
  onOpenSpectateItem?: (items: OrbitObject[], initialId: string) => void
  onOpenCardChat?: () => void
  onOpenCreateCard?: () => void
  onOpenDeckBuilder?: () => void
  // Override functions that request notification permission
  toggleAutoQueue?: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  sendInvite?: (userId: string) => Promise<{ ok: boolean; error?: string }>
}

export function LobbyPanel({ lobby, identity, myCards, soundEnabled, onExpandItem, onOpenProfile, users, onOpenSpectateItem, onOpenCardChat, onOpenCreateCard, onOpenDeckBuilder, toggleAutoQueue }: Props) {
const { state, joined, autoQueueEnabled, loading, toggleAutoQueue: lobbyToggleAutoQueue, spectateMatch, closeSpectate, spectatingMatchId, spectatingSnapshot, liveMatches, pickCard, decide, quitMatch, activeSpecials, submitSpecialCard, endSpecialMatch, decideSpecialMatch, onlineUsers } = lobby

  // Use passed-in override functions if provided, otherwise fall back to lobby functions
  const effectiveToggleAutoQueue = toggleAutoQueue ?? lobbyToggleAutoQueue

const selfId = identity?.orbitId || ''
  const { toast } = useToast()
  const confirm = useConfirm()
  const [spectateRequesting, setSpectateRequesting] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [dismissedExpired, setDismissedExpired] = useState(false)
  const [league, setLeague] = useState<LeagueEntry[]>([])
  const [showLeagueTab, setShowLeagueTab] = useState(false)

  // Load league ranks
  useEffect(() => {
    if (!identity) return
    let active = true
    const loadLeague = async () => {
      try {
        const res = await orbitFetch('/api/lobby/league', { method: 'GET' }, identity)
        if (res.ok && active) {
          const data = await res.json()
          setLeague(data.league || [])
        }
      } catch { }
    }
    loadLeague()
    const id = setInterval(loadLeague, 15000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [identity])

  // Most recent special match that ended by idle timeout (opponent AFK).
  const latestExpired = useMemo(() => {
    const recent = lobby.specialMatches?.recent || []
    return recent.find((m) => m.last_result === 'expired') || null
  }, [lobby.specialMatches])

  useEffect(() => {
    if (!lobby.specialMatches?.recent?.some((m) => m.last_result === 'expired')) {
      setDismissedExpired(false)
    }
  }, [lobby.specialMatches])

  useEffect(() => {
    if (!joined && !autoQueueEnabled && !state?.match && activeSpecials.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [joined, autoQueueEnabled, state?.match, activeSpecials.length])

  const match = useMemo(() => currentMatch(state), [state])
  const matchRoundInfo = useMemo(
    () => (match ? { seq: match.round_seq || 1, max: match.max_rounds || 5, deadline: match.phase_deadline ?? 0 } : null),
    [match]
  )
  
  const matchPanelKey = match ? match.id : null

  const prevCount = useRef<number | null>(null)
  const prevWaiting = useRef<number | null>(null)
  useEffect(() => {
    if (state?.waiting_count == null) return
    if (prevWaiting.current != null && state.waiting_count > prevWaiting.current && soundEnabled) {
      playQueueJoin()
    }
    prevWaiting.current = state.waiting_count
  }, [state?.waiting_count, soundEnabled])

  useEffect(() => {
    if (state?.match && prevCount.current === null && soundEnabled) {
      playMatch()
    }
    prevCount.current = state?.match ? 1 : 0
  }, [state?.match, soundEnabled])

  const prevResultRef = useRef<string | null>(null)
  useEffect(() => {
    const result = state?.match?.result ?? null
    if (result && result !== prevResultRef.current) {
      if (result === 'winner_a' || result === 'winner_b') {
        const won = (result === 'winner_a' && state?.match?.user_a_info?.id === selfId) || (result === 'winner_b' && state?.match?.user_b_info?.id === selfId)
        toast(won ? 'Match victory. +50 points.' : 'Match complete.', won ? 'success' : 'info')
      } else if (result === 'draw') {
        toast('Match draw. +10 points.', 'info')
      } else if (result === 'quit' && state?.match?.forfeit_user && state.match.forfeit_user !== 'both' && state.match.forfeit_user !== selfId) {
        toast('Opponent forfeited. You win.', 'success')
      }
    }
    prevResultRef.current = result
  }, [state?.match?.result, state?.match?.score_mine, state?.match?.score_opponent, state?.match?.forfeit_user, selfId, toast])

  const players = state?.players || []

  // Merged player list: all recently-seen online users, annotated with match & queue status.
  const mergedPlayers = useMemo(() => {
    const queueMap = new Map(players.map((p) => [p.user_id, p]))
    const usersMap = new Map((users || []).map((u) => [u.id, u]))
    const seen = new Set<string>()
    const result: Array<{
      id: string
      display_name: string | null
      pfp_url: string | null
      tags: string[]
      queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online'
      activeMatchId?: string
      matchRound?: number
    }> = []

    const resolveName = (id: string, directName?: string | null): string | null => {
      if (directName && directName.trim()) return directName
      const fromUsers = usersMap.get(id)?.display_name
      if (fromUsers && fromUsers.trim()) return fromUsers
      if (id === selfId && typeof window !== 'undefined') {
        try {
          const local = localStorage.getItem('orbit_display_name')
          if (local && local.trim()) return local
        } catch { }
      }
      return null
    }

    const resolvePfp = (id: string, directPfp?: string | null): string | null => {
      if (directPfp) return directPfp
      return usersMap.get(id)?.pfp_url || null
    }

    const findMatch = (userId: string) => {
      return liveMatches.find((m) => m.user_a.id === userId || m.user_b.id === userId)
    }

    // Roster ordering is intentionally stable: players in the lobby queue are
    // listed first in their joined_at order (new players append to the right,
    // existing positions never shift), then any other online users.
    for (const p of players) {
      seen.add(p.user_id)
      const userEntry = usersMap.get(p.user_id)
      const lm = findMatch(p.user_id)
      const isSelfInMatch = p.user_id === selfId && Boolean(state?.match)

      let queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online' = 'online'
      if (lm || isSelfInMatch || p.status === 'in_match') {
        queueStatus = 'in_match'
      } else if (p.status === 'waiting' && (p.auto_queue ?? true)) {
        queueStatus = 'in_queue'
      } else if (p.auto_queue === false || p.status === 'idle') {
        queueStatus = 'idle'
      }

      result.push({
        id: p.user_id,
        display_name: resolveName(p.user_id, p.display_name),
        pfp_url: resolvePfp(p.user_id, p.pfp_url),
        tags: Array.isArray(p.tags) && p.tags.length > 0 ? (p.tags as string[]) : (userEntry?.tags || []),
        queueStatus,
        activeMatchId: lm?.id || (isSelfInMatch ? state?.match?.id : undefined),
        matchRound: lm?.round_seq || (isSelfInMatch ? state?.match?.round_seq : undefined),
      })
    }

    for (const u of onlineUsers) {
      if (seen.has(u.id)) continue
      seen.add(u.id)
      const qp = queueMap.get(u.id)
      const userEntry = usersMap.get(u.id)
      const lm = findMatch(u.id)
      const isSelfInMatch = u.id === selfId && Boolean(state?.match)

      let queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online' = 'online'
      if (lm || isSelfInMatch || qp?.status === 'in_match') {
        queueStatus = 'in_match'
      } else if (qp?.status === 'waiting' && (qp.auto_queue ?? true)) {
        queueStatus = 'in_queue'
      } else if (qp?.auto_queue === false || qp?.status === 'idle') {
        queueStatus = 'idle'
      }

      result.push({
        id: u.id,
        display_name: resolveName(u.id, u.display_name),
        pfp_url: resolvePfp(u.id, u.pfp_url),
        tags: (u.tags && u.tags.length > 0) ? u.tags : (userEntry?.tags || []),
        queueStatus,
        activeMatchId: lm?.id || (isSelfInMatch ? state?.match?.id : undefined),
        matchRound: lm?.round_seq || (isSelfInMatch ? state?.match?.round_seq : undefined),
      })
    }

    // Always ensure the local logged-in player is in the list
    if (selfId && !seen.has(selfId)) {
      const userEntry = usersMap.get(selfId)
      const lm = findMatch(selfId)
      result.unshift({
        id: selfId,
        display_name: resolveName(selfId, userEntry?.display_name),
        pfp_url: resolvePfp(selfId, userEntry?.pfp_url),
        tags: userEntry?.tags || [],
        queueStatus: lm ? 'in_match' : autoQueueEnabled ? 'in_queue' : 'idle',
        activeMatchId: lm?.id,
        matchRound: lm?.round_seq,
      })
    }

    return result
  }, [onlineUsers, players, users, liveMatches, state?.match, selfId, autoQueueEnabled])

  const lobbyPlayers = useMemo(() => {
    const ordered: typeof mergedPlayers = []
    const placed = new Set<string>()
    // 1. Group active dueling pairs side by side
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'in_match' && p.activeMatchId && !placed.has(p.id)) {
        const members = mergedPlayers.filter((m) => m.activeMatchId === p.activeMatchId)
        for (const m of members) placed.add(m.id)
        ordered.push(...members)
      }
    }
    // 2. Queued players
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'in_queue' && !placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    // 3. Idle / Paused players
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'idle' && !placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    // 4. Remaining online players
    for (const p of mergedPlayers) {
      if (!placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    return ordered
  }, [mergedPlayers])

  // Render segments: dueling pairs are grouped as one unit so a single
  // combined SPECTATE row renders above each matched pair, followed by the
  // two player tiles. Everyone else renders as an individual tile.
  



  const [queuedSinceFallback, setQueuedSinceFallback] = useState<number | null>(null)
  useEffect(() => {
    if (autoQueueEnabled) {
      setQueuedSinceFallback((prev) => prev ?? Date.now())
    } else {
      setQueuedSinceFallback(null)
    }
  }, [autoQueueEnabled])

  const selfQueueRow = state?.players.find((p) => p.user_id === selfId)
  const queuedSinceRaw = selfQueueRow?.waiting_since || selfQueueRow?.joined_at
  const queuedSinceMs = queuedSinceRaw
    ? Math.max(0, now - new Date(queuedSinceRaw).getTime())
    : (autoQueueEnabled && queuedSinceFallback ? Math.max(0, now - queuedSinceFallback) : 0)

  // Let the page footer refetch users/score immediately after a match action
  // awards points server-side (decisions, forfeits, special-tier climbs).
  const refreshScore = () => {
    try { window.dispatchEvent(new CustomEvent('orbit-score-refresh')) } catch { }
  }

  const handlePickCard = async (matchId: string, cardId: string): Promise<boolean> => {
    const ok = await pickCard(matchId, cardId)
    if (ok) refreshScore()
    return ok
  }

  const handleDecide = async (matchId: string, decision: 'like' | 'reject' | 'boost') => {
    const res = await decide(matchId, decision)
    refreshScore()
    return res
  }

  const handleQuit = async (matchId: string, opts?: { alreadyEnded?: boolean }): Promise<boolean> => {
    // Don't bother the player with a "Quit this match?" confirm when the
    // match has already ended (phase=result) and they're just leaving the
    // scoreboard view to go back to the lobby. That forward flow should be
    // frictionless.
    if (!opts?.alreadyEnded && typeof window !== 'undefined') {
      const confirmed = await confirm({
        title: 'Quit this match?',
        description: 'You will forfeit the duel and the current round.',
        confirmLabel: 'Quit',
        tone: 'danger',
      })
      if (!confirmed) return false
    }
    const ok = await quitMatch(matchId)
    refreshScore()
    return ok
  }

  const handlePlaySpecialCard = async (matchId: string, cardId: string): Promise<boolean> => {
    const ok = await submitSpecialCard(cardId, matchId)
    refreshScore()
    return ok
  }

  // Called from the result-phase "PLAY AGAIN" button — re-enters the lobby
  // queue after a match has ended. Uses `toggleAutoQueue(true)` so the server
  // enforces the same card-count gate as the regular Quick-Play entry.
  const handlePlayAgain = async () => {
    const r = await effectiveToggleAutoQueue(true)
    if (!r.ok) {
      toast(r.error || 'Could not re-join the queue.', 'warning')
    }
  }

  const handleDecideSpecial = async (matchId: string, decision: 'like' | 'reject') => {
    const res = await decideSpecialMatch(matchId, decision)
    refreshScore()
    return res
  }

  const handleEndSpecial = async (matchId: string): Promise<boolean> => {
    const ok = await endSpecialMatch(matchId)
    refreshScore()
    return ok
  }

  

  

  

  const handleSpectate = async (matchId: string) => {
    if (spectateRequesting) return
    setSpectateRequesting(matchId)
    toast('Entering spectator mode…', 'info')
    try {
      await spectateMatch(matchId)
    } catch {
      toast('Could not join spectator view', 'error')
    } finally {
      setSpectateRequesting(null)
    }
  }

  return (
    <div className={match ? "flex flex-col gap-6 pb-14" : "space-y-6"}>
      {/* Active 5-Round Match Panel (When In Match) */}
      {match && matchPanelKey && (
        <div key={matchPanelKey} className="animate-orbit-slide-up grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] gap-5 items-start">
          <MatchRoundPanel
            match={match}
            players={players}
            users={users}
            identity={identity}
            myCards={myCards}
            soundEnabled={soundEnabled}
            onPick={handlePickCard}
            onDecide={handleDecide}
            onQuit={handleQuit}
            onPlayAgain={handlePlayAgain}
            onOpenProfile={onOpenProfile}
            onOpenDeckBuilder={onOpenDeckBuilder}
          />
          {/* Match chat pinned to the left column so it stays visible beside the duel */}
          <div className="lg:sticky lg:top-[72px]">
            <MatchChat
              matchId={match.id}
              selfId={selfId}
              messages={lobby.matchChats[match.id] || []}
              onSend={lobby.sendMatchChat}
              onLoad={lobby.loadMatchChat}
              soundEnabled={soundEnabled}
            />
          </div>
        </div>
      )}

      {/* Your Match — Special Match Ladder (if active) */}
      {activeSpecials.length > 0 && activeSpecials.map((specialMatch) => (
        <div key={specialMatch.id} className="space-y-2">
          <YourMatchTab
            match={specialMatch}
            selfId={selfId}
            myCards={myCards}
            identity={identity}
            soundEnabled={soundEnabled}
            users={users}
            onPlayCard={handlePlaySpecialCard}
            onDecide={handleDecideSpecial}
            onEnd={handleEndSpecial}
            onOpenProfile={onOpenProfile}
          />
          <MatchChat
            matchId={specialMatch.id}
            selfId={selfId}
            messages={lobby.matchChats[specialMatch.id] || []}
            onSend={lobby.sendMatchChat}
            onLoad={lobby.loadMatchChat}
            soundEnabled={soundEnabled}
          />
        </div>
      ))}

      {/* Expired special-match notice */}
      {!dismissedExpired && latestExpired && (
        <div className="border border-retro-warning/50 bg-retro-warning/5 p-3 flex items-center justify-between gap-3 rounded-lg animate-orbit-fade-in">
          <p className="text-xs text-retro-muted">
            <span className="text-retro-warning font-medium">Match expired</span>
            {' — '}{latestExpired.opponent_name?.trim() || 'Unknown User'} went idle. You&apos;ve been re-queued.
          </p>
          <button
            type="button"
            onClick={() => setDismissedExpired(true)}
            className="text-xs font-medium text-retro-muted hover:text-retro-fg border border-retro-border px-2 py-1 cursor-pointer rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 01 — Online Players Roster & League (hidden while in a match) */}
      {!match && (
        <>
          <section className="module">
            <div className="module-header flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <span className="module-title">Players</span>
                <span className="module-subtitle">
                  {mergedPlayers.length} online
                </span>
              </div>

<QueueControls
                state={state}
                match={match}
                matchRoundInfo={matchRoundInfo}
                autoQueueEnabled={autoQueueEnabled}
                soundEnabled={soundEnabled}
                myCardsCount={myCards.length}
                queuedSinceMs={queuedSinceMs}
                showLeagueTab={showLeagueTab}
                onToggleAutoQueue={effectiveToggleAutoQueue}
                onOpenCreateCard={onOpenCreateCard}
                onOpenDeckBuilder={onOpenDeckBuilder}
                onShowLeagueTab={setShowLeagueTab}
                onOpenCardChat={onOpenCardChat}
                toast={toast}
                now={now}
              />
            </div>

            <div className="module-body space-y-3">
              {showLeagueTab ? (
                <LeagueBoard league={league} users={users} onOpenProfile={onOpenProfile} />
              ) : (
                <PlayerRoster
                  players={lobbyPlayers}
                  selfId={selfId}
                  spectateRequesting={spectateRequesting}
                  users={users}
                  onOpenProfile={onOpenProfile}
                  onSpectate={handleSpectate}
                  loading={loading}
                  state={state}
                />
              )}
            </div>
          </section>

          {/* 02 — Your Cards: collection strip right below the player cards */}
          <section className="module">
            <div className="module-header flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <span className="module-title">Your Cards</span>
                <span className="module-subtitle">
                  {myCards.length} in collection
                </span>
              </div>
              {onOpenDeckBuilder && (
                <button
                  type="button"
                  onClick={onOpenDeckBuilder}
                  className="border border-retro-border px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors"
                >
                  Open collection
                </button>
              )}
            </div>
            <div className="module-body">
              {myCards.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs text-retro-muted">No cards yet — forge one or win duels to build your deck.</p>
                  {onOpenCreateCard && (
                    <button
                      type="button"
                      onClick={onOpenCreateCard}
                      className="px-3 py-1.5 text-xs font-bold bg-retro-accent text-black hover:bg-retro-accent-hover transition-colors cursor-pointer rounded-lg whitespace-nowrap"
                    >
                      Create Card
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 select-none">
                  {myCards.slice(0, 10).map((card) => (
                    <CardTile
                      key={card.id}
                      item={card as any}
                      users={users}
                      identity={identity}
                      onClick={() => openCardDetail(card)}
                      onDoubleClick={() => onExpandItem?.(card.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

        </>
      )}

      {/* Floating Spectator Modal Overlay */}
      {spectatingMatchId && (
        <SpectateModal
          match={spectatingSnapshot}
          onClose={closeSpectate}
          soundEnabled={soundEnabled}
          onOpenItem={onOpenSpectateItem}
          identity={identity}
        />
      )}
    </div>
  )
}
