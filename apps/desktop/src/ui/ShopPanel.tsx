import { useState, type ComponentType } from 'react'
import { useGame } from '../game/store'
import { MAX_TAG_LEVEL, tagCost } from '../game/tags'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import {
  IconFlask,
  IconRefresh,
  IconTag,
  IconTrophy,
} from './icons'
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
import { EmptyState } from '../components/EmptyState'
import {
  BTN,
  BTN_DANGER,
  BTN_SMALL,
  DISPLAY,
  MONO,
  MUTED,
  PANEL,
  PLATE,
  SKIN,
} from './styles'

type Tab = 'tags' | 'caps' | 'prestige'

const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'tags', label: 'Tags', icon: IconTag },
  { id: 'caps', label: 'Caps', icon: IconFlask },
  { id: 'prestige', label: 'Prestige', icon: IconTrophy },
]

/** Scrollable tab body (was .tab-body). */
const TAB_BODY = 'min-h-0 flex-1 overflow-y-auto p-3.5'

/** Tag search / filter input — shell glass tokens (was .custom-tag-input). */
const TAG_INPUT =
  'min-w-0 flex-1 rounded-lg border border-border-glass bg-retro-bg px-2.5 py-1.5 text-[13px] text-retro-fg outline-none placeholder:text-retro-muted focus:border-retro-accent disabled:opacity-50 [@media(pointer:coarse)]:text-[16px]'

