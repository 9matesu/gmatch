import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useGame } from '../game/store'
import { clickPower, passiveGps } from '../game/economy'
import { TITLES, tierForXp, titleForTier, xpForTier } from '../game/prestige'
import { clearImageCache, imageCacheStats, type ImageCacheStats } from '../services/imageCache'
import { formatNum } from './format'
import { BTN, BTN_SMALL, DISPLAY, MONO, PANEL, PLATE } from './styles'
import { Skeleton } from '../components/Skeleton'
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

  const statRow = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="flex items-center justify-between border-b border-border-subtle py-[7px] text-[13px] text-retro-muted">
      <span className="inline-flex items-center gap-[7px]">
        {icon} {label}
      </span>
      <b className={`${MONO} text-sm text-retro-fg`}>{value}</b>
    </div>
  )

  return (
    <aside className={`${PLATE} ${PANEL}`}>
      <div className={`${DISPLAY} text-[40px] font-bold leading-[1.1] break-all text-retro-fg [font-variant-numeric:tabular-nums]`}>
        {formatNum(s.gc)}
      </div>
      <div className="mb-3.5 text-[11px] uppercase tracking-[2px] text-retro-muted">g$</div>
      {statRow(<IconCoin size={13} />, 'g$/s', formatNum(gps))}
      {statRow(<IconBolt size={13} />, 'Click power', formatNum(cp))}
      {statRow(
        <IconCursor size={13} />,
        'Clicks / crits',
        <>
          {s.clicks} / {s.crits}
        </>,
      )}
      {statRow(<IconShard size={13} />, 'Corruption shards', s.shards)}
      {statRow(
        <IconImage size={13} />,
        'Picture cache',
        cache ? `${cache.files} · ${formatCacheMb(cache.bytes)}` : <Skeleton className="h-3 w-16" />,
      )}
      {cache && cache.files > 0 && (
        <button
          type="button"
          className={`${BTN} ${BTN_SMALL} mt-2 w-full`}
          onClick={() => {
            void clearImageCache().then(refreshCache)
          }}
          title="Delete cached pictures from the user folder"
        >
          <IconRefresh size={12} /> Clear cache
        </button>
      )}
      <div className="mt-[18px]">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[2px] text-retro-muted">
            Pornification
          </span>
          <span className="inline-flex items-baseline gap-1.5">
            <span className={`${DISPLAY} font-bold text-retro-accent`}>{titleForTier(tier)}</span>
            <span className={`${MONO} text-[11px] text-retro-muted`}>T{tier}</span>
          </span>
        </div>
        <div className="mb-2.5 h-2 overflow-hidden rounded-full border border-border-glass bg-retro-bg">
          <div
            className="h-full rounded-full bg-retro-accent transition-[width] duration-[400ms] ease-in-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="flex flex-col gap-[3px] text-xs">
          {TITLES.map((t, i) => (
            <li
              key={t}
              className={
                i + 1 < tier
                  ? 'flex gap-2 text-retro-fg/75'
                  : i + 1 === tier
                    ? 'flex gap-2 font-bold text-retro-fg'
                    : 'flex gap-2 text-retro-muted'
              }
            >
              <span
                className={`${MONO} w-4 text-right ${
                  i + 1 === tier ? 'text-retro-accent' : 'opacity-60'
                }`}
              >
                {i + 1}
              </span>{' '}
              {t}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
