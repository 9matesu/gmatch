import { describe, expect, it } from 'vitest'
import { worldAccentStyle, worldGlyph, worldHue, worldTileStyle } from './worldIdentity'

describe('worldHue', () => {
  it('is deterministic for the same key', () => {
    expect(worldHue('127.0.0.1:8790')).toBe(worldHue('127.0.0.1:8790'))
  })

  it('stays inside the 0–359 range', () => {
    for (const key of ['', 'a', 'node.example', 'x'.repeat(400)]) {
      const hue = worldHue(key)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(Number.isInteger(hue)).toBe(true)
    }
  })

  it('separates worlds with different keys', () => {
    expect(worldHue('alpha.example')).not.toBe(worldHue('beta.example'))
  })
})

describe('worldGlyph', () => {
  it('uses the first letter or number', () => {
    expect(worldGlyph('Night Shift')).toBe('N')
    expect(worldGlyph('42 goons')).toBe('4')
  })

  it('ignores punctuation-only names and falls back to ?', () => {
    expect(worldGlyph('— · —')).toBe('?')
    expect(worldGlyph('')).toBe('?')
  })
})

describe('world styles', () => {
  it('paints from the same hue as the key', () => {
    const hue = worldHue('world-a')
    expect(worldTileStyle('world-a').background).toContain(`hsl(${hue}`)
    expect(worldAccentStyle('world-a').backgroundColor).toBe(`hsl(${hue} 70% 58%)`)
  })
})
