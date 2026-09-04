import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { GRID_SIZE } from '../game/store'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import { offlineSvg } from '../services/offlineSvg'
import { prefetchImages } from '../services/imageCache'
import { isVideoUrl } from '../services/postFilter'
import { redgifsPlayable } from '../services/redgifs'
import { CAP_SKINS } from './capSkins'
import { formatNum } from './format'
import CachedImg from './CachedImg'
import OfflineCard from './OfflineCard'
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
  const gp = useGame((s) => s.gp)
  const foeHp = useGame((s) => s.foeHp)
  const foeMaxHp = useGame((s) => s.foeMaxHp)
  const defeated = useGame((s) => s.defeated)
  const caps = useGame((s) => s.caps)
  const viewMode = useGame((s) => s.viewMode)
  const grid = useGame((s) => s.grid)
  const clickImage = useGame((s) => s.clickImage)
  const clickCell = useGame((s) => s.clickCell)
  const dropCell = useGame((s) => s.dropCell)
  const setViewMode = useGame((s) => s.setViewMode)
  const fetchFeed = useGame((s) => s.fetchFeed)
  const advanceFeed = useGame((s) => s.advanceFeed)
  const goBack = useGame((s) => s.goBack)
  const canGoBack = useGame((s) => s.past.length > 0)
  const queue = useGame((s) => s.queue)
  const past = useGame((s) => s.past)
  const popCap = useGame((s) => s.popCap)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
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

  const spawnFloat = (x: number, y: number, gain: number, crit: boolean, cell: number | null) => {
    const id = ++floatId.current
    setFloats((f) => [...f, { id, x, y, text: `+${formatNum(gain)}`, crit, cell }])
    window.setTimeout(() => setFloats((f) => f.filter((fl) => fl.id !== id)), 900)
    if (crit) {
      setCritFlash(true)
      window.setTimeout(() => setCritFlash(false), 350)
    }
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit } = clickImage()
    spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, null)
  }

  const handleCellClick = (index: number, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit } = clickCell(index)
    if (gain > 0) spawnFloat(e.clientX - rect.left, e.clientY - rect.top, gain, crit, index)
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
  const hpPct = inBattle ? Math.max(0, (foeHp / foeMaxHp) * 100) : 0
  const isGrid = viewMode === 'grid'

  return (
    <section className="plate panel goon-panel">
      {isGrid ? (
        <div className="grid-board" aria-label="3x3 goon grid">
          {critFlash && <div className="crit-flash">CRIT!</div>}
          {grid.map((cell, i) => {
            const motion =
              (cell.post.kind === 'video' || isVideoUrl(cell.post.url)) &&
              !/\.gif(?:[?#]|$)/i.test(cell.post.url)
            const pct = Math.max(0, (cell.hp / cell.maxHp) * 100)
            return (
              <button
                key={`${cell.post.id}:${i}`}
                type="button"
                className="grid-cell"
                onClick={(e) => handleCellClick(i, e)}
                aria-label={`Foe ${i + 1}: ${Math.ceil(cell.hp)} of ${cell.maxHp} HP — activate to attack`}
              >
                {motion ? (
                  <video
                    className="goon-image"
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
                    className="goon-image"
                    src={cell.post.url}
                    alt="goon grid square"
                    referrerPolicy="no-referrer"
                    onError={() => dropCell(i)}
                    draggable={false}
                  />
                )}
                <span className="cell-hp">
                  <span className="hp-bar">
                    <span className={`hp-fill ${pct <= 30 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
                  </span>
                </span>
                {floats
                  .filter((f) => f.cell === i)
                  .map((f) => (
                    <span key={f.id} className={`float-gp ${f.crit ? 'crit' : ''}`} style={{ left: f.x, top: f.y }}>
                      {f.text}
                    </span>
                  ))}
              </button>
            )
          })}
          {Array.from({ length: Math.max(0, GRID_SIZE - grid.length) }, (_, k) => (
            <div key={`empty-${k}`} className="grid-cell cell-empty">
              <span className="cell-empty-label">{fetching ? '…' : 'empty'}</span>
            </div>
          ))}
          {feedOffline && <span className="offline-badge">OFFLINE</span>}
          {grid.length === 0 && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} onRetry={() => void fetchFeed()} />
          )}
        </div>
      ) : (
        <div
          className="image-stage"
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
          {critFlash && <div className="crit-flash">CRIT!</div>}
          {isMotion && current ? (
            <video
              className="goon-image"
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
            <CachedImg
              className="goon-image"
              src={src}
              alt="goon feed"
              referrerPolicy="no-referrer"
              onError={onImageError}
              draggable={false}
            />
          )}
          {showOffline && <span className="offline-badge">OFFLINE</span>}
          {showOffline && (
            <OfflineCard fetching={fetching} feedOffline={feedOffline} onRetry={() => void fetchFeed()} />
          )}
          {!showOffline && canGoBack && (
            <button
              type="button"
              className="back-arrow"
              aria-label="Previous image"
              title="Back to the skipped foe"
              onClick={(e) => {
                e.stopPropagation()
                goBack()
              }}
            >
              <IconChevronL size={26} />
            </button>
          )}
          {!showOffline && (
            <button
              type="button"
              className="skip-arrow"
              aria-label="Next image"
              title="Skip this foe — no reward"
              onClick={(e) => {
                e.stopPropagation()
                advanceFeed()
              }}
            >
              <IconChevronR size={26} />
            </button>
          )}
          {floats
            .filter((f) => f.cell === null)
            .map((f) => (
              <span key={f.id} className={`float-gp ${f.crit ? 'crit' : ''}`} style={{ left: f.x, top: f.y }}>
                {f.text}
              </span>
            ))}
        </div>
      )}
      <div className="battle-row">
        <div className="view-toggle" role="group" aria-label="Feed layout">
          <button
            type="button"
            className={viewMode === 'single' ? 'active' : ''}
            aria-pressed={viewMode === 'single'}
            onClick={() => setViewMode('single')}
            title="Single foe view"
          >
            1×1
          </button>
          <button
            type="button"
            className={viewMode === 'grid' ? 'active' : ''}
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            title="3×3 grid — nine foes at once"
          >
            3×3
          </button>
        </div>
        {isGrid ? (
          <span className="muted">
            {grid.length}/{GRID_SIZE} live{feedOffline ? ' · offline' : ''}
          </span>
        ) : inBattle ? (
          <div className="hp-wrap" title={`${Math.ceil(foeHp)} / ${foeMaxHp} HP`}>
            <div className="hp-bar">
              <div className={`hp-fill ${hpPct <= 30 ? 'low' : ''}`} style={{ width: `${hpPct}%` }} />
            </div>
            <span className="hp-text mono">
              {formatNum(Math.ceil(foeHp))}/{formatNum(foeMaxHp)} HP
            </span>
          </div>
        ) : (
          <span className="muted">No live foe — take your time.</span>
        )}
        {feedOffline && (
          <button
            type="button"
            className="btn small"
            disabled={fetching}
            aria-label="Retry the feed"
            onClick={() => void fetchFeed()}
            title="Retry the feed"
          >
            {fetching ? '…' : 'Retry'}
          </button>
        )}
        <span className="ko-count mono" title="Lifetime KOs — each foe hits harder">
          KOs: {formatNum(defeated)}
        </span>
      </div>

      <div className="caps-bar">
        {CAP_ORDER.map((id) => {
          const def = CAPS[id]
          const st = capStacks(caps, id, now)
          const isLive = st.count > 0
          return (
            <button
              key={id}
              type="button"
              className={`cap has-skin ${isLive ? 'active' : ''}`}
              style={{
                backgroundImage: `linear-gradient(rgba(5,5,12,0.72), rgba(5,5,12,0.72)), url("${CAP_SKINS[id]}")`,
              }}
              disabled={gp < def.cost}
              onClick={() => popCap(id)}
              title={`${def.name} — ${capEffectLabel(id)} — ${formatNum(def.cost)} GP — permanent, pops stack${st.count > 0 ? ` (x${st.count} live)` : ''}`}
            >
              <span className="cap-name">
                {def.name}
                {st.count > 1 ? ` x${st.count}` : ''}
              </span>
              <span className="cap-stats">{capEffectLabel(id)}</span>
              <span className="cap-cost mono">{formatNum(def.cost)} GP</span>
              <span className="cap-timer mono">{isLive ? '∞' : ''}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
