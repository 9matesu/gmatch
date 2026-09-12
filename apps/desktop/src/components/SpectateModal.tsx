"use client";

import { useState, useEffect } from 'react'
import type { MatchSnapshot, OrbitObject, OrbitId } from '@orbit/shared'
import { Avatar } from './Avatar'
import { formatCountdown, countdownMs } from '../utils/lobby'
import { CardZoomModal } from './CardZoomModal'
import {  formatGc } from '@orbit/shared'
import { isMediaVideo } from '../utils/media'
import { ObjectImage } from './ObjectImage'
import { playPress } from '../utils/sounds'
import {
  Star,
  X,
  Minimize2,
  Maximize2,
  ZoomIn,
  Sparkles,
  Award,
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
  const [zoomModal, setZoomModal] = useState<{
    isOpen: boolean
    imageUrl: string | null
    isVideo?: boolean
    title?: string
    subtitle?: string
  }>({
    isOpen: false,
    imageUrl: null,
  })

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
    const add = (url: string | null | undefined, ownerId: string, label: string) => {
      if (!url || map.has(url)) return
      map.set(url, {
        id: url,
        owner_id: ownerId as OrbitId,
        size_bytes: 0,
        mime_type: isMediaVideo(url) ? 'video/mp4' : 'image/jpeg',
        created_at: '',
        content_url: url,
        display_name: label,
      })
    }
    add(pA.card, pA.id, `${pA.display_name || 'Player 1'}'s Card`)
    add(pB.card, pB.id, `${pB.display_name || 'Player 2'}'s Card`)
    for (const h of history) {
      add(h.card_a_url, pA.id, `R${h.round} — ${pA.display_name || 'Player 1'}'s Card`)
      add(h.card_b_url, pB.id, `R${h.round} — ${pB.display_name || 'Player 2'}'s Card`)
    }
    return Array.from(map.values())
  }

  const openInBoard = (url: string) => {
    playPress(780)
    if (onOpenItem) onOpenItem(buildViewerItems(), url)
    else
      setZoomModal({
        isOpen: true,
        imageUrl: url,
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
    return `/api/objects/${trimmed}`
  }

  const cardAUrl = formatCardUrl(pA.card)
  const cardBUrl = formatCardUrl(pB.card)

  

  // Minimized Picture-in-Picture (PiP) floating window with Shadcn Yellow/Cyan Theme
  if (isMinimized) {
    return (
      <div
        style={pipPos ? { left: `${pipPos.x}px`, top: `${pipPos.y}px`, bottom: 'auto', right: 'auto' } : undefined}
        className="fixed bottom-6 right-6 z-[var(--z-system)] w-80 bg-surface-canvas/95 border-2 border-cyan-500/60 rounded-xl shadow-2xl overflow-hidden flex flex-col select-none backdrop-blur-2xl animate-orbit-fade-in font-sans"
      >
        <div
          onMouseDown={handleMouseDown}
          className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-zinc-900 to-zinc-950 border-b border-border-glass cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] font-black tracking-widest text-cyan-300 uppercase truncate">
              DUEL R{currentRound}/{maxRounds}
            </span>
            <span className="text-[10px] font-mono text-yellow-400 font-bold bg-yellow-950/40 px-1.5 py-0.2 rounded border border-yellow-500/30">
              {pA.score ?? 0} : {pB.score ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { playPress(720); setIsMinimized(false) }}
              className="px-2 py-0.5 text-[10px] font-bold bg-cyan-500 hover:bg-cyan-400 text-retro-fg rounded-lg cursor-pointer transition-all active:scale-95 shadow"
            >
              EXPAND
            </button>
            <button
              type="button"
              onClick={() => { playPress(680); onClose() }}
              className="p-1 text-retro-muted hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-2.5 grid grid-cols-2 gap-2 bg-surface-canvas/90">
          <div className="space-y-1 text-center">
            <div className="text-[10px] font-bold text-retro-body truncate">{pA.display_name || 'Player 1'}</div>
            <div className="metallic-card-border aspect-[3/4.2] rounded-xl overflow-hidden relative flex items-center justify-center select-none" data-rarity="copper">
              <div className="metallic-card w-full h-full flex flex-col">
                {isRevealed && cardAUrl ? (
                  <>
                    <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1">
                      <span className="text-[10px] font-mono font-bold px-1 rounded bg-black/80 text-amber-300 border border-amber-500/30">
                        {formatGc(pA.score ?? 0)}
                      </span>
                    </div>
                    <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                      <ObjectImage
                        contentUrl={cardAUrl}
                        identity={identity}
                        className="w-full h-full object-cover"
                        videoClassName="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-surface-canvas/80">
                    <div className="w-8 h-10 border border-dashed border-cyan-500/40 rounded-lg flex items-center justify-center animate-pulse">
                      <span className="text-xs text-cyan-400 font-mono">◈</span>
                    </div>
                    <span className="text-[10px] text-retro-muted mt-1">Picking...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-1 text-center">
            <div className="text-[10px] font-bold text-retro-body truncate">{pB.display_name || 'Player 2'}</div>
            <div className="metallic-card-border aspect-[3/4.2] rounded-xl overflow-hidden relative flex items-center justify-center select-none" data-rarity="gold">
              <div className="metallic-card w-full h-full flex flex-col">
                {isRevealed && cardBUrl ? (
                  <>
                    <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1">
                      <span className="text-[10px] font-mono font-bold px-1 rounded bg-black/80 text-amber-300 border border-amber-500/30">
                        {formatGc(pB.score ?? 0)}
                      </span>
                    </div>
                    <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                      <ObjectImage
                        contentUrl={cardBUrl}
                        identity={identity}
                        className="w-full h-full object-cover"
                        videoClassName="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-surface-canvas/80">
                    <div className="w-8 h-10 border border-dashed border-yellow-500/40 rounded-lg flex items-center justify-center animate-pulse">
                      <span className="text-xs text-yellow-400 font-mono">◈</span>
                    </div>
                    <span className="text-[10px] text-retro-muted mt-1">Picking...</span>
                  </div>
                )}
              </div>
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
        className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/70 backdrop-blur-xl animate-orbit-fade-in font-sans select-none"
        onClick={onClose}
      >
        <div
          className={`relative w-full ${isExpanded ? 'max-w-6xl h-[92vh]' : 'max-w-3xl max-h-[88vh]'
            } bg-surface-raised border border-border-glass rounded-xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass bg-surface-raised shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shadow-xs" />
              <span className="text-xs font-black tracking-widest text-retro-fg uppercase">
                SPECTATING LIVE DUEL
              </span>
              <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-500/10 px-2.5 py-0.5 border border-cyan-500/30 rounded-full">
                ROUND {currentRound} OF {maxRounds}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!isEnded && (
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1 border border-amber-200 rounded-xl mr-1">
                  <span>⏱</span>
                  <span>{countdown}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => { playPress(720); setIsExpanded((v) => !v) }}
                title={isExpanded ? 'Restore View' : 'Maximize View'}
                className="w-8 h-8 rounded-xl text-retro-muted hover:text-retro-fg hover:bg-glass-w10 flex items-center justify-center transition-all cursor-pointer"
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => { playPress(720); setIsMinimized(true) }}
                title="Picture-in-Picture Mini View"
                className="w-8 h-8 rounded-xl text-retro-muted hover:text-retro-fg hover:bg-glass-w10 flex items-center justify-center transition-all cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { playPress(680); onClose() }}
                title="Close Spectator"
                className="w-8 h-8 rounded-xl text-retro-muted hover:text-red-500 hover:bg-glass-w10 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Round Progress Indicator */}
          <div className="flex items-center gap-1.5 p-2 bg-surface-raised border-b border-border-glass justify-center">
            {Array.from({ length: maxRounds }).map((_, idx) => {
              const rNum = idx + 1
              const pastRound = history.find((h) => h.round === rNum)
              const isCurrent = rNum === currentRound
              return (
                <div
                  key={rNum}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-xl border transition-all ${isCurrent
                      ? 'border-purple-500 bg-cyan-500/10 text-cyan-300 shadow-xs animate-pulse'
                      : pastRound
                        ? pastRound.matched
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-border-glass bg-surface-raised text-retro-muted'
                        : 'border-border-glass bg-transparent text-retro-muted'
                    }`}
                >
                  <span>R{rNum}</span>
                  {pastRound && (
                    <span className={pastRound.matched ? 'text-emerald-600 font-black' : 'text-retro-muted font-bold'}>
                      {pastRound.matched ? <Star className="w-3.5 h-3.5 fill-current" /> : <X className="w-3.5 h-3.5" />}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Arena Body */}
          <div className="p-3 sm:p-5 overflow-y-auto flex-1 styled-scrollbar">
            <div className={`grid gap-4 ${history.length > 0 ? 'lg:grid-cols-[1fr_minmax(280px,36%)]' : 'grid-cols-1'}`}>
              {/* Left Column: Live Arena & Cards */}
              <div className="space-y-4 flex flex-col">
                {/* Scoreboard Players Card Header */}
                <div className="grid grid-cols-2 gap-3 items-center bg-surface-raised p-3.5 border border-border-glass rounded-xl shadow-xs">
                  {/* Player A */}
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar id={pA.id} imageUrl={pA.pfp_url || undefined} size={42} />
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-500 border-2 border-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate text-retro-fg">
                        {pA.display_name?.trim() || 'Unknown User'}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[10px] text-retro-muted">Score:</span>
                        <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 px-1.5 py-0.2 rounded border border-cyan-500/30">
                          {pA.score ?? 0}
                        </span>
                        {pATags.slice(0, 2).map((t, idx) => (
                          <span key={idx} className="text-[10px] bg-surface-raised text-retro-muted px-1.5 py-0.5 rounded border border-border-glass">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Player B */}
                  <div className="flex items-center gap-3 justify-end text-right">
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate text-retro-fg">
                        {pB.display_name?.trim() || 'Unknown User'}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 flex-wrap mt-0.5">
                        {pBTags.slice(0, 2).map((t, idx) => (
                          <span key={idx} className="text-[10px] bg-surface-raised text-retro-muted px-1.5 py-0.5 rounded border border-border-glass">
                            #{t}
                          </span>
                        ))}
                        <span className="text-[10px] text-retro-muted">Score:</span>
                        <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                          {pB.score ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="relative">
                      <Avatar id={pB.id} imageUrl={pB.pfp_url || undefined} size={42} />
                      <span className="absolute -bottom-1 -left-1 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white" />
                    </div>
                  </div>
                </div>

                {/* Duel Cards Display */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {/* Card A */}
                  <div className="flex flex-col items-center gap-2.5 bg-surface-raised p-3 sm:p-4 border border-border-glass rounded-xl shadow-xs">
                    <div className="text-[10px] font-bold tracking-wider text-cyan-300 uppercase flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                      <span>{pA.display_name || 'Player 1'}&apos;s Card</span>
                    </div>

                    <div className="metallic-card-border w-full aspect-[3/4.2] max-h-72 select-none" data-rarity="copper">
                      <div className="metallic-card flex flex-col h-full">
                        {isRevealed && cardAUrl ? (
                          <button
                            type="button"
                            onClick={() => openInBoard(cardAUrl)}
                            className="w-full h-full cursor-zoom-in relative flex flex-col"
                          >
                            <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                              <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/80 text-amber-300 border border-amber-400/40 shadow-md backdrop-blur-xs">
                                {formatGc(pA.score ?? 0)}
                              </span>
                            </div>
                            <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                              <ObjectImage
                                contentUrl={cardAUrl}
                                identity={identity}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                autoPlay
                                loop
                                muted
                                playsInline
                              />
                              <span className="absolute bottom-2 right-2 bg-black/70 border border-border-glass text-[10px] font-bold text-white px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <ZoomIn className="w-3 h-3" />
                                <span>ZOOM</span>
                              </span>
                            </div>
                            <div className="p-2 bg-surface-canvas/90 border-t border-border-glass backdrop-blur-md text-left">
                              <div className="text-xs font-semibold text-retro-fg truncate">{pA.display_name || 'Player 1'}</div>
                            </div>
                          </button>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-surface-canvas relative overflow-hidden text-retro-muted">
                            <div className={`absolute inset-0 bg-gradient-to-br from-cyan-900/60 via-teal-900/40 to-cyan-900/50 blur-xl opacity-70 animate-pulse transition-all duration-300`} />
                            <div className="relative z-10 flex flex-col items-center gap-2 text-center">
                              <div className="w-10 h-14 rounded-xl border border-border-strong bg-surface-raised/10 backdrop-blur-md flex items-center justify-center shadow-lg animate-bounce">
                                <Sparkles className="w-4 h-4 text-cyan-300 animate-spin" />
                              </div>
                              <span className="text-[10px] font-mono font-black text-purple-200 uppercase tracking-wider">
                                Shuffling... (Tick #{tickIdx + 1})
                              </span>
                              <span className="text-[10px] font-mono text-retro-muted">
                                [Encrypted Hand]
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card B */}
                  <div className="flex flex-col items-center gap-2.5 bg-surface-raised p-3 sm:p-4 border border-border-glass rounded-xl shadow-xs">
                    <div className="text-[10px] font-bold tracking-wider text-amber-700 uppercase flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>{pB.display_name || 'Player 2'}&apos;s Card</span>
                    </div>

                    <div className="metallic-card-border w-full aspect-[3/4.2] max-h-72 select-none" data-rarity="gold">
                      <div className="metallic-card flex flex-col h-full">
                        {isRevealed && cardBUrl ? (
                          <button
                            type="button"
                            onClick={() => openInBoard(cardBUrl)}
                            className="w-full h-full cursor-zoom-in relative flex flex-col"
                          >
                            <div className="absolute top-2 left-2 z-20 flex items-center gap-1">
                              <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/80 text-amber-300 border border-amber-400/40 shadow-md backdrop-blur-xs">
                                {formatGc(pB.score ?? 0)}
                              </span>
                            </div>
                            <div className="relative w-full flex-1 min-h-0 bg-surface-canvas overflow-hidden">
                              <ObjectImage
                                contentUrl={cardBUrl}
                                identity={identity}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                videoClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                autoPlay
                                loop
                                muted
                                playsInline
                              />
                              <span className="absolute bottom-2 right-2 bg-black/70 border border-border-glass text-[10px] font-bold text-white px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <ZoomIn className="w-3 h-3" />
                                <span>ZOOM</span>
                              </span>
                            </div>
                            <div className="p-2 bg-surface-canvas/90 border-t border-border-glass backdrop-blur-md text-left">
                              <div className="text-xs font-semibold text-retro-fg truncate">{pB.display_name || 'Player 2'}</div>
                            </div>
                          </button>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-surface-canvas relative overflow-hidden text-retro-muted">
                            <div className={`absolute inset-0 bg-gradient-to-br from-amber-900/60 via-orange-900/40 to-rose-900/50 blur-xl opacity-70 animate-pulse transition-all duration-300`} />
                            <div className="relative z-10 flex flex-col items-center gap-2 text-center">
                              <div className="w-10 h-14 rounded-xl border border-border-strong bg-surface-raised/10 backdrop-blur-md flex items-center justify-center shadow-lg animate-bounce">
                                <Sparkles className="w-4 h-4 text-amber-300 animate-spin" />
                              </div>
                              <span className="text-[10px] font-mono font-black text-amber-200 uppercase tracking-wider">
                                Shuffling... (Tick #{tickIdx + 1})
                              </span>
                              <span className="text-[10px] font-mono text-retro-muted">
                                [Encrypted Hand]
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Rounds History */}
              {history.length > 0 && (
                <div className="border border-border-glass bg-surface-raised p-3.5 rounded-xl flex flex-col min-h-0 lg:h-full shadow-xs">
                  <div className="text-xs font-black text-retro-body uppercase tracking-widest shrink-0 mb-3 flex items-center gap-2">
                    <Award className="w-3.5 h-3.5 text-amber-500" />
                    <span>Duel Round History</span>
                  </div>

                  <div className="space-y-2 flex-1 min-h-0 overflow-y-auto styled-scrollbar pr-1 max-h-80 lg:max-h-none">
                    {history.map((h) => {
                      const mediaThumb = (url: string | null | undefined) => {
                        if (!url) {
                          return (
                            <span className="w-14 h-14 shrink-0 flex items-center justify-center text-[10px] text-retro-muted bg-surface-interactive border border-border-glass rounded-xl">
                              —
                            </span>
                          )
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => openInBoard(url)}
                            className="w-14 h-14 shrink-0 overflow-hidden border border-border-glass bg-black group relative cursor-zoom-in rounded-xl shadow-xs"
                          >
                            <ObjectImage
                              contentUrl={url}
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
                        <div
                          key={h.round}
                          className="flex items-center gap-2 p-2 bg-surface-raised border border-border-glass rounded-xl shadow-xs"
                        >
                          <span className="font-mono font-bold text-retro-muted text-xs shrink-0">R{h.round}</span>
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            {mediaThumb(h.card_a_url)}
                            <span className="text-[10px] text-retro-muted font-bold shrink-0">VS</span>
                            {mediaThumb(h.card_b_url)}
                          </div>
                          <span
                            className={`font-bold px-2 py-0.5 text-[10px] rounded-lg shrink-0 border ${h.matched
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs'
                                : 'bg-surface-interactive text-retro-muted border-border-glass'
                              }`}
                          >
                            {h.matched ? 'MUTUAL' : 'MISSED'}
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

      <CardZoomModal
        isOpen={zoomModal.isOpen}
        onClose={() => setZoomModal({ isOpen: false, imageUrl: null })}
        imageUrl={zoomModal.imageUrl}
        isVideo={zoomModal.isVideo}
        title={zoomModal.title}
        subtitle={zoomModal.subtitle}
        identity={identity}
      />
    </>
  )
}
