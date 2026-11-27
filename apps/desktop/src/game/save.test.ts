import { describe, expect, it } from 'vitest'
import {
  SAVE_KEY,
  SAVE_VERSION,
  defaultSave,
  deserialize,
  serialize,
} from './save'

describe('save key + version (SPEC §11)', () => {
  it('uses gmatch.save.v1', () => {
    expect(SAVE_KEY).toBe('gmatch.save.v1')
    expect(SAVE_VERSION).toBe(3)
  })
})

describe('serialize / deserialize round-trip', () => {
  it('preserves all fields', () => {
    const data = {
      ...defaultSave(123),
      points: 4200,
      totalEarned: 99_000,
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
      defeated: 4,
      backgroundUrl: 'https://x/bg.jpg',
    }
    const back = deserialize(serialize(data))
    expect(back).toEqual(data)
  })

  it('returns null for corrupt, empty or wrong-version payloads', () => {
    expect(deserialize(null)).toBeNull()
    expect(deserialize(undefined)).toBeNull()
    expect(deserialize('not json')).toBeNull()
    expect(deserialize('{"version":999}')).toBeNull()
    expect(deserialize('[1,2,3]')).toBeNull()
  })

  it('fills missing fields with defaults', () => {
    const back = deserialize(JSON.stringify({ version: SAVE_VERSION, points: 7 }))
    expect(back).not.toBeNull()
    expect(back!.points).toBe(7)
    expect(back!.tags).toEqual([])
    expect(back!.defeated).toBe(0)
  })

  it('migrates legacy gp saves 1:1 to points (plan D4)', () => {
    const back = deserialize(JSON.stringify({ version: SAVE_VERSION, gp: 1500, totalEarnedGP: 9000 }))
    expect(back).not.toBeNull()
    expect(back!.points).toBe(1500)
    expect(back!.totalEarned).toBe(9000)
  })

  it('migrates legacy gc saves 1:1 to points', () => {
    const back = deserialize(JSON.stringify({ version: SAVE_VERSION, gc: 777, totalEarnedGc: 888 }))
    expect(back).not.toBeNull()
    expect(back!.points).toBe(777)
    expect(back!.totalEarned).toBe(888)
  })

  it('migrates pre-v3 saves instead of discarding the whole run', () => {
    const v1 = deserialize(JSON.stringify({ version: 1, gp: 1500, totalEarnedGP: 9000, clickCount: 42 }))
    expect(v1?.version).toBe(SAVE_VERSION)
    expect(v1?.points).toBe(1500)
    expect(v1?.totalEarned).toBe(9000)
    expect(v1?.clickCount).toBe(42)
    expect(v1?.maxHeatStreak).toBe(0) // field did not exist yet

    const v2 = deserialize(JSON.stringify({ version: 2, gc: 777, totalEarnedGc: 888 }))
    expect(v2?.version).toBe(SAVE_VERSION)
    expect(v2?.points).toBe(777)
    expect(v2?.totalEarned).toBe(888)
  })
})
