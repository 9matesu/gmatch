"use client";

import { useState, useEffect, useMemo } from 'react'
import type { TierMatch, OrbitObject, User } from '@orbit/shared'
import { specialTierLine, tierColor, tierLabel, SPECIAL_TIER_POINTS, SPECIAL_FINAL_POINTS, SPECIAL_MAX_TIER } from '@orbit/shared'
import { specialTabState, revealedCards } from '../utils/special'
import { resolveDisplayName } from '../utils/lobby'
import { useObjectImage } from '../hooks/useObjectImage'
import { playTierUpOnce, playMatchOnce, playRejectOnce, playTimeoutOnce } from '../utils/sounds'
import { matchEndSummary } from '../utils/matchEndSummary'
import { notifyWhenHidden } from '../utils/notifyHidden'
import { ZoomModal, useZoomModal } from './CardZoomModalHost'
import { CardBack } from './CardBack'
import { GameCard } from './cards/GameCard'
import { CreateCardModal } from './CreateCardModal'
import { ObjectImage } from './ObjectImage'
import { Button } from '../ui/kit'
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  RADIUS, SHADOW, STATUS, TYPE, WEIGHT,
} from '../ui/tokens'
import { ZoomIn, Heart, X, Sparkles } from 'lucide-react'
import type { OrbitIdentity } from '@orbit/crypto'

type IdentityLike = OrbitIdentity | null;

interface Props {
  match: TierMatch
  selfId: string
  myCards: OrbitObject[]
  identity: IdentityLike | null
  soundEnabled: boolean
  users?: User[] | null
  onPlayCard: (matchId: string, cardId: string) => Promise<boolean>
  onDecide: (matchId: string, decision: 'like' | 'reject') => Promise<unknown>
  onEnd: (matchId: string) => Promise<boolean>
  onOpenProfile?: (user: User) => void
}