function TagsTab() {
  const tags = useGame((s) => s.tags)
  const gc = useGame((s) => s.gc)
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
    <div className={TAB_BODY}>
      <div className="mb-2.5 flex items-center justify-between gap-2.5">
        <span className={MUTED}>
          Pills steer the feed — buy the picture types you want, toggle owned pills ON/OFF.
          New tags drop from drained foes. {owned} owned.
        </span>
        <button
          type="button"
          className={`${BTN} ${BTN_SMALL} flex-none`}
          disabled={fetching}
          onClick={() => void refreshTagMarket()}
        >
          <IconRefresh size={12} /> {fetching ? 'Parsing…' : 'Refresh'}
        </button>
      </div>
      <div className="mb-2.5 flex items-center gap-2.5">
        <input
          className={TAG_INPUT}
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
        <button
          type="button"
          className={`${BTN} ${BTN_SMALL} flex-none`}
          disabled={fetching || !custom.trim()}
          onClick={submitCustom}
        >
          Add
        </button>
      </div>
      {note && <div className={`${MUTED} -mt-1 mb-2.5`}>{note}</div>}
      {/* Market refresh: shell skeleton pills while the fetch is in flight. */}
      {fetching && (
        <div className="mb-2.5 flex gap-2" role="status" aria-label="Refreshing tag market">
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      )}
      {tags.length === 0 && !fetching && (
        <EmptyState
          icon="🏷️"
          title="Tag market is empty"
          description="Hit Refresh to pull fresh pills from the boorus."
        />
      )}
      {(() => {
        const ownedTags = tags.filter((t) => t.level > 0)
        const marketTags = tags.filter((t) => t.level <= 0)
        const renderPill = (t: (typeof tags)[number]) => {
          const isOwned = t.level > 0
          const on = isOwned && t.selected !== false
          const maxed = t.level >= MAX_TAG_LEVEL
          const cost = tagCost(t.base, t.level)
          const afford = !maxed && gc >= cost
          return (
            <div
              key={t.name}
              className={`flex max-w-full items-stretch overflow-hidden rounded-full border shadow-sm transition-[transform,box-shadow] duration-75 active:translate-y-px ${
                on
                  ? 'border-white/50 bg-retro-accent'
                  : 'border-border-glass bg-surface-elevated'
              } ${afford ? 'animate-[gg-pulse_1.6s_ease-in-out_infinite]' : ''}`}
            >
              <button
                type="button"
                className="flex min-w-0 cursor-pointer flex-col gap-px border-0 bg-transparent px-3 py-1.5 text-left text-retro-fg disabled:cursor-not-allowed disabled:opacity-45"
                disabled={isOwned ? false : !afford}
                onClick={() => (isOwned ? toggleTag(t.name) : buyTag(t.name))}
                title={
                  isOwned
                    ? `${t.name} — click to switch ${on ? 'OFF' : 'ON'} in the feed`
                    : `Buy ${t.name} for ${formatNum(cost)} g$`
                }
              >
                <span
                  className={`${DISPLAY} truncate text-xs font-bold ${on ? 'text-retro-accent-text' : ''}`}
                >
                  {t.name}
                </span>
                <span
                  className={`${MONO} whitespace-nowrap text-[10px] ${on ? 'text-retro-accent-text' : 'text-retro-muted'}`}
                >
                  Lv {t.level} · +{formatNum(t.income)}/s ·{' '}
                  {isOwned ? (on ? 'ON' : 'OFF') : `${formatNum(cost)} g$`}
                </span>
              </button>
              {isOwned && (
                <button
                  type="button"
                  className={`${MONO} cursor-pointer border-0 border-l border-black/50 bg-black/25 px-2.5 text-[10px] text-retro-fg enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-45 ${on ? 'text-retro-accent-text' : ''}`}
                  onClick={() => soloTag(t.name)}
                  title={`Solo ${t.name} — feed ONLY this tag`}
                >
                  SOLO
                </button>
              )}
              {isOwned && !maxed && (
                <button
                  type="button"
                  className={`${MONO} cursor-pointer border-0 border-l border-black/50 bg-black/25 px-2.5 text-[10px] text-retro-fg enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-45 ${on ? 'text-retro-accent-text' : ''}`}
                  disabled={!afford}
                  onClick={() => buyTag(t.name)}
                  title={`Level up ${t.name} — ${formatNum(cost)} g$`}
                >
                  +{formatNum(cost)}
                </button>
              )}
              {maxed && (
                <span className={`${MONO} self-center py-0 pl-2 pr-3 text-[10px] font-bold text-[#ffd75e]`}>
                  MAX
                </span>
              )}
            </div>
          )
        }
        return (
          <div className="space-y-3">
            {ownedTags.length > 0 && (
              <section aria-label="Owned tags">
                <h4 className={`${MONO} mb-1.5 text-[10px] font-bold uppercase tracking-wider text-retro-muted`}>
                  Owned — steer the feed
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {ownedTags.map(renderPill)}
                </div>
              </section>
            )}
            {marketTags.length > 0 && (
              <section aria-label="Tag market">
                <h4 className={`${MONO} mb-1.5 text-[10px] font-bold uppercase tracking-wider text-retro-muted`}>
                  Market — buy to earn
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {marketTags.map(renderPill)}
                </div>
              </section>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function CapsTab() {
  const gc = useGame((s) => s.gc)
  const caps = useGame((s) => s.caps)
  const popCap = useGame((s) => s.popCap)
  const now = Date.now()
  return (
    <div className={TAB_BODY}>
      <p className={`${MUTED} m-0 mb-3.5`}>
        GoonCap vending machine. Pops are permanent — every pop stacks forever, repeats compound.
      </p>
      <div className="flex flex-col gap-2">
        {(Object.keys(CAPS) as CapId[]).map((id) => {
          const def = CAPS[id]
          const afford = gc >= def.cost
          const st = capStacks(caps, id, now)
          return (
            <div
              key={id}
              className={`${SKIN} flex items-center justify-between gap-2.5 rounded-[10px] border border-border-glass bg-surface-elevated p-2.5 shadow-sm ${
                afford ? 'animate-[gg-pulse_1.6s_ease-in-out_infinite]' : ''
              }`}
              style={{
                backgroundImage: `linear-gradient(rgba(5,5,12,0.78), rgba(5,5,12,0.78)), url("${CAP_SKINS[id]}")`,
              }}
            >
              <div>
                <div className={`${DISPLAY} text-[11px] font-bold tracking-[0.5px]`}>
                  {def.name}
                  {st.count > 0 && <span className={MONO}> x{st.count}</span>}
                </div>
                <div className={MUTED}>
                  {capEffectLabel(id)} · permanent
                  {st.count > 0 && ` · x${st.count} stacked`}
                </div>
              </div>
              <button
                type="button"
                className={`${BTN} ${BTN_SMALL} flex-none`}
                disabled={!afford}
                onClick={() => popCap(id)}
              >
                {formatNum(def.cost)} g$
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
  const totalEarnedGc = useGame((s) => s.totalEarnedGc)
  const shards = useGame((s) => s.shards)
  const achievements = useGame((s) => s.achievements)
  const brainmelt = useGame((s) => s.brainmelt)
  const tier = tierForXp(xp)
  const ready = canBrainmelt(tier)
  const preview = shardsFromEarned(totalEarnedGc)
  return (
    <div className={TAB_BODY}>
      <div className="mb-3.5 rounded-[10px] border border-border-glass bg-retro-bg p-3">
        <p className={`${MUTED} m-0`}>
          Brainmelt burns the run for <b>Corruption shards</b> — each one is a permanent +10%
          global multiplier.
        </p>
        <ul className="my-2 list-none text-xs">
          <li className="text-retro-error">Resets: g$, XP/tier, tags, caps</li>
          <li className="text-retro-online">Keeps: gallery, shards, achievements</li>
        </ul>
        <div className={`${MONO} mb-2.5 mt-2 text-[13px] text-[#ffd75e]`}>
          +{preview} shards on melt · held: {shards}
        </div>
        <button
          type="button"
          className={`${BTN} ${BTN_DANGER}`}
          disabled={!ready}
          onClick={brainmelt}
        >
          {ready ? 'BRAINMELT' : `Unlocks at tier ${PRESTIGE_MIN_TIER} (you: ${tier})`}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {ACHIEVEMENTS.map((a) => {
          const got = achievements.includes(a.id)
          return (
            <div
              key={a.id}
              className={`flex items-center gap-1.5 rounded-lg border bg-retro-bg p-2 text-[11px] ${
                got ? 'border-[rgba(255,215,94,0.5)] text-[#ffd75e]' : 'border-border-subtle text-retro-muted'
              }`}
              title={got ? 'Unlocked' : 'Locked'}
            >
              {a.name}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ShopPanel() {
  const [tab, setTab] = useState<Tab>('tags')
  return (
    <aside className={`${PLATE} ${PANEL} flex flex-col overflow-hidden p-0`}>
      <nav className="grid flex-none grid-cols-3 gap-1.5 border-b border-border-glass bg-retro-bg p-3">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`glass-tab ${DISPLAY} flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-0.5 py-2 text-xs font-semibold tracking-[0.5px] ${
                tab === t.id ? 'glass-tab-active' : ''
              }`}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} />
              <span className="truncate">{t.label}</span>
            </button>
          )
        })}
      </nav>
      {tab === 'tags' && <TagsTab />}
      {tab === 'caps' && <CapsTab />}
      {tab === 'prestige' && <PrestigeTab />}
    </aside>
  )
}
