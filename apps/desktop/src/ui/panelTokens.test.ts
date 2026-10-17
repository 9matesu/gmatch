/**
 * Panel/opacity contract (docs/DESIGN.md -> Surfaces). The panel colour family
 * must resolve through the ONE opacity knob and the blur scale through the ONE
 * blur knob: an opaque literal here is what silently breaks Settings -> Panel
 * Opacity / Glass blur, so the tokens are guarded rather than trusted.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../globals.css', import.meta.url)), 'utf8')

/** Raw right-hand side of a custom property in globals.css. */
function token(name: string): string {
  const match = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))
  if (!match) throw new Error(`token --${name} not found in globals.css`)
  return match[1].trim()
}

describe('panel tokens', () => {
  it('scales every panel colour through the single --panel-alpha knob', () => {
    for (const name of ['color-glass', 'color-glass-strong', 'color-surface-interactive']) {
      expect(token(name), name).toContain('var(--panel-alpha)')
    }
    // The other panel names must be aliases, never their own slate.
    expect(token('color-surface-raised')).toBe('var(--color-glass)')
    expect(token('color-surface-elevated')).toBe('var(--color-glass-strong)')
    expect(token('color-retro-panel')).toBe('var(--color-glass)')
  })

  it('keeps the page plate opaque (only bg-retro-bg may be solid)', () => {
    expect(token('color-surface-canvas')).not.toContain('var(')
  })

  it('drives every backdrop-blur step from the single --glass-blur knob', () => {
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']) {
      expect(token(`blur-${step}`), `blur-${step}`).toContain('var(--glass-blur, 0.7)')
    }
  })
})
