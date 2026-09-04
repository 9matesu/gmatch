import { describe, expect, it } from 'vitest'
import { ALL_CAP_IDS } from '../game/caps'
import { CAP_SKINS } from './capSkins'

describe('cap skins (bundled gif loops)', () => {
  it('every cap id has a bundled gif skin', () => {
    for (const id of ALL_CAP_IDS) {
      expect(CAP_SKINS[id]).toMatch(/\.gif/)
    }
  })
})
