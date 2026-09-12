"use client";

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchSnapshot, LobbyState, OrbitObject, User } from '@orbit/shared'
import { countdownMs, formatCountdown, matchWindowMs, opponentCardId, resolveDisplayName, myCardId } from '../utils/lobby'
import { useObjectImage } from '../hooks/useObjectImage'
import {
  playCountdownOnce,
  playTimeoutOnce,
  playLikeOnce,
  playRejectOnce,
  playMatchOnce,
  playUpload,
} from '../utils/sounds'
import type { LobbyDecisionResult, LobbyDecisionFailure } from '../hooks/useLobby'
import { CardZoomModal } from './CardZoomModal'
import { computeCardRarity, formatGc, matchEconomy } from '@orbit/shared'
import { isMediaVideo } from '../utils/media'
import { MediaBadge } from './MediaBadge'
import { CardBack } from './CardBack'
import { ObjectImage } from './ObjectImage'
import { ValuationSummary } from './game/ValuationSummary'
import { ZoomIn, Check, X, Sparkles, Heart, Zap, Link as LinkIcon,   LayoutGrid } from 'lucide-react'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

interface Props {
  match: MatchSnapshot | null
  players: LobbyState['players']
  users?: User[] | null
  identity: IdentityLike | null
  myCards: OrbitObject[]
  soundEnabled: boolean
  onPick: (matchId: string, cardId: string) => Promise<boolean>
  onDecide: (matchId: string, decision: 'like' | 'reject' | 'boost') => Promise<LobbyDecisionResult | LobbyDecisionFailure | null>
  onQuit: (matchId: string, opts?: { alreadyEnded?: boolean }) => Promise<boolean>
  onPlayAgain?: () => Promise<void>
  onOpenProfile?: (user: User) => void
  onOpenDeckBuilder?: () => void
}

