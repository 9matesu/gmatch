import { useState, type ComponentType } from 'react'
import { useGame } from '../game/store'
import { MAX_TAG_LEVEL, tagCost } from '../game/tags'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import {
  IconFlask,
  IconImage,
  IconRefresh,
  IconTag,
  IconTrophy,
  IconWallpaper,
  IconX,
} from './icons'
import {
  PRESTIGE_MIN_TIER,
  canBrainmelt,
  shardsFromEarned,
  tierForXp,
} from '../game/prestige'
import { ACHIEVEMENTS } from '../game/achievements'
import { offlineSvg } from '../services/offlineSvg'
import { redgifsPlayable } from '../services/redgifs'
import { CAP_SKINS } from './capSkins'
import CachedImg from './CachedImg'
import { formatNum } from './format'

type Tab = 'tags' | 'gallery' | 'caps' | 'prestige'

const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'tags', label: 'Tags', icon: IconTag },
  { id: 'gallery', label: 'Gallery', icon: IconImage },
  { id: 'caps', label: 'Caps', icon: IconFlask },
  { id: 'prestige', label: 'Prestige', icon: IconTrophy },
]

function TagsTab() {
  const tags = useGame((s) => s.tags)
  const gp = useGame((s) => s.gp)
  const fetching = useGame((s) => s.fetching)
  const buyTag = useGame((s) => s.buyTag)
  const toggleTag = useGame((s) => s.toggleTag)
  const soloTag = useGame((s) => s.soloTag)
  const refreshTagMarket = useGame((s) => s.refreshTagMarket)
  const addCustomTag = useGame((s) => s.addCustomTag)
  const owned = tags.filter((t) => t.level > 0).length
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const submitCustom = () => {
    const q = custom
    if (!q.trim()) return
    setNote(null)
    void addCustomTag(q).then((r) => {
      setNote(r.message)
      if (r.added) setCustom('')
    })
  }
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
          <IconRefresh size={12} /> {fetching ? 'Parsing…' : 'Refresh'}
        </button>
      </div>
      <div className="market-head custom-tag-row">
        <input
          className="custom-tag-input"
          value={custom}
          disabled={fetching}
          placeholder="Custom tag — try skylar vox, bbc, goon caption…"
          aria-label="Search a custom tag"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitCustom()
            }
          }}
        />
        <button type="button" className="btn small" disabled={fetching || !custom.trim()} onClick={submitCustom}>
          Add
        </button>
      </div>
      {note && <div className="muted custom-tag-note">{note}</div>}
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
              {isOwned && (
                <button
                  type="button"
                  className="pill-lv mono"
                  onClick={() => soloTag(t.name)}
                  title={`Solo ${t.name} — feed ONLY this tag`}
                >
                  SOLO
                </button>
              )}
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
  const backgroundUrl = useGame((s) => s.backgroundUrl)
  const featureImage = useGame((s) => s.featureImage)
  const setBackground = useGame((s) => s.setBackground)
  const [filter, setFilter] = useState('')
  if (gallery.length === 0) {
    return <div className="tab-body empty">No keepsakes yet. Drain feed images to keep them.</div>
  }
  const q = filter.trim().toLowerCase()
  const shown = q
    ? gallery.filter((img) => img.tags.some((t) => t.toLowerCase().includes(q)))
    : gallery
  return (
    <div className="tab-body">
      <div className="market-head custom-tag-row">
        <input
          className="custom-tag-input"
          value={filter}
          placeholder="Filter gallery by tag…"
          aria-label="Filter gallery by tag"
          onChange={(e) => setFilter(e.target.value)}
        />
        {q && (
          <button type="button" className="btn small" onClick={() => setFilter('')}>
            Clear
          </button>
        )}
      </div>
      {q && (
        <div className="muted custom-tag-note">
          {shown.length} of {gallery.length} match “{filter.trim()}”
        </div>
      )}
      {shown.length === 0 ? (
        <div className="tab-body empty">No keepsakes match that tag.</div>
      ) : null}
      {backgroundUrl && (
        <div className="backdrop-row">
          <span className="muted">Backdrop live</span>
          <button
            type="button"
            className="btn small"
            onClick={() => setBackground(null)}
            title="Remove the app backdrop"
          >
            <IconX size={12} /> Clear
          </button>
        </div>
      )}
      <div className="gallery-grid">
        {shown.map((img) => {
          const isBackdrop = backgroundUrl === img.url
          const isMotion = img.kind === 'video'
          return (
            <div key={img.id} className={`gallery-cell ${isBackdrop ? 'is-backdrop' : ''}`}>
              <button
                type="button"
                className="gallery-open"
                title="Re-feature in the Goon Panel"
                onClick={() => featureImage(img.id)}
              >
                {isMotion ? (
                  <video src={redgifsPlayable(img.url)} poster={img.preview ? redgifsPlayable(img.preview) : undefined} muted preload="metadata" playsInline />
                ) : (
                  <CachedImg
                    src={img.url || offlineSvg(img.tags)}
                    fallbackSrc={offlineSvg(img.tags)}
                    alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </button>
              <span className={`rarity-badge sm rarity-${img.rarity.toLowerCase()}`}>
                {img.rarity}
              </span>
              <button
                type="button"
                className="gallery-bg"
                title={isBackdrop ? 'This is the app backdrop' : 'Set as app backdrop'}
                aria-label={isBackdrop ? 'Current app backdrop' : `Set ${img.tags.slice(0, 2).join(' ') || 'image'} as app backdrop`}
                disabled={isBackdrop}
                onClick={() => setBackground(img.url)}
              >
                <IconWallpaper size={13} />
              </button>
            </div>
          )
        })}
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
        GoonCap vending machine. Pops are permanent — every pop stacks forever, repeats compound.
      </p>
      <div className="vending">
        {(Object.keys(CAPS) as CapId[]).map((id) => {
          const def = CAPS[id]
          const afford = gp >= def.cost
          const st = capStacks(caps, id, now)
          return (
            <div
              key={id}
              className={`vend-row has-skin ${afford ? 'pulse' : ''}`}
              style={{
                backgroundImage: `linear-gradient(rgba(5,5,12,0.78), rgba(5,5,12,0.78)), url("${CAP_SKINS[id]}")`,
              }}
            >
              <div>
                <div className="cap-name">
                  {def.name}
                  {st.count > 0 && <span className="mono"> x{st.count}</span>}
                </div>
                <div className="muted">
                  {capEffectLabel(id)} · permanent
                  {st.count > 0 && ` · x${st.count} stacked`}
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
    <aside className="plate panel shop">
      <nav className="tabs">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </nav>
      {tab === 'tags' && <TagsTab />}
      {tab === 'gallery' && <GalleryTab />}
      {tab === 'caps' && <CapsTab />}
      {tab === 'prestige' && <PrestigeTab />}
    </aside>
  )
}
