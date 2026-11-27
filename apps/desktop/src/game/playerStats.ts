import { useShallow } from 'zustand/react/shallow'
import { useGame } from './store'
import type { GameState } from './store'

/**
 * Player statistics for the badge shelf.
 *
 * These are DERIVED, on read, from the single persisted run state
 * (`gmatch.save.v1` via the game store). There is deliberately no second
 * ledger: an earlier attempt kept its own `gmatch.playerStats.v1` copy that
 * nothing ever updated, so every number stayed zero.
 *
 * Every field here is LIFETIME — it survives a Brainmelt. A badge must not
 * relock, and Brainmelt resets points, totalEarned, XP and tags, so run-scoped
 * metrics are deliberately absent (as are session time and picture-cache
 * views, which nothing records). "Lifetime" also means it never goes DOWN: the
 * spendable `shards` balance and the deletable `gallery.length` are projections
 * of the dedicated `totalShardsEarned` / `totalGallerySaved` counters, so a
 * redemption or a deletion can never take a badge back.
 */
export interface PlayerStats {
  clicks: number
  crits: number
  /** Lifetime keepsakes ever saved (never drops when a keep is deleted). */
  gallerySaved: number
  /** Distinct GoonCaps used (max = ALL_CAP_IDS.length); survives Brainmelt. */
  capsUsed: number
  /** Lifetime tag-level purchases. */
  tagPurchases: number
  prestigeCount: number
  /** Lifetime shards ever earned (never drops when shards are spent). */
  totalShardsEarned: number
  idleShardsEarned: number
  /** Lifetime foes defeated. */
  kOs: number
  maxHeatStreak: number
}

/** Pure projection of the game store into badge-facing stats. */
export function playerStatsFromGame(s: GameState): PlayerStats {
  return {
    clicks: s.clicks,
    crits: s.crits,
    gallerySaved: s.totalGallerySaved,
    capsUsed: s.capsUsed.length,
    tagPurchases: s.purchases,
    prestigeCount: s.prestigeCount,
    totalShardsEarned: s.totalShardsEarned,
    idleShardsEarned: s.idleShardsEarned,
    kOs: s.defeated,
    maxHeatStreak: s.maxHeatStreak,
  }
}

/**
 * Live stats for the shelf. `useShallow` keeps the derived object referentially
 * stable, so an unrelated store write (a toast, a fetch flag, heat ticking)
 * does not re-render the shelf.
 */
export function usePlayerStats(): PlayerStats {
  return useGame(useShallow(playerStatsFromGame))
}
