"use client";

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchSnapshot, LobbyState, OrbitObject, User } from '@orbit/shared'
import { countdownMs, formatCountdown, matchWindowMs, opponentCardId, resolveDisplayName, myCardId } from '../utils/lobby'
import { useObjectImage } from '../hooks/useObjectImage'
import {
  playCountdownOnce,
  playTimeoutOnce,
  playRejectOnce,
  playMatchOnce,
  playUpload,
  playPress,
} from '../utils/sounds'
import type { LobbyDecisionResult, LobbyDecisionFailure } from '../hooks/useLobby'
import { ZoomModal, useZoomModal } from './CardZoomModalHost'
import { computeCardRarity, formatGc, matchEconomy } from '@orbit/shared'
import { isMediaVideo } from '../utils/media'
import { CardBack } from './CardBack'
import { GameCard } from './cards/GameCard'
import { ObjectImage } from './ObjectImage'
import { Avatar } from './Avatar'
import { ValuationSummary } from './game/ValuationSummary'
import { Button } from '../ui/kit'
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  PADDING_Y, RADIUS, SHADOW, STATUS, TYPE, WEIGHT,
} from '../ui/tokens'
import { ZoomIn, Check, X, Sparkles, Heart, Zap, LayoutGrid, ExternalLink } from 'lucide-react'

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
  const zoom = useZoomModal()
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
  // Dual-leg display URLs: server-resolved snapshot URL first (handles
  // match-local bot cards + bucket-backed objects), local card row second,
  // signed-fetch blob last. Either leg alone left images blank.
  const myPlayed = myCards.find((c) => c.id === myPlayedCardId)
  const myPlayedUrl = match?.my_card_url ?? myPlayed?.content_url ?? myPlayedImg.url ?? null
  const oppUrl = match?.opponent_card_url ?? opponentImg.url ?? null
  // Real opponent value: the result-phase valuation summary. Before that the
  // value is unknown — never fabricate one (the old pointDelta || 100 fiction).
  const oppKnownValue = (() => {
    const d = match?.valuation_summary?.opponentCardDeltas?.find((x) => x.cardId === oppCardId)
    return typeof d?.newScore === 'number' ? Math.max(0, d.newScore) : null
  })()

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
    setNotices((n) => [...n, `Round ${currentRound} card played. Waiting for reveal.`])
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
      if (decision === 'like' || decision === 'boost') playPress(820)
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
        setDecideError('Match already ended. A new one is coming.')
      } else {
        setDecideError(result.error || 'Couldn\'t record your decision. Try again.')
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
    <section className={classes(CHROME.tile, PADDING[3], 'space-y-3')}>
      <div className={classes('flex items-center flex-wrap', GAP[2])}>
        <span className={classes('flex items-center min-w-0', GAP[2], TYPE.sub, WEIGHT.semibold, COLOR.fg)}>
          <Avatar id={match.opponent.id} imageUrl={match.opponent.pfp_url || opponentUser?.pfp_url || undefined} size={20} />
          <span className="truncate">
            vs{' '}
            <button
              type="button"
              onClick={() => onOpenProfile?.(opponentUser)}
              title={`View ${opponentName}'s profile`}
              className={classes('cursor-pointer hover:underline', WEIGHT.medium, COLOR.fg)}
            >
              {opponentName}
            </button>
          </span>
        </span>

        {/* Score */}
        <div className={classes('flex items-center', GAP[1], PADDING_X[2], PADDING_Y[1], COLOR.interactive, 'border', COLOR.edge, RADIUS.chip, MONO, TYPE.caption)}>
          <span className={classes(COLOR.accent, WEIGHT.semibold)}>{match.score_mine || 0}</span>
          <span className={COLOR.muted}>:</span>
          <span className={classes(COLOR.fg, WEIGHT.semibold)}>{match.score_opponent || 0}</span>
        </div>

        <span className={classes('ml-auto hidden sm:inline truncate', TYPE.caption, COLOR.muted)}>
          R{currentRound}/{maxRounds}
        </span>
        <span className={classes('ml-2', TYPE.caption, MONO, COLOR.fg, phase === 'result' ? '' : 'animate-orbit-pulse-soft')}>{countdown}</span>
      </div>

      <div className={classes('space-y-2')}>
        {/* Round Progress */}
        <div className={classes('flex items-center justify-between', GAP[1], PADDING[2], COLOR.canvasSurface, 'border', COLOR.edge, RADIUS.control)}>
          <div className={classes(TYPE.body, WEIGHT.medium, COLOR.muted)}>Progress</div>
          <div className={classes('flex items-center', GAP[1])}>
            {Array.from({ length: maxRounds }).map((_, idx) => {
              const rNum = idx + 1
              const past = roundsHistory.find((h) => h.round === rNum)
              const isCurrent = rNum === currentRound
              return (
                <div
                  key={rNum}
                  className={classes(
                    'flex items-center', GAP[0.5], PADDING_X[1.5], 'py-0.5', TYPE.caption, WEIGHT.medium, 'border', RADIUS.chip, MOTION.transition.micro,
                    isCurrent && !isResult
                      ? classes(COLOR.accentEdge, COLOR.glassW12, COLOR.accent)
                      : past
                        ? past.matched
                          ? classes('border-retro-online/40 bg-retro-online/10 text-retro-online')
                          : classes(COLOR.edge, COLOR.interactive, COLOR.muted)
                        : classes('border-edge/40 bg-transparent text-retro-muted/40'),
                  )}
                >
                  <span>R{rNum}</span>
                  {past && <span>{past.matched ? <Check className={ICON.sm} /> : <X className={ICON.sm} />}</span>}
                </div>
              )
            })}
          </div>
        </div>

        <div className={classes('flex flex-col', GAP[1])}>
          <div className={classes('h-1 w-full overflow-hidden rounded-full border', COLOR.edge, COLOR.interactive)}>
            <div
              className={classes('h-full', MOTION.transition.width, isResult ? 'bg-retro-muted' : msLeft <= 10000 ? 'bg-danger' : COLOR.accentBg)}
              style={{ width: `${isResult ? 100 : pct}%` }}
            />
          </div>
          <div className={classes('flex justify-between', TYPE.caption, COLOR.muted)}>
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
          <div className={classes('space-y-1')}>
            {notices.slice(-2).map((msg, i) => (
              <div key={i} className={classes('border', COLOR.accentEdge, COLOR.glassW5, PADDING[2], TYPE.body, COLOR.fg, MOTION.keyframe.fadeIn, RADIUS.chip)}>
                {msg}
              </div>
            ))}
          </div>
        )}

        {phase === 'lobby' && (
          <div className={classes('border border-dashed', COLOR.edge, PADDING[4], 'text-center', 'space-y-2', RADIUS.control)}>
            <p className={classes(TYPE.body, COLOR.muted)}>
              Matched with <span className={classes(COLOR.fg, WEIGHT.semibold)}>{opponentName}</span>
            </p>
            <p className={classes(TYPE.body, COLOR.muted)}>
              Starting in <span className={classes(COLOR.accent, MONO)}>{countdown}</span>
            </p>
          </div>
        )}

        {phase === 'pick' && (
          <>
            <div className={classes(PADDING[2.5], TYPE.body, COLOR.muted, 'flex flex-wrap items-center', GAP[2], RADIUS.control, 'border', COLOR.edge)}>
              <span className={classes(WEIGHT.semibold, COLOR.fg)}>Round {currentRound}/{maxRounds}:</span>
              <span>
                {deckExhausted
                  ? 'Deck exhausted. Cards can be replayed.'
                  : 'Pick a card to play.'}
              </span>
            </div>

            {match.my_card ? (
              <div className={classes('py-2', 'space-y-3', MOTION.keyframe.fadeIn)}>
                <div className={classes('grid grid-cols-2', GAP[3], 'items-center')}>
                  {/* Player's locked-in card — the same GameCard surface as the tile. */}
                  {(() => {
                    const c = myCards.find(card => card.id === match.my_card)
                    const val = Math.max(0, (c as any)?.value ?? c?.gacha_downloads_count ?? 0)
                    const name = c?.caption || 'Your Card'
                    return (
                      <div className={classes('space-y-1 text-center')}>
                        <GameCard
                          objectId={myPlayedCardId}
                          src={myPlayedUrl}
                          identity={identity}
                          width={220}
                          height={308}
                          isVideo={Boolean(isMediaVideo(myPlayedUrl ?? '') || myPlayed?.mime_type?.startsWith('video/'))}
                          name={name}
                          value={val}
                          footerExtra={<div className={CHROME.cardFooterMeta}>by You</div>}
                        >
                          <span className={classes('absolute bottom-2 right-2 z-20', CHROME.cardChip, COLOR.accentBg, COLOR.onAccent)}>Locked in</span>
                        </GameCard>
                        <div className={classes(TYPE.caption, WEIGHT.medium, COLOR.muted)}>You</div>
                      </div>
                    )
                  })()}

                  {/* Opponent's placeholder / card-back */}
                  <div className={classes('space-y-1 text-center')}>
                    <div className={classes('relative w-full aspect-[3/4.2] mx-auto select-none overflow-hidden', RADIUS.panel, COLOR.interactiveSoft)} data-rarity="common">
                      <div className={classes('flex flex-col items-center justify-center h-full', PADDING[3])}>
                        {match.opponent_played ? (
                          <div className={classes('space-y-2')}>
                            <CardBack className="w-16 h-22 mx-auto" />
                            <div className={classes(TYPE.body, COLOR.accent, WEIGHT.semibold)}>Card submitted</div>
                          </div>
                        ) : (
                          <div className={classes('space-y-2', COLOR.muted)}>
                            <div className={classes('w-12 h-16 border border-dashed', COLOR.edge, RADIUS.control, 'mx-auto flex items-center justify-center opacity-50')}>?</div>
                            <div className={TYPE.caption}>Picking card...</div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={classes(TYPE.caption, WEIGHT.medium, COLOR.muted)}>{opponentName || 'Opponent'}</div>
                  </div>
                </div>

                <div className={classes(PADDING[2.5], COLOR.interactive, 'border', COLOR.edge, RADIUS.control, 'text-center', TYPE.body, COLOR.fg)}>
                  {match.opponent_played ? 'Both cards submitted. Revealing soon' : `Waiting for ${opponentName}...`}
                </div>
              </div>
            ) : (
              <>
                {match.opponent_played && (
                  <div className={classes('border', COLOR.accentEdge, COLOR.glassW5, PADDING[2], 'text-center', TYPE.body, COLOR.fg, MOTION.keyframe.fadeIn, RADIUS.control)}>
                    {opponentName} played. Select your card!
                  </div>
                )}

                {myCards.length === 0 ? (
                  <div className={classes('border', COLOR.edge, PADDING[6], 'text-center space-y-3', RADIUS.panel, COLOR.canvasSurfaceSoft)}>
                    <p className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg)}>No playable cards in your active deck.</p>
                    <p className={classes(TYPE.body, COLOR.muted)}>Select or build a 5-card deck in the Deck Builder to play duels.</p>
                    {onOpenDeckBuilder && (
                      <Button type="button" variant="primary" onClick={onOpenDeckBuilder} className={classes('flex items-center', GAP[1.5])}>
                        <LayoutGrid className={ICON.sm} />
                        Open Deck Builder
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className={classes('grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5', GAP[2], 'max-h-[min(34vh,22rem)] overflow-y-auto styled-scrollbar p-0.5')}>
                      {myCards.map((card) => {
                        const isVid = isMediaVideo(card.content_url) || Boolean(card.mime_type?.startsWith('video/'))
                        const cardVal = Math.max(0, (card as any).value ?? card.gacha_downloads_count ?? 0)
                        const rarity = computeCardRarity(cardVal)
                        const isAlreadyPlayed = !deckExhausted && playedCards.includes(card.id)
                        return (
                          <button
                            key={card.id}
                            type="button"
                            aria-label={`Play ${card.caption || card.id}`}
                            aria-pressed={selectedCard === card.id}
                            disabled={isAlreadyPlayed}
                            onClick={() => !isAlreadyPlayed && setSelectedCard(card.id)}
                            className={classes(
                              'relative aspect-square overflow-hidden border-2', MOTION.transition.micro, RADIUS.chip,
                              rarity.borderClass,
                              isAlreadyPlayed
                                ? classes('opacity-30 grayscale cursor-not-allowed', COLOR.edge)
                                : selectedCard === card.id
                                  ? classes(COLOR.edgeStrong, 'ring-2 ring-retro-fg/30')
                                  : COLOR.hoverEdgeStrong,
                            )}
                          >
                            {card.content_url || card.id ? (
                              <ObjectImage
                                contentUrl={card.content_url}
                                objectId={card.id}
                                identity={identity}
                                mimeType={card.mime_type}
                                className="w-full h-full object-cover"
                                videoClassName="pointer-events-none w-full h-full object-cover"
                                thumb
                              />
                            ) : (
                              <div className={classes('w-full h-full', COLOR.surfaceRaised)} />
                            )}
                            {isVid && (
                              <span className={classes('absolute bottom-0.5 left-0.5', TYPE.caption, CHROME.mediaChip, RADIUS.chip)}>Video</span>
                            )}
                            <div className={classes('absolute top-0.5 left-0.5 flex items-center', GAP[0.5], 'z-10')}>
                              <span className={classes(TYPE.caption, WEIGHT.medium, RADIUS.chip, rarity.badgeClass)}>{rarity.label}</span>
                              <span className={classes(CHROME.cardChip, STATUS.warning)}>{formatGc(cardVal)}</span>
                            </div>
                            {isAlreadyPlayed && (
                              <span className={classes('absolute inset-0', COLOR.scrim, 'flex items-center justify-center', TYPE.caption, WEIGHT.medium, STATUS.dangerFg, 'p-1 text-center', RADIUS.chip)}>Used</span>
                            )}
                            {selectedCard === card.id && !isAlreadyPlayed && (
                              <span className={classes('absolute top-0.5 right-0.5', TYPE.caption, COLOR.accentBg, COLOR.onAccent, WEIGHT.medium, RADIUS.chip)}>Selected</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!selectedCard || submitting}
                  onClick={() => selectedCard && handlePick(selectedCard)}
                  className="w-full justify-center"
                >
                  {submitting ? 'Playing...' : `Play card. Round ${currentRound}`}
                </Button>
              </>
            )}
          </>
        )}

        {(phase === 'reveal' || waitingDecide) && (
          <div className={classes('border', COLOR.edge, PADDING[3], 'text-center', TYPE.body, COLOR.muted, MOTION.keyframe.fadeIn, RADIUS.control)}>
            {phase === 'reveal' ? (
              <>
                <span className={classes(WEIGHT.semibold, COLOR.fg)}>Cards revealed</span>. Deciding in {countdown}
              </>
            ) : (
              <>
                <span className={WEIGHT.semibold}>Decision recorded</span>. Waiting for {opponentName}
              </>
            )}
          </div>
        )}

        {isRoundResult && (
          <div className={classes('border', COLOR.accentEdge, COLOR.glassW5, PADDING[3], 'text-center space-y-1', MOTION.keyframe.fadeIn, RADIUS.control)}>
            <div className={classes(WEIGHT.semibold, COLOR.fg, 'flex items-center justify-center', GAP[2])}>
              <span>Round {currentRound}:</span>
              {match.matched ? (
                <span className={classes(STATUS.success, WEIGHT.semibold, 'flex items-center', GAP[1])}><Sparkles className={ICON.sm} /> Match! +50 pts</span>
              ) : (
                <span className={COLOR.muted}>No match</span>
              )}
            </div>
            <div className={classes(TYPE.body, COLOR.muted)}>
              Next round in <span className={MONO}>{countdown}</span>
            </div>
          </div>
        )}

        {(phase === 'reveal' || phase === 'decide' || waitingDecide || isRoundResult) && (
          <div className={classes('grid grid-cols-2', GAP[3], 'max-w-2xl mx-auto w-full')}>
            {/* Player's card */}
            {(() => {
              const myCardObj = myCards.find(c => c.id === (match.my_card || myPlayedCardId))
              const myVal = Math.max(0, (myCardObj as any)?.value ?? myCardObj?.gacha_downloads_count ?? 0)
              const myTitle = myCardObj?.caption || 'Your Card'

              return (
                <div className={classes('space-y-1 text-center')}>
                  <div
                    role={myPlayedImg.url && !myPlayedImg.isLink ? 'button' : undefined}
                    tabIndex={myPlayedImg.url && !myPlayedImg.isLink ? 0 : undefined}
                    aria-label={myPlayedImg.url && !myPlayedImg.isLink ? `Zoom ${myTitle}` : undefined}
                    className={classes(
                      'mx-auto select-none', RADIUS.panel, SHADOW.sheet,
                      isRoundResult && match.matched ? 'ring-2 ring-success' : '',
                      myPlayedImg.url ? 'cursor-pointer' : '',
                    )}
                    onClick={() => {
                      if (myPlayedImg.url) {
                        zoom.showZoom(myPlayedImg.url, {
                          isVideo: myPlayedImg.isVideo,
                          title: myTitle,
                          subtitle: `Valuation: ${formatGc(myVal)}, Round ${currentRound}`,
                        })
                      }
                    }}
                    onKeyDown={(e) => {
                      if (myPlayedImg.url && !myPlayedImg.isLink && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        zoom.showZoom(myPlayedImg.url, {
                          isVideo: myPlayedImg.isVideo,
                          title: myTitle,
                          subtitle: `Valuation: ${formatGc(myVal)}, Round ${currentRound}`,
                        })
                      }
                    }}
                  >
                    <GameCard
                      objectId={myPlayedCardId}
                      src={myPlayedUrl}
                      identity={identity}
                      width={220}
                      height={308}
                      isVideo={Boolean(isMediaVideo(myPlayedUrl ?? '') || myPlayed?.mime_type?.startsWith('video/'))}
                      name={myTitle}
                      value={myVal}
                      footerExtra={<div className={CHROME.cardFooterMeta}>by You</div>}
                    >
                      {myPlayedImg.url && (
                        <span className={classes('absolute top-2 right-2 z-20', CHROME.mediaChip, 'flex items-center', GAP[1])}>
                          <ZoomIn className={ICON.sm} /> Zoom
                        </span>
                      )}
                      {myPlayedImg.isLink ? (
                        <a
                          href={myPlayedImg.linkUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={classes('absolute inset-0 z-10 flex flex-col items-center justify-center', GAP[2], COLOR.muted, COLOR.hoverFg, MOTION.transition.micro)}
                          title={myPlayedImg.linkUrl || undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className={ICON.lg} />
                          <span className={TYPE.body}>Link card</span>
                          <span className={classes(TYPE.caption, MONO, 'border', COLOR.edge, PADDING_X[2], 'py-0.5', RADIUS.chip)}>Open</span>
                        </a>
                      ) : !myPlayedUrl && !myPlayedCardId ? (
                        <div className="absolute inset-0 z-0"><CardBack label="Your card" /></div>
                      ) : null}
                      {isRoundResult && match.my_decision && (
                        <span
                          className={classes('absolute bottom-2 left-2 z-20', CHROME.cardChip, match.my_decision === 'like' ? 'bg-success text-retro-accent-text' : 'bg-danger text-retro-fg', 'flex items-center', GAP[1])}
                        >
                          {match.my_decision === 'like' ? <><Check className={ICON.sm} /> Liked</> : <><X className={ICON.sm} /> Rejected</>}
                        </span>
                      )}
                    </GameCard>
                  </div>
                  <div className={classes(TYPE.caption, WEIGHT.medium, COLOR.muted)}>You</div>
                </div>
              )
            })()}

            {/* Opponent's card */}
            {(() => {
              const oppRarity = computeCardRarity(oppKnownValue ?? 0)
              const oppTitle = `${opponentName}'s Card`
              const zoomUrl = oppUrl || opponentImg.url

              return (
                <div className={classes('space-y-1 text-center')}>
                  <div
                    role={zoomUrl && !opponentImg.isLink ? 'button' : undefined}
                    tabIndex={zoomUrl && !opponentImg.isLink ? 0 : undefined}
                    aria-label={zoomUrl && !opponentImg.isLink ? `Zoom ${oppTitle}` : undefined}
                    className={classes(
                      'mx-auto select-none', RADIUS.panel, SHADOW.sheet,
                      isRoundResult && match.matched ? 'ring-2 ring-success' : '',
                      zoomUrl ? 'cursor-pointer' : '',
                    )}
                    onClick={() => {
                      if (zoomUrl) {
                        zoom.showZoom(zoomUrl, {
                          isVideo: opponentImg.isVideo,
                          title: oppTitle,
                          subtitle: `Round ${currentRound}`,
                        })
                      }
                    }}
                    onKeyDown={(e) => {
                      if (zoomUrl && !opponentImg.isLink && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        zoom.showZoom(zoomUrl, {
                          isVideo: opponentImg.isVideo,
                          title: oppTitle,
                          subtitle: `Round ${currentRound}`,
                        })
                      }
                    }}
                  >
                    <GameCard
                      objectId={oppCardId}
                      src={oppUrl}
                      identity={identity}
                      width={220}
                      height={308}
                      isVideo={opponentImg.isVideo}
                      name={oppTitle}
                      rarity={oppRarity}
                      value={oppKnownValue ?? undefined}
                      footerExtra={<div className={CHROME.cardFooterMeta}>by {opponentName}</div>}
                    >
                      {zoomUrl && (
                        <span className={classes('absolute top-2 right-2 z-20', CHROME.mediaChip, 'flex items-center', GAP[1])}>
                          <ZoomIn className={ICON.sm} /> Zoom
                        </span>
                      )}
                      {opponentImg.isLink ? (
                        <a
                          href={opponentImg.linkUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={classes('absolute inset-0 z-10 flex flex-col items-center justify-center', GAP[2], COLOR.muted, COLOR.hoverFg, MOTION.transition.micro)}
                          title={opponentImg.linkUrl || undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className={ICON.lg} />
                          <span className={TYPE.body}>Link card</span>
                          <span className={classes(TYPE.caption, MONO, 'border', COLOR.edge, PADDING_X[2], 'py-0.5', RADIUS.chip)}>Open</span>
                        </a>
                      ) : !oppUrl && !oppCardId ? (
                        <div className="absolute inset-0 z-0">
                          <CardBack
                            label={phase === 'reveal' ? 'Revealing...' : 'Waiting for card'}
                            className="animate-orbit-pulse-soft"
                          />
                        </div>
                      ) : opponentImg.failed ? (
                        <div className={classes('absolute inset-0 z-0 flex items-center justify-center', TYPE.body, COLOR.muted)}>Card unavailable</div>
                      ) : null}
                      {isRoundResult && match.opponent_decision && (
                        <span
                          className={classes('absolute bottom-2 left-2 z-20', CHROME.cardChip, match.opponent_decision === 'like' ? 'bg-success text-retro-accent-text' : 'bg-danger text-retro-fg', 'flex items-center', GAP[1])}
                        >
                          {match.opponent_decision === 'like' ? <><Check className={ICON.sm} /> Liked</> : <><X className={ICON.sm} /> Rejected</>}
                        </span>
                      )}
                    </GameCard>
                  </div>
                  <div className={classes(TYPE.caption, WEIGHT.medium, COLOR.muted)}>{opponentName}</div>
                </div>
              )
            })()}
          </div>
        )}

        {phase === 'decide' && !isMyDecided && (
          <>
            <p className={classes('text-center', TYPE.body, COLOR.muted)}>
              Both cards revealed. Decide if you like <span className={classes(COLOR.fg, WEIGHT.semibold)}>{opponentName}</span>&apos;s card
            </p>
            {lastResult && (
              <div className={classes('border', PADDING[3], 'text-center', TYPE.sub, WEIGHT.semibold, MOTION.keyframe.slideUp, RADIUS.control, lastResult.matched ? classes(COLOR.fg, COLOR.accentEdge, COLOR.glassW12) : classes(COLOR.muted, COLOR.edge))}>
                {lastResult.matched ? 'It\'s a match!' : 'Decision recorded'}
                {typeof lastResult.points === 'number' && lastResult.points > 0 && (
                  <span className={classes('ml-2', COLOR.accent, WEIGHT.medium)}>+{lastResult.points} pts</span>
                )}
              </div>
            )}
            {decideError && (
              <div className={classes('border', COLOR.edge, PADDING[3], 'text-center', TYPE.body, COLOR.muted, RADIUS.control)}>
                {decideError}
              </div>
            )}
            <div className={classes('grid grid-cols-3', GAP[2])}>
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => handleDecide('reject')}
                title="Reject (-5 pts)"
                className={classes('justify-center', STATUS.dangerFg, STATUS.dangerTintHover)}
              >
                <X className={ICON.sm} />
                <span>Reject</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => handleDecide('like')}
                title="Like (+10 pts)"
                className="justify-center"
              >
                <Heart className={classes(ICON.sm, 'fill-current', STATUS.dangerFg)} />
                <span>Like</span>
              </Button>
              <Button
                type="button"
                variant="info"
                disabled={submitting || boostsRemaining <= 0}
                onClick={() => handleDecide('boost')}
                title={boostsRemaining > 0 ? `Conviction Boost (+25 pts). Costs ${formatGc(matchEconomy(myCardVal, 0).boostCost)} g$` : 'No boosts remaining'}
                className="justify-center"
              >
                <Zap className={classes(ICON.sm, 'fill-current')} />
                <span>Boost {boostsRemaining > 0 ? `(${boostsRemaining}, ${formatGc(matchEconomy(myCardVal, 0).boostCost)} g$)` : ''}</span>
              </Button>
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
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={handleQuit}
            className="w-full justify-center"
          >
            {submitting ? 'Leaving...' : 'Leave match'}
          </Button>
        )}
      </div>

      {/* Fullscreen Card Zoom Lightbox Modal */}
      <ZoomModal zoom={zoom} identity={identity} />
    </section>
  )
}
