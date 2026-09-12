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
import { CAP_SKINS } from './capSkins'
import { formatNum } from './format'
import { Skeleton } from '../components/Skeleton'
import {
  BTN,
  BTN_DANGER,
  BTN_SMALL,
  DISPLAY,
  MONO,
  MUTED,
  PLATE,
  SKIN,
} from './styles'
import {
  Tag as TagIcon,
  Lightning,
  Fire,
  MagnifyingGlass,
  Plus,
  ArrowClockwise,
  X,
  Trophy,
  Sparkle,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react'
import { playPress } from '../utils/sounds'

const TAB_KEY = 'gmatch.shop.tab.v2'
type ShopTab = 'tags' | 'caps' | 'prestige'

function loadSavedTab(): ShopTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved === 'tags' || saved === 'caps' || saved === 'prestige') return saved
  } catch { /* session-only */ }
  return 'tags'
}

/** Tag search / filter input — Cyber-Slate styling. */
const TAG_INPUT =
  'min-w-0 flex-1 rounded-xl border border-border-glass bg-black/40 px-3 py-1.5 text-xs text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent/60 transition-colors font-mono'

function TagsTab() {
  const tags = useGame((s) => s.tags)
  const points = useGame((s) => s.points)
  const fetching = useGame((s) => s.fetching)
  const buyTag = useGame((s) => s.buyTag)
  const toggleTag = useGame((s) => s.toggleTag)
  const soloTag = useGame((s) => s.soloTag)
  const deleteTag = useGame((s) => s.deleteTag)
  const mergeTags = useGame((s) => s.mergeTags)
  const refreshTagMarket = useGame((s) => s.refreshTagMarket)
  const addCustomTag = useGame((s) => s.addCustomTag)
  const owned = tags.filter((t) => t.level > 0).length

  const [custom, setCustom] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mergeSel, setMergeSel] = useState<string | null>(null)

  const submitCustom = () => {
    const q = custom.trim()
    if (!q) return
    setNote(null)
    void addCustomTag(q).then((r) => {
      setNote(r.message)
      if (r.added) setCustom('')
    })
  }

  const ownedTags = tags.filter((t) => t.level > 0)
  const marketTags = tags.filter((t) => t.level <= 0)

  const renderTagPill = (t: (typeof tags)[number]) => {
    const isOwned = t.level > 0
    const on = isOwned && t.selected !== false
    const maxed = t.level >= MAX_TAG_LEVEL
    const cost = tagCost(t.base, t.level)
    const afford = !maxed && points >= cost

    return (
      <span key={t.name} className="relative inline-flex group">
        <button
          type="button"
          onClick={() => {
            playPress(740)
            if (mergeSel && isOwned) {
              if (mergeSel === t.name) setMergeSel(null)
              else { mergeTags(mergeSel, t.name); setMergeSel(null) }
            } else if (!mergeSel) {
              if (isOwned) toggleTag(t.name)
              else buyTag(t.name)
            }
          }}
          onDoubleClick={() => {
            if (isOwned) { setMergeSel(mergeSel === t.name ? null : t.name) }
          }}
          onContextMenu={(e) => {
            if (isOwned) { e.preventDefault(); soloTag(t.name) }
          }}
          title={
            isOwned
              ? `${t.name} · Lv${t.level} · +${formatNum(t.income)}/s · click ${on ? 'OFF' : 'ON'} · right-click = solo · double-click = pick for merge`
              : `${t.name} · buy for ${formatNum(cost)} pts`
          }
          className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-150 ${
            on
              ? 'border-retro-accent/50 bg-retro-accent/15 text-retro-fg'
              : isOwned
                ? 'border-border-glass bg-glass-w5 text-retro-muted hover:text-retro-fg hover:border-border-strong'
                : 'border-dashed border-border-strong bg-transparent text-retro-muted hover:border-retro-accent/40 hover:text-retro-fg'
          } ${!isOwned && !afford ? 'opacity-40' : ''} ${mergeSel === t.name ? 'ring-1 ring-retro-accent' : ''}`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
              on
                ? 'bg-emerald-400'
                : isOwned
                  ? 'bg-glass-w20'
                  : afford
                    ? 'bg-retro-accent'
                    : 'bg-glass-w20'
            }`}
            aria-hidden="true"
          />
          <span className="truncate font-medium">{t.name}</span>
          {isOwned && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Delete ${t.name}`}
              onClick={(e) => { e.stopPropagation(); deleteTag(t.name) }}
              className="-mr-1 hidden shrink-0 rounded p-0.5 text-retro-muted hover:text-rose-400 group-hover:inline-flex"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </span>
    )
  }

  return (
    <div className="space-y-3">
      {/* Top action bar: count & toggle search drawer */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-retro-muted">
          Active Tags ({owned})
        </span>
        <button
          type="button"
          onClick={() => { playPress(720); setSearchOpen((v) => !v); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-glass bg-glass-w5 hover:bg-glass-w10 text-xs font-medium text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
        >
          {searchOpen ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          <span>{searchOpen ? 'Close' : 'Add Tag'}</span>
        </button>
      </div>

      {/* Custom Tag Search Input Box */}
      {searchOpen && (
        <div className="space-y-2 rounded-xl border border-border-glass bg-black/40 p-2.5 shadow-inner">
          <div className="flex items-center gap-1.5">
            <input
              className={TAG_INPUT}
              value={custom}
              disabled={fetching}
              placeholder="Tag name (e.g. milf, cyberpunk)…"
              aria-label="Search a custom tag"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCustom()
                }
              }}
            />
            <button
              type="button"
              disabled={fetching || !custom.trim()}
              onClick={submitCustom}
              className="px-3 py-1.5 rounded-lg border border-retro-accent/40 bg-retro-accent/20 hover:bg-retro-accent/30 text-retro-fg text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              disabled={fetching}
              onClick={() => { playPress(700); void refreshTagMarket(); }}
              className="p-1.5 rounded-xl border border-border-glass bg-glass-w5 hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors cursor-pointer disabled:opacity-40"
              title="Refresh market offers"
            >
              <ArrowClockwise className="w-3.5 h-3.5" />
            </button>
          </div>
          {note && <div className="text-xs text-retro-muted px-1">{note}</div>}
        </div>
      )}

      {/* Market refresh skeleton */}
      {fetching && (
        <div className="flex gap-1.5" role="status" aria-label="Refreshing tag market">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      )}

      {/* Owned Tags Pills */}
      {ownedTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto styled-scrollbar pr-0.5">
          {ownedTags.map(renderTagPill)}
        </div>
      ) : (
        <div className="text-xs text-retro-muted italic py-2">
          No tags unlocked yet. Tap Add Tag or buy from the market below.
        </div>
      )}

      {/* Market Offers Section */}
      {marketTags.length > 0 && (
        <div className="pt-2 border-t border-border-glass space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted flex items-center justify-between">
            <span>Market Discoveries ({marketTags.length})</span>
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto styled-scrollbar pr-0.5">
            {marketTags.map(renderTagPill)}
          </div>
        </div>
      )}
    </div>
  )
}

function CapsTab() {
  const points = useGame((s) => s.points)
  const caps = useGame((s) => s.caps)
  const popCap = useGame((s) => s.popCap)
  const now = Date.now()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-retro-muted">
          Permanent Overclocks
        </span>
        <span className="text-[10px] font-mono text-retro-muted">
          Stacks compound
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {(Object.keys(CAPS) as CapId[]).map((id, idx) => {
          const def = CAPS[id]
          const afford = points >= def.cost
          const st = capStacks(caps, id, now)

          return (
            <div
              key={id}
              className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-all duration-150 ${
                st.count > 0
                  ? 'border-pink-500/30 bg-pink-500/[0.04]'
                  : 'border-border-glass bg-glass-w5 hover:border-border-strong'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-6 h-6 rounded-lg bg-black/50 border border-border-glass flex items-center justify-center font-mono text-xs font-bold text-retro-muted shrink-0">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-retro-fg truncate">
                      {def.name}
                    </span>
                    {st.count > 0 && (
                      <span className={`${MONO} text-[10px] font-black text-pink-400 bg-pink-500/15 px-1.5 py-0.2 rounded-full`}>
                        x{st.count}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-retro-muted truncate mt-0.5">
                    {capEffectLabel(id)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer shrink-0 ${
                  afford
                    ? 'border-retro-accent/50 bg-retro-accent/20 text-retro-fg hover:bg-retro-accent/30'
                    : 'border-border-glass bg-glass-w5 text-retro-muted opacity-40 cursor-not-allowed'
                }`}
                disabled={!afford}
                onClick={() => { playPress(800); popCap(id); }}
              >
                {formatNum(def.cost)}
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
  const totalEarned = useGame((s) => s.totalEarned)
  const shards = useGame((s) => s.shards)
  const achievements = useGame((s) => s.achievements)
  const brainmelt = useGame((s) => s.brainmelt)
  const tier = tierForXp(xp)
  const ready = canBrainmelt(tier)
  const preview = shardsFromEarned(totalEarned)

  return (
    <div className="space-y-3">
      {/* Brainmelt Terminal Card */}
      <div className="rounded-lg border border-border-glass bg-glass-w5 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-purple-300 font-bold text-xs">
            <Sparkle className="w-4 h-4 text-purple-400" weight="fill" />
            <span>Corruption Shards</span>
          </div>
          <span className={`${MONO} text-xs font-bold text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30`}>
            Held: {shards}
          </span>
        </div>

        <p className="text-xs text-retro-muted leading-relaxed">
          Brainmelt burns your current run to forge permanent Corruption Shards — each granting <b className="text-white">+10% passive multiplier</b> across all future runs.
        </p>

        {/* Reset vs Keep Rules */}
        <div className="grid grid-cols-2 gap-2 text-[10px] bg-black/40 rounded-xl p-2 border border-border-glass">
          <div className="space-y-1">
            <div className="font-bold text-rose-400 flex items-center gap-1">
              <WarningCircle className="w-3 h-3" /> Resets
            </div>
            <div className="text-retro-muted">Points, XP, Tags, Caps</div>
          </div>
          <div className="space-y-1">
            <div className="font-bold text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Keeps
            </div>
            <div className="text-retro-muted">Keepsakes, Shards, Trophies</div>
          </div>
        </div>

        <div className={`${MONO} text-center text-xs font-bold text-amber-300 bg-amber-500/10 py-1 rounded-lg border border-amber-500/20`}>
          +{preview} shards on melt
        </div>

        <button
          type="button"
          className={`w-full py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold tracking-wider uppercase transition-all cursor-pointer ${
            ready
              ? 'bg-rose-600 hover:bg-rose-500 text-retro-fg'
              : 'border border-border-glass bg-glass-w5 text-retro-muted opacity-40 cursor-not-allowed'
          }`}
          disabled={!ready}
          onClick={() => { playPress(900); brainmelt(); }}
        >
          <Fire className="w-4 h-4" weight="fill" />
          <span>{ready ? 'Trigger Brainmelt' : `Unlocks at Tier ${PRESTIGE_MIN_TIER} (You: ${tier})`}</span>
        </button>
      </div>

      {/* Achievements Showcase */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted flex items-center justify-between">
          <span>Achievements ({achievements.length}/{ACHIEVEMENTS.length})</span>
        </span>
        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto styled-scrollbar pr-0.5">
          {ACHIEVEMENTS.map((a) => {
            const got = achievements.includes(a.id)
            return (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded-xl border p-2 text-xs transition-colors ${
                  got
                    ? 'border-amber-500/30 bg-amber-500/[0.05] text-amber-200'
                    : 'border-border-glass bg-glass-w5 text-retro-muted opacity-50'
                }`}
                title={got ? 'Unlocked Trophy' : 'Locked Trophy'}
              >
                <Trophy className={`w-3.5 h-3.5 shrink-0 ${got ? 'text-amber-400' : 'text-retro-muted'}`} weight={got ? 'fill' : 'regular'} />
                <span className="truncate text-xs font-medium">{a.name}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function ShopPanel() {
  const [tab, setTab] = useState<ShopTab>(loadSavedTab)
  const tags = useGame((s) => s.tags)
  const caps = useGame((s) => s.caps)
  const xp = useGame((s) => s.xp)
  const now = Date.now()

  const handleTab = (nextTab: ShopTab) => {
    playPress(700)
    setTab(nextTab)
    try {
      localStorage.setItem(TAB_KEY, nextTab)
    } catch { /* session-only */ }
  }

  const ownedTagsCount = tags.filter((t) => t.level > 0).length
  const totalCapsStacks = Object.keys(CAPS).reduce((acc, k) => acc + capStacks(caps, k as CapId, now).count, 0)
  const currentTier = tierForXp(xp)

  return (
    <aside className={`${PLATE} flex min-h-0 flex-1 flex-col p-3.5 space-y-3`}>
      {/* 3-Tab Segmented Switcher */}
      <div className="flex items-center p-1 rounded-xl bg-black/50 border border-border-glass" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tags'}
          onClick={() => handleTab('tags')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            tab === 'tags'
              ? 'bg-glass-w10 text-retro-fg shadow-sm'
              : 'text-retro-muted hover:text-retro-fg'
          }`}
        >
          <TagIcon className="w-3.5 h-3.5" />
          <span>Tags</span>
          {ownedTagsCount > 0 && (
            <span className="font-mono text-[10px] px-1 rounded-full bg-glass-w10 text-retro-fg">
              {ownedTagsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'caps'}
          onClick={() => handleTab('caps')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            tab === 'caps'
              ? 'bg-glass-w10 text-retro-fg shadow-sm'
              : 'text-retro-muted hover:text-retro-fg'
          }`}
        >
          <Lightning className="w-3.5 h-3.5" />
          <span>Caps</span>
          {totalCapsStacks > 0 && (
            <span className="font-mono text-[10px] px-1 rounded-full bg-pink-500/20 text-pink-400 font-bold">
              {totalCapsStacks}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'prestige'}
          onClick={() => handleTab('prestige')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            tab === 'prestige'
              ? 'bg-glass-w10 text-retro-fg shadow-sm'
              : 'text-retro-muted hover:text-retro-fg'
          }`}
        >
          <Fire className="w-3.5 h-3.5" />
          <span>Prestige</span>
          <span className="font-mono text-[10px] px-1 rounded-full bg-purple-500/20 text-purple-300 font-bold">
            T{currentTier}
          </span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar pr-0.5">
        {tab === 'tags' && <TagsTab />}
        {tab === 'caps' && <CapsTab />}
        {tab === 'prestige' && <PrestigeTab />}
      </div>
    </aside>
  )
}
