import { achievementClickMult } from './achievements'
import { capClickMult } from './caps'
import type { ActiveCap, GalleryImage, OwnedTag } from './types'

export const BASE_CLICK = 1
export const CRIT_EVERY = 25
export const CRIT_MULT = 10
export const SHARD_MULT = 0.1

/** Every 25th click is a CRIT (SPEC §1). clickNumber is 1-based. */
export function isCrit(clickNumber: number): boolean {
  return clickNumber > 0 && clickNumber % CRIT_EVERY === 0
}

/**
 * Global price inflation: every tag purchase nudges ALL future tag prices.
 * This is the anti-runaway lever — buying more can never make the market
 * cheaper, no matter how many pts a run has banked.
 */
export const INFLATION_PER_PURCHASE = 0.02
export function inflationMultiplier(purchases: number): number {
  return 1 + INFLATION_PER_PURCHASE * (Number.isFinite(purchases) ? Math.max(0, purchases) : 0)
}

/** SPEC §9: each shard is +10%, linear — progression is tuned by inflation/costs. */
export function shardMultiplier(shards: number): number {
  const n = Number.isFinite(shards) ? Math.max(0, shards) : 0
  return 1 + SHARD_MULT * n
}

/**
 * Idle shards: slow, bounded and earned only while the game is open. The
 * session/lifetime cap keeps even a week-long open window far below the
 * 1000-shards-per-g$ redemption rate; the server caps it again on redeem.
 */
export const IDLE_SHARD_INTERVAL_MS = 5 * 60_000
export const IDLE_SHARD_LIFETIME_CAP = 100
export function idleShardAccrual(
  dtMs: number,
  carryMs: number,
  banked: number,
): { shards: number; carryMs: number } {
  const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0
  const carry = Number.isFinite(carryMs) ? Math.max(0, carryMs) : 0
  const room = Math.max(0, IDLE_SHARD_LIFETIME_CAP - (Number.isFinite(banked) ? Math.max(0, banked) : 0))
  const raw = carry + dt
  const shards = Math.min(room, Math.floor(raw / IDLE_SHARD_INTERVAL_MS))
  return { shards, carryMs: Math.min(raw - shards * IDLE_SHARD_INTERVAL_MS, IDLE_SHARD_INTERVAL_MS - 1) }
}

/** A drained foe pays a shard burst every N wins — faster than idle, but slow. */
export const KO_SHARDS_EVERY = 5
export function koShards(defeatedAfter: number, defeatedBefore = Math.max(0, defeatedAfter - 1)): number {
  return Math.max(
    0,
    Math.floor(Math.max(0, defeatedAfter) / KO_SHARDS_EVERY) -
      Math.floor(Math.max(0, defeatedBefore) / KO_SHARDS_EVERY),
  )
}

export interface EconomyInput {
  shards: number
  achievementsEarned: number
  tags: OwnedTag[]
  gallery: GalleryImage[]
  caps: ActiveCap[]
}

export function clickPower(input: EconomyInput, now: number): number {
  return (
    BASE_CLICK *
    shardMultiplier(input.shards) *
    achievementClickMult(input.achievementsEarned) *
    capClickMult(input.caps, now)
  )
}

/** pts gained by click #clickNumber (applies x10 crit and the heat combo). */
export function clickGain(input: EconomyInput, clickNumber: number, now: number, heatStreak = 0): number {
  return clickPower(input, now) * (isCrit(clickNumber) ? CRIT_MULT : 1) * heatMultiplier(heatStreak)
}

/**
 * The clicker is a CLICK game: points come from the player, not from a clock.
 * Passive income (tag levels, gallery keepsakes, auto-click caps, offline
 * earnings) was removed with the idle economy — the whole promise of the
 * genre is "your time is worth more than your waiting".
 */
/**
 * Heat combo (addiction hook): clicks within HEAT_WINDOW_MS of each other
 * stack heat; every HEAT_STACK clicks of streak adds +HEAT_STEP to the click
 * multiplier, capped at HEAT_MAX. Idle past the window resets to 1x. Pure —
 * the store persists only lastClickAt + heatStreak.
 */
export const HEAT_WINDOW_MS = 2_000
export const HEAT_STACK = 10
export const HEAT_STEP = 0.25
export const HEAT_MAX = 3

export function heatMultiplier(streak: number): number {
  if (streak <= 0) return 1
  return Math.min(HEAT_MAX, 1 + Math.floor(streak / HEAT_STACK) * HEAT_STEP)
}

/** Next streak given the previous click time; resets when the window lapsed. */
export function heatStreakAfter(prevStreak: number, prevClickAt: number, now: number): number {
  if (prevStreak > 0 && now - prevClickAt > HEAT_WINDOW_MS) return 1
  return prevStreak + 1
}