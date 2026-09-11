import { achievementClickMult } from './achievements'
import { capClickMult, capPassiveMult } from './caps'
import { rarityIncome } from './rarity'
import type { ActiveCap, GalleryImage, OwnedTag } from './types'

export const BASE_CLICK = 1
export const CRIT_EVERY = 25
export const CRIT_MULT = 10
export const SHARD_MULT = 0.1

/** Every 25th click is a CRIT (SPEC §1). clickNumber is 1-based. */
export function isCrit(clickNumber: number): boolean {
  return clickNumber > 0 && clickNumber % CRIT_EVERY === 0
}

/** Each Corruption shard = +10% global multiplier (SPEC §9). */
export function shardMultiplier(shards: number): number {
  return 1 + SHARD_MULT * shards
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

/** g$ gained by click #clickNumber (applies x10 crit and the heat combo). */
export function clickGain(input: EconomyInput, clickNumber: number, now: number, heatStreak = 0): number {
  return clickPower(input, now) * (isCrit(clickNumber) ? CRIT_MULT : 1) * heatMultiplier(heatStreak)
}

export function tagIncome(tags: OwnedTag[]): number {
  return tags.reduce((sum, t) => sum + t.income * t.level, 0)
}

export function galleryIncome(gallery: GalleryImage[]): number {
  return gallery.reduce((sum, img) => sum + rarityIncome(img.rarity), 0)
}

/** Passive g$/s from tags + gallery, scaled by shards and passive caps. Nerfed to 25% so clicking stays king. */
export function passiveGps(input: EconomyInput, now: number): number {
  return (
    (tagIncome(input.tags) + galleryIncome(input.gallery)) *
    shardMultiplier(input.shards) *
    capPassiveMult(input.caps, now) *
    0.25
  )
}

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