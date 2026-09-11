import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { gridSizeForMode, isGridMode } from '../game/store'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import { HEAT_WINDOW_MS, heatMultiplier } from '../game/economy'
import type { CapId, ViewMode } from '../game/types'
import { offlineSvg } from '../services/offlineSvg'
import { prefetchImages, resolveImage } from '../services/imageCache'
import { isVideoUrl } from '../services/postFilter'
import { redgifsPlayable } from '../services/redgifs'
import { formatNum } from './format'
import {
  BTN,
  BTN_SMALL,
  DISPLAY,
  FLOAT_GC,
  FLOAT_GC_CRIT,
  GOON_IMAGE,
  HP_BAR,
  HP_FILL,
  HP_FILL_LOW,
  MONO,
  MUTED,
  PANEL,
  PLATE,
  STAGE_FRAME,
} from './styles'
import CachedImg from './CachedImg'
import OfflineCard from './OfflineCard'
import { Badge } from '../components/Badge'
import { X } from 'lucide-react'
import { Skeleton } from '../components/Skeleton'
import { IconChevronL, IconChevronR } from './icons'

interface Float {
  id: number
  x: number
  y: number
  text: string
  crit: boolean
  cell: number | null
}

const CAP_ORDER: CapId[] = ['blue', 'filter', 'hypno', 'melt']

/** Autoplay is opt-in: honor prefers-reduced-motion (SPEC §7 a11y). */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