export function MatchRoundPanel({
  match,
  players,
  users,
  identity,
  myCards,
  soundEnabled,
  onPick,
  onDecide,
  onQuit,
  onPlayAgain,
  onOpenProfile,
  onOpenDeckBuilder,
}: Props) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState<number>(() => Date.now())
  const [lastResult, setLastResult] = useState<{ matched: boolean; points?: number } | null>(null)
  const [decideError, setDecideError] = useState<string | null>(null)
  const [localDecidedRound, setLocalDecidedRound] = useState<number | null>(null)
  const [boostsRemaining, setBoostsRemaining] = useState<number>(1)
  const [notices, setNotices] = useState<string[]>([])
  const [zoomModal, setZoomModal] = useState<{ isOpen: boolean; imageUrl: string | null; isVideo?: boolean; title?: string; subtitle?: string; caption?: string }>({
    isOpen: false,
    imageUrl: null,
  })
  const prevPhase = useRef<string | null>(null)
  const prevMatchId = useRef<string | null>(null)
  const prevRound = useRef<number | null>(null)
  const timedOutRef = useRef<boolean>(false)

  const phase = match?.phase ?? null
  const currentRound = match?.round_seq || 1
  const maxRounds = match?.max_rounds || 5
  const playedCards = match?.played_cards || []
  // The card I have on the table this round — its value prices my boost.
  const myCardVal = Math.max(0, ...myCards
    .filter((c) => c.id === (match?.my_card || ''))
    .map((c) => Number((c as { value?: number }).value ?? c.gacha_downloads_count ?? 0))
    .concat(0))
  // Deck exhaustion: every card I own is already used this match. The server
  // then allows replaying a used card so a player with fewer cards than
  // rounds can keep the duel going — mirror that here by re-enabling the grid.
  const deckExhausted = myCards.length > 0 && myCards.every((c) => playedCards.includes(c.id))
  const roundsHistory = match?.rounds_history || []
  const opponentName = match ? resolveDisplayName(match.opponent.id, { users, players, fallbackName: match.opponent.display_name }) : ''

  // Full user record for the opponent so the profile popup can follow/DM them.
  const opponentUser = useMemo<User>(() => {
    const base = users?.find((u) => u.id === match?.opponent.id)
    if (base) return base
    return { id: match?.opponent.id ?? '', display_name: match?.opponent.display_name, pfp_url: match?.opponent.pfp_url } as User
  }, [users, match?.opponent.id, match?.opponent.display_name, match?.opponent.pfp_url])

  useEffect(() => {
    if (!phase) return
    if (phase !== prevPhase.current || currentRound !== prevRound.current) {
      prevPhase.current = phase
      prevRound.current = currentRound
      timedOutRef.current = false
      setSelectedCard(null)
      setLocalDecidedRound(null)
      if (phase === 'round_result') {
        if (soundEnabled && match?.matched) playMatchOnce()
      }
      setDecideError(null)
    }
  }, [phase, currentRound, soundEnabled, match?.matched])

  useEffect(() => {
    if (!phase) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Final-seconds countdown tick & timeout buzzer
  useEffect(() => {
    if ((phase !== 'decide' && phase !== 'lobby' && phase !== 'pick') || !soundEnabled) return
    if (!match) return
    const ms = countdownMs(match.phase_deadline, now)
    if (ms > 0 && ms <= 5000) {
      playCountdownOnce()
    } else if (ms <= 0 && !timedOutRef.current) {
      timedOutRef.current = true
      playTimeoutOnce()
    }
  }, [now, phase, match, soundEnabled])

  useEffect(() => {
    if (!identity) return
    if (prevMatchId.current !== match?.id) {
      prevMatchId.current = match?.id ?? null
      setNotices([])
      setLastResult(null)
      setSelectedCard(null)
      setLocalDecidedRound(null)
      setBoostsRemaining(typeof match?.boosts_remaining === 'number' ? match.boosts_remaining : 1)
    } else if (typeof match?.boosts_remaining === 'number') {
      setBoostsRemaining(match.boosts_remaining)
    }
  }, [match?.id, match?.boosts_remaining, identity])

  const oppCardId = opponentCardId(match)
  const myPlayedCardId = myCardId(match)
  const opponentImg = useObjectImage(oppCardId, identity)
  const myPlayedImg = useObjectImage(myPlayedCardId, identity)

  if (!phase || !match) return null

  const countdown = formatCountdown(countdownMs(match.phase_deadline, now))
  const msLeft = Math.max(0, countdownMs(match.phase_deadline, now))
  const windowMs = matchWindowMs(match)
  const pct = windowMs > 0 ? Math.min(100, Math.round((msLeft / windowMs) * 100)) : 0
  const isMyDecided = Boolean(match.my_decided) || localDecidedRound === currentRound
  const waitingDecide = phase === 'decide' && isMyDecided && !match.opponent_decided
  const isRoundResult = phase === 'round_result'
  const isResult = phase === 'result'


  const handlePick = async (cardId: string): Promise<boolean> => {
    if (submitting) return false
    setSubmitting(true)
    setSelectedCard(cardId)
    setNotices((n) => [...n, `Round ${currentRound} card played — waiting for reveal.`])
    const ok = await onPick(match.id, cardId)
    if (ok && soundEnabled) playUpload()
    setSubmitting(false)
    return ok
  }

  const handleDecide = async (decision: 'like' | 'reject' | 'boost') => {
    if (submitting) return
    setSubmitting(true)
    setDecideError(null)
    setLocalDecidedRound(currentRound)
    if (decision === 'boost') {
      setBoostsRemaining((prev) => Math.max(0, prev - 1))
    }
    if (soundEnabled) {
      if (decision === 'like' || decision === 'boost') playLikeOnce()
      else playRejectOnce()
    }
    const result = await onDecide(match.id, decision)
    if (result && !('ok' in result)) {
      const res = result as LobbyDecisionResult
      setLastResult({ matched: Boolean(res.matched), points: res.points_awarded })
      setNotices((n) => [
        ...n,
        decision === 'boost' ? 'Conviction Boost cast!' : res.matched ? 'Mutual like. It\'s a match!' : 'Decision recorded.',
      ])
    } else if (result && 'ok' in result) {
      setLocalDecidedRound(null)
      if (result.status === 410) {
        setDecideError('Match already ended — a new one is coming.')
      } else {
        setDecideError(result.error || 'Couldn\'t record your decision — try again.')
      }
    } else {
      setLocalDecidedRound(null)
    }
    setSubmitting(false)
  }

  const handleQuit = async () => {
    if (submitting) return
    setSubmitting(true)
    setNotices((n) => [...n, 'You left the match.'])
    await onQuit(match.id)
    setSubmitting(false)
  }

  // "RETURN TO LOBBY" / "PLAY AGAIN" on the result-phase scoreboard. These
  // are forward-only transitions — the match has already ended — so the
  // quit confirm should be skipped.
  const handleQuitEnded = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onQuit(match.id, { alreadyEnded: true })
    } finally {
      // Held across the await so a rapid double-click is ignored by the
      // guard above (the panel unmounts anyway once the WS /quit ack
      // arrives and the optimistic clear fires).
      setSubmitting(false)
    }
  }

  return (
    <section className="module module-primary">
      <div className="module-header allow-wrap flex items-center gap-2">
        <span className="module-title flex items-center gap-2 min-w-0">
          {match.opponent.pfp_url ? (
            <img
              src={match.opponent.pfp_url}
              alt=""
              className="w-5 h-5 rounded-full border border-border-glass object-cover flex-shrink-0"
            />
          ) : null}
          <span className="truncate text-sm">
            vs{' '}
            <button
              type="button"
              onClick={() => onOpenProfile?.(opponentUser)}
              title={`View ${opponentName}'s profile`}
              className="text-retro-fg font-medium hover:underline cursor-pointer"
            >
              {opponentName}
            </button>
          </span>
        </span>

        {/* Score */}
        <div className="flex items-center gap-1 px-2 py-0.5 bg-surface-interactive border border-border-glass rounded-md text-xs tabular-nums">
          <span className="text-retro-accent font-medium">{match.score_mine || 0}</span>
          <span className="text-retro-muted">:</span>
          <span className="text-retro-fg font-medium">{match.score_opponent || 0}</span>
        </div>

        <span className="module-subtitle module-subtitle-truncate ml-auto hidden sm:inline text-retro-muted text-xs">
          R{currentRound}/{maxRounds}
        </span>
        <span className={`module-subtitle ml-2 text-retro-fg tabular-nums text-xs ${phase === 'result' ? '' : 'animate-orbit-pulse-soft'}`}>{countdown}</span>
      </div>

      <div className="module-body space-y-2">
        {/* Round Progress */}
        <div className="flex items-center justify-between gap-1 p-2 bg-surface-canvas border border-border-glass rounded-lg">
          <div className="text-xs font-medium text-retro-muted">
            Progress
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: maxRounds }).map((_, idx) => {
              const rNum = idx + 1
              const past = roundsHistory.find((h) => h.round === rNum)
              const isCurrent = rNum === currentRound
              return (
                <div
                  key={rNum}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium border rounded transition-colors ${isCurrent && !isResult
                      ? 'border-retro-accent bg-glass-w10 text-retro-accent'
                      : past
                        ? past.matched
                          ? 'border-retro-online/40 bg-retro-online/10 text-retro-online'
                          : 'border-border-glass bg-surface-interactive text-retro-muted'
                        : 'border-border-glass/40 bg-transparent text-retro-muted/40'
                    }`}
                >
                  <span>R{rNum}</span>
                  {past && <span>{past.matched ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}</span>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="h-1 w-full bg-surface-interactive border border-border-glass rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ease-linear ${isResult ? 'bg-retro-muted' : msLeft <= 10000 ? 'bg-rose-500' : 'bg-retro-accent'}`}
              style={{ width: `${isResult ? 100 : pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-retro-muted">
            <span>
              {phase === 'lobby'
                ? 'Match starting'
                : phase === 'pick'
                  ? 'Pick a card'
                  : phase === 'reveal'
                    ? 'Revealing cards'
                    : phase === 'decide'
                      ? 'Like or reject'
                      : phase === 'round_result'
                        ? `Round ${currentRound} complete`
                        : isResult
                          ? 'Match complete'
                          : 'Waiting'}
            </span>
            <span>{isResult ? '0:00' : countdown}</span>
          </div>
        </div>

        {notices.length > 0 && (
          <div className="space-y-1">
            {notices.slice(-2).map((msg, i) => (
              <div key={i} className="border border-retro-accent/30 bg-glass-w5 p-2 text-xs text-retro-fg animate-orbit-fade-in rounded">
                {msg}
              </div>
            ))}
          </div>
        )}

        {phase === 'lobby' && (
          <div className="border border-dashed border-border-glass p-4 text-center space-y-2 rounded-lg">
            <p className="text-xs text-retro-muted">
              Matched with <span className="text-retro-fg font-medium">{opponentName}</span>
            </p>
            <p className="text-xs text-retro-muted">
              Starting in <span className="text-retro-accent tabular-nums">{countdown}</span>
            </p>
          </div>
        )}

        {phase === 'pick' && (
          <>
            <div className="border border-border-glass p-2.5 text-xs text-retro-muted flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg">
              <span className="font-medium text-retro-fg">Round {currentRound}/{maxRounds}:</span>
              <span>
                {deckExhausted
                  ? 'Deck exhausted — cards can be replayed.'
                  : 'Pick a card to play.'}
              </span>
            </div>

            {match.my_card ? (
              <div className="py-2 space-y-3 animate-orbit-fade-in">
                <div className="grid grid-cols-2 gap-3 items-center">
                  {/* Player's locked-in card */}
                  {(() => {
                    const c = myCards.find(card => card.id === match.my_card)
                    const val = Math.max(0, (c as any)?.value ?? c?.gacha_downloads_count ?? 0)
                    const rarity = computeCardRarity(val)
                    const name = c?.caption || 'Your Card'
                    return (
                      <div className="space-y-1 text-center">
                        <div
                          className="metallic-card-border w-full max-w-[280px] aspect-[3/4.2] mx-auto select-none"
                          data-rarity={rarity.rarity}
                        >
                          <div className="metallic-card flex flex-col h-full">
                            <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border shadow-md ${rarity.badgeClass}`}>
                                {rarity.label}
                              </span>
                              <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/80 text-amber-300 border border-amber-400/40 shadow-md backdrop-blur-xs">
                                {formatGc(val)}
                              </span>
                            </div>
                            <span className="absolute bottom-2 right-2 z-20 text-[10px] bg-retro-accent text-black font-black px-2 py-0.5 rounded-md shadow-md">
                              Locked in
                            </span>
                            <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                              {myPlayedImg?.url || c?.content_url ? (
                                <ObjectImage
                                  contentUrl={c?.content_url}
                                  objectId={c?.id}
                                  identity={identity}
                                  className="w-full h-full object-cover"
                                  videoClassName="pointer-events-none w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-surface-interactive flex items-center justify-center text-xs text-retro-muted">
                                  Locked
                                </div>
                              )}
                            </div>
                            <div className="p-2 bg-surface-canvas/90 border-t border-border-glass backdrop-blur-md text-left">
                              <div className="text-xs font-semibold text-retro-fg truncate">{name}</div>
                              <div className="text-[10px] font-mono text-retro-muted truncate">by You</div>
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-medium text-retro-muted">You</div>
                      </div>
                    )
                  })()}

                  {/* Opponent's placeholder / card-back */}
                  <div className="space-y-1 text-center">
                    <div className="metallic-card-border w-full max-w-[280px] aspect-[3/4.2] mx-auto select-none" data-rarity="common">
                      <div className="metallic-card flex flex-col items-center justify-center h-full p-3 bg-surface-interactive/50">
                        {match.opponent_played ? (
                          <div className="space-y-2">
                            <CardBack className="w-16 h-22 mx-auto" />
                            <div className="text-xs text-retro-accent font-black tracking-wide">Card submitted</div>
                          </div>
                        ) : (
                          <div className="space-y-2 text-retro-muted">
                            <div className="w-12 h-16 border border-dashed border-border-glass rounded-lg mx-auto flex items-center justify-center text-sm opacity-50">?</div>
                            <div className="text-[10px]">Picking card...</div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] font-medium text-retro-muted">{opponentName || 'Opponent'}</div>
                  </div>
                </div>

                <div className="p-2.5 bg-surface-interactive border border-border-glass rounded-lg text-center text-xs text-retro-fg">
                  {match.opponent_played ? 'Both cards submitted — revealing soon' : `Waiting for ${opponentName}...`}
                </div>
              </div>
            ) : (
              <>
                {match.opponent_played && (
                  <div className="border border-retro-accent/30 bg-glass-w5 p-2 text-center text-xs text-retro-fg animate-orbit-fade-in rounded-lg">
                    {opponentName} played — select your card!
                  </div>
                )}

                {myCards.length === 0 ? (
                  <div className="border border-border-glass p-6 text-center text-xs text-retro-muted space-y-3 rounded-xl bg-surface-canvas/40">
                    <p className="text-retro-fg font-semibold">No playable cards in your active deck.</p>
                    <p className="text-retro-muted text-xs">Select or build a 5-card deck in the Deck Builder to play duels.</p>
                    {onOpenDeckBuilder && (
                      <button
                        type="button"
                        onClick={onOpenDeckBuilder}
                        className="px-4 py-2 bg-retro-accent text-black font-bold text-xs rounded-lg hover:bg-retro-accent-hover transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        Open Deck Builder
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[min(34vh,22rem)] overflow-y-auto styled-scrollbar p-0.5">
                      {myCards.map((card) => {
                        const isVid = isMediaVideo(card.content_url) || Boolean(card.mime_type?.startsWith('video/'))
                        const cardVal = Math.max(0, (card as any).value ?? card.gacha_downloads_count ?? 0)
                        const rarity = computeCardRarity(cardVal)
                        const isAlreadyPlayed = !deckExhausted && playedCards.includes(card.id)
                        return (
                          <button
                            key={card.id}
                            disabled={isAlreadyPlayed}
                            onClick={() => !isAlreadyPlayed && setSelectedCard(card.id)}
                            className={`relative aspect-square overflow-hidden border-2 transition-all rounded ${rarity.borderClass} ${isAlreadyPlayed
                                ? 'opacity-30 grayscale cursor-not-allowed border-border-glass'
                                : selectedCard === card.id
                                  ? 'border-retro-fg ring-2 ring-retro-fg/30'
                                  : 'hover:border-retro-muted'
                              }`}
                          >
                            {card.content_url ? (
                              <ObjectImage
                                contentUrl={card.content_url}
                                objectId={card.id}
                                identity={identity}
                                className="w-full h-full object-cover"
                                videoClassName="pointer-events-none w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-retro-border" />
                            )}
                            {isVid && (
                              <span className="absolute bottom-0.5 left-0.5 text-[10px] bg-black/80 text-retro-fg font-medium px-1 rounded">
                                Video
                              </span>
                            )}
                            <div className="absolute top-0.5 left-0.5 flex items-center gap-0.5 z-10">
                              <span className={`text-[10px] font-medium px-1 rounded ${rarity.badgeClass}`}>
                                {rarity.label}
                              </span>
                              <span className="text-[10px] font-mono font-bold px-1 rounded bg-black/80 text-amber-300 border border-amber-500/30">
                                {formatGc(cardVal)}
                              </span>
                            </div>
                            {isAlreadyPlayed && (
                              <span className="absolute inset-0 bg-black/70 flex items-center justify-center text-[10px] font-medium text-rose-400 p-1 text-center rounded">
                                Used
                              </span>
                            )}
                            {selectedCard === card.id && !isAlreadyPlayed && (
                              <span className="absolute top-0.5 right-0.5 text-[10px] bg-retro-fg text-retro-bg font-medium px-1 rounded">Selected</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
                <button
                  disabled={!selectedCard || submitting}
                  onClick={() => selectedCard && handlePick(selectedCard)}
                  className="w-full py-2.5 text-xs font-medium bg-retro-fg text-retro-bg disabled:opacity-30 hover:opacity-90 cursor-pointer rounded-lg transition-opacity"
                >
                  {submitting ? 'Playing...' : `Play card — Round ${currentRound}`}
                </button>
              </>
            )}
          </>
        )}

        {(phase === 'reveal' || waitingDecide) && (
          <div className="border border-border-glass p-3 text-center text-xs text-retro-muted animate-orbit-fade-in rounded-lg">
            {phase === 'reveal' ? (
              <>
                <span className="font-medium text-retro-fg">Cards revealed</span> — deciding in {countdown}
              </>
            ) : (
              <>
                <span className="font-medium">Decision recorded</span> — waiting for {opponentName}
              </>
            )}
          </div>
        )}

        {isRoundResult && (
          <div className="border border-retro-accent/30 bg-glass-w5 p-3 text-center text-xs animate-orbit-fade-in space-y-1 rounded-lg">
            <div className="font-medium text-retro-fg flex items-center justify-center gap-2">
              <span>Round {currentRound}:</span>
              {match.matched ? (
                <span className="text-retro-online font-medium flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Match! +50 pts</span>
              ) : (
                <span className="text-retro-muted">No match</span>
              )}
            </div>
            <div className="text-xs text-retro-muted">
              Next round in <span className="text-retro-fg tabular-nums">{countdown}</span>
            </div>
          </div>
        )}

        {(phase === 'reveal' || phase === 'decide' || waitingDecide || isRoundResult) && (
          <div className="grid grid-cols-2 gap-3 max-w-2xl mx-auto w-full">
            {/* Player's card */}
            {(() => {
              const myCardObj = myCards.find(c => c.id === (match.my_card || myPlayedCardId))
              const myVal = Math.max(0, (myCardObj as any)?.value ?? myCardObj?.gacha_downloads_count ?? 0)
              const myRarity = computeCardRarity(myVal)
              const myTitle = myCardObj?.caption || 'Your Card'

              return (
                <div className="space-y-1 text-center">
                  <div
                    className={`metallic-card-border w-full aspect-[3/4.2] mx-auto select-none transition-all ${
                      isRoundResult && match.matched ? 'ring-2 ring-emerald-400 shadow-2xl' : ''
                    } ${myPlayedImg.url ? 'cursor-pointer' : ''}`}
                    data-rarity={myRarity.rarity}
                    onClick={() => {
                      if (myPlayedImg.url) {
                        setZoomModal({
                          isOpen: true,
                          imageUrl: myPlayedImg.url,
                          isVideo: myPlayedImg.isVideo,
                          title: myTitle,
                          subtitle: `Valuation: ${formatGc(myVal)} · Round ${currentRound}`,
                        })
                      }
                    }}
                  >
                    <div className="metallic-card flex flex-col h-full">
                      {/* Top Badges */}
                      <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border shadow-md ${myRarity.badgeClass}`}>
                          {myRarity.label}
                        </span>
                        <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/80 text-amber-300 border border-amber-400/40 shadow-md backdrop-blur-xs">
                          {formatGc(myVal)}
                        </span>
                      </div>

                      <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/80 border border-border-glass text-retro-fg text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" />
                          <span>Zoom</span>
                        </div>
                      </div>

                      {/* Image container */}
                      <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                        {myPlayedImg.url ? (
                          myPlayedImg.isVideo ? (
                            <>
                              <video src={myPlayedImg.url} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                              <MediaBadge className="absolute bottom-1.5 right-1.5" />
                            </>
                          ) : (
                            <img src={myPlayedImg.url} alt="Your card" className="w-full h-full object-cover" />
                          )
                        ) : myPlayedImg.isLink ? (
                          <a
                            href={myPlayedImg.linkUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full h-full flex flex-col items-center justify-center gap-2 text-retro-muted hover:text-retro-fg transition-colors"
                            title={myPlayedImg.linkUrl || undefined}
                          >
                            <LinkIcon className="w-5 h-5 text-purple-400" />
                            <span className="text-xs font-medium">Link card</span>
                            <span className="text-[10px] font-mono border border-border-glass px-2 py-0.5 rounded">Open ↗</span>
                          </a>
                        ) : (
                          <CardBack label="Your card" />
                        )}

                        {/* Decision stamp */}
                        {isRoundResult && match.my_decision && (
                          <span
                            className={`absolute bottom-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-lg ${
                              match.my_decision === 'like' ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'
                            }`}
                          >
                            {match.my_decision === 'like' ? <><Check className="w-3 h-3 stroke-[3]" /> Liked</> : <><X className="w-3 h-3 stroke-[3]" /> Rejected</>}
                          </span>
                        )}
                      </div>

                      {/* Card Info Footer */}
                      <div className="p-2 bg-surface-canvas/90 border-t border-border-glass backdrop-blur-md text-left">
                        <div className="text-xs font-semibold text-retro-fg truncate">{myTitle}</div>
                        <div className="text-[10px] font-mono text-retro-muted truncate">by You</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] font-medium text-retro-muted">You</div>
                </div>
              )
            })()}

            {/* Opponent's card */}
            {(() => {
              const oppVal = match.valuation_summary?.cardOfTheMatch?.ownerId === opponentUser?.id
                ? (match.valuation_summary.cardOfTheMatch.pointDelta || 100)
                : 100
              const oppRarity = computeCardRarity(oppVal)
              const oppTitle = `${opponentName}'s Card`

              return (
                <div className="space-y-1 text-center">
                  <div
                    className={`metallic-card-border w-full aspect-[3/4.2] mx-auto select-none transition-all ${
                      isRoundResult && match.matched ? 'ring-2 ring-emerald-400 shadow-2xl' : ''
                    } ${opponentImg.url ? 'cursor-pointer hover:opacity-80' : ''}`}
                    data-rarity={oppRarity.rarity}
                    onClick={() => {
                      if (opponentImg.url) {
                        setZoomModal({
                          isOpen: true,
                          imageUrl: opponentImg.url,
                          isVideo: opponentImg.isVideo,
                          title: oppTitle,
                          subtitle: `Round ${currentRound}`,
                        })
                      }
                    }}
                  >
                    <div className="metallic-card flex flex-col h-full">
                      {/* Top Badges */}
                      {opponentImg.url && (
                        <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border shadow-md ${oppRarity.badgeClass}`}>
                            {oppRarity.label}
                          </span>
                          <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/80 text-amber-300 border border-amber-400/40 shadow-md backdrop-blur-xs">
                            {formatGc(oppVal)}
                          </span>
                        </div>
                      )}

                      <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/80 border border-border-glass text-retro-fg text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" />
                          <span>Zoom</span>
                        </div>
                      </div>

                      {/* Image container */}
                      <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                        {opponentImg.url ? (
                          opponentImg.isVideo ? (
                            <>
                              <video src={opponentImg.url} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                              <MediaBadge className="absolute bottom-1.5 right-1.5" />
                            </>
                          ) : (
                            <img src={opponentImg.url} alt="Opponent card" className="w-full h-full object-cover" />
                          )
                        ) : opponentImg.isLink ? (
                          <a
                            href={opponentImg.linkUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full h-full flex flex-col items-center justify-center gap-2 text-retro-muted hover:text-retro-fg transition-colors"
                            title={opponentImg.linkUrl || undefined}
                          >
                            <LinkIcon className="w-5 h-5 text-purple-400" />
                            <span className="text-xs font-medium">Link card</span>
                            <span className="text-[10px] font-mono border border-border-glass px-2 py-0.5 rounded">Open ↗</span>
                          </a>
                        ) : opponentImg.failed ? (
                          <div className="w-full h-full flex items-center justify-center text-retro-muted text-xs">
                            Card unavailable
                          </div>
                        ) : (
                          <CardBack label={phase === 'reveal' ? 'Revealing...' : 'Waiting for card'} className="animate-orbit-pulse-soft" />
                        )}

                        {/* Decision stamp */}
                        {isRoundResult && match.opponent_decision && (
                          <span
                            className={`absolute bottom-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-lg ${
                              match.opponent_decision === 'like' ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'
                            }`}
                          >
                            {match.opponent_decision === 'like' ? <><Check className="w-3 h-3 stroke-[3]" /> Liked</> : <><X className="w-3 h-3 stroke-[3]" /> Rejected</>}
                          </span>
                        )}
                      </div>

                      {/* Card Info Footer */}
                      <div className="p-2 bg-surface-canvas/90 border-t border-border-glass backdrop-blur-md text-left">
                        <div className="text-xs font-semibold text-retro-fg truncate">{oppTitle}</div>
                        <div className="text-[10px] font-mono text-retro-muted truncate">by {opponentName}</div>
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] font-medium text-retro-muted">{opponentName}</div>
                </div>
              )
            })()}
          </div>
        )}

        {phase === 'decide' && !isMyDecided && (
          <>
            <p className="text-center text-xs text-retro-muted">
              Both cards revealed — decide if you like <span className="text-retro-fg font-medium">{opponentName}</span>&apos;s card
            </p>
            {lastResult && (
              <div className={`border p-3 text-center text-sm font-medium animate-orbit-slide-up rounded-lg ${lastResult.matched ? 'text-retro-fg border-retro-accent bg-glass-w10 animate-orbit-match-flux' : 'text-retro-muted border-border-glass'}`}>
                {lastResult.matched ? 'It\'s a match!' : 'Decision recorded'}
                {typeof lastResult.points === 'number' && lastResult.points > 0 && (
                  <span className="ml-2 text-retro-accent font-medium">+{lastResult.points} pts</span>
                )}
              </div>
            )}
            {decideError && (
              <div className="border border-border-glass p-3 text-center text-xs text-retro-muted rounded-lg">
                {decideError}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                disabled={submitting}
                onClick={() => handleDecide('reject')}
                className="py-2.5 px-2 text-xs font-medium border border-border-glass text-retro-muted hover:text-rose-400 hover:border-rose-500/30 cursor-pointer rounded-lg bg-surface-interactive hover:bg-rose-500/5 transition-colors flex items-center justify-center gap-1.5"
                title="Reject (-5 pts)"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reject</span>
              </button>
              <button
                disabled={submitting}
                onClick={() => handleDecide('like')}
                className="py-2.5 px-2 text-xs font-medium bg-retro-fg text-retro-bg hover:bg-retro-fg/90 cursor-pointer rounded-lg transition-colors flex items-center justify-center gap-1.5"
                title="Like (+10 pts)"
              >
                <Heart className="w-3.5 h-3.5 fill-current text-rose-400" />
                <span>Like</span>
              </button>
              <button
                disabled={submitting || boostsRemaining <= 0}
                onClick={() => handleDecide('boost')}
                className={`py-2.5 px-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${boostsRemaining > 0
                    ? 'bg-glass-w10 text-retro-accent border-retro-accent/30 hover:bg-glass-w20'
                    : 'opacity-40 border-border-glass text-retro-muted cursor-not-allowed bg-surface-interactive'
                  }`}
                title={boostsRemaining > 0 ? `Conviction Boost (+25 pts) — costs ${formatGc(matchEconomy(myCardVal, 0).boostCost)} g$` : 'No boosts remaining'}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Boost {boostsRemaining > 0 ? `(${boostsRemaining} · ${formatGc(matchEconomy(myCardVal, 0).boostCost)} g$)` : ''}</span>
              </button>
            </div>
          </>
        )}

        {isResult && (
          <ValuationSummary
            match={match}
            identity={identity}
            myCards={myCards}
            onPlayAgain={onPlayAgain}
            onReturnToLobby={handleQuitEnded}
            submitting={submitting}
          />
        )}

        {(phase === 'lobby' || phase === 'pick' || phase === 'reveal' || phase === 'decide') && (
          <button
            disabled={submitting}
            onClick={handleQuit}
            className="w-full py-2 text-xs font-medium text-retro-muted hover:text-retro-fg border border-border-glass hover:border-retro-fg cursor-pointer rounded-lg transition-colors"
          >
            {submitting ? 'Leaving...' : 'Leave match'}
          </button>
        )}
      </div>

      {/* Fullscreen Card Zoom Lightbox Modal */}
      <CardZoomModal
        isOpen={zoomModal.isOpen}
        onClose={() => setZoomModal({ isOpen: false, imageUrl: null })}
        imageUrl={zoomModal.imageUrl}
        isVideo={zoomModal.isVideo}
        title={zoomModal.title}
        subtitle={zoomModal.subtitle}
        caption={zoomModal.caption}
        identity={identity}
      />
    </section>
  )
}
