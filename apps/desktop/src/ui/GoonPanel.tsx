import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { gridSizeForMode, isGridMode } from '../game/store'
import { HEAT_WINDOW_MS, heatMultiplier } from '../game/economy'
import { ALL_CAP_IDS } from '../game/caps'
import type { CapId, ViewMode } from '../game/types'
import { playPress } from '../utils/sounds'
import { cachedImageFor, prefetchImages, resolveImage } from '../services/imageCache'
import { isVideoUrl } from '../services/postFilter'
import { redgifsPlayable } from '../services/redgifs'
import { formatNum } from './format'
import {
  BTN,
  BTN_SMALL,
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
import { DamageTint } from './DamageTint'
import CachedImg from './CachedImg'
import OfflineCard from './OfflineCard'
import { Badge } from '../components/Badge'
import { Skeleton } from '../components/Skeleton'
import {
  CaretLeft,
  CaretRight,
  Prohibit,
  X,
  Gift,
  Fire,
  Skull,
  ArrowClockwise,
  Lightning,
} from '@phosphor-icons/react'
import { playHit } from '../utils/sounds'

interface Float {
  id: number
  x: number
  y: number
  text: string
  crit: boolean
  cell: number | null
}

const CAP_ORDER: readonly CapId[] = ALL_CAP_IDS

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
  const feedEmptyFresh = useGame((s) => s.feedEmptyFresh)
  const fetching = useGame((s) => s.fetching)
  const foeHp = useGame((s) => s.foeHp)
  const foeMaxHp = useGame((s) => s.foeMaxHp)
  const defeated = useGame((s) => s.defeated)
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
  const retryFeedManual = useGame((s) => s.retryFeedManual)
  const advanceFeed = useGame((s) => s.advanceFeed)
  const goBack = useGame((s) => s.goBack)
  const canGoBack = useGame((s) => s.past.length > 0)
  const skipGrid = useGame((s) => s.skipGrid)
  const purgePost = useGame((s) => s.purgePost)
  const undoGrid = useGame((s) => s.undoGrid)
  const canGridBack = useGame((s) => s.gridPast.length > 0)
  const queue = useGame((s) => s.queue)
  const past = useGame((s) => s.past)
  const setImageReady = useGame((s) => s.setImageReady)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [shownUrl, setShownUrl] = useState<string | null>(null)
  const [dropsOpen, setDropsOpen] = useState(false)
  // Multi-select ban: the ✕ toggles a tag into a per-drop selection, then one
  // "Ban selected" button applies them all (claimDropAntiTag per tag).
  const [banSel, setBanSel] = useState<Record<string, string[]>>({})
  const toggleBanSel = (dropId: string, tag: string) =>
    setBanSel((prev) => {
      const cur = prev[dropId] || []
      const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]
      return { ...prev, [dropId]: next }
    })
  const applyBanSel = (dropId: string) => {
    for (const t of banSel[dropId] || []) claimDropAntiTag(dropId, t)
    setBanSel((prev) => ({ ...prev, [dropId]: [] }))
  }
  // Ban-by-tag for the CURRENT foe: the Prohibit button opens a picker of that
  // image's tags instead of purging the whole image + auto-learning 3 tags.
  const userExcludes = useGame((s) => s.userExcludes)
  const addUserExclude = useGame((s) => s.addUserExclude)
  const [banPickerOpen, setBanPickerOpen] = useState(false)
  const [banPick, setBanPick] = useState<string[]>([])
  const toggleBanPick = (tag: string) =>
    setBanPick((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  const applyBanCurrent = () => {
    for (const t of banPick) addUserExclude(t)
    setBanPick([])
    setBanPickerOpen(false)
    advanceFeed()
  }
  // A new foe is a new picker: drop the previous selection.
  useEffect(() => { setBanPick([]); setBanPickerOpen(false) }, [current?.id])
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // Shake + hit-flash are retriggered by REMOUNTING a child span, not the tile
  // that holds the media. See the note on GoonPanel's `key` props: bumping the
  // tile's key used to unmount the <img>/<video> on every click.
  const [shakeKey, setShakeKey] = useState(0)
  const [shakeCell, setShakeCell] = useState<number | null>(null)
  const [critCell, setCritCell] = useState<number | null>(null)
  const floatId = useRef(0)
  const stageRef = useRef<HTMLElement | null>(null)
  const reduceMotion = useReducedMotion()

  const onImageError = useCallback(() => {
    if (current?.preview && shownUrl !== current.preview) {
      setShownUrl(current.preview)
      return
    }
    setFailedUrl(current?.url ?? null)
    advanceFeed()
  }, [advanceFeed, current, shownUrl])

  // Warm the cache so the player never waits: the active grid + the next 18
  // queue items (two full 3x3 boards ahead).
  //
  // Debounced, and the CURRENT picture goes first. This effect keys on
  // [queue, past, grid], so it re-fired on every queue mutation — up to 27
  // resolveImage IPC round-trips each time, at a concurrency of 2 and up to
  // 15s per byte fetch. Those requests queue BEHIND the fetch the player is
  // actually waiting for, so the prefetch was making the wait it exists to
  // prevent.
  useEffect(() => {
    // Keyed on current.url, not shownUrl: shownUrl also changes when the
    // cache resolves to a gmcache:// URL, which would restart this debounce
    // for a picture the player is already looking at.
    const head = current?.url
    const ids = new Set<string>()
    const ordered: string[] = []
    const add = (u?: string) => {
      if (!u || ids.has(u)) return
      ids.add(u)
      ordered.push(u)
    }
    add(head)
    for (const c of grid) {
      add(c.post.url)
      add(c.post.preview)
    }
    for (const p of queue.slice(0, 18)) {
      add(p.url)
      add(p.preview)
    }
    for (const p of past.slice(-3)) {
      add(p.url)
      add(p.preview)
    }
    // Coalesce the burst of renders a queue update produces into one sweep.
    const timer = window.setTimeout(() => prefetchImages(ordered, 27), 250)
    return () => window.clearTimeout(timer)
  }, [queue, past, grid, current?.url])

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
          if (st.grid.length > 0) {
            const res = st.clickCell(0)
            playHit(res.crit)
          }
        } else {
          const res = st.clickImage()
          playHit(res.crit)
        }
        return
      }
      const capIndex = Number(e.key) - 1
      if (/^[1-9]$/.test(e.key) && capIndex < CAP_ORDER.length) {
        e.preventDefault()
        st.popCap(CAP_ORDER[capIndex])
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

  /**
   * Retrigger the click feedback. The shake and hit-flash alternate between two
   * identically-named keyframe pairs (`gg-shake-a`/`-b`), because changing
   * `animation-name` restarts a CSS animation in place. Nothing is remounted,
   * so the tile's <img>/<video> keeps its DOM node ÔÇö which is what stops a
   * click from restarting a video or blanking an already-decoded image.
   */
  const triggerShake = (cell: number | null, crit = false) => {
    setCritCell(crit ? cell : null)
    if (reduceMotion) return
    setShakeCell(cell)
    setShakeKey((k) => k + 1)
  }

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickImage()
    playHit(crit)
    spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, null, heat)
    triggerShake(null, crit)
  }

  const handleCellClick = (index: number, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit, heat } = clickCell(index)
    playHit(crit)
    if (gain > 0) spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, index, heat)
    triggerShake(index, crit)
  }

  /** Middle-click anywhere on the stage advances to the next foe — no reward. */
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    if (isGridMode(useGame.getState().viewMode)) useGame.getState().skipGrid()
    else useGame.getState().advanceFeed()
  }

  const showOffline = feedOffline || !current || failedUrl === current.url
  // Motion posts (redgifs mp4/webm) play inline; gifs stay on <img>.
  const isMotion =
    !showOffline &&
    !!current &&
    (current.kind === 'video' || isVideoUrl(current.url)) &&
    !/\.gif(?:[?#]|$)/i.test(current.url)
  const inBattle = !showOffline && foeMaxHp > 0

  const [stageLoaded, setStageLoaded] = useState(false)
  const stageImgRef = useRef<HTMLImageElement | null>(null)

  // Verified stage swap: keep the last decoded picture on screen until the
  // next one is cached + decoded successfully — arrows never show a blank
  // frame, and scoring stays locked (store.imageReady) until it is visible.
  //
  // The FIRST paint uses the session cache map when it already knows the bytes
  // (`cachedImageFor`), so a foe whose picture is on disk mounts straight on
  // gmcache:// instead of the remote URL. That is the difference between
  // "instant" and "a frame late" for every picture after the first.
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
    const url = current.url
    const warm = cachedImageFor(url)
    setShownUrl(warm ?? url)
    // NOT ready yet. This used to be set immediately, which meant clicks
    // scored against a picture that had not painted: the "Loading" overlay was
    // unreachable and the first click or two of every picture were lost (or
    // worse, scored while the old frame was still up). The stage <img> now
    // reports its own load, and readiness follows the pixels.
    //
    // A warm picture is decoded ahead of time (imageCache.decodeAhead), so its
    // load event lands in the same frame the element mounts — the player sees
    // it and can click it immediately.
    setImageReady(false)
    setStageLoaded(false)
    if (warm) {
      // Already local: the bytes are in the encrypted disk cache, so the only
      // remaining work is the browser's own decode of a gmcache:// URL.
      return () => { live = false }
    }
    void (async () => {
      try {
        const resolved = await resolveImage(url)
        if (!live) return
        if (resolved && resolved !== url) setShownUrl(resolved)
      } catch {
        /* best effort background caching */
      }
    })()
    // Pre-warm next 5 queue images so they're already in RAM before the foe is defeated
    try {
      for (const next of queue.slice(0, 5)) {
        if (next?.url) {
          void resolveImage(next.url)
        }
      }
    } catch {
      /* best-effort */
    }
    return () => {
      live = false
    }
  }, [current, queue, showOffline, isMotion, setImageReady])

  // A picture counts as ready once the browser says it decoded. onLoad fires
  // for the blurred cover and the stage image alike, so readiness is gated on
  // the stage element's own src matching what is on screen — otherwise the
  // cover (which paints first) would unlock scoring before the real picture.
  const onStageLoad = useCallback(() => {
    setStageLoaded(true)
    setImageReady(true)
  }, [setImageReady])

  /**
   * Stage ref callback: also treats an ALREADY-COMPLETE element as loaded.
   *
   * `onLoad` is not reliable for a cached picture — the browser can finish
   * decoding between the element mounting and React attaching the handler,
   * in which case no load event ever fires and scoring would stay locked
   * forever. `complete` is the documented way to close that gap.
   */
  const onStageRef = useCallback((el: HTMLImageElement | null) => {
    stageImgRef.current = el
    if (el?.complete && el.naturalWidth > 0) {
      setStageLoaded(true)
      setImageReady(true)
    }
  }, [setImageReady])

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
    <div className="pointer-events-none absolute inset-0 z-[10] flex items-center justify-center bg-danger/15 backdrop-blur-[1px] animate-[gg-crit_0.2s_ease-out_forwards]">
      <div className="flex items-center gap-2 rounded-xl border border-danger/60 bg-retro-bg/90 px-6 py-2.5 font-mono text-xl font-black tracking-widest text-danger-fg">
        <Lightning className="h-5 w-5 text-danger-fg" weight="fill" />
        CRITICAL HIT!
      </div>
    </div>
  )

  // KO popup: a brief screen pop the moment a foe is drained — mobile-game
  // feedback, honoring prefers-reduced-motion.
  const [koPop, setKoPop] = useState(false)
  const prevDefeated = useRef(defeated)
  useEffect(() => {
    if (defeated <= prevDefeated.current) {
      prevDefeated.current = defeated
      return
    }
    prevDefeated.current = defeated
    if (reduceMotion) return
    setKoPop(true)
    const t = window.setTimeout(() => setKoPop(false), 900)
    return () => window.clearTimeout(t)
  }, [defeated, reduceMotion])

  const koPopEl = koPop && (
    <div className="pointer-events-none absolute inset-0 z-[11] flex items-center justify-center">
      <div className="animate-orbit-pop flex items-center gap-2 rounded-2xl border border-edge bg-black/85 px-8 py-3 font-mono text-3xl font-black tracking-widest text-retro-fg">
        <Skull className="h-7 w-7 text-danger-fg" weight="fill" />
        KO
      </div>
    </div>
  )

  return (
    <section
      ref={stageRef as React.RefObject<HTMLElement>}
      // flex-1 min-h-0: the stage keeps ONE fixed box between images; the
      // old auto height resized to each picture's intrinsic ratio and made
      // the click target jump under the cursor every advance.
      className={`${PLATE} ${PANEL} flex min-h-0 flex-1 flex-col gap-2 overflow-hidden`}
    >
      {/* Layout selector on top of the game header */}
      <div className="flex flex-none items-center justify-between gap-2 px-1 pt-0.5">
        <div
          className="inline-flex flex-none overflow-hidden rounded-lg border border-edge"
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
              onClick={() => { playPress(760); setViewMode(mode); }}
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
        {headerRight && (
          <div className="flex items-center gap-2">
            {headerRight}
          </div>
        )}
      </div>
      {isGrid ? (
        <div
          className={`${STAGE_FRAME} relative min-h-0 flex-1 grid auto-rows-fr ${gridCols} gap-2 p-2`}
          aria-label={`${viewMode} goon grid`}
        >
          {critFlashEl}
          {koPopEl}
          {grid.map((cell, i) => {
            const motion =
              (cell.post.kind === 'video' || isVideoUrl(cell.post.url)) &&
              !/\.gif(?:[?#]|$)/i.test(cell.post.url)
            const pct = Math.max(0, (cell.hp / cell.maxHp) * 100)
            return (
              <button
                // Stable across clicks: only the foe's identity and the cell
                // index belong here. This key used to include `shakeKey`, so
                // every click remounted the media inside ÔÇö video restarted
                // from 0 and the image flashed a blank frame.
                key={`${cell.post.id}:${i}`}
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
                className={`relative min-h-0 cursor-grab overflow-hidden rounded-lg border bg-retro-bg p-0 text-left font-[inherit] text-[color:inherit] active:cursor-grabbing ${dragOver === i ? 'border-retro-accent ring-2 ring-retro-accent/60' : 'border-edge'
                  } ${dragFrom === i ? 'opacity-50' : ''}`}
                onClick={(e) => handleCellClick(i, e)}
                onAuxClick={handleAuxClick}
                onContextMenu={(e) => { e.preventDefault(); purgePost(cell.post) }}
                aria-label={`Foe ${i + 1}: ${Math.ceil(cell.hp)} of ${cell.maxHp} HP. Activate to attack, drag to reorder, right-click to purge`}
              >
                {motion ? (
                  <video
                    className={GOON_IMAGE}
                    src={redgifsPlayable(cell.post.url)}
                    poster={cell.post.preview ? redgifsPlayable(cell.post.preview) : undefined}
                    autoPlay
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
                    fallbackSrc={cell.post.preview}
                    alt="goon grid square"
                    referrerPolicy="no-referrer"
                    onError={() => dropCell(i)}
                    draggable={false}
                  />
                )}
                {/* Click feedback. The a/b alternation restarts each animation
                    per hit without changing the tile's key, so the <img>/<video>
                    above keep their DOM nodes. */}
                {shakeCell === i && (
                  <span
                    aria-hidden="true"
                    data-testid="goon-shake"
                    className={`pointer-events-none absolute inset-0 z-[4] ${shakeKey % 2 ? 'animate-[gg-shake-b_0.18s_ease-out]' : 'animate-[gg-shake-a_0.18s_ease-out]'}`}
                  />
                )}
                <DamageTint
                  dmg={1 - pct / 100}
                  flashKey={shakeCell === i ? shakeKey : 0}
                  crit={critCell === i}
                  reducedMotion={reduceMotion}
                />
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
              className="relative flex min-h-0 cursor-default items-center justify-center overflow-hidden rounded-lg border border-dashed border-edge bg-retro-bg"
            >
              {fetching ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <span className={`${MONO} text-xl text-retro-muted`}>empty</span>
              )}
            </div>
          ))}
          {feedOffline && grid.length > 0 && (
            <Badge variant="warning" className={`${MONO} absolute right-2.5 top-2.5`}>
              OFFLINE
            </Badge>
          )}
          {grid.length === 0 && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} emptyFresh={feedEmptyFresh} onRetry={() => retryFeedManual()} />
          )}
          {grid.length > 0 && (
            <>
              <button
                type="button"
                className="icon-btn absolute left-2 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-black/60 text-retro-fg/80 border border-edge backdrop-blur-md hover:bg-retro-accent/15 hover:text-retro-fg hover:border-edge transition duration-150 disabled:opacity-20 active:scale-95 cursor-pointer"
                aria-label="Previous image"
                title={canGridBack ? 'Back to the previous board' : 'Nothing behind you yet'}
                disabled={!canGridBack}
                onClick={() => undoGrid()}
              >
                <CaretLeft size={22} weight="bold" />
              </button>
              <button
                type="button"
                className="icon-btn absolute right-2 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-black/60 text-retro-fg/80 border border-edge backdrop-blur-md hover:bg-retro-accent/15 hover:text-retro-fg hover:border-edge transition duration-150 disabled:opacity-20 active:scale-95 cursor-pointer"
                aria-label="Next image"
                title="Skip this round. No reward"
                onClick={() => skipGrid()}
              >
                <CaretRight size={22} weight="bold" />
              </button>
            </>
          )}
        </div>
      ) : (
        <div
          // No `key` here on purpose — see the grid tile above. This box holds
          // the <img>/<video>, and a per-click key remounted them.
          className={`${STAGE_FRAME} border-beam relative min-h-0 flex-1 max-[1100px]:min-h-[320px]`}
        >
          {/* The click target is a real button LAYERED OVER the media, not the
              stage element itself: the stage also holds <video controls> and
              the prev/next/purge buttons, and interactive content must never
              nest inside a button. */}
          {!showOffline && (
            <button
              type="button"
              onPointerDown={(e) => {
                // Score on PRESS, not release: a clicker that waits for mouse-up
                // feels a frame late. The click that follows is ignored (detail > 0)
                // so one press scores exactly once; keyboard activation (detail 0)
                // still scores through onClick.
                if (e.button === 0) handleClick(e)
              }}
              onClick={(e) => { if (e.detail === 0) handleClick(e) }}
              onAuxClick={handleAuxClick}
              aria-label="Attack the current foe"
              className="absolute inset-0 z-[2] cursor-pointer"
            />
          )}
          {critFlashEl}
          {koPopEl}
          {/* Shake on its own keyed-free overlay, and the progressive damage
              wash. Both sit above the media and below the controls. */}
          {shakeCell === null && shakeKey > 0 && (
            <span
              aria-hidden="true"
              data-testid="goon-shake"
              className={`pointer-events-none absolute inset-0 z-[4] ${shakeKey % 2 ? 'animate-[gg-shake-b_0.18s_ease-out]' : 'animate-[gg-shake-a_0.18s_ease-out]'}`}
            />
          )}
          {inBattle && (
            <DamageTint
              dmg={1 - hpPct / 100}
              flashKey={shakeKey}
              crit={critFlash}
              reducedMotion={reduceMotion}
            />
          )}
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
          {/* Lightweight runtime: no blurred cover fill. It forced a full-stage
              backdrop re-composite on every shake/crit frame for a purely
              decorative effect — the object-contain image is the whole stage. */}
          {isMotion && current ? (
            <video
              className={`${GOON_IMAGE} relative z-[3]`}
              src={redgifsPlayable(current.url)}
              poster={current.preview ? redgifsPlayable(current.preview) : undefined}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              controls={reduceMotion}
              onError={onImageError}
            />
          ) : !showOffline && shownUrl ? (
            <img
              ref={onStageRef}
              className={`${GOON_IMAGE} relative z-[1]`}
              src={shownUrl}
              alt="goon feed"
              referrerPolicy="no-referrer"
              onLoad={onStageLoad}
              onError={onImageError}
              draggable={false}
            />
          ) : null}
          {/* Only the stage picture counts. While it has not painted, the
              "Loading" label is real UI rather than dead markup. */}
          {!stageLoaded && !showOffline && !isMotion && shownUrl && (
            <span
              className={`${MONO} absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-retro-muted`}
              role="status"
            >
              Loading…
            </span>
          )}
          {showOffline && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} emptyFresh={feedEmptyFresh} onRetry={() => retryFeedManual()} />
          )}
          <button
            type="button"
            className="icon-btn absolute left-3 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-black/60 text-retro-fg/80 border border-edge backdrop-blur-md hover:bg-retro-accent/15 hover:text-retro-fg hover:border-edge transition duration-150 disabled:opacity-20 active:scale-95 cursor-pointer"
            aria-label="Previous image"
            title={canGoBack ? 'Back to the skipped foe' : 'Nothing behind you yet'}
            disabled={!canGoBack}
            onClick={(e) => {
              e.stopPropagation()
              goBack()
            }}
          >
            <CaretLeft size={22} weight="bold" />
          </button>
          <button
            type="button"
            className="icon-btn absolute right-3 top-1/2 z-[6] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-black/60 text-retro-fg/80 border border-edge backdrop-blur-md hover:bg-retro-accent/15 hover:text-retro-fg hover:border-edge transition duration-150 disabled:opacity-20 active:scale-95 cursor-pointer"
            aria-label="Next image"
            title="Skip this foe. No reward"
            onClick={(e) => {
              e.stopPropagation()
              advanceFeed()
            }}
          >
            <CaretRight size={22} weight="bold" />
          </button>
          <button
            type="button"
            className="icon-btn absolute right-3 top-3 z-[6] flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-retro-fg/70 border border-edge backdrop-blur-md hover:bg-danger/80 hover:text-retro-fg hover:border-danger/60 transition duration-150 active:scale-95 cursor-pointer"
            aria-label="Ban tags from this image"
            title="Choose which tags of this image to ban"
            hidden={!current}
            onClick={(e) => {
              e.stopPropagation()
              setBanPickerOpen((v) => !v)
              setBanPick([])
            }}
          >
            <Prohibit size={16} weight="bold" />
          </button>
          {banPickerOpen && current && (
            <div
              className="absolute right-3 top-14 z-[7] w-60 rounded-xl border border-edge bg-retro-panel p-2.5 shadow-2xl backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-retro-muted">
                Ban tags from this image
              </div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto styled-scrollbar">
                {current.tags.map((tag) => {
                  const already = userExcludes.includes(tag)
                  const on = banPick.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={already}
                      onClick={() => toggleBanPick(tag)}
                      aria-pressed={on}
                      title={already ? `${tag} is already excluded` : `Ban ${tag}`}
                      className={`${MONO} cursor-pointer rounded-md border px-1.5 py-0.5 text-2xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-danger/60 bg-danger/20 text-danger-fg' : 'border-edge bg-glass-w8 text-retro-body hover:text-retro-fg'}`}
                    >
                      {tag}
                    </button>
                  )
                })}
                {current.tags.length === 0 && (
                  <span className="text-2xs text-retro-muted">No tags on this one.</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={applyBanCurrent}
                  disabled={banPick.length === 0}
                  className={`${MONO} flex-1 cursor-pointer rounded-md border border-danger/50 bg-danger/15 px-2 py-1 text-2xs font-bold text-danger-fg hover:bg-danger/25 transition-colors disabled:opacity-40`}
                >
                  Ban {banPick.length || ''} selected
                </button>
                <button
                  type="button"
                  onClick={() => { purgePost(current); setBanPickerOpen(false); setBanPick([]) }}
                  title="Purge the image and auto-learn its rarest tags"
                  className={`${MONO} cursor-pointer rounded-md border border-edge bg-glass-w8 px-2 py-1 text-2xs font-bold text-retro-muted hover:text-retro-fg transition-colors`}
                >
                  Purge
                </button>
              </div>
            </div>
          )}
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
              title="KO drops. Adopt (+) or ban (✕) any tag from the foe"
              className={`${MONO} inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-bold text-danger-fg hover:bg-danger/20 transition-colors`}
            >
              <Gift size={14} weight="bold" className="text-danger-fg" />
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs font-black text-retro-fg">
                {pendingDrops.length}
              </span>
            </button>
            {dropsOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 space-y-1.5 rounded-xl border border-edge bg-retro-panel p-2.5 shadow-2xl backdrop-blur-md">
                {pendingDrops.slice(0, 4).map((drop) => (
                  <div key={drop.id} className="rounded-lg border border-edge bg-retro-bg/80 p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`${MONO} truncate text-2xs font-bold text-retro-muted`}>
                        from {drop.foeTitle}
                      </span>
                      <button
                        type="button"
                        onClick={() => dismissDrop(drop.id)}
                        aria-label="Dismiss drop"
                        className="shrink-0 cursor-pointer border-0 bg-transparent p-0.5 text-retro-fg/40 hover:text-retro-fg transition-colors"
                      >
                        <X size={12} weight="bold" />
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {drop.tags.map((tag) => {
                        const banned = (banSel[drop.id] || []).includes(tag)
                        return (
                          <span
                            key={tag}
                            className={`${MONO} inline-flex items-center overflow-hidden rounded-md border text-2xs font-bold ${banned ? 'border-danger/60 bg-danger/15' : 'border-edge bg-glass-w8'}`}
                          >
                            <button
                              type="button"
                              onClick={() => claimDropTag(drop.id, tag)}
                              title={`Adopt +${tag} into your feed`}
                              className="cursor-pointer px-1.5 py-0.5 text-success-fg hover:bg-success/20 transition-colors"
                            >
                              + {tag}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleBanSel(drop.id, tag)}
                              title={banned ? `Unselect ${tag}` : `Select ${tag} to ban`}
                              aria-label={banned ? `Unselect ${tag}` : `Select ${tag} to ban`}
                              aria-pressed={banned}
                              className="cursor-pointer border-l border-edge px-1 py-0.5 text-danger-fg hover:bg-danger/20 transition-colors"
                            >
                              <X size={10} weight="bold" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                    {(banSel[drop.id]?.length || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => applyBanSel(drop.id)}
                        className={`${MONO} mt-1.5 w-full cursor-pointer rounded-md border border-danger/50 bg-danger/15 px-2 py-1 text-2xs font-bold text-danger-fg hover:bg-danger/25 transition-colors`}
                      >
                        Ban {banSel[drop.id].length} selected
                      </button>
                    )}
                  </div>
                ))}
                {pendingDrops.length > 4 && (
                  <div className={`${MONO} text-center text-2xs text-retro-fg/40`}>
                    +{pendingDrops.length - 4} more…
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {isGrid ? (
          <span className={`${MONO} text-xs font-medium text-retro-muted`}>
            {grid.length}/{gridTarget} live{feedOffline ? ' · offline' : ''}
          </span>
        ) : inBattle ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5" title={`${Math.ceil(foeHp)} / ${foeMaxHp} HP`}>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/60 border border-edge">
              <div
                className={`h-full rounded-full transition duration-150 ${hpPct <= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <span className={`${MONO} whitespace-nowrap text-xs font-semibold text-retro-muted`}>
              {formatNum(Math.ceil(foeHp))}/{formatNum(foeMaxHp)} <span className="text-2xs text-retro-fg/40">HP</span>
            </span>
          </div>
        ) : (
          <span className={`${MUTED} text-xs`}>No live foe. Take your time.</span>
        )}
        {heatLive && (
          <span
            className={`${MONO} inline-flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-lg border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-black text-warning-fg${reduceMotion ? '' : ' animate-pulse'}`}
            title={`Heat combo: ${heatStreak} rapid clicks. X${heat} click power`}
            aria-label={`Heat combo x${heat}`}
          >
            <Fire size={14} weight="fill" className="text-warning-fg" />
            x{heat}
          </span>
        )}
        {feedOffline && (
          <button
            type="button"
            className={`${BTN} ${BTN_SMALL} inline-flex items-center gap-1`}
            disabled={fetching}
            aria-label="Retry the feed"
            onClick={() => retryFeedManual()}
            title="Retry the feed"
          >
            <ArrowClockwise size={12} weight="bold" className={fetching ? 'animate-spin' : ''} />
            {fetching ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <span
          className={`${MONO} inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-edge bg-glass-w8 px-2.5 py-1 text-xs font-bold text-retro-body shadow-sm`}
          title="Lifetime KOs. Each foe hits harder"
        >
          <Skull size={13} weight="bold" className="text-danger-fg" />
          {formatNum(defeated)}
        </span>
      </div>

    </section>
  )
}
