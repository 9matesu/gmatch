import { useCallback, useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { clickPower, passiveGps } from '../game/economy'
import { TITLES, tierForXp, titleForTier, xpForTier } from '../game/prestige'
import { clearImageCache, imageCacheStats, type ImageCacheStats } from '../services/imageCache'
import { formatNum } from './format'
import { IconBolt, IconCoin, IconCursor, IconImage, IconRefresh, IconShard } from './icons'

function formatCacheMb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function StatsPanel() {
  const s = useGame()
  const now = Date.now()
  const input = {
    shards: s.shards,
    achievementsEarned: s.achievements.length,
    tags: s.tags,
    gallery: s.gallery,
    caps: s.caps,
  }
  const gps = passiveGps(input, now)
  const cp = clickPower(input, now)
  const tier = tierForXp(s.xp)
  const cur = xpForTier(tier)
  const next = xpForTier(tier + 1)
  const pct =
    tier >= TITLES.length ? 100 : Math.min(100, Math.max(0, ((s.xp - cur) / (next - cur)) * 100))

  const [cache, setCache] = useState<ImageCacheStats | null>(null)
  const refreshCache = useCallback(() => {
    imageCacheStats()
      .then(setCache)
      .catch(() => setCache(null))
  }, [])
  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  return (
    <aside className="plate panel stats">
      <div className="gc-big mono">{formatNum(s.gc)}</div>
      <div className="gc-label">g$</div>
      <div className="stat-row">
        <span>
          <IconCoin size={13} /> g$/s
        </span>
        <b className="mono">{formatNum(gps)}</b>
      </div>
      <div className="stat-row">
        <span>
          <IconBolt size={13} /> Click power
        </span>
        <b className="mono">{formatNum(cp)}</b>
      </div>
      <div className="stat-row">
        <span>
          <IconCursor size={13} /> Clicks / crits
        </span>
        <b className="mono">
          {s.clicks} / {s.crits}
        </b>
      </div>
      <div className="stat-row">
        <span>
          <IconShard size={13} /> Corruption shards
        </span>
        <b className="mono">{s.shards}</b>
      </div>
      <div className="stat-row">
        <span>
          <IconImage size={13} /> Picture cache
        </span>
        <b className="mono">{cache ? `${cache.files} · ${formatCacheMb(cache.bytes)}` : '—'}</b>
      </div>
      {cache && cache.files > 0 && (
        <button
          type="button"
          className="btn small cache-clear"
          onClick={() => {
            void clearImageCache().then(refreshCache)
          }}
          title="Delete cached pictures from the user folder"
        >
          <IconRefresh size={12} /> Clear cache
        </button>
      )}
      <div className="ladder">
        <div className="ladder-head">
          <span className="ladder-title">Pornification</span>
          <span className="tier-now">
            <span className="tier-name">{titleForTier(tier)}</span>
            <span className="mono tier-num">T{tier}</span>
          </span>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <ol className="tier-list">
          {TITLES.map((t, i) => (
            <li
              key={t}
              className={i + 1 < tier ? 'reached' : i + 1 === tier ? 'current' : 'locked'}
            >
              <span className="mono">{i + 1}</span> {t}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
