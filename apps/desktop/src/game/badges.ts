import type { PlayerStats } from './playerStats'
import { ALL_CAP_IDS } from './caps'

/** Badge grouping for the shelf. */
export type BadgeCategory = 'clicking' | 'collection' | 'prestige' | 'shards' | 'combat'

/** Badge tier, mapped to the shared `RARITY` text tokens in the UI. */
export type BadgeRarity = 'common' | 'copper' | 'silver' | 'gold' | 'diamond'

export interface BadgeDef {
  id: string
  name: string
  description: string
  category: BadgeCategory
  rarity: BadgeRarity
  /** True when the player has already reached the milestone. */
  check: (s: PlayerStats) => boolean
}

/**
 * One badge from a metric + target, so the threshold lives in exactly one
 * place.
 */
function badge(
  id: string,
  name: string,
  description: string,
  category: BadgeCategory,
  rarity: BadgeRarity,
  value: (s: PlayerStats) => number,
  target: number,
): BadgeDef {
  return {
    id,
    name,
    description,
    category,
    rarity,
    check: (s) => value(s) >= target,
  }
}

/**
 * Cosmetic, permanent milestones that go BEYOND the 12 power-granting
 * achievements (SPEC §10). Names and thresholds are deliberately distinct from
 * the achievement set, so the shelf complements it instead of shadowing it.
 * Every metric is lifetime (see `playerStats.ts`), so a badge never relocks.
 */
export const BADGES: readonly BadgeDef[] = [
  // Clicking
  badge('clicks_1000', 'Thousand Clicks', 'Clicked 1,000 times', 'clicking', 'copper', (s) => s.clicks, 1_000),
  badge('clicks_10000', 'Grinder', 'Clicked 10,000 times', 'clicking', 'silver', (s) => s.clicks, 10_000),
  badge('clicks_100000', 'Click Machine', 'Clicked 100,000 times', 'clicking', 'gold', (s) => s.clicks, 100_000),
  badge('crit_100', 'Critical Mass', 'Landed 100 crits', 'clicking', 'copper', (s) => s.crits, 100),
  badge('crit_500', 'Crit Machine', 'Landed 500 crits', 'clicking', 'gold', (s) => s.crits, 500),

  // Collection
  badge('gallery_50', 'Gallery Curator', 'Saved 50 keepsakes', 'collection', 'copper', (s) => s.gallerySaved, 50),
  badge('gallery_100', 'Gallery Master', 'Saved 100 keepsakes', 'collection', 'gold', (s) => s.gallerySaved, 100),
  badge('caps_all', 'Cap Collector', 'Used every GoonCap', 'collection', 'silver', (s) => s.capsUsed, ALL_CAP_IDS.length),
  badge('tags_bought_50', 'Tag Investor', 'Bought 50 tag levels', 'collection', 'copper', (s) => s.tagPurchases, 50),
  badge('tags_bought_200', 'Tag Patron', 'Bought 200 tag levels', 'collection', 'gold', (s) => s.tagPurchases, 200),

  // Prestige
  badge('prestige_5', 'Serial Melter', 'Brainmelted 5 times', 'prestige', 'silver', (s) => s.prestigeCount, 5),
  badge('prestige_10', 'Eternal Melter', 'Brainmelted 10 times', 'prestige', 'diamond', (s) => s.prestigeCount, 10),

  // Shard economy
  badge('shards_50', 'Shard Tycoon', 'Earned 50 Corruption shards', 'shards', 'silver', (s) => s.totalShardsEarned, 50),
  badge('shards_100', 'Shard Emperor', 'Earned 100 Corruption shards', 'shards', 'gold', (s) => s.totalShardsEarned, 100),
  badge('idle_shards_10', 'Patient Accumulator', 'Banked 10 idle shards', 'shards', 'copper', (s) => s.idleShardsEarned, 10),

  // Combat
  badge('kos_100', 'Veteran Slayer', 'Defeated 100 foes', 'combat', 'copper', (s) => s.kOs, 100),
  badge('kos_1000', 'Legendary Slayer', 'Defeated 1,000 foes', 'combat', 'diamond', (s) => s.kOs, 1_000),
  badge('heat_50', 'Heat Addict', 'Reached a 50-click heat streak', 'combat', 'silver', (s) => s.maxHeatStreak, 50),
]

/** Badges the player has earned. */
export function getUnlockedBadges(stats: PlayerStats): readonly BadgeDef[] {
  return BADGES.filter((b) => b.check(stats))
}

/** Badges still to earn. */
export function getLockedBadges(stats: PlayerStats): readonly BadgeDef[] {
  return BADGES.filter((b) => !b.check(stats))
}
