"use client";

import { useState, useEffect } from 'react'
import type { MatchSnapshot, OrbitObject, OrbitId } from '@orbit/shared'
import { computeCardRarity } from '@orbit/shared'
import { Avatar } from './Avatar'
import { formatCountdown, countdownMs } from '../utils/lobby'
import { ZoomModal, useZoomModal } from './CardZoomModalHost'
import { isMediaVideo } from '../utils/media'
import { ObjectImage } from './ObjectImage'
import { GameCard } from './cards/GameCard'
import { playPress } from '../utils/sounds'
import { Button } from '../ui/kit'
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  PADDING_Y, RADIUS, SHADOW, STATUS, TRACKING, TYPE, WEIGHT,
} from '../ui/tokens'
import {
  Star,
  X,
  Minimize2,
  Maximize2,
  ZoomIn,
  Sparkles,
  Award,
  Clock,
} from 'lucide-react'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

interface Props {
  match: MatchSnapshot | null
  onClose: () => void
  soundEnabled?: boolean
  onOpenItem?: (items: OrbitObject[], initialId: string) => void
  players?: Array<{ user_id: string; tags?: string[] | null }>
  identity?: IdentityLike | null
}

export function SpectateModal({
  match,
  onClose,
  onOpenItem,
  players,
  identity = null,
}: Props) {
  const [now, setNow] = useState<number>(() => Date.now())
  const [isMinimized, setIsMinimized] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null)
  const zoom = useZoomModal()

  // Simulated ticking shuffle card animation while players are choosing cards
  const [tickIdx, setTickIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const tickTimer = setInterval(() => {
      setTickIdx((prev) => (prev + 1) % 6)
    }, 450)
    return () => clearInterval(tickTimer)
  }, [])

  // Dragging event listeners for PiP / modal
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    setDragOffset({
      x: e.clientX - (pipPos?.x || (typeof window !== 'undefined' ? window.innerWidth - 340 : 0)),
      y: e.clientY - (pipPos?.y || (typeof window !== 'undefined' ? window.innerHeight - 280 : 0)),
    })
  }

  useEffect(() => {
    if (!dragOffset) return
    const handleMouseMove = (e: MouseEvent) => {
      setPipPos({
        x: Math.max(10, Math.min(window.innerWidth - 120, e.clientX - dragOffset.x)),
        y: Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      })
    }
    const handleMouseUp = () => setDragOffset(null)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragOffset])

  if (!match) return null

  const pA = match.user_a_info || {
    id: 'user_a',
    display_name: 'Player 1',
    pfp_url: null,
    card: match.my_card,
    decided: match.my_decided,
    score: match.score_mine,
  }

  const pB = match.user_b_info || {
    id: match.opponent?.id || 'user_b',
    display_name: match.opponent?.display_name || 'Player 2',
    pfp_url: match.opponent?.pfp_url || null,
    card: match.opponent_card,
    decided: match.opponent_decided,
    score: match.score_opponent,
  }

  const pATags = players?.find((p) => p.user_id === pA.id)?.tags || []
  const pBTags = players?.find((p) => p.user_id === pB.id)?.tags || []

  // Dual-leg card resolution: the server ships both the raw card id and the
  // resolved display URL. The id drives the signed object stream (bucket
  // cards, swarm descriptors); the URL covers direct/bot-card media.
  const objectIdFromUrl = (url: string | null | undefined): string | null => {
    if (!url) return null
    const idx = url.indexOf('/api/objects/')
    if (idx >= 0) return url.slice(idx + '/api/objects/'.length).split(/[?#]/)[0] || null
    return null
  }
  const pACardId = (pA as { card_id?: string | null }).card_id ?? objectIdFromUrl(pA.card)
  const pBCardId = (pB as { card_id?: string | null }).card_id ?? objectIdFromUrl(pB.card)

  const phase = match.phase
  const isRevealed = ['reveal', 'decide', 'round_result', 'result'].includes(phase)
  const msLeft = Math.max(0, countdownMs(match.phase_deadline, now))
  const countdown = formatCountdown(msLeft)
  const isEnded = match.status === 'ended' || phase === 'result'

  const currentRound = match.round_seq || 1
  const maxRounds = match.max_rounds || 5
  const history = match.rounds_history || []

  const buildViewerItems = (): OrbitObject[] => {
    const map = new Map<string, OrbitObject>()
    const add = (id: string | null | undefined, url: string | null | undefined, ownerId: string, label: string) => {
      if (!url) return
      const key = id || url
      if (map.has(key)) return
      map.set(key, {
        id: key,
        owner_id: ownerId as OrbitId,
        size_bytes: 0,
        mime_type: isMediaVideo(url) ? 'video/mp4' : 'image/jpeg',
        created_at: '',
        content_url: url,
        display_name: label,
      })
    }
    add(pACardId, pA.card, pA.id, `${pA.display_name || 'Player 1'}'s Card`)
    add(pBCardId, pB.card, pB.id, `${pB.display_name || 'Player 2'}'s Card`)
    for (const h of history) {
      add(h.card_a, h.card_a_url, pA.id, `R${h.round}, ${pA.display_name || 'Player 1'}'s Card`)
      add(h.card_b, h.card_b_url, pB.id, `R${h.round}, ${pB.display_name || 'Player 2'}'s Card`)
    }
    return Array.from(map.values())
  }

  const openInBoard = (id: string, url: string) => {
    playPress(780)
    if (onOpenItem) onOpenItem(buildViewerItems(), id)
    else
      zoom.showZoom(url, {
        isVideo: isMediaVideo(url),
        title: 'Spectator Card Zoom',
        subtitle: `Round ${currentRound}`,
      })
  }

  const formatCardUrl = (c: string | null | undefined): string | null => {
    if (!c) return null
    const trimmed = c.trim()
    if (!trimmed) return null
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/api/')
    ) {
      return trimmed
    }
    // encodeURIComponent: an id is one path segment. Without it a descriptor
    // that slipped through (magnet:?xt=… carries ? and &) would truncate the
    // path and 404 on the fragment before the id.
    return `/api/objects/${encodeURIComponent(trimmed)}`
  }

  const cardAUrl = formatCardUrl(pA.card)
  const cardBUrl = formatCardUrl(pB.card)

  // Minimized Picture-in-Picture (PiP) floating window.
  if (isMinimized) {
    return (
      <div
        style={pipPos ? { left: `${pipPos.x}px`, top: `${pipPos.y}px`, bottom: 'auto', right: 'auto' } : undefined}
        className={classes(
          'fixed bottom-6 right-6 z-[var(--z-lightbox)] w-80', COLOR.canvasVeil, 'border', STATUS.infoEdge,
          RADIUS.panel, SHADOW.sheet, 'overflow-hidden flex flex-col select-none backdrop-blur-md', MOTION.keyframe.fadeIn,
        )}
      >
        <div
          onMouseDown={handleMouseDown}
          className={classes('flex items-center justify-between', PADDING_X[3], PADDING_Y[2], COLOR.canvasSurface, 'border-b', COLOR.edge, 'cursor-grab active:cursor-grabbing')}
        >
          <div className={classes('flex items-center min-w-0', GAP[2])}>
            <span className="w-2 h-2 rounded-full bg-success shrink-0" />
            <span className={classes(TYPE.caption, WEIGHT.bold, TRACKING.wide, STATUS.info, 'uppercase truncate')}>
              Duel R{currentRound}/{maxRounds}
            </span>
            <span className={classes(CHROME.badge, MONO, WEIGHT.semibold, COLOR.fg)}>
              {pA.score ?? 0} : {pB.score ?? 0}
            </span>
          </div>
          <div className={classes('flex items-center', GAP[1])}>
            <Button type="button" variant="info" size="sm" onClick={() => { playPress(720); setIsMinimized(false) }}>
              Expand
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label="Close spectator" onClick={() => { playPress(680); onClose() }} className={PADDING_X[1.5]}>
              <X className={ICON.sm} />
            </Button>
          </div>
        </div>

        <div className={classes(PADDING[2.5], 'grid grid-cols-2', GAP[2], COLOR.canvasVeil)}>
          <div className={classes('space-y-1 text-center')}>
            <div className={classes(TYPE.caption, WEIGHT.semibold, COLOR.body, 'truncate')}>{pA.display_name || 'Player 1'}</div>
            <div className={classes('relative w-full select-none', RADIUS.panel)} data-rarity="copper">
              <GameCard
                objectId={pACardId}
                src={isRevealed ? cardAUrl : undefined}
                identity={identity}
                width={120}
                height={168}
                isVideo={Boolean(isMediaVideo(cardAUrl ?? ''))}
                interactive={false}
                name={isRevealed ? (pA.display_name || 'Player 1') : undefined}
                value={isRevealed ? (pA.score ?? 0) : undefined}
                rarity={computeCardRarity(pA.score ?? 0)}
              >
                {!isRevealed || !cardAUrl ? (
                  <div className={classes('absolute inset-0 z-0 flex flex-col items-center justify-center', PADDING[2], COLOR.canvasVeil)}>
                    <div className={classes('w-8 h-10 border border-dashed', STATUS.infoEdge, RADIUS.control, 'flex items-center justify-center')}>
                      <Clock className={classes(ICON.sm, STATUS.info)} />
                    </div>
                    <span className={classes(TYPE.caption, COLOR.muted, 'mt-1')}>Picking...</span>
                  </div>
                ) : null}
              </GameCard>
            </div>
          </div>
          <div className={classes('space-y-1 text-center')}>
            <div className={classes(TYPE.caption, WEIGHT.semibold, COLOR.body, 'truncate')}>{pB.display_name || 'Player 2'}</div>
            <div className={classes('relative w-full select-none', RADIUS.panel)} data-rarity="gold">
              <GameCard
                objectId={pBCardId}
                src={isRevealed ? cardBUrl : undefined}
                identity={identity}
                width={120}
                height={168}
                isVideo={Boolean(isMediaVideo(cardBUrl ?? ''))}
                interactive={false}
                name={isRevealed ? (pB.display_name || 'Player 2') : undefined}
                value={isRevealed ? (pB.score ?? 0) : undefined}
                rarity={computeCardRarity(pB.score ?? 0)}
              >
                {!isRevealed || !cardBUrl ? (
                  <div className={classes('absolute inset-0 z-0 flex flex-col items-center justify-center', PADDING[2], COLOR.canvasVeil)}>
                    <div className={classes('w-8 h-10 border border-dashed', STATUS.warningEdge, RADIUS.control, 'flex items-center justify-center')}>
                      <Clock className={classes(ICON.sm, STATUS.warning)} />
                    </div>
                    <span className={classes(TYPE.caption, COLOR.muted, 'mt-1')}>Picking...</span>
                  </div>
                ) : null}
              </GameCard>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Full Spectator Arena Modal
  return (
    <>
      <div
        className={classes('fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center', PADDING[1], 'sm:p-4 md:p-6', 'bg-black/70 backdrop-blur-sm', MOTION.keyframe.fadeIn, 'font-sans select-none')}
        onClick={onClose}
      >
        <div
          className={classes(
            'relative w-full', isExpanded ? 'max-w-6xl h-[92dvh]' : 'max-w-3xl max-h-[88dvh]',
            COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.panel, SHADOW.sheet, 'overflow-hidden flex flex-col', MOTION.transition.quick,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Bar */}
          <div className={classes('flex items-center justify-between', PADDING_X[4], PADDING_Y[3], 'border-b', COLOR.edge, COLOR.surfaceRaised, 'shrink-0')}>
            <div className={classes('flex items-center', GAP[2.5])}>
              <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
              <span className={classes(TYPE.body, WEIGHT.bold, TRACKING.wide, COLOR.fg, 'uppercase')}>
                Spectating live duel
              </span>
              <span className={classes(TYPE.caption, MONO, WEIGHT.semibold, STATUS.info, STATUS.infoBg, 'border', STATUS.infoEdge, RADIUS.pill, PADDING_X[2.5], 'py-0.5')}>
                Round {currentRound} of {maxRounds}
              </span>
            </div>

            <div className={classes('flex items-center', GAP[2])}>
              {!isEnded && (
                <div className={classes('flex items-center', GAP[1.5], TYPE.body, MONO, WEIGHT.semibold, STATUS.warning, STATUS.warningBg, 'border', STATUS.warningEdge, RADIUS.control, PADDING_X[2.5], PADDING_Y[1], 'mr-1')}>
                  <Clock className={ICON.sm} />
                  <span>{countdown}</span>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={isExpanded ? 'Restore view' : 'Maximize view'}
                title={isExpanded ? 'Restore View' : 'Maximize View'}
                onClick={() => { playPress(720); setIsExpanded((v) => !v) }}
                className={PADDING_X[2]}
              >
                {isExpanded ? <Minimize2 className={ICON.sm} /> : <Maximize2 className={ICON.sm} />}
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Picture in picture" title="Picture-in-Picture Mini View" onClick={() => { playPress(720); setIsMinimized(true) }} className={PADDING_X[2]}>
                <Minimize2 className={ICON.sm} />
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Close spectator" title="Close Spectator" onClick={() => { playPress(680); onClose() }} className={PADDING_X[2]}>
                <X className={ICON.md} />
              </Button>
            </div>
          </div>

          {/* Round Progress Indicator */}
          <div className={classes('flex items-center justify-center', GAP[1.5], PADDING[2], COLOR.surfaceRaised, 'border-b', COLOR.edge)}>
            {Array.from({ length: maxRounds }).map((_, idx) => {
              const rNum = idx + 1
              const pastRound = history.find((h) => h.round === rNum)
              const isCurrent = rNum === currentRound
              return (
                <div
                  key={rNum}
                  className={classes(
                    'flex items-center', GAP[1.5], PADDING_X[3], PADDING_Y[1], TYPE.caption, WEIGHT.bold, RADIUS.control, 'border', MOTION.transition.micro,
                    isCurrent
                      ? classes(STATUS.infoEdge, STATUS.infoBg, STATUS.info)
                      : pastRound
                        ? pastRound.matched
                          ? classes('border-success bg-success text-success-fg')
                          : classes(COLOR.edge, COLOR.surfaceRaised, COLOR.muted)
                        : classes(COLOR.edge, 'bg-transparent', COLOR.muted),
                  )}
                >
                  <span>R{rNum}</span>
                  {pastRound && (
                    <span className={pastRound.matched ? classes(STATUS.success, WEIGHT.bold) : classes(COLOR.muted, WEIGHT.bold)}>
                      {pastRound.matched ? <Star className={classes(ICON.sm, 'fill-current')} /> : <X className={ICON.sm} />}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Arena Body */}
          <div className={classes(PADDING[3], 'sm:p-5 overflow-y-auto flex-1 styled-scrollbar')}>
            <div className={classes('grid gap-4', history.length > 0 ? 'lg:grid-cols-[1fr_minmax(280px,36%)]' : 'grid-cols-1')}>
              {/* Left Column: Live Arena & Cards */}
              <div className={classes('space-y-4 flex flex-col')}>
                {/* Scoreboard Players Card Header */}
                <div className={classes('grid grid-cols-2 gap-3 items-center', COLOR.surfaceRaised, PADDING[3.5], 'border', COLOR.edge, RADIUS.control, SHADOW.xs)}>
                  {/* Player A */}
                  <div className={classes('flex items-center', GAP[3])}>
                    <div className="relative">
                      <Avatar id={pA.id} imageUrl={pA.pfp_url || undefined} size={42} />
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-success border-2 border-edge" />
                    </div>
                    <div className="min-w-0">
                      <div className={classes(TYPE.body, WEIGHT.bold, 'truncate', COLOR.fg)}>
                        {pA.display_name?.trim() || 'Unknown User'}
                      </div>
                      <div className={classes('flex items-center flex-wrap mt-0.5', GAP[1.5])}>
                        <span className={classes(TYPE.caption, COLOR.muted)}>Score:</span>
                        <span className={classes(TYPE.body, MONO, WEIGHT.bold, STATUS.info, STATUS.infoBg, 'border', STATUS.infoEdge, PADDING_X[1.5], 'py-0.5', RADIUS.chip)}>
                          {pA.score ?? 0}
                        </span>
                        {pATags.slice(0, 2).map((t, idx) => (
                          <span key={idx} className={classes(TYPE.caption, COLOR.surfaceRaised, COLOR.muted, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'border', COLOR.edge)}>#{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Player B */}
                  <div className={classes('flex items-center justify-end text-right', GAP[3])}>
                    <div className="min-w-0">
                      <div className={classes(TYPE.body, WEIGHT.bold, 'truncate', COLOR.fg)}>
                        {pB.display_name?.trim() || 'Unknown User'}
                      </div>
                      <div className={classes('flex items-center justify-end flex-wrap mt-0.5', GAP[1.5])}>
                        {pBTags.slice(0, 2).map((t, idx) => (
                          <span key={idx} className={classes(TYPE.caption, COLOR.surfaceRaised, COLOR.muted, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'border', COLOR.edge)}>#{t}</span>
                        ))}
                        <span className={classes(TYPE.caption, COLOR.muted)}>Score:</span>
                        <span className={classes(TYPE.body, MONO, WEIGHT.bold, STATUS.warning, STATUS.warningBg, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'border', STATUS.warningEdge)}>
                          {pB.score ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="relative">
                      <Avatar id={pB.id} imageUrl={pB.pfp_url || undefined} size={42} />
                      <span className="absolute -bottom-1 -left-1 w-3.5 h-3.5 rounded-full bg-warning border-2 border-edge" />
                    </div>
                  </div>
                </div>

                {/* Duel Cards Display — the same HoloCard surface as every card. */}
                <div className={classes('grid grid-cols-2', GAP[3], 'sm:gap-4')}>
                  {/* Card A */}
                  <div className={classes('flex flex-col items-center', GAP[2.5], COLOR.surfaceRaised, PADDING[3], 'sm:p-4 border border-edge rounded-xl shadow-xs')}>
                    <div className={classes(TYPE.caption, WEIGHT.bold, STATUS.info, 'uppercase flex items-center', GAP[1.5])}>
                      <span className="w-1.5 h-1.5 rounded-full bg-info" />
                      <span>{pA.display_name || 'Player 1'}&apos;s Card</span>
                    </div>

                    <div className={classes('relative w-full max-h-72 select-none', RADIUS.panel)} data-rarity="copper">
                      <GameCard
                        objectId={pACardId}
                        src={isRevealed ? cardAUrl : undefined}
                        identity={identity}
                        width={200}
                        height={280}
                        isVideo={Boolean(isMediaVideo(cardAUrl ?? ''))}
                        interactive={false}
                        name={isRevealed && cardAUrl ? (pA.display_name || 'Player 1') : undefined}
                        value={isRevealed ? (pA.score ?? 0) : undefined}
                        rarity={computeCardRarity(pA.score ?? 0)}
                      >
                        {isRevealed && cardAUrl ? (
                          <button
                            type="button"
                            aria-label={`Open ${pA.display_name || 'Player 1'}'s card`}
                            onClick={() => openInBoard(pACardId ?? cardAUrl, cardAUrl)}
                            className="absolute inset-0 z-10 cursor-zoom-in"
                          >
                            <span className={classes('absolute bottom-2 right-2 z-20', CHROME.mediaChip, 'flex items-center', GAP[1])}>
                              <ZoomIn className={ICON.sm} /> Zoom
                            </span>
                          </button>
                        ) : (
                          <div className={classes('absolute inset-0 z-0 flex flex-col items-center justify-center', PADDING[4], COLOR.canvasVeil, COLOR.muted)}>
                            <Sparkles className={classes(ICON.lg, STATUS.info, 'animate-orbit-pulse-soft')} />
                            <span className={classes(TYPE.caption, STATUS.info, 'uppercase')}>Shuffling</span>
                            <span className={classes(TYPE.caption, COLOR.muted)}>Card {tickIdx + 1} of {maxRounds}</span>
                          </div>
                        )}
                      </GameCard>
                    </div>
                  </div>

                  {/* Card B */}
                  <div className={classes('flex flex-col items-center', GAP[2.5], COLOR.surfaceRaised, PADDING[3], 'sm:p-4 border border-edge rounded-xl shadow-xs')}>
                    <div className={classes(TYPE.caption, WEIGHT.bold, STATUS.warning, 'uppercase flex items-center', GAP[1.5])}>
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                      <span>{pB.display_name || 'Player 2'}&apos;s Card</span>
                    </div>

                    <div className={classes('relative w-full max-h-72 select-none', RADIUS.panel)} data-rarity="gold">
                      <GameCard
                        objectId={pBCardId}
                        src={isRevealed ? cardBUrl : undefined}
                        identity={identity}
                        width={200}
                        height={280}
                        isVideo={Boolean(isMediaVideo(cardBUrl ?? ''))}
                        interactive={false}
                        name={isRevealed && cardBUrl ? (pB.display_name || 'Player 2') : undefined}
                        value={isRevealed ? (pB.score ?? 0) : undefined}
                        rarity={computeCardRarity(pB.score ?? 0)}
                      >
                        {isRevealed && cardBUrl ? (
                          <button
                            type="button"
                            aria-label={`Open ${pB.display_name || 'Player 2'}'s card`}
                            onClick={() => openInBoard(pBCardId ?? cardBUrl, cardBUrl)}
                            className="absolute inset-0 z-10 cursor-zoom-in"
                          >
                            <span className={classes('absolute bottom-2 right-2 z-20', CHROME.mediaChip, 'flex items-center', GAP[1])}>
                              <ZoomIn className={ICON.sm} /> Zoom
                            </span>
                          </button>
                        ) : (
                          <div className={classes('absolute inset-0 z-0 flex flex-col items-center justify-center', PADDING[4], COLOR.canvasVeil, COLOR.muted)}>
                            <Sparkles className={classes(ICON.lg, STATUS.warning, 'animate-orbit-pulse-soft')} />
                            <span className={classes(TYPE.caption, STATUS.warning, 'uppercase')}>Shuffling</span>
                            <span className={classes(TYPE.caption, COLOR.muted)}>Card {tickIdx + 1} of {maxRounds}</span>
                          </div>
                        )}
                      </GameCard>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Rounds History */}
              {history.length > 0 && (
                <div className={classes('border border-edge', COLOR.surfaceRaised, PADDING[3.5], RADIUS.control, 'flex flex-col min-h-0 lg:h-full', SHADOW.xs)}>
                  <div className={classes(TYPE.body, WEIGHT.bold, COLOR.body, 'uppercase shrink-0 mb-3 flex items-center', GAP[2])}>
                    <Award className={classes(ICON.sm, STATUS.warning)} />
                    <span>Duel round history</span>
                  </div>

                  <div className={classes('space-y-2 flex-1 min-h-0 overflow-y-auto styled-scrollbar pr-1 max-h-80 lg:max-h-none')}>
                    {history.map((h) => {
                      const mediaThumb = (id: string | null | undefined, url: string | null | undefined) => {
                        if (!url) {
                          return (
                            <span className={classes('w-14 h-14 shrink-0 flex items-center justify-center', TYPE.caption, COLOR.muted, COLOR.interactive, 'border border-edge rounded-xl')}>
                              None
                            </span>
                          )
                        }
                        return (
                          <button
                            type="button"
                            aria-label="Open duel round card"
                            onClick={() => openInBoard(id ?? url, url)}
                            className={classes('w-14 h-14 shrink-0 overflow-hidden border border-edge bg-retro-bg group relative cursor-zoom-in rounded-xl', SHADOW.xs)}
                          >
                            <ObjectImage
                              contentUrl={url}
                              objectId={id}
                              identity={identity}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              muted
                              playsInline
                              preload="metadata"
                              loading="lazy"
                            />
                          </button>
                        )
                      }

                      return (
                        <div key={h.round} className={classes('flex items-center', GAP[2], PADDING[2], COLOR.surfaceRaised, 'border border-edge rounded-xl', SHADOW.xs)}>
                          <span className={classes(MONO, WEIGHT.bold, COLOR.muted, TYPE.body, 'shrink-0')}>R{h.round}</span>
                          <div className={classes('flex items-center', GAP[1.5], 'flex-1 min-w-0')}>
                            {mediaThumb(h.card_a, h.card_a_url)}
                            <span className={classes(TYPE.caption, COLOR.muted, WEIGHT.bold, 'shrink-0')}>vs</span>
                            {mediaThumb(h.card_b, h.card_b_url)}
                          </div>
                          <span
                            className={classes(
                              WEIGHT.bold, PADDING_X[2], 'py-0.5', TYPE.caption, 'rounded-lg shrink-0 border',
                              h.matched ? classes('bg-success text-success-fg border-success', SHADOW.xs) : classes(COLOR.interactive, COLOR.muted, COLOR.edge),
                            )}
                          >
                            {h.matched ? 'Mutual' : 'Missed'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ZoomModal zoom={zoom} identity={identity} />
    </>
  )
}
