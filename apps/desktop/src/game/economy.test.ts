import { describe, expect, it } from 'vitest'
import {
  BASE_CLICK,
  CRIT_EVERY,
  clickGain,
  clickPower,
  galleryIncome,
  isCrit,
  passiveGps,
  shardMultiplier,
  tagIncome,
  type EconomyInput,
} from './economy'
import type { ActiveCap, GalleryImage, OwnedTag, Rarity } from './types'

const NOW = 1_000_000

function tag(name: string, level: number, income: number): OwnedTag {
  return { name, level, income, base: income * 20, weight: 1 }
}

function img(rarity: Rarity): GalleryImage {
  return { id: rarity, url: '', tags: [], rarityBase: 1, clicks: 0, rarity }
}

function caps(...specs: [ActiveCap['capId'], number][]): ActiveCap[] {
  return specs.map(([capId, expiresAt]) => ({ capId, expiresAt }))
}

const base: EconomyInput = {
  shards: 0,
  achievementsEarned: 0,
  tags: [],
  gallery: [],
  caps: [],
}

describe('crits (SPEC §1)', () => {
  it('every 25th click is a crit', () => {
    expect(CRIT_EVERY).toBe(25)
    expect(isCrit(25)).toBe(true)
    expect(isCrit(50)).toBe(true)
    expect(isCrit(1)).toBe(false)
    expect(isCrit(24)).toBe(false)
    expect(isCrit(26)).toBe(false)
    expect(isCrit(0)).toBe(false)
  })

  it('crit pays x10 click power', () => {
    const input = { ...base }
    expect(clickGain(input, 24, NOW)).toBe(BASE_CLICK)
    expect(clickGain(input, 25, NOW)).toBe(BASE_CLICK * 10)
  })
})

describe('click power', () => {
  it('base click is 1 GP', () => {
    expect(clickPower(base, NOW)).toBe(1)
  })

  it('shards give +10% each, achievements +5% each', () => {
    expect(shardMultiplier(3)).toBeCloseTo(1.3)
    expect(clickPower({ ...base, shards: 3 }, NOW)).toBeCloseTo(1.3)
    expect(clickPower({ ...base, achievementsEarned: 4 }, NOW)).toBeCloseTo(1.2)
    expect(clickPower({ ...base, shards: 3, achievementsEarned: 4 }, NOW)).toBeCloseTo(1.56)
  })

  it('E-Girl Spit doubles click, Brain Drain x10, legacy timed caps prune', () => {
    expect(clickPower({ ...base, caps: caps(['blue', NOW + 1]) }, NOW)).toBe(2)
    expect(clickPower({ ...base, caps: caps(['melt', NOW + 1]) }, NOW)).toBe(10)
    expect(clickPower({ ...base, caps: caps(['blue', NOW - 1]) }, NOW)).toBe(1)
  })

  it('caps stack multiplicatively', () => {
    const input = { ...base, caps: caps(['blue', NOW + 1], ['melt', NOW + 1]) }
    expect(clickPower(input, NOW)).toBe(20)
  })
})

describe('passive GP/s (SPEC §3/§4)', () => {
  it('tags pay income * level', () => {
    expect(tagIncome([tag('wet', 3, 2), tag('solo', 1, 5)])).toBe(11)
  })

  it('gallery pays by rarity 1/3/10/30/100', () => {
    expect(galleryIncome([img('Common'), img('Copper'), img('Silver'), img('Gold'), img('Diamond')])).toBe(144)
  })

  it('passive scales with shards and Pornmeat, not with click caps', () => {
    const input: EconomyInput = {
      ...base,
      tags: [tag('wet', 2, 5)],
      gallery: [img('Gold')],
    }
    expect(passiveGps(input, NOW)).toBe(40)
    expect(passiveGps({ ...input, shards: 2 }, NOW)).toBeCloseTo(48)
    expect(passiveGps({ ...input, caps: caps(['hypno', NOW + 1]) }, NOW)).toBe(80)
    expect(passiveGps({ ...input, caps: caps(['blue', NOW + 1]) }, NOW)).toBe(40)
    expect(passiveGps({ ...input, caps: caps(['melt', NOW + 1]) }, NOW)).toBe(400)
  })
})
