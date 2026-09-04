import type { CapId } from './types'

/** Stats snapshot used to evaluate achievement conditions. */
export interface AchievementStats {
  clicks: number
  crits: number
  tagsOwned: number
  galleryOwned: number
  hasDiamond: boolean
  capsUsed: CapId[]
  prestiges: number
  shards: number
  tier: number
  collectedOfflineEarnings: boolean
}

export interface AchievementDef {
  id: string
  name: string
  check: (s: AchievementStats) => boolean
}

/** 12 achievements (SPEC §10). Each +5% click power. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_click', name: 'First Click', check: (s) => s.clicks >= 1 },
  { id: 'clicks_100', name: '100 Clicks', check: (s) => s.clicks >= 100 },
  { id: 'first_tag', name: 'First Tag', check: (s) => s.tagsOwned >= 1 },
  { id: 'tag_collector', name: 'Tag Collector', check: (s) => s.tagsOwned >= 10 },
  { id: 'gallery_of_sins', name: 'Gallery of Sins', check: (s) => s.galleryOwned >= 10 },
  { id: 'diamond_hands', name: 'Diamond Hands', check: (s) => s.hasDiamond },
  { id: 'crit_addict', name: 'Crit Addict', check: (s) => s.crits >= 50 },
  {
    id: 'cap_connoisseur',
    name: 'Cap Connoisseur',
    check: (s) => (['blue', 'filter', 'hypno', 'melt'] as CapId[]).every((c) => s.capsUsed.includes(c)),
  },
  { id: 'first_brainmelt', name: 'First Brainmelt', check: (s) => s.prestiges >= 1 },
  { id: 'ten_shards', name: '10 Shards', check: (s) => s.shards >= 10 },
  { id: 'goon_master', name: 'Goon Master', check: (s) => s.tier >= 10 },
  {
    id: 'offline_slut',
    name: 'Offline Slut',
    check: (s) => s.collectedOfflineEarnings,
  },
]

export const ACHIEVEMENT_CLICK_BONUS = 0.05

/** Ids newly earned given current stats and already-earned ids. */
export function newlyEarned(earned: readonly string[], stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((a) => !earned.includes(a.id) && a.check(stats)).map((a) => a.id)
}

/** +5% click power per earned achievement (SPEC §10). */
export function achievementClickMult(earnedCount: number): number {
  return 1 + ACHIEVEMENT_CLICK_BONUS * earnedCount
}
