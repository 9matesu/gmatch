import { useState } from 'react'
import { useGame } from '../game/store'
import { MAX_TAG_LEVEL, tagCost } from '../game/tags'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import {
  PRESTIGE_MIN_TIER,
  canBrainmelt,
  shardsFromEarned,
  tierForXp,
} from '../game/prestige'
import { ACHIEVEMENTS } from '../game/achievements'
import { offlineSvg } from '../services/offlineSvg'
import { formatNum } from './format'

type Tab = 'tags' | 'gallery' | 'caps' | 'prestige'

const TABS: { id: Tab; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'caps', label: 'Caps' },
  { id: 'prestige', label: 'Prestige' },
]

function TagsTab() {
  const tags = useGame((s) => s.tags)
  const gp = useGame((s) => s.gp)
  const fetching = useGame((s) => s.fetching)
  const buyTag = useGame((s) => s.buyTag)
  const toggleTag = useGame((s) => s.toggleTag)
  const refreshTagMarket = useGame((s) => s.refreshTagMarket)
  const owned = tags.filter((t) => t.level > 0).length
  return (
    <div className="tab-body">
      <div className="market-head">
        <span className="muted">
          Pills steer the feed — buy the picture types you want, toggle owned pills ON/OFF.
          New tags drop from drained foes. {owned} owned.
        </span>
        <button
          type="button"
          className="btn small"
          disabled={fetching}
          onClick={() => void refreshTagMarket()}
        >
          {fetching ? 'Parsing…' : 'Refresh'}
        </button>
      </div>
      <div className="tag-pills">
        {tags.map((t) => {
          const isOwned = t.level > 0
          const on = isOwned && t.selected !== false
          const maxed = t.level >= MAX_TAG_LEVEL
          const cost = tagCost(t.base, t.level)
          const afford = !maxed && gp >= cost
          return (
            <div key={t.name} className={`tag-pill ${on ? 'on' : ''} ${afford ? 'pulse' : ''}`}>
              <button
                type="button"
                className="pill-main"
                disabled={isOwned ? false : !afford}
                onClick={() => (isOwned ? toggleTag(t.name) : buyTag(t.name))}
                title={
                  isOwned
                    ? `${t.name} — click to switch ${on ? 'OFF' : 'ON'} in the feed`
                    : `Buy ${t.name} for ${formatNum(cost)} GP`
                }
              >
                <span className="pill-name">{t.name}</span>
                <span className="pill-stats mono">
                  Lv {t.level} · +{formatNum(t.income)}/s ·{' '}
                  {isOwned ? (on ? 'ON' : 'OFF') : `${formatNum(cost)} GP`}
                </span>
              </button>
              {isOwned && !maxed && (
                <button
                  type="button"
                  className="pill-lv mono"
                  disabled={!afford}
                  onClick={() => buyTag(t.name)}
                  title={`Level up ${t.name} — ${formatNum(cost)} GP`}
                >
                  +{formatNum(cost)}
                </button>
              )}
              {maxed && <span className="pill-max mono">MAX</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GalleryTab() {
  const gallery = useGame((s) => s.gallery)
  const featureImage = useGame((s) => s.featureImage)
  if (gallery.length === 0) {
    return <div className="tab-body empty">No keepsakes yet. Drain feed images to keep them.</div>
  }
  return (
    <div className="tab-body">
      <div className="gallery-grid">
        {gallery.map((img) => (
          <button
            key={img.id}
            type="button"
            className="gallery-cell"
            title="Re-feature in the Goon Panel"
            onClick={() => featureImage(img.id)}
          >
            <img
              src={img.url || offlineSvg(img.tags)}
              alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.src = offlineSvg(img.tags)
              }}
            />
            <span className={`rarity-badge sm rarity-${img.rarity.toLowerCase()}`}>
              {img.rarity}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CapsTab() {
  const gp = useGame((s) => s.gp)
  const caps = useGame((s) => s.caps)
  const popCap = useGame((s) => s.popCap)
  const now = Date.now()
  return (
    <div className="tab-body">
      <p className="muted">
        GoonCap vending machine. Every pop stacks — repeats compound instead of refreshing.
      </p>
      <div className="vending">
        {(Object.keys(CAPS) as CapId[]).map((id) => {
          const def = CAPS[id]
          const afford = gp >= def.cost
          const st = capStacks(caps, id, now)
          return (
            <div key={id} className={`vend-row ${afford ? 'pulse' : ''}`}>
              <div>
                <div className="cap-name">
                  {def.name}
                  {st.count > 0 && <span className="mono"> x{st.count}</span>}
                </div>
                <div className="muted">
                  {capEffectLabel(id)} · {Math.round(def.durationMs / 1000)}s
                  {st.count > 0 && ` · ${st.secsLeft}s left`}
                </div>
              </div>
              <button
                type="button"
                className="btn small"
                disabled={!afford}
                onClick={() => popCap(id)}
              >
                {formatNum(def.cost)} GP
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PrestigeTab() {
  const xp = useGame((s) => s.xp)
  const totalEarnedGP = useGame((s) => s.totalEarnedGP)
  const shards = useGame((s) => s.shards)
  const achievements = useGame((s) => s.achievements)
  const brainmelt = useGame((s) => s.brainmelt)
  const tier = tierForXp(xp)
  const ready = canBrainmelt(tier)
  const preview = shardsFromEarned(totalEarnedGP)
  return (
    <div className="tab-body">
      <div className="prestige-box">
        <p className="muted">
          Brainmelt burns the run for <b>Corruption shards</b> — each one is a permanent +10%
          global multiplier.
        </p>
        <ul className="keep-reset">
          <li className="resets">Resets: GP, XP/tier, tags, caps</li>
          <li className="keeps">Keeps: gallery, shards, achievements</li>
        </ul>
        <div className="shard-preview mono">
          +{preview} shards on melt · held: {shards}
        </div>
        <button
          type="button"
          className="btn danger"
          disabled={!ready}
          onClick={brainmelt}
        >
          {ready ? 'BRAINMELT' : `Unlocks at tier ${PRESTIGE_MIN_TIER} (you: ${tier})`}
        </button>
      </div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => (
          <div
            key={a.id}
            className={`ach ${achievements.includes(a.id) ? 'got' : ''}`}
            title={achievements.includes(a.id) ? 'Unlocked' : 'Locked'}
          >
            {a.name}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ShopPanel() {
  const [tab, setTab] = useState<Tab>('tags')
  return (
    <aside className="glass panel shop">
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'tags' && <TagsTab />}
      {tab === 'gallery' && <GalleryTab />}
      {tab === 'caps' && <CapsTab />}
      {tab === 'prestige' && <PrestigeTab />}
    </aside>
  )
}
