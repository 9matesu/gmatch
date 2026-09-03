import { useState } from 'react'
import { useGame } from '../game/store'
import { MAX_TAG_LEVEL, tagCost } from '../game/tags'
import { CAPS } from '../game/caps'
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

const CAP_EFFECT: Record<CapId, string> = {
  blue: 'x2 click power',
  filter: 'auto-click 1/s',
  hypno: 'x2 passive GP/s',
  melt: 'x10 everything',
}

function TagsTab() {
  const tags = useGame((s) => s.tags)
  const gp = useGame((s) => s.gp)
  const fetching = useGame((s) => s.fetching)
  const buyTag = useGame((s) => s.buyTag)
  const refreshTagMarket = useGame((s) => s.refreshTagMarket)
  return (
    <div className="tab-body">
      <div className="market-head">
        <span className="muted">Live-parsed from the feed. Rarer tags cost more and earn more.</span>
        <button
          type="button"
          className="btn small"
          disabled={fetching}
          onClick={() => void refreshTagMarket()}
        >
          {fetching ? 'Parsing…' : 'Refresh'}
        </button>
      </div>
      <ul className="tag-list">
        {tags.map((t) => {
          const maxed = t.level >= MAX_TAG_LEVEL
          const cost = tagCost(t.base, t.level)
          const afford = !maxed && gp >= cost
          return (
            <li key={t.name} className={`tag-row ${afford ? 'pulse' : ''}`}>
              <div className="tag-info">
                <span className="tag-name">{t.name}</span>
                <span className="tag-meta mono">
                  Lv {t.level} · +{formatNum(t.income)} GP/s
                </span>
              </div>
              <button
                type="button"
                className="btn small"
                disabled={!afford}
                onClick={() => buyTag(t.name)}
              >
                {maxed ? 'MAX' : `${formatNum(cost)} GP`}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GalleryTab() {
  const gallery = useGame((s) => s.gallery)
  const featureImage = useGame((s) => s.featureImage)
  if (gallery.length === 0) {
    return <div className="tab-body empty">No keepsakes yet. Buy images from the Goon Panel.</div>
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
  const popCap = useGame((s) => s.popCap)
  return (
    <div className="tab-body">
      <p className="muted">
        GoonCap vending machine. Different caps stack; repeats refresh the timer.
      </p>
      <div className="vending">
        {(Object.keys(CAPS) as CapId[]).map((id) => {
          const def = CAPS[id]
          const afford = gp >= def.cost
          return (
            <div key={id} className={`vend-row ${afford ? 'pulse' : ''}`}>
              <div>
                <div className="cap-name">{def.name}</div>
                <div className="muted">
                  {CAP_EFFECT[id]} · {Math.round(def.durationMs / 1000)}s
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
