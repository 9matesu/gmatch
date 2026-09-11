import { useState, type ReactNode } from 'react'
import { useGame } from '../game/store'
import { MAX_TAG_LEVEL, tagCost } from '../game/tags'
import { CAPS, capEffectLabel, capStacks } from '../game/caps'
import type { CapId } from '../game/types'
import { IconRefresh, IconChevronR } from './icons'
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
  PANEL,
  PLATE,
  SKIN,
} from './styles'

/** Tab body content (stacked under fold headers; outer column scrolls). */
const TAB_BODY = 'space-y-2.5'

const FOLD_KEY = 'gmatch.shop.folded.v1'

function loadFolded(): Record<string, boolean> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(FOLD_KEY)
    if (!raw) return {}
    const d = JSON.parse(raw) as unknown
    if (typeof d === 'object' && d !== null) return d as Record<string, boolean>
  } catch {
    /* corrupt — start expanded */
  }
  return {}
}

/** Collapsible section (persisted): header toggles, body hides. */
function FoldSection({ id, title, count, wrap = true, children }: { id: string; title: string; count?: number; wrap?: boolean; children: ReactNode }) {
  const [foldedMap, setFoldedMap] = useState<Record<string, boolean>>(loadFolded)
  const folded = foldedMap[id] === true
  const toggle = () => {
    setFoldedMap((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(FOLD_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }
  return (
    <section aria-label={title} className={folded ? '' : 'border-b border-border-glass pb-3 last:border-0'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!folded}
        aria-label={`${folded ? 'Expand' : 'Collapse'} ${title}`}
        className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
      >
        <span className={`inline-block transition-transform ${folded ? '' : 'rotate-90'}`}>
          <IconChevronR size={11} />
        </span>
        <h4 className={`${MONO} m-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-retro-muted`}>
          {title}
          {typeof count === 'number' ? ` (${count})` : ''}
        </h4>
      </button>
      {!folded && (wrap ? <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div> : <div className="mt-1.5">{children}</div>)}
    </section>
  )
}

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
  const [drawerOpen, setDrawerOpen] = useState(false)

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
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-retro-muted">
          Feed Tags ({owned})
        </span>
        <button
          type="button"
          className={`${BTN} ${BTN_SMALL} !py-0.5 !px-2 text-[10px]`}
          onClick={() => setDrawerOpen((v) => !v)}
          title="Open tag search & booru market drawer"
        >
          {drawerOpen ? 'Close Search' : '+ Market / Search'}
        </button>
      </div>

      {drawerOpen && (
        <div className="space-y-2 rounded-xl border border-border-glass bg-surface-elevated p-2 shadow-inner">
          <div className="flex items-center gap-1.5">
            <input
              className={`${TAG_INPUT} !py-1 text-xs`}
              value={custom}
              disabled={fetching}
              placeholder="Add tag (e.g. milf, bbc)…"
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
              className={`${BTN} ${BTN_SMALL} !py-1 flex-none text-xs`}
              disabled={fetching || !custom.trim()}
              onClick={submitCustom}
            >
              Add
            </button>
            <button
              type="button"
              className={`${BTN} ${BTN_SMALL} !py-1 flex-none text-xs`}
              disabled={fetching}
              onClick={() => void refreshTagMarket()}
              title="Refresh market offers"
            >
              <IconRefresh size={11} />
            </button>
          </div>
          {note && <div className={`${MUTED} text-[11px]`}>{note}</div>}
        </div>
      )}

      {/* Market refresh skeleton */}
      {fetching && (
        <div className="flex gap-1.5" role="status" aria-label="Refreshing tag market">
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
        </div>
      )}

      {(() => {
        const ownedTags = tags.filter((t) => t.level > 0)
        const marketTags = tags.filter((t) => t.level <= 0)

        const renderLittlePill = (t: (typeof tags)[number]) => {
          const isOwned = t.level > 0
          const on = isOwned && t.selected !== false
          const maxed = t.level >= MAX_TAG_LEVEL
          const cost = tagCost(t.base, t.level)
          const afford = !maxed && gc >= cost
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => (isOwned ? toggleTag(t.name) : buyTag(t.name))}
              title={
                isOwned
                  ? `${t.name} · Lv${t.level} · +${formatNum(t.income)}/s · click ${on ? 'OFF' : 'ON'} · shift-click = solo`
                  : `${t.name} · buy for ${formatNum(cost)} g$`
              }
              onAuxClick={(e) => {
                if (e.button === 1 && isOwned) {
                  e.preventDefault()
                  soloTag(t.name)
                }
              }}
              className={`inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight transition-colors ${on
                ? 'border-retro-accent/50 bg-surface-interactive text-retro-fg'
                : isOwned
                  ? 'border-border-subtle bg-surface-raised text-retro-muted hover:text-retro-fg hover:border-border-strong'
                  : 'border-border-dashed bg-transparent text-retro-muted hover:text-retro-fg hover:border-retro-accent/50'
                } ${!isOwned && !afford ? 'opacity-50' : ''}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${on
                  ? 'bg-retro-online'
                  : isOwned
                    ? 'bg-zinc-600'
                    : afford
                      ? 'bg-retro-accent'
                      : 'bg-zinc-700'
                  }`}
                aria-hidden="true"
              />
              <span className="truncate font-medium">{t.name}</span>
            </button>
          )
        }

        return (
          <div className="space-y-2">
            {ownedTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {ownedTags.map(renderLittlePill)}
              </div>
            )}
            {drawerOpen && marketTags.length > 0 && (
              <FoldSection id="market" title="Market Offers" count={marketTags.length} wrap={false}>
                <div className="flex flex-wrap gap-1 pt-1">
                  {marketTags.map(renderLittlePill)}
                </div>
              </FoldSection>
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
  return (
    <aside className={`${PLATE} ${PANEL} flex flex-col gap-3`}>
      <FoldSection id="shop-tags" title="Tags" wrap={false}>
        <TagsTab />
      </FoldSection>
      <FoldSection id="shop-caps" title="Caps" wrap={false}>
        <CapsTab />
      </FoldSection>
      <FoldSection id="shop-prestige" title="Prestige" wrap={false}>
        <PrestigeTab />
      </FoldSection>
    </aside>
  )
}