export default function GoonPanel({ headerRight }: { headerRight?: React.ReactNode }) {
  const current = useGame((s) => s.current)
  const feedOffline = useGame((s) => s.feedOffline)
  const fetching = useGame((s) => s.fetching)
  const gc = useGame((s) => s.gc)
  const foeHp = useGame((s) => s.foeHp)
  const foeMaxHp = useGame((s) => s.foeMaxHp)
  const defeated = useGame((s) => s.defeated)
  const caps = useGame((s) => s.caps)
  const viewMode = useGame((s) => s.viewMode)
  const grid = useGame((s) => s.grid)
  const heatStreak = useGame((s) => s.heatStreak)
  const lastClickAt = useGame((s) => s.lastClickAt)
  const clickImage = useGame((s) => s.clickImage)
  const clickCell = useGame((s) => s.clickCell)
  const dropCell = useGame((s) => s.dropCell)
  const setViewMode = useGame((s) => s.setViewMode)
  const reorderGrid = useGame((s) => s.reorderGrid)
  const pendingDrops = useGame((s) => s.pendingDrops)
  const claimDropTag = useGame((s) => s.claimDropTag)
  const claimDropAntiTag = useGame((s) => s.claimDropAntiTag)
  const dismissDrop = useGame((s) => s.dismissDrop)
  const fetchFeed = useGame((s) => s.fetchFeed)
  const advanceFeed = useGame((s) => s.advanceFeed)
  const goBack = useGame((s) => s.goBack)
  const canGoBack = useGame((s) => s.past.length > 0)
  const skipGrid = useGame((s) => s.skipGrid)
  const undoGrid = useGame((s) => s.undoGrid)
  const canGridBack = useGame((s) => s.gridPast.length > 0)
  const queue = useGame((s) => s.queue)
  const past = useGame((s) => s.past)
  const popCap = useGame((s) => s.popCap)
  const imageReady = useGame((s) => s.imageReady)
  const setImageReady = useGame((s) => s.setImageReady)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  const [dropsOpen, setDropsOpen] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [shakeKey, setShakeKey] = useState(0)
  const [shakeCell, setShakeCell] = useState<number | null>(null)
  const floatId = useRef(0)
  const stageRef = useRef<HTMLElement | null>(null)
  const reduceMotion = useReducedMotion()

  const now = Date.now()

  const onImageError = useCallback(() => {
    setFailedUrl(current?.url ?? null)
    advanceFeed()
  }, [advanceFeed, current])

  // Warm the cache so player never waits: prefetch active grid + next 18 queue items (2 full 3x3 boards ahead)
  useEffect(() => {
    const urls = [
      ...grid.flatMap((c) => [c.post.url, ...(c.post.preview ? [c.post.preview] : [])]),
      ...queue.slice(0, 18).flatMap((p) => [p.url, ...(p.preview ? [p.preview] : [])]),
      ...past.slice(-3).flatMap((p) => [p.url, ...(p.preview ? [p.preview] : [])]),
    ]
    prefetchImages(urls, 27)
  }, [queue, past, grid])

  // Grid top-up: after load (persisted grid mode) or whenever squares run dry.
  // Stops once the feed flags offline — the Retry button takes it from there.
  useEffect(() => {
    const target = gridSizeForMode(viewMode)
    if (isGridMode(viewMode) && grid.length < target && !fetching && !feedOffline) {
      setViewMode(viewMode)
    }
  }, [viewMode, grid.length, fetching, feedOffline, setViewMode])

  // One-hand keyboard: Space clicks the foe, 1-4 pop caps, arrows navigate.
  // Skipped inside inputs/textareas/selects so typing stays safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return
      }
      const st = useGame.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        if (isGridMode(st.viewMode)) {
          if (st.grid.length > 0) st.clickCell(0)
        } else {
          st.clickImage()
        }
        return
      }
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        e.preventDefault()
        st.popCap(CAP_ORDER[Number(e.key) - 1])
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (isGridMode(st.viewMode)) void st.undoGrid()
        else void st.goBack()
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (isGridMode(st.viewMode)) st.skipGrid()
        else st.advanceFeed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Float budget: rapid clicking (or heat spam) used to append unbounded
  // DOM spans + orphan timers on unmount. Cap live floats at 20 and clear
  // every timer on unmount — the stage can't be the thing that leaks.
  const floatTimers = useRef<number[]>([])
  useEffect(() => () => { for (const t of floatTimers.current) window.clearTimeout(t); floatTimers.current = [] }, [])
  const spawnFloat = (x: number, y: number, gain: number, crit: boolean, cell: number | null, heatMult = 1) => {
    const id = ++floatId.current
    const heatTag = heatMult > 1 ? ` x${heatMult}` : ''
    setFloats((f) => [...f.slice(-19), { id, x, y, text: `+${formatNum(gain)}${heatTag}`, crit, cell }])
    floatTimers.current.push(window.setTimeout(() => setFloats((f) => f.filter((fl) => fl.id !== id)), 900))
    if (crit) {
      setCritFlash(true)
      floatTimers.current.push(window.setTimeout(() => setCritFlash(false), 350))
    }
  }

  const triggerShake = (cell: number | null) => {
    if (reduceMotion) return
    setShakeCell(cell)
    setShakeKey((k) => k + 1)
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickImage()
    spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, null, heat)
    triggerShake(null)
  }

  const handleCellClick = (index: number, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickCell(index)
    if (gain > 0) spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, index, heat)
    triggerShake(index)
  }

  /** Middle-click anywhere on the stage advances to the next foe — no reward. */
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    if (isGridMode(useGame.getState().viewMode)) useGame.getState().skipGrid()
    else useGame.getState().advanceFeed()
  }

  const showOffline = feedOffline || !current || failedUrl === current.url
  const src = showOffline ? offlineSvg(current?.tags ?? []) : current.url
  // Motion posts (redgifs mp4/webm) play inline; gifs stay on <img>.
  const isMotion =
    !showOffline &&
    !!current &&
    (current.kind === 'video' || isVideoUrl(current.url)) &&
    !/\.gif(?:[?#]|$)/i.test(current.url)
  const inBattle = !showOffline && foeMaxHp > 0

  // Verified stage swap: keep the last decoded picture on screen until the
  // next one is cached + decoded successfully — arrows never show a blank
  // frame, and scoring stays locked (store.imageReady) until it is visible.
  useEffect(() => {
    if (showOffline || !current) {
      setImageReady(false)
      return
    }
    if (isMotion) {
      // Videos stream from source; the <video> element's own events gate it.
      setShownUrl(null)
      setImageReady(true)
      return
    }
    let live = true
    setImageReady(false)
    const url = current.url
    void (async () => {
      try {
        const resolved = await resolveImage(url)
        const probe = new Image()
        probe.referrerPolicy = 'no-referrer'
        probe.src = resolved
        await probe.decode()
        if (!live) return
        setShownUrl(resolved)
        setImageReady(true)
      } catch {
        if (!live) return
        onImageError()
      }
    })()
    return () => {
      live = false
    }
  }, [current, showOffline, isMotion, setImageReady, onImageError])
  const hpPct = inBattle ? Math.max(0, (foeHp / foeMaxHp) * 100) : 0
  // Heat combo HUD: live multiplier + whether the streak is still inside the
  // 2s window (goes cold visually the moment you stop clicking).
  const heat = heatMultiplier(heatStreak)
  const heatLive = heat > 1 && Date.now() - lastClickAt <= HEAT_WINDOW_MS
  const isGrid = isGridMode(viewMode)
  const gridTarget = gridSizeForMode(viewMode)
  const gridCols =
    viewMode === '2x2' || viewMode === '1x2' ? 'grid-cols-2' : 'grid-cols-3'

  const critFlashEl = critFlash && (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(255,45,120,0.28)] font-sans text-7xl font-bold tracking-[6px] text-white shadow-[inset_0_0_60px_rgba(255,45,120,0.5)] animate-[gg-crit_0.35s_ease-out_forwards]">
      CRIT!
    </div>
  )

  return (
    <section
      ref={stageRef as React.RefObject<HTMLElement>}
      className={`${PLATE} ${PANEL} flex flex-col gap-2 overflow-hidden`}
    >
      {/* Integrated panel toolbar: gallery + sources + fullscreen live here, never floating */}
      <div className="flex flex-none items-center justify-between gap-2 px-1 pt-0.5">
        <div
          className="inline-flex flex-none overflow-hidden rounded-lg border border-border-glass"
          role="group"
          aria-label="Feed layout"
        >
          {(['1x1', '1x2', '2x2', '3x3'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${MONO} cursor-pointer border-0 bg-transparent px-2 py-0.5 text-xs font-bold ${viewMode === mode ||
                (mode === '3x3' && viewMode === 'grid')
                ? 'bg-retro-accent text-retro-accent-text'
                : 'bg-transparent text-retro-muted hover:text-retro-fg'
                }`}
              aria-pressed={viewMode === mode || (mode === '3x3' && viewMode === 'grid')}
              onClick={() => setViewMode(mode)}
              title={
                mode === '1x1'
                  ? 'Single foe view'
                  : mode === '1x2'
                    ? 'Split — two foes side by side'
                    : mode === '2x2'
                      ? 'Four foes at once'
                      : '3×3 grid — nine foes at once'
              }
            >
              {mode === '1x1' ? '1×1' : mode === '1x2' ? '1×2' : mode === '2x2' ? '2×2' : '3×3'}
            </button>
          ))}
        </div>
        {headerRight}
      </div>
      {isGrid ? (
        <div
          className={`${STAGE_FRAME} relative min-h-0 flex-1 grid auto-rows-fr ${gridCols} gap-2 p-2`}
          aria-label={`${viewMode} goon grid`}
        >
          {critFlashEl}
          {grid.map((cell, i) => {
            const motion =
              (cell.post.kind === 'video' || isVideoUrl(cell.post.url)) &&
              !/\.gif(?:[?#]|$)/i.test(cell.post.url)
            const pct = Math.max(0, (cell.hp / cell.maxHp) * 100)
            return (
              <button
                key={`${cell.post.id}:${i}:${shakeCell === i ? shakeKey : 0}`}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(i))
                  e.dataTransfer.effectAllowed = 'move'
                  setDragFrom(i)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOver !== i) setDragOver(i)
                }}
                onDragLeave={() => {
                  if (dragOver === i) setDragOver(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const raw = e.dataTransfer.getData('text/plain')
                  const from = Number(raw)
                  if (!Number.isNaN(from)) reorderGrid(from, i)
                  setDragFrom(null)
                  setDragOver(null)
                }}
                onDragEnd={() => {
                  setDragFrom(null)
                  setDragOver(null)
                }}
                className={`relative min-h-0 cursor-grab overflow-hidden rounded-lg border bg-black p-0 text-left font-[inherit] text-[color:inherit] active:cursor-grabbing ${dragOver === i ? 'border-retro-accent ring-2 ring-retro-accent/60' : 'border-border-glass'
                  } ${dragFrom === i ? 'opacity-50' : ''} ${shakeCell === i ? 'animate-[gg-shake_0.18s_ease-out]' : ''}`}
                onClick={(e) => handleCellClick(i, e)}
                onAuxClick={handleAuxClick}
                aria-label={`Foe ${i + 1}: ${Math.ceil(cell.hp)} of ${cell.maxHp} HP — activate to attack, drag to reorder`}
              >
                {motion ? (
                  <video
                    className={GOON_IMAGE}
                    src={redgifsPlayable(cell.post.url)}
                    poster={cell.post.preview ? redgifsPlayable(cell.post.preview) : undefined}
                    autoPlay={!reduceMotion}
                    loop
                    muted
                    playsInline
                    preload="auto"
                    controls={reduceMotion}
                    onError={() => dropCell(i)}
                  />
                ) : (
                  <CachedImg
                    className={GOON_IMAGE}
                    src={cell.post.url}
                    alt="goon grid square"
                    referrerPolicy="no-referrer"
                    onError={() => dropCell(i)}
                    draggable={false}
                  />
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
                  <span className={`${HP_BAR} h-[2px] rounded-none`}>
                    <span
                      className={`${HP_FILL} ${pct <= 30 ? HP_FILL_LOW : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
                {floats
                  .filter((f) => f.cell === i)
                  .map((f) => (
                    <span
                      key={f.id}
                      className={`${FLOAT_GC} ${MONO} ${f.crit ? FLOAT_GC_CRIT : ''}`}
                      style={{ left: f.x, top: f.y }}
                    >
                      {f.text}
                    </span>
                  ))}
              </button>
            )
          })}
          {Array.from({ length: Math.max(0, gridTarget - grid.length) }, (_, k) => (
            <div
              key={`empty-${k}`}
              className="relative flex min-h-0 cursor-default items-center justify-center overflow-hidden rounded-lg border border-dashed border-border-glass bg-black"
            >
              {fetching ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <span className={`${MONO} text-xl text-retro-muted`}>empty</span>
              )}
            </div>
          ))}
          {feedOffline && (
            <Badge variant="warning" className={`${MONO} absolute right-2.5 top-2.5`}>
              OFFLINE
            </Badge>
          )}
          {grid.length === 0 && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} onRetry={() => void fetchFeed()} />
          )}
          {grid.length > 0 && (
            <>
              <button
                type="button"
                className="icon-btn absolute left-1.5 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px] hover:bg-black/65 disabled:opacity-25"
                aria-label="Previous image"
                title={canGridBack ? 'Back to the previous board' : 'Nothing behind you yet'}
                disabled={!canGridBack}
                onClick={() => undoGrid()}
              >
                <IconChevronL size={26} />
              </button>
              <button
                type="button"
                className="icon-btn absolute right-1.5 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px] hover:bg-black/65 disabled:opacity-25"
                aria-label="Next image"
                title="Skip this round — no reward"
                onClick={() => skipGrid()}
              >
                <IconChevronR size={26} />
              </button>
            </>
          )}
        </div>
      ) : (
        <div
          key={shakeCell === null ? shakeKey : 0}
          className={`${STAGE_FRAME} relative min-h-0 flex-1 ${imageReady ? 'cursor-pointer active:cursor-grabbing' : 'cursor-progress'} max-[1100px]:min-h-[320px] ${shakeCell === null && shakeKey > 0 ? 'animate-[gg-shake_0.18s_ease-out]' : ''}`}
          onClick={handleClick}
          onAuxClick={handleAuxClick}
          role="button"
          tabIndex={0}
          aria-label="Attack the current foe"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              clickImage()
            }
          }}
        >
          {critFlashEl}
          {inBattle && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[5]">
              <span className={`${HP_BAR} h-[2px] rounded-none`}>
                <span
                  className={`${HP_FILL} ${hpPct <= 30 ? HP_FILL_LOW : ''}`}
                  style={{ width: `${hpPct}%` }}
                />
              </span>
            </span>
          )}
          {/* Blurred cover fill so the stage reads as an image, not a
              letterbox — the foreground stays 100% visible (object-contain). */}
          {!showOffline && (
            <img
              src={shownUrl ?? src}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl select-none"
            />
          )}
          {isMotion && current ? (
            <video
              className={`${GOON_IMAGE} relative z-[1]`}
              src={redgifsPlayable(current.url)}
              poster={current.preview ? redgifsPlayable(current.preview) : undefined}
              autoPlay={!reduceMotion}
              loop
              muted
              playsInline
              preload="auto"
              controls={reduceMotion}
              onError={onImageError}
            />
          ) : (
            <img
              className={`${GOON_IMAGE} relative z-[1]`}
              src={shownUrl ?? src}
              alt="goon feed"
              referrerPolicy="no-referrer"
              onError={onImageError}
              draggable={false}
            />
          )}
          {!imageReady && !showOffline && !isMotion && (
            <span
              className={`${MONO} absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-retro-muted`}
              role="status"
            >
              Loading…
            </span>
          )}
          {showOffline && (
            <Badge variant="warning" className={`${MONO} absolute right-2.5 top-2.5`}>
              OFFLINE
            </Badge>
          )}
          {showOffline && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} onRetry={() => void fetchFeed()} />
          )}
          <button
            type="button"
            className="icon-btn absolute left-1.5 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px] hover:bg-black/65 disabled:opacity-25"
            aria-label="Previous image"
            title={canGoBack ? 'Back to the skipped foe' : 'Nothing behind you yet'}
            disabled={!canGoBack}
            onClick={(e) => {
              e.stopPropagation()
              goBack()
            }}
          >
            <IconChevronL size={26} />
          </button>
          <button
            type="button"
            className="icon-btn absolute right-1.5 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px] hover:bg-black/65 disabled:opacity-25"
              aria-label="Next image"
              title="Skip this foe — no reward"
              onClick={(e) => {
                e.stopPropagation()
                advanceFeed()
              }}
            >
              <IconChevronR size={26} />
          </button>
          {floats
            .filter((f) => f.cell === null)
            .map((f) => (
              <span
                key={f.id}
                className={`${FLOAT_GC} ${MONO} ${f.crit ? FLOAT_GC_CRIT : ''}`}
                style={{ left: f.x, top: f.y }}
              >
                {f.text}
              </span>
            ))}
        </div>
      )}
      <div className="flex flex-none flex-wrap items-center gap-2 px-1 py-0.5">
        {/* Hoverable novelty tray: KO drops never pause gameplay. */}
        {pendingDrops.length > 0 && (
          <div className="relative flex-none" onMouseEnter={() => setDropsOpen(true)} onMouseLeave={() => setDropsOpen(false)}>
            <button
              type="button"
              onClick={() => setDropsOpen((v) => !v)}
              aria-expanded={dropsOpen}
              aria-label={`${pendingDrops.length} novelty drops waiting`}
              title="KO drops — adopt a tag, ban an anti-tag, one click each"
              className={`${MONO} inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#ff2d78]/40 bg-[#ff2d78]/10 px-2 py-0.5 text-xs font-bold text-retro-fg`}
            >
              🎁 Drops
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff2d78] px-1 text-[10px] font-black text-white">
                {pendingDrops.length}
              </span>
            </button>
            {dropsOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 space-y-1.5 rounded-xl border border-border-glass bg-surface-elevated p-2 shadow-xl">
                {pendingDrops.slice(0, 4).map((drop) => (
                  <div key={drop.id} className="rounded-lg border border-border-subtle bg-surface-raised p-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`${MONO} truncate text-[10px] font-bold text-retro-muted`}>
                        from {drop.foeTitle}
                      </span>
                      <button
                        type="button"
                        onClick={() => dismissDrop(drop.id)}
                        aria-label="Dismiss drop"
                        className="shrink-0 cursor-pointer border-0 bg-transparent p-0.5 text-retro-muted hover:text-retro-fg"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {drop.suggestedTag && (
                        <button
                          type="button"
                          onClick={() => claimDropTag(drop.id)}
                          title={`Adopt +${drop.suggestedTag} into your feed`}
                          className={`${MONO} cursor-pointer rounded-md border border-retro-accent/40 bg-retro-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-retro-fg hover:bg-retro-accent/30`}
                        >
                          + {drop.suggestedTag}
                        </button>
                      )}
                      {drop.suggestedAntiTag && (
                        <button
                          type="button"
                          onClick={() => claimDropAntiTag(drop.id)}
                          title={`Ban ${drop.suggestedAntiTag} from your feed`}
                          className={`${MONO} cursor-pointer rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-300 hover:bg-red-500/25`}
                        >
                          <X className="w-3 h-3 shrink-0" /> {drop.suggestedAntiTag}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {pendingDrops.length > 4 && (
                  <div className={`${MONO} text-center text-[10px] text-retro-muted`}>
                    +{pendingDrops.length - 4} more…
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {isGrid ? (
          <span className={MUTED}>
            {grid.length}/{gridTarget} live{feedOffline ? ' · offline' : ''}
          </span>
        ) : inBattle ? (
          <div className="flex min-w-0 flex-1 items-center gap-2" title={`${Math.ceil(foeHp)} / ${foeMaxHp} HP`}>
            <div className={`${HP_BAR} flex-1`}>
              <div className={`${HP_FILL} ${hpPct <= 30 ? HP_FILL_LOW : ''}`} style={{ width: `${hpPct}%` }} />
            </div>
            <span className={`${MONO} whitespace-nowrap text-[10px] text-retro-muted`}>
              {formatNum(Math.ceil(foeHp))}/{formatNum(foeMaxHp)} HP
            </span>
          </div>
        ) : (
          <span className={MUTED}>No live foe — take your time.</span>
        )}
        {heatLive && (
          <span
            className={`${MONO} inline-flex min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-lg border border-[rgba(255,120,40,0.5)] bg-[rgba(255,80,0,0.15)] px-2 py-0.5 text-xs font-black text-[#ffb066]${reduceMotion ? '' : ' animate-pulse'}`}
            title={`Heat combo: ${heatStreak} rapid clicks — x${heat} click power`}
            aria-label={`Heat combo x${heat}`}
          >
            🔥 x{heat}
          </span>
        )}
        {feedOffline && (
          <button
            type="button"
            className={`${BTN} ${BTN_SMALL}`}
            disabled={fetching}
            aria-label="Retry the feed"
            onClick={() => void fetchFeed()}
            title="Retry the feed"
          >
            {fetching ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <span
          className={`${MONO} inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-glass bg-retro-bg px-2 py-0.5 text-xs font-bold text-retro-fg [&_svg]:text-retro-accent`}
          title="Lifetime KOs — each foe hits harder"
        >
          KOs: {formatNum(defeated)}
        </span>
      </div>

      {/* Thumb-sized compact bottom dock with [1] [2] [3] [4] keyboard triggers */}
      <div
        className="flex flex-none items-center gap-1.5 overflow-x-auto rounded-xl border border-border-glass bg-surface-elevated/70 p-1 backdrop-blur-md styled-scrollbar"
        role="group"
        aria-label="Powerups dock"
      >
        {CAP_ORDER.map((id, idx) => {
          const def = CAPS[id]
          const st = capStacks(caps, id, now)
          const isLive = st.count > 0
          return (
            <button
              key={id}
              type="button"
              className={`flex flex-1 min-w-[120px] cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-retro-fg transition-all duration-150 enabled:hover:border-retro-accent enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${isLive
                ? 'border-[#ff2d78] bg-[#ff2d78]/15 shadow-[0_0_8px_rgba(255,45,120,0.25)]'
                : 'border-border-glass bg-surface-raised hover:bg-surface-interactive'
                }`}
              disabled={gc < def.cost}
              onClick={() => popCap(id)}
              title={`${def.name} — ${capEffectLabel(id)} — ${formatNum(def.cost)} g$ — Press [${idx + 1}]`}
            >
              <kbd className={`${MONO} inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 bg-black/60 text-[10px] font-bold text-retro-muted`}>
                {idx + 1}
              </kbd>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className={`${DISPLAY} truncate text-xs font-bold leading-tight`}>
                    {def.name}
                  </span>
                  {st.count > 0 && (
                    <span className={`${MONO} text-[10px] font-black text-[#ff2d78]`}>
                      x{st.count}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 text-[10px] text-retro-muted leading-tight">
                  <span className="truncate">{capEffectLabel(id)}</span>
                  <span className={`${MONO} shrink-0 font-semibold`}>{formatNum(def.cost)}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
