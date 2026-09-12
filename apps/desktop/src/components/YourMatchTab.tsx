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
import { CardZoomModal } from './CardZoomModal'
import { CardBack } from './CardBack'
import { CreateCardModal } from './CreateCardModal'
import { LazyVideo } from './LazyVideo'
import { ObjectImage } from './ObjectImage'
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
  const [zoomModal, setZoomModal] = useState<{ isOpen: boolean; imageUrl: string | null; title?: string; subtitle?: string }>({
    isOpen: false,
    imageUrl: null,
  })
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
    if (!ok) setError('Failed to play card — it may have expired.')
    return ok
  }

  const cardSlot = (
    label: string,
    img: { url: string | null; failed?: boolean } | null,
    placeholder: string,
    border: string,
    pulsing: boolean,
    hidden?: boolean,
    profileUser?: User | null
  ) => (
    <div className="flex-1 min-w-0">
      <div
        className={`aspect-square border-2 overflow-hidden relative group ${border} ${pulsing ? 'animate-orbit-pulse-soft' : ''} ${!hidden && img?.url ? 'cursor-pointer hover:opacity-95' : ''
          }`}
        onClick={() => {
          if (hidden || !img?.url) return
          if (profileUser) {
            onOpenProfile?.(profileUser)
            return
          }
          setZoomModal({
            isOpen: true,
            imageUrl: img.url,
            title: `${label} Card`,
            subtitle: `Tier ${st.tier} · ${opponentName}`,
          })
        }}
        title={!hidden && img?.url ? (profileUser ? `View ${label}'s profile` : `Click to zoom into ${label.toLowerCase()} card`) : undefined}
      >
        {hidden ? (
          <CardBack label="Covered" />
        ) : img?.url ? (
          <>
            {img.url.split('?')[0].toLowerCase().match(/\.(mp4|webm|mov|ogg)$/) || img.url.includes('video/') ? (
              <LazyVideo src={img.url} videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150" />
            ) : (
              <img src={img.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (img?.url) {
                  setZoomModal({
                    isOpen: true,
                    imageUrl: img.url,
                    title: `${label} Card`,
                    subtitle: `Tier ${st.tier} · ${opponentName}`,
                  })
                }
              }}
              className="absolute top-1.5 right-1.5 bg-black/80 border border-border-glass text-retro-fg text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity font-bold flex items-center gap-1 cursor-pointer"
              title="Zoom into card"
            >
              <ZoomIn className="w-3 h-3" />
              <span>ZOOM</span>
            </button>
          </>
        ) : img?.failed ? (
          <div className="w-full h-full flex items-center justify-center text-retro-muted text-[10px] px-1 text-center">Unavailable</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-retro-muted text-[10px] px-1 text-center">{placeholder}</div>
        )}
      </div>
      <div className="mt-1 text-center text-[10px] font-medium text-retro-muted truncate">{label}</div>
    </div>
  )

  return (
    <section className="module animate-orbit-fade-in">
      <div className="module-header allow-wrap flex items-center gap-2">
        <span className="module-title">Special Match</span>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="module-subtitle" style={{ color }}>Tier {st.tier} · {label}</span>
        <span className="module-subtitle module-subtitle-truncate ml-auto text-retro-fg">
          vs{' '}
          {opponentUser && (
            <button
              type="button"
              onClick={() => onOpenProfile?.(opponentUser)}
              title={`View ${opponentName}'s profile`}
              className="cursor-pointer hover:underline"
            >
              {opponentName}
            </button>
          )}
          {!opponentUser && <span>{opponentName}</span>}
        </span>
        <button
          onClick={() => void onEnd(match.id)}
          disabled={submitting}
          className="text-xs font-medium px-2.5 py-1 border border-border-glass text-retro-muted hover:text-retro-fg hover:border-retro-fg disabled:opacity-30 rounded transition-colors"
        >
          End
        </button>
      </div>

      <div className="module-body space-y-3">
        {/* Celebration */}
        {celebrate && (
          <div
            className={`p-4 text-center space-y-2 animate-orbit-tier-flash rounded-lg ${celebrate.final ? 'bg-retro-warning/10 border border-retro-warning/30' : 'bg-glass-w5 border border-retro-accent/20'}`}
          >
            <div className={`text-sm font-medium ${celebrate.final ? 'text-retro-warning' : 'text-retro-accent'}`}>
              {celebrate.final ? 'Match complete' : specialTierLine(celebrate.tier)}
            </div>
            <div className="text-xs text-retro-fg">
              +{celebrate.points} pts {celebrate.final ? '— Match complete' : `— Tier ${celebrate.tier}`}
              {lastPayout?.reason === 'mutual_like' ? ` · +${lastPayout.gp} g$` : ''}
            </div>
          </div>
        )}

        {/* No match */}
        {!celebrate && st.phase === 'ended' && st.lastResult === 'ended' && (
          <div className="border border-rose-500/30 bg-rose-500/5 p-4 text-center space-y-2 animate-orbit-slide-up rounded-lg">
            <div className="text-sm font-medium text-rose-400">{matchEndSummary(st.lastResult, lastPayout, false)}</div>
            <div className="text-xs text-retro-muted">Cards revealed below.</div>
            <div className="grid grid-cols-2 gap-2">
              {cardSlot('You', revealMineImg, 'Your card', 'border-rose-500/30', false)}
              {cardSlot(opponentName, revealTheirsImg, 'Their card', 'border-rose-500/30', false, false, opponentUser)}
            </div>
          </div>
        )}

        {/* Quit */}
        {!celebrate && st.phase === 'ended' && st.lastResult === 'quit' && (
          <div className="border border-border-glass p-3 text-center text-xs text-retro-muted animate-orbit-fade-in rounded-lg">
            {matchEndSummary(st.lastResult, lastPayout, false)}
          </div>
        )}

        {st.phase !== 'ended' && (
          <div className="grid grid-cols-2 gap-2">
            {cardSlot('You', myCardImg, needCard ? 'Send a card' : 'Your card', st.myCardId ? 'border-retro-accent bg-glass-w5' : 'border-border-glass border-dashed', needCard)}
            {cardSlot(
              opponentName,
              oppCardImg,
              'Waiting...',
              opponentHidden ? 'border-border-glass border-dashed' : st.opponentCardId ? 'border-retro-accent bg-glass-w5' : 'border-border-glass border-dashed',
              !st.opponentCardId,
              opponentHidden,
              opponentUser
            )}
          </div>
        )}

        {st.phase === 'pick' && needCard && !celebrate && (
          <div className="text-center text-xs text-retro-muted">
            Cards reveal when both have played
          </div>
        )}

        {error && <div className="border border-border-glass p-2 text-center text-xs text-retro-muted rounded-lg">{error}</div>}

        {(waitingForCard || waitingForDecision) && !celebrate && (
          <div className="border border-border-glass p-2 text-center text-xs text-retro-muted animate-orbit-pulse-soft rounded-lg">
            Waiting for {opponentName}...
          </div>
        )}

        {st.phase === 'pick' && needCard && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setShowCreateCardModal(true)}
              className="w-full py-3 text-sm font-medium bg-retro-accent text-black rounded-lg hover:bg-retro-accent-hover transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Create Card</span>
            </button>
            {myCards.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-5 gap-2">
                  {myCards.slice(0, 10).map((card) => (
                    <button
                      key={card.id}
                      onClick={() => setSelectedCard(card.id)}
                      className={`relative aspect-square overflow-hidden border-2 rounded ${selectedCard === card.id ? 'border-retro-fg ring-2 ring-retro-fg/30' : 'border-border-glass hover:border-retro-muted'}`}
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
                    </button>
                  ))}
                </div>
                <button
                  disabled={!selectedCard || submitting}
                  onClick={() => selectedCard && handlePlay(selectedCard)}
                  className="w-full py-2.5 text-xs font-medium bg-retro-fg text-retro-bg disabled:opacity-30 hover:opacity-90 cursor-pointer rounded-lg transition-opacity"
                >
                  {submitting ? 'Playing...' : 'Play selected card'}
                </button>
              </div>
            )}
          </div>
        )}

        {st.phase === 'decide' && !st.myDecision && (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={submitting}
              onClick={() => void decideAndCapture('reject')}
              className="py-2.5 text-xs font-medium border border-border-glass text-retro-muted hover:text-rose-400 hover:border-rose-500/30 bg-surface-interactive hover:bg-rose-500/5 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
            <button
              disabled={submitting}
              onClick={() => void decideAndCapture('like')}
              className="py-2.5 text-xs font-medium bg-retro-fg text-retro-bg hover:bg-retro-fg/90 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Heart className="w-3.5 h-3.5 fill-current text-rose-400" />
              <span>Like</span>
            </button>
          </div>
        )}

        {st.phase === 'decide' && st.myDecision && (
          <div className="border border-border-glass p-3 text-center text-xs text-retro-muted rounded-lg">
            Decision recorded — waiting for {opponentName}...
          </div>
        )}
      </div>

      <CardZoomModal
        isOpen={zoomModal.isOpen}
        onClose={() => setZoomModal({ isOpen: false, imageUrl: null })}
        imageUrl={zoomModal.imageUrl}
        title={zoomModal.title}
        subtitle={zoomModal.subtitle}
        identity={identity}
      />
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