export function YourMatchTab({
  match,
  selfId,
  myCards,
  identity,
  soundEnabled,
  users,
  onPlayCard,
  onDecide,
  onEnd,
  onOpenProfile,
}: Props) {
  const st = specialTabState(match, selfId)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Confirmation banner shown on level-up / final payouts, then auto-dismissed.
  const [celebrate, setCelebrate] = useState<{ final: boolean; tier: number; points: number } | null>(null)
  // g$ from the server's card-driven economy, when I was the one who closed
  // the round (the deciding response carries it; the other side falls back to
  // a payout-less summary line).
  const [lastPayout, setLastPayout] = useState<{ gp: number; reason: string } | null>(null)
  const decideAndCapture = async (decision: 'like' | 'reject') => {
    const res = (await onDecide(match.id, decision)) as { payout?: { gp: number; reason: string } } | null | undefined
    if (res && typeof res.payout?.gp === 'number') setLastPayout(res.payout)
  }
  const zoom = useZoomModal()
  const [showCreateCardModal, setShowCreateCardModal] = useState(false)
  const prevKey = useMemo(() => `${match.id}:${match.tier}:${match.last_result}:${match.status}`, [match.id, match.tier, match.last_result, match.status])
  const [lastKey, setLastKey] = useState<string>(prevKey)
  useEffect(() => {
    if (prevKey === lastKey) return
    setLastKey(prevKey)
    if (match.last_result === 'both_like') {
      const final = match.status === 'ended'
      const points = final ? SPECIAL_FINAL_POINTS : SPECIAL_TIER_POINTS
      setCelebrate({ final, tier: match.tier, points })
      if (soundEnabled && !document.hidden) {
        if (final) playMatchOnce()
        else playTierUpOnce()
      }
      notifyWhenHidden(matchEndSummary(match.last_result, lastPayout, final))
      const t = setTimeout(() => setCelebrate(null), 2800)
      return () => clearTimeout(t)
    }
    if (soundEnabled && !document.hidden) {
      if (match.last_result === 'expired') playTimeoutOnce()
      else if (match.last_result === 'ended' && match.status === 'ended') playRejectOnce()
    }
    if (match.status === 'ended' && (match.last_result === 'ended' || match.last_result === 'expired' || match.last_result === 'quit')) {
      notifyWhenHidden(matchEndSummary(match.last_result, lastPayout, false))
    }
  }, [prevKey, lastKey, match.last_result, match.status, match.tier, soundEnabled, lastPayout])

  const myCardImg = useObjectImage(st?.myCardId ?? null, identity)
  const oppCardImg = useObjectImage(st?.opponentCardId ?? null, identity)
  const reveal = st ? revealedCards(st) : { mine: null, theirs: null }
  const revealMineImg = useObjectImage(reveal.mine, identity)
  const revealTheirsImg = useObjectImage(reveal.theirs, identity)

  // Full user record for the opponent so the profile popup can follow/DM them.
  const opponentUser = useMemo<User | null>(() => {
    if (!st) return null
    const base = users?.find((u) => u.id === st.opponentId)
    if (base) return base
    return { id: st.opponentId, display_name: match.opponent_name || st.opponentId } as User
  }, [st, users, match.opponent_name])

  if (!st) return null

  const opponentName = resolveDisplayName(st.opponentId, { users, fallbackName: match.opponent_name })
  const color = tierColor(st.tier)
  const label = st.tier > SPECIAL_MAX_TIER ? 'Final' : tierLabel(st.tier)
  const needCard = !st.myCardId
  const waitingForCard = Boolean(st.myCardId && !st.opponentCardId)
  const waitingForDecision = Boolean(st.phase === 'decide' && st.myDecision && !st.opponentDecision)
  const opponentHidden = Boolean(st.phase === 'pick' && st.opponentCardId)

  const handlePlay = async (cardId: string): Promise<boolean> => {
    setSubmitting(true)
    setError(null)
    const ok = await onPlayCard(match.id, cardId)
    setSubmitting(false)
    if (!ok) setError('Failed to play card. It may have expired.')
    return ok
  }

  const cardSlot = (
    label: string,
    img: { url: string | null; failed?: boolean } | null,
    placeholder: string,
    border: string,
    pulsing: boolean,
    hidden?: boolean,
    profileUser?: User | null,
    objectId?: string | null
  ) => (
    <div className={classes('flex-1 min-w-0')}>
      <div
        role={!hidden && img?.url && !profileUser ? 'button' : undefined}
        tabIndex={!hidden && img?.url && !profileUser ? 0 : undefined}
        aria-label={!hidden && img?.url && !profileUser ? `${label} card, zoom` : undefined}
        className={classes(
          'relative w-full aspect-[3/4.2] overflow-hidden group', RADIUS.panel, SHADOW.sheet,
          border, pulsing ? 'animate-orbit-pulse-soft' : '',
          !hidden && img?.url ? 'cursor-pointer' : '',
        )}
        onClick={() => {
          if (hidden || !img?.url) return
          if (profileUser) {
            onOpenProfile?.(profileUser)
            return
          }
          zoom.showZoom(img.url, {
            title: `${label} Card`,
            subtitle: `Tier ${st.tier}, ${opponentName}`,
          })
        }}
        onKeyDown={(e) => {
          if (hidden || !img?.url) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (profileUser) onOpenProfile?.(profileUser)
            else zoom.showZoom(img.url, {
              title: `${label} Card`,
              subtitle: `Tier ${st.tier}, ${opponentName}`,
            })
          }
        }}
        title={!hidden && img?.url ? (profileUser ? `View ${label}'s profile` : `Zoom into ${label.toLowerCase()} card`) : undefined}
      >
        {hidden ? (
          <CardBack label="Covered" />
        ) : img?.url ? (
          <>
            <GameCard
              objectId={objectId ?? null}
              src={img.url}
              identity={identity}
              width={180}
              height={252}
              isVideo={Boolean(img.url.includes('video/'))}
              interactive={false}
              className="rounded-none border-0"
            />
            <button
              type="button"
              aria-label={`Zoom into ${label} card`}
              onClick={(e) => {
                e.stopPropagation()
                if (img?.url) {
                  zoom.showZoom(img.url, {
                    title: `${label} Card`,
                    subtitle: `Tier ${st.tier}, ${opponentName}`,
                  })
                }
              }}
              className={classes('absolute top-1.5 right-1.5 z-20', CHROME.mediaChip, 'flex items-center', GAP[1], 'opacity-0 group-hover:opacity-100', MOTION.transition.fade)}
              title="Zoom into card"
            >
              <ZoomIn className={ICON.sm} />
              <span>Zoom</span>
            </button>
          </>
        ) : img?.failed ? (
          <div className={classes('w-full h-full flex items-center justify-center', TYPE.caption, COLOR.muted, PADDING_X[1], 'text-center')}>Unavailable</div>
        ) : (
          <div className={classes('w-full h-full flex items-center justify-center', TYPE.caption, COLOR.muted, PADDING_X[1], 'text-center')}>{placeholder}</div>
        )}
      </div>
      <div className={classes('mt-1 text-center', TYPE.caption, WEIGHT.medium, COLOR.muted, 'truncate')}>{label}</div>
    </div>
  )

  return (
    <section className={classes(CHROME.tile, PADDING[3], 'space-y-3', MOTION.keyframe.fadeIn)}>
      <div className={classes('flex items-center flex-wrap', GAP[2])}>
        <span className={classes(TYPE.sub, WEIGHT.semibold, COLOR.fg)}>Special Match</span>
        <span className={classes('w-2 h-2 rounded-full shrink-0')} style={{ backgroundColor: color }} />
        <span style={{ color }} className={classes(TYPE.caption, WEIGHT.medium)}>Tier {st.tier}, {label}</span>
        <span className={classes('ml-auto truncate', COLOR.fg)}>
          vs{' '}
          {opponentUser && (
            <button
              type="button"
              onClick={() => onOpenProfile?.(opponentUser)}
              title={`View ${opponentName}'s profile`}
              className={classes('cursor-pointer hover:underline', WEIGHT.medium)}
            >
              {opponentName}
            </button>
          )}
          {!opponentUser && <span>{opponentName}</span>}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void onEnd(match.id)} disabled={submitting}>
          End
        </Button>
      </div>

      <div className={classes('space-y-3')}>
        {/* Celebration */}
        {celebrate && (
          <div
            className={classes(PADDING[4], 'text-center space-y-2 animate-orbit-tier-flash', RADIUS.control, celebrate.final ? classes(STATUS.warningBg, STATUS.warningEdge) : classes(COLOR.glassW5, 'border', COLOR.accentEdge))}
          >
            <div className={classes(TYPE.sub, WEIGHT.semibold, celebrate.final ? STATUS.warning : COLOR.accent)}>
              {celebrate.final ? 'Match complete' : specialTierLine(celebrate.tier)}
            </div>
            <div className={classes(TYPE.body, COLOR.fg, MONO)}>
              +{celebrate.points} pts {celebrate.final ? 'Match complete' : `Tier ${celebrate.tier}`}
              {lastPayout?.reason === 'mutual_like' ? `, +${lastPayout.gp} g$` : ''}
            </div>
          </div>
        )}

        {/* No match */}
        {!celebrate && st.phase === 'ended' && st.lastResult === 'ended' && (
          <div className={classes('border', STATUS.dangerEdge, STATUS.dangerBg, PADDING[4], 'text-center space-y-2', MOTION.keyframe.slideUp, RADIUS.control)}>
            <div className={classes(TYPE.sub, WEIGHT.semibold, STATUS.dangerFg)}>{matchEndSummary(st.lastResult, lastPayout, false)}</div>
            <div className={classes(TYPE.body, COLOR.muted)}>Cards revealed below.</div>
            <div className={classes('grid grid-cols-2', GAP[2])}>
              {cardSlot('You', revealMineImg, 'Your card', STATUS.dangerEdge, false, false, null, reveal.mine)}
              {cardSlot(opponentName, revealTheirsImg, 'Their card', STATUS.dangerEdge, false, false, opponentUser, reveal.theirs)}
            </div>
          </div>
        )}

        {/* Quit */}
        {!celebrate && st.phase === 'ended' && st.lastResult === 'quit' && (
          <div className={classes('border', COLOR.edge, PADDING[3], 'text-center', TYPE.body, COLOR.muted, MOTION.keyframe.fadeIn, RADIUS.control)}>
            {matchEndSummary(st.lastResult, lastPayout, false)}
          </div>
        )}

        {st.phase !== 'ended' && (
          <div className={classes('grid grid-cols-2', GAP[2])}>
            {cardSlot('You', myCardImg, needCard ? 'Send a card' : 'Your card', st.myCardId ? classes(COLOR.accentEdge, COLOR.glassW5) : classes(COLOR.edge, 'border-dashed'), needCard, false, null, st.myCardId)}
            {cardSlot(
              opponentName,
              oppCardImg,
              'Waiting...',
              opponentHidden ? classes(COLOR.edge, 'border-dashed') : st.opponentCardId ? classes(COLOR.accentEdge, COLOR.glassW5) : classes(COLOR.edge, 'border-dashed'),
              !st.opponentCardId,
              opponentHidden,
              opponentUser,
              st.opponentCardId,
            )}
          </div>
        )}

        {st.phase === 'pick' && needCard && !celebrate && (
          <div className={classes('text-center', TYPE.body, COLOR.muted)}>
            Cards reveal when both have played
          </div>
        )}

        {error && <div className={classes('border', COLOR.edge, PADDING[2], 'text-center', TYPE.body, COLOR.muted, RADIUS.control)}>{error}</div>}

        {(waitingForCard || waitingForDecision) && !celebrate && (
          <div className={classes('border', COLOR.edge, PADDING[2], 'text-center', TYPE.body, COLOR.muted, 'animate-orbit-pulse-soft', RADIUS.control)}>
            Waiting for {opponentName}...
          </div>
        )}

        {st.phase === 'pick' && needCard && (
          <div className={classes('space-y-3')}>
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowCreateCardModal(true)}
              className="w-full justify-center"
            >
              <Sparkles className={ICON.md} />
              <span>Create Card</span>
            </Button>
            {myCards.length > 0 && (
              <div className={classes('space-y-2')}>
                <div className={classes('grid grid-cols-5', GAP[2])}>
                  {myCards.slice(0, 10).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      aria-label={`Select ${card.caption || card.id}`}
                      aria-pressed={selectedCard === card.id}
                      onClick={() => setSelectedCard(card.id)}
                      className={classes(
                        'relative aspect-square overflow-hidden border-2', RADIUS.chip, MOTION.transition.micro,
                        selectedCard === card.id ? classes(COLOR.edgeStrong, 'ring-2 ring-retro-fg/30') : classes(COLOR.edge, COLOR.hoverEdgeStrong),
                      )}
                    >
                      {card.content_url ? (
                        <ObjectImage
                          contentUrl={card.content_url}
                          objectId={card.id}
                          identity={identity}
                          className="w-full h-full object-cover"
                          videoClassName="pointer-events-none w-full h-full object-cover"
                          thumb
                        />
                      ) : (
                        <div className={classes('w-full h-full', COLOR.surfaceRaised)} />
                      )}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!selectedCard || submitting}
                  onClick={() => selectedCard && handlePlay(selectedCard)}
                  className="w-full justify-center"
                >
                  {submitting ? 'Playing...' : 'Play selected card'}
                </Button>
              </div>
            )}
          </div>
        )}

        {st.phase === 'decide' && !st.myDecision && (
          <div className={classes('grid grid-cols-2', GAP[2])}>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => void decideAndCapture('reject')}
              className={classes('justify-center', STATUS.dangerFg, STATUS.dangerTintHover)}
            >
              <X className={ICON.sm} />
              <span>Reject</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              onClick={() => void decideAndCapture('like')}
              className="justify-center"
            >
              <Heart className={classes(ICON.sm, 'fill-current', STATUS.dangerFg)} />
              <span>Like</span>
            </Button>
          </div>
        )}

        {st.phase === 'decide' && st.myDecision && (
          <div className={classes('border', COLOR.edge, PADDING[3], 'text-center', TYPE.body, COLOR.muted, RADIUS.control)}>
            Decision recorded. Waiting for {opponentName}...
          </div>
        )}
      </div>

      <ZoomModal zoom={zoom} identity={identity} />
      {showCreateCardModal && identity && (
        <CreateCardModal
          identity={identity}
          onClose={() => setShowCreateCardModal(false)}
          onCreated={(card) => {
            setShowCreateCardModal(false)
            handlePlay(card.id)
          }}
        />
      )}
    </section>
  )
}
