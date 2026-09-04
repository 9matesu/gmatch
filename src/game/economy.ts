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

/** GP gained by click #clickNumber (applies x10 crit). */
export function clickGain(input: EconomyInput, clickNumber: number, now: number): number {
  return clickPower(input, now) * (isCrit(clickNumber) ? CRIT_MULT : 1)
}

export function tagIncome(tags: OwnedTag[]): number {
  return tags.reduce((sum, t) => sum + t.income * t.level, 0)
}

export function galleryIncome(gallery: GalleryImage[]): number {
  return gallery.reduce((sum, img) => sum + rarityIncome(img.rarity), 0)
}

/** Passive GP/s from tags + gallery, scaled by shards and passive caps. */
export function passiveGps(input: EconomyInput, now: number): number {
  return (
    (tagIncome(input.tags) + galleryIncome(input.gallery)) *
    shardMultiplier(input.shards) *
    capPassiveMult(input.caps, now)
  )
}
