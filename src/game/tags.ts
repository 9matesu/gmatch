import type { OwnedTag } from './types'

export const MAX_TAG_LEVEL = 20
export const TAG_COST_GROWTH = 1.15

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

/** Evergreen starter tags so the market is never empty (SPEC §3). */
export const STARTER_TAGS: readonly string[] = [
  '1girl',
  'solo',
  'long_hair',
  'smile',
  'closed_eyes',
  'wet',
  'lingerie',
  'cosplay',
]

/** cost = base * 1.15^owned (SPEC §3). */
export function tagCost(base: number, owned: number): number {
  return Math.ceil(base * Math.pow(TAG_COST_GROWTH, owned))
}

export function canBuyTag(tag: OwnedTag): boolean {
  return tag.level < MAX_TAG_LEVEL
}

/** Buy one level of a tag; returns a new tag or null if maxed/unaffordable. */
export function buyTag(tag: OwnedTag, gp: number): { tag: OwnedTag; gp: number } | null {
  if (!canBuyTag(tag)) return null
  const cost = tagCost(tag.base, tag.level)
  if (gp < cost) return null
  return { tag: { ...tag, level: tag.level + 1 }, gp: gp - cost }
}

/** Market offers seeded from the evergreen starter tags. */
export function starterOffers(): OwnedTag[] {
  return STARTER_TAGS.map((name) => ({
    name,
    level: 0,
    ...deriveTagStats(name, STARTER_TAGS.length),
  }))
}

/** Feed query = owned tags, top 5 by level (SPEC §3). */
export function feedQuery(tags: OwnedTag[], limit = 5): string[] {
  return [...tags]
    .filter((t) => t.level > 0)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((t) => t.name)
}
