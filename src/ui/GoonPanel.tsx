import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useGame, rarityBaseForPost } from '../game/store'
import { imageBuyCost, imageRarity } from '../game/rarity'
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
  const gallerySize = useGame((s) => s.gallery.length)
  const caps = useGame((s) => s.caps)
  const nsfwBlur = useGame((s) => s.nsfwBlur)
  const clickImage = useGame((s) => s.clickImage)
  const buyCurrentImage = useGame((s) => s.buyCurrentImage)
  const advanceFeed = useGame((s) => s.advanceFeed)
  const popCap = useGame((s) => s.popCap)

  const [floats, setFloats] = useState<Float[]>([])
  const [critFlash, setCritFlash] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const floatId = useRef(0)

  const rarityBase = current ? rarityBaseForPost(current.id) : 1
  const price = imageBuyCost(rarityBase, gallerySize)
  const rarity = imageRarity(rarityBase, gallerySize)
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

  return (
    <section className="glass panel goon-panel">
      <div
        className={`image-stage ${nsfwBlur ? 'nsfw' : ''}`}
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

      <div className="buy-row">
        <span className={`rarity-badge rarity-${rarity.toLowerCase()}`}>{rarity}</span>
        <button
          type="button"
          className="btn buy-btn"
          disabled={gp < price || !current}
          onClick={buyCurrentImage}
        >
          Buy this image · {formatNum(price)} GP
        </button>
        <button type="button" className="btn next-btn" onClick={advanceFeed}>
          Next image
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
