import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useGame } from '../game/store'
import { CAPS, activeCaps } from '../game/caps'
import type { CapId } from '../game/types'
import { offlineSvg } from '../services/offlineSvg'
import { formatNum } from './format'

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
  const popCap = useGame((s) => s.popCap)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const floatId = useRef(0)

  const now = Date.now()
  const live = activeCaps(caps, now)

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
    <section className="glass panel goon-panel">
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
              <div className="hp-fill" style={{ width: `${hpPct}%` }} />
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
        <button type="button" className="btn next-btn" onClick={advanceFeed}>
          Skip (no reward)
        </button>
      </div>

      <div className="caps-bar">
        {CAP_ORDER.map((id) => {
          const def = CAPS[id]
          const liveCap = live.find((c) => c.capId === id)
          const remaining = liveCap ? Math.max(0, Math.ceil((liveCap.expiresAt - now) / 1000)) : 0
          return (
            <button
              key={id}
              type="button"
              className={`cap ${liveCap ? 'active' : ''}`}
              disabled={gp < def.cost}
              onClick={() => popCap(id)}
              title={`${def.name} — ${formatNum(def.cost)} GP`}
            >
              <span className="cap-name">{def.name}</span>
              <span className="cap-cost mono">{formatNum(def.cost)}</span>
              <span className="cap-timer mono">{liveCap ? `${remaining}s` : ''}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
