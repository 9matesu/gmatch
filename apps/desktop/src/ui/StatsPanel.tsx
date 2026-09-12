import { useCallback, useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { clickPower, passiveGps } from '../game/economy'
import { clearImageCache, imageCacheStats, type ImageCacheStats } from '../services/imageCache'
import { formatNum } from './format'
import { MONO, PLATE } from './styles'
import { Skeleton } from '../components/Skeleton'
import {
  Coins,
  Lightning,
  CursorClick,
  Sparkle,
  Images,
  Trash,
} from '@phosphor-icons/react'
import { playPress } from '../utils/sounds'

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

  const [cache, setCache] = useState<ImageCacheStats | null>(null)
  const [clearing, setClearing] = useState(false)

  const refreshCache = useCallback(() => {
    imageCacheStats()
      .then(setCache)
      .catch(() => setCache(null))
  }, [])

  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  const handleClearCache = async () => {
    playPress(600)
    setClearing(true)
    try {
      await clearImageCache()
      refreshCache()
    } finally {
      setClearing(false)
    }
  }

  return (
    <aside className={`${PLATE} p-3.5 space-y-3`}>
      {/* Primary Balance Header */}
      <div className="flex items-baseline justify-between gap-2 border-b border-border-glass pb-2.5">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">
            Total Points
          </span>
          <div
            className={`${MONO} text-2xl sm:text-3xl font-extrabold text-retro-fg tracking-tight leading-none mt-1`}
            data-testid="gc-balance"
          >
            {formatNum(s.points)}
          </div>
        </div>
        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-glass-w8 text-retro-accent border border-border-glass">
          PTS
        </span>
      </div>

      {/* Modern 2x2 Telemetry Grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* Passive Income */}
        <div className="rounded-xl border border-border-glass bg-glass-w5 p-2 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-medium text-retro-muted truncate">
            <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" weight="fill" />
            <span>Passive</span>
          </div>
          <div className={`${MONO} text-xs font-bold text-retro-fg mt-1`}>
            +{formatNum(gps)}/s
          </div>
        </div>

        {/* Click Power */}
        <div className="rounded-xl border border-border-glass bg-glass-w5 p-2 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-medium text-retro-muted truncate">
            <Lightning className="w-3.5 h-3.5 text-cyan-400 shrink-0" weight="fill" />
            <span>Click Power</span>
          </div>
          <div className={`${MONO} text-xs font-bold text-retro-fg mt-1`}>
            +{formatNum(cp)}
          </div>
        </div>

        {/* Clicks & Crits */}
        <div className="rounded-xl border border-border-glass bg-glass-w5 p-2 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-medium text-retro-muted truncate">
            <CursorClick className="w-3.5 h-3.5 text-emerald-400 shrink-0" weight="fill" />
            <span>Clicks / Crits</span>
          </div>
          <div className={`${MONO} text-xs font-bold text-retro-fg mt-1 truncate`}>
            {formatNum(s.clicks)} <span className="text-[10px] text-amber-400 font-normal">({formatNum(s.crits)})</span>
          </div>
        </div>

        {/* Corruption Shards */}
        <div className="rounded-xl border border-border-glass bg-glass-w5 p-2 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-medium text-retro-muted truncate">
            <Sparkle className="w-3.5 h-3.5 text-purple-400 shrink-0" weight="fill" />
            <span>Shards</span>
          </div>
          <div className={`${MONO} text-xs font-bold text-purple-300 mt-1`}>
            {s.shards} <span className="text-[10px] text-retro-muted font-normal">(+{s.shards * 10}%)</span>
          </div>
        </div>
      </div>

      {/* Cache Telemetry Bar */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-glass text-[11px] text-retro-muted">
        <div className="flex items-center gap-1.5 truncate">
          <Images className="w-3.5 h-3.5 text-retro-muted shrink-0" />
          <span className="font-mono text-[10px]">
            {cache ? `${cache.files} images · ${formatCacheMb(cache.bytes)}` : <Skeleton className="h-3 w-20 inline-block" />}
          </span>
        </div>
        {cache && cache.files > 0 && (
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing}
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-border-glass bg-glass-w5 hover:bg-glass-w10 hover:text-rose-300 text-[10px] font-medium text-retro-muted transition-colors cursor-pointer disabled:opacity-40"
            title="Clean local cached picture files"
          >
            <Trash className="w-3 h-3" />
            <span>{clearing ? 'Clearing…' : 'Clean'}</span>
          </button>
        )}
      </div>
    </aside>
  )
}
