import type { ActiveCap, GalleryImage, OwnedTag } from './types'

export const PRESTIGE_MIN_TIER = 5
export const SHARD_DIVISOR = 1e6

/** Pornification ladder; index+1 = tier (SPEC §9). Tier 5+ unlocks Brainmelt. */
export const TITLES: readonly string[] = [
  'Curious',
  'Flustered',
  'Kinky',
  'Pervert',
  'Degenerate',
  'Goon',
  'Addict',
  'Deviant',
  'Sinlord',
  'Brainmelt God',
]

/** Simple XP curve: tier n reached at (n-1)^2 * 100 XP. */
export function tierForXp(xp: number): number {
  return Math.min(TITLES.length, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1)
}

/** Inverse of tierForXp: XP needed to reach `tier`. */
export function xpForTier(tier: number): number {
  return Math.pow(Math.max(1, tier) - 1, 2) * 100
}

export function titleForTier(tier: number): string {
  return TITLES[Math.min(Math.max(1, tier), TITLES.length) - 1]
}

/** Shards = floor(sqrt(totalEarnedGc / 1e6)) (SPEC §9). */
export function shardsFromEarned(totalEarnedGc: number): number {
  return Math.floor(Math.sqrt(Math.max(0, totalEarnedGc) / SHARD_DIVISOR))
}

export function canBrainmelt(tier: number): boolean {
  return tier >= PRESTIGE_MIN_TIER
}

export interface PrestigeState {
  gc: number
  totalEarnedGc: number
  xp: number
  tags: OwnedTag[]
  caps: ActiveCap[]
  gallery: GalleryImage[]
  shards: number
  achievements: string[]
  prestigeCount: number
}

export interface BrainmeltResult extends PrestigeState {
  shardsGained: number
}

/**
 * Brainmelt (SPEC §9): resets g$/XP/tags/caps; keeps gallery, shards,
 * achievements. Returns the new run state.
 */
export function applyBrainmelt(state: PrestigeState): BrainmeltResult {
  const shardsGained = shardsFromEarned(state.totalEarnedGc)
  return {
    ...state,
    gc: 0,
    totalEarnedGc: 0,
    xp: 0,
    tags: [],
    caps: [],
    shards: state.shards + shardsGained,
    prestigeCount: state.prestigeCount + 1,
    shardsGained,
  }
}
