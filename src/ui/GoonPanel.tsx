import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import { offlineSvg } from '../services/offlineSvg'
import { formatNum } from './format'
import { IconChevronL, IconChevronR } from './icons'

interface Float {
  id: number
  x: number
  y: number
  text: string
  crit: boolean
}

const CAP_ORDER: CapId[] = ['blue', 'filter', 'hypno', 'melt']

export default function GoonPanel() {
  const current = useGame((s) => s.current)
  const feedOffline = useGame((s) => s.feedOffline)
  const gp = useGame((s) => s.gp)
  const foeHp = useGame((s) => s.foeHp)
  const foeMaxHp = useGame((s) => s.foeMaxHp)
  const defeated = useGame((s) => s.defeated)
  const caps = useGame((s) => s.caps)
  const clickImage = useGame((s) => s.clickImage)
  const advanceFeed = useGame((s) => s.advanceFeed)
  const goBack = useGame((s) => s.goBack)
  const canGoBack = useGame((s) => s.past.length > 0)
  const popCap = useGame((s) => s.popCap)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const floatId = useRef(0)

  const now = Date.now()

  const onImageError = useCallback(() => {
    setFailedUrl(current?.url ?? null)
    advanceFeed()
  }, [advanceFeed, current])

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { gain, crit } = clickImage()
    const id = ++floatId.current
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setFloats((f) => [...f, { id, x, y, text: `+${formatNum(gain)}`, crit }])
    window.setTimeout(() => setFloats((f) => f.filter((fl) => fl.id !== id)), 900)
    if (crit) {
      setCritFlash(true)
      window.setTimeout(() => setCritFlash(false), 350)
    }
  }

  const showOffline = feedOffline || !current || failedUrl === current.url
  const src = showOffline ? offlineSvg(current?.tags ?? []) : current.url
  const inBattle = !showOffline && foeMaxHp > 0
  const hpPct = inBattle ? Math.max(0, (foeHp / foeMaxHp) * 100) : 0

  return (
    <section className="plate panel goon-panel">
      <div
        className="image-stage"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            clickImage()
          }
        }}
      >
        {critFlash && <div className="crit-flash">CRIT!</div>}
        <img
          className="goon-image"
          src={src}
          alt="goon feed"
          referrerPolicy="no-referrer"
          onError={onImageError}
          draggable={false}
        />
        {showOffline && <span className="offline-badge">OFFLINE</span>}
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
        {floats.map((f) => (
          <span
            key={f.id}
            className={`float-gp ${f.crit ? 'crit' : ''}`}
            style={{ left: f.x, top: f.y }}
          >
            {f.text}
          </span>
        ))}
      </div>

      <div className="battle-row">
        {inBattle ? (
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
              className={`cap ${isLive ? 'active' : ''}`}
              disabled={gp < def.cost}
              onClick={() => popCap(id)}
              title={`${def.name} — ${capEffectLabel(id)} — ${formatNum(def.cost)} GP — ${Math.round(def.durationMs / 1000)}s each, pops stack${st.count > 0 ? ` (x${st.count} live)` : ''}`}
            >
              <span className="cap-name">
                {def.name}
                {st.count > 1 ? ` x${st.count}` : ''}
              </span>
              <span className="cap-stats">{capEffectLabel(id)}</span>
              <span className="cap-cost mono">{formatNum(def.cost)} GP</span>
              <span className="cap-timer mono">{isLive ? `${st.secsLeft}s` : ''}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
