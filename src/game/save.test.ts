import { describe, expect, it } from 'vitest'
import {
  OFFLINE_CAP_MS,
  SAVE_KEY,
  SAVE_VERSION,
  defaultSave,
  deserialize,
  offlineEarnings,
  serialize,
} from './save'

describe('save key + version (SPEC §11)', () => {
  it('uses goongrid.save.v1', () => {
    expect(SAVE_KEY).toBe('goongrid.save.v1')
    expect(SAVE_VERSION).toBe(1)
  })
})

describe('serialize / deserialize round-trip', () => {
  it('preserves all fields', () => {
    const data = {
      ...defaultSave(123),
      gp: 4200,
      totalEarnedGP: 99_000,
      xp: 1_600,
      clickCount: 300,
      critCount: 12,
      shards: 3,
      prestigeCount: 1,
      tags: [{ name: 'wet', level: 2, base: 10, income: 1, weight: 1 }],
      gallery: [{ id: 'g', url: 'u', tags: ['1girl'], rarityBase: 2, clicks: 5, rarity: 'Silver' as const }],
      caps: [{ capId: 'blue' as const, expiresAt: 999 }],
      capsUsed: ['blue' as const],
      achievements: ['first_click'],
      ageAccepted: true,
      nsfwBlur: false,
    }
    const back = deserialize(serialize(data))
    expect(back).toEqual(data)
  })

  it('returns null for corrupt, empty or wrong-version payloads', () => {
    expect(deserialize(null)).toBeNull()
    expect(deserialize(undefined)).toBeNull()
    expect(deserialize('not json')).toBeNull()
    expect(deserialize('{"version":2}')).toBeNull()
    expect(deserialize('[1,2,3]')).toBeNull()
  })

  it('fills missing fields with defaults', () => {
    const back = deserialize(JSON.stringify({ version: SAVE_VERSION, gp: 7 }))
    expect(back).not.toBeNull()
    expect(back!.gp).toBe(7)
    expect(back!.tags).toEqual([])
    expect(back!.nsfwBlur).toBe(true)
  })
})

describe('offline earnings (SPEC §11)', () => {
  it('elapsed * GP/s * 50%', () => {
    expect(offlineEarnings(10, 60_000)).toBe(300)
    expect(offlineEarnings(0, 60_000)).toBe(0)
  })

  it('caps at 8 hours', () => {
    expect(OFFLINE_CAP_MS).toBe(8 * 60 * 60 * 1000)
    expect(offlineEarnings(10, OFFLINE_CAP_MS)).toBe(10 * 8 * 3600 * 0.5)
    expect(offlineEarnings(10, OFFLINE_CAP_MS * 10)).toBe(offlineEarnings(10, OFFLINE_CAP_MS))
  })

  it('clamps negative elapsed time to zero', () => {
    expect(offlineEarnings(10, -5_000)).toBe(0)
  })
})
