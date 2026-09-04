import type { OwnedTag } from './types'
import { isNoise, isQueryBlocked, rankTags } from './tagFilter'

/**
 * Custom feed tags (user spec): free-form search → normalize → validity
 * gate → probe the live feed before adding.
 * Normalization: lowercase, spaces/dashes → underscores, [a-z0-9_] only.
 */
export function normalizeCustomTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

export type CustomTagVerdict =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-short' | 'too-long' | 'blocked' | 'noise' }

/** Validity gate for a custom tag — blocklist + noise, never the network. */
export function validateCustomTag(raw: string): CustomTagVerdict {
  const name = normalizeCustomTag(raw)
  if (!name) return { ok: false, reason: 'empty' }
  if (name.length < 2) return { ok: false, reason: 'too-short' }
  if (name.length > 40) return { ok: false, reason: 'too-long' }
  if (isQueryBlocked(name)) return { ok: false, reason: 'blocked' }
  if (isNoise(name)) return { ok: false, reason: 'noise' }
  return { ok: true, name }
}

export const MAX_TAG_LEVEL = 20
export const TAG_COST_GROWTH = 1.15
/** Unowned market offers shown at once — owned tags are always kept. */
export const MAX_MARKET_OFFERS = 24

export interface TagStats {
  base: number
  income: number
  weight: number
}

/**
 * Tag stat derivation (SPEC §3): base/income derived from tag length +
 * frequency — rarer tag = pricier = better.
 */
export function deriveTagStats(name: string, frequency: number): TagStats {
  const freq = Math.max(1, frequency)
  const rarityFactor = 1 + 20 / freq
  const base = Math.ceil((name.length + 2) * rarityFactor)
  const income = Math.max(1, Math.round(base * 0.05))
  const weight = Math.max(1, Math.round(Math.sqrt(income)))
  return { base, income, weight }
}

/** Pervert starter tags so the market is never empty (user spec: no vanilla). */
export const STARTER_TAGS: readonly string[] = [
  'gangbang',
  'creampie',
  'ahegao',
  'pregnant',
  'veiny_penis',
  'bulge',
  'deepthroat',
  'anal',
  'bbc',
  'skylar_vox',
]

/** cost = base * 1.15^owned (SPEC §3). */
export function tagCost(base: number, owned: number): number {
  return Math.ceil(base * Math.pow(TAG_COST_GROWTH, owned))
}

export function canBuyTag(tag: OwnedTag): boolean {
  return tag.level < MAX_TAG_LEVEL
}

/** Buy one level of a tag; returns a new tag or null if maxed/unaffordable. Buying selects it for the feed. */
export function buyTag(tag: OwnedTag, gp: number): { tag: OwnedTag; gp: number } | null {
  if (!canBuyTag(tag)) return null
  const cost = tagCost(tag.base, tag.level)
  if (gp < cost) return null
  return { tag: { ...tag, level: tag.level + 1, selected: true }, gp: gp - cost }
}

/** Toggle feed selection on an owned tag; null when unowned. */
export function toggleTag(tag: OwnedTag): OwnedTag | null {
  if (tag.level <= 0) return null
  return { ...tag, selected: !(tag.selected !== false) }
}

/**
 * Solo one owned tag: only `name` stays selected, every other owned tag goes
 * OFF. Returns null when the target is missing/unowned.
 */
export function soloTag(tags: OwnedTag[], name: string): OwnedTag[] | null {
  const target = tags.find((t) => t.name === name)
  if (!target || target.level <= 0) return null
  return tags.map((t) =>
    t.level > 0 ? { ...t, selected: t.name === name } : t,
  )
}

/** A tag feeds the round-robin only when owned AND selected. */
export function isTagSelected(tag: OwnedTag): boolean {
  return tag.level > 0 && tag.selected !== false
}

/** Market offers seeded from the evergreen starter tags. */
export function starterOffers(): OwnedTag[] {
  return STARTER_TAGS.map((name) => ({
    name,
    level: 0,
    selected: false,
    ...deriveTagStats(name, STARTER_TAGS.length),
  }))
}

/**
 * Discover new market offers from a drained foe's tags (auto-generated as
 * you progress — pay GP to buy the picture types you want). Blocklist/noise
 * filtered via rankTags; owned levels + selection preserved; unowned offers
 * capped, owned tags always kept.
 */
export function discoverTags(existing: OwnedTag[], postTags: string[]): OwnedTag[] {
  const have = new Set(existing.map((t) => t.name.toLowerCase()))
  const fresh: OwnedTag[] = []
  for (const { name, frequency } of rankTags(postTags)) {
    if (have.has(name.toLowerCase())) continue
    have.add(name.toLowerCase())
    fresh.push({ name, level: 0, selected: false, ...deriveTagStats(name, frequency) })
  }
  if (fresh.length === 0) return existing
  const owned = existing.filter((t) => t.level > 0)
  const offers = [...existing.filter((t) => t.level === 0), ...fresh].slice(0, MAX_MARKET_OFFERS)
  return [...offers, ...owned]
}

/** Feed query = SELECTED owned tags, top 5 by level (SPEC §3). */
export function feedQuery(tags: OwnedTag[], limit = 5): string[] {
  return [...tags]
    .filter(isTagSelected)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((t) => t.name)
}
