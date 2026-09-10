import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { GRID_SIZE } from '../game/store'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import { HEAT_WINDOW_MS, heatMultiplier } from '../game/economy'
import type { CapId } from '../game/types'
import { offlineSvg } from '../services/offlineSvg'
import { prefetchImages, resolveImage } from '../services/imageCache'
import { isVideoUrl } from '../services/postFilter'
import { redgifsPlayable } from '../services/redgifs'
import { CAP_SKINS } from './capSkins'
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
  SKIN,
  STAGE_FRAME,
} from './styles'
import CachedImg from './CachedImg'
import OfflineCard from './OfflineCard'
import { Badge } from '../components/Badge'
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

export default function GoonPanel() {
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
  const floatId = useRef(0)
  const reduceMotion = useReducedMotion()

  const now = Date.now()

  const onImageError = useCallback(() => {
    setFailedUrl(current?.url ?? null)
    advanceFeed()
  }, [advanceFeed, current])

  // Warm the cache 5 up / 5 down (past 5 + queue 5 + previews + grid) so
  // back/skip arrows and grid squares show instantly for images AND videos.
  useEffect(() => {
    const urls = [
      ...past.slice(-5).flatMap((p) => [p.url, ...(p.preview ? [p.preview] : [])]),
      ...queue.slice(0, 5).flatMap((p) => [p.url, ...(p.preview ? [p.preview] : [])]),
      ...grid.flatMap((c) => [c.post.url, ...(c.post.preview ? [c.post.preview] : [])]),
    ]
    prefetchImages(urls)
  }, [queue, past, grid])

  // Grid top-up: after load (persisted grid mode) or whenever squares run dry.
  // Stops once the feed flags offline — the Retry button takes it from there.
  useEffect(() => {
    if (viewMode === 'grid' && grid.length < GRID_SIZE && !fetching && !feedOffline) {
      setViewMode('grid')
    }
  }, [viewMode, grid.length, fetching, feedOffline, setViewMode])

  const spawnFloat = (x: number, y: number, gain: number, crit: boolean, cell: number | null, heatMult = 1) => {
    const id = ++floatId.current
    const heatTag = heatMult > 1 ? ` x${heatMult}` : ''
    setFloats((f) => [...f, { id, x, y, text: `+${formatNum(gain)}${heatTag}`, crit, cell }])
    window.setTimeout(() => setFloats((f) => f.filter((fl) => fl.id !== id)), 900)
    if (crit) {
      setCritFlash(true)
      window.setTimeout(() => setCritFlash(false), 350)
    }
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickImage()
    spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, null, heat)
  }

  const handleCellClick = (index: number, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickCell(index)
    if (gain > 0) spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, index, heat)
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
  const isGrid = viewMode === 'grid'

  const critFlashEl = critFlash && (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(255,45,120,0.28)] font-sans text-7xl font-bold tracking-[6px] text-white shadow-[inset_0_0_60px_rgba(255,45,120,0.5)] animate-[gg-crit_0.35s_ease-out_forwards]">
      CRIT!
    </div>
  )

  return (
    <section className={`${PLATE} ${PANEL} flex flex-col gap-2 overflow-hidden`}>
      {isGrid ? (
        <div
          className={`${STAGE_FRAME} relative min-h-0 flex-1 grid auto-rows-fr grid-cols-3 gap-2 p-2`}
          aria-label="3x3 goon grid"
        >
          {critFlashEl}
          {grid.map((cell, i) => {
            const motion =
              (cell.post.kind === 'video' || isVideoUrl(cell.post.url)) &&
              !/\.gif(?:[?#]|$)/i.test(cell.post.url)
            const pct = Math.max(0, (cell.hp / cell.maxHp) * 100)
            return (
              <button
                key={`${cell.post.id}:${i}`}
                type="button"
                className="relative min-h-0 cursor-pointer overflow-hidden rounded-lg border border-border-glass bg-black p-0 text-left font-[inherit] text-[color:inherit] active:cursor-grabbing"
                onClick={(e) => handleCellClick(i, e)}
                aria-label={`Foe ${i + 1}: ${Math.ceil(cell.hp)} of ${cell.maxHp} HP — activate to attack`}
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
                <span className="absolute bottom-1.5 left-1.5 right-1.5 z-[2]">
                  <span className={`${HP_BAR} h-2`}>
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
          {Array.from({ length: Math.max(0, GRID_SIZE - grid.length) }, (_, k) => (
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
                className="glass-button absolute left-2.5 top-1/2 z-[4] flex h-20 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl opacity-85 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Previous image"
                title={canGridBack ? 'Back to the previous board' : 'Nothing behind you yet'}
                disabled={!canGridBack}
                onClick={() => undoGrid()}
              >
                <IconChevronL size={26} />
              </button>
              <button
                type="button"
                className="glass-button absolute right-2.5 top-1/2 z-[4] flex h-20 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl opacity-85 hover:opacity-100"
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
          className={`${STAGE_FRAME} relative min-h-0 flex-1 ${imageReady ? 'cursor-pointer active:cursor-grabbing' : 'cursor-progress'} max-[1100px]:min-h-[320px]`}
          onClick={handleClick}
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
            className="glass-button absolute left-2.5 top-1/2 z-[5] flex h-20 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl opacity-85 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
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
            className="glass-button absolute right-2.5 top-1/2 z-[5] flex h-20 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl opacity-85 hover:opacity-100"
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
      <div className="flex flex-none items-center gap-2 rounded-[10px] border border-border-glass bg-retro-bg px-2 py-1.5">
        <div
          className="inline-flex flex-none overflow-hidden rounded-lg border border-border-glass"
          role="group"
          aria-label="Feed layout"
        >
          <button
            type="button"
            className={`${MONO} cursor-pointer border-0 bg-transparent px-2.5 py-1 text-xs font-bold ${
              viewMode === 'single' ? 'bg-retro-accent text-retro-accent-text' : 'bg-transparent text-retro-muted hover:text-retro-fg'
            }`}
            aria-pressed={viewMode === 'single'}
            onClick={() => setViewMode('single')}
            title="Single foe view"
          >
            1×1
          </button>
          <button
            type="button"
            className={`${MONO} cursor-pointer border-0 bg-transparent px-2.5 py-1 text-xs font-bold ${
              viewMode === 'grid' ? 'bg-retro-accent text-retro-accent-text' : 'bg-transparent text-retro-muted hover:text-retro-fg'
            }`}
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            title="3×3 grid — nine foes at once"
          >
            3×3
          </button>
        </div>
        {isGrid ? (
          <span className={MUTED}>
            {grid.length}/{GRID_SIZE} live{feedOffline ? ' · offline' : ''}
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
            className={`${MONO} inline-flex min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-lg border border-[rgba(255,120,40,0.5)] bg-[rgba(255,80,0,0.15)] px-2 py-0.5 text-[11px] font-black text-[#ffb066]${reduceMotion ? '' : ' animate-pulse'}`}
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
          className={`${MONO} inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-glass bg-retro-bg px-2 py-0.5 text-[11px] font-bold text-retro-fg [&_svg]:text-retro-accent`}
          title="Lifetime KOs — each foe hits harder"
        >
          KOs: {formatNum(defeated)}
        </span>
      </div>

      <div className="grid flex-none grid-cols-4 gap-2">
        {CAP_ORDER.map((id) => {
          const def = CAPS[id]
          const st = capStacks(caps, id, now)
          const isLive = st.count > 0
          return (
            <button
              key={id}
              type="button"
              className={`${SKIN} flex cursor-pointer flex-col gap-0 rounded-[10px] border border-border-glass bg-surface-elevated p-1.5 text-left text-retro-fg shadow-sm transition-[transform,box-shadow,border-color] duration-75 enabled:hover:border-retro-accent enabled:active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none ${
                isLive
                  ? 'border-[#ff2d78] shadow-[0_0_12px_rgba(255,45,120,0.35)]'
                  : ''
              }`}
              style={{
                backgroundImage: `linear-gradient(rgba(5,5,12,0.72), rgba(5,5,12,0.72)), url("${CAP_SKINS[id]}")`,
              }}
              disabled={gc < def.cost}
              onClick={() => popCap(id)}
              title={`${def.name} — ${capEffectLabel(id)} — ${formatNum(def.cost)} g$ — permanent, pops stack${st.count > 0 ? ` (x${st.count} live)` : ''}`}
            >
              <span className={`${DISPLAY} text-[10px] font-bold tracking-[0.5px]`}>
                {def.name}
                {st.count > 1 ? ` x${st.count}` : ''}
              </span>
              <span className={`text-[9px] leading-tight ${isLive ? 'text-retro-fg' : 'text-retro-muted'}`}>
                {capEffectLabel(id)}
              </span>
              <span className={`${MONO} text-[10px] text-retro-muted`}>{formatNum(def.cost)} g$</span>
              <span className={`${MONO} min-h-[12px] text-[10px] font-bold text-[#ff2d78]`}>
                {isLive ? '∞' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
