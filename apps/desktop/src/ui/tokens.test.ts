/**
 * Foundation contract for the common UI module. The token module is the ONE
 * place surfaces import names from; the raw values stay in globals.css @theme.
 * These tests pin both halves so a future fan-out cannot re-inline a value or
 * silently drop a token the kit relies on.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as tokens from './tokens'

const css = readFileSync(new URL('../globals.css', import.meta.url), 'utf8')
const tokenSource = readFileSync(new URL('./tokens.ts', import.meta.url), 'utf8')
const allowlist = JSON.parse(
  readFileSync(new URL('../../scripts/check-ui-tokens.allowlist.json', import.meta.url), 'utf8'),
) as {
  entries: { file: string; why: string; smells: Record<string, string[]> }[]
}

describe('common UI tokens', () => {
  it('exports every token group a surface needs', () => {
    for (const group of [
      'SPACE_VAR', 'PADDING', 'PADDING_X', 'PADDING_Y', 'GAP',
      'LAYOUT', 'DIALOG_WIDTH', 'SURFACE_TONE',
      'RADIUS', 'SHADOW', 'TYPE', 'WEIGHT', 'COLOR', 'STATUS', 'RARITY',
      'BUTTON_BASE', 'BUTTON_VARIANT', 'BUTTON_SIZE', 'WORDMARK', 'RECIPE',
      'CHROME', 'PRESENCE',
    ]) {
      expect(tokens, group).toHaveProperty(group)
    }
  })

  it('names only tokens — no raw colour or length value in the module', () => {
    expect(tokenSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(tokenSource).not.toMatch(/\brgba?\(\s*[\d.]/)
    expect(tokenSource).not.toMatch(/\btext-(?:gray|slate|zinc|neutral|stone)-/)
    expect(tokenSource).not.toMatch(/\bp(?:[xytblr]?)-\[\d+(?:\.\d+)?(?:px|rem|em)\]/)
  })

  it('keeps the new layout/elevation/weight values in the one @theme block', () => {
    for (const name of [
      'layout-content', 'layout-sheet', 'layout-sheet-max', 'grid-feed-cols',
      'shadow-panel', 'shadow-panel-strong', 'shadow-toolbar', 'shadow-surface',
      'shadow-control', 'weight-heading',
    ]) {
      expect(css, name).toMatch(new RegExp(`^\\s*--${name}:`, 'm'))
    }
    expect(css).toMatch(/\.glass-panel \{[\s\S]*?box-shadow: var\(--shadow-panel-strong\)/)
    expect(css).toMatch(/\.solid-panel \{[\s\S]*?box-shadow: var\(--shadow-panel\)/)
    expect(css).toMatch(/h1, h2, h3, h4, h5, h6 \{\s*font-weight: var\(--weight-heading\)/)
  })

  it('keeps the game-semantic recipes that styles.ts must not tokenize', () => {
    const styles = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8')
    expect(styles).toContain("export * from './tokens'")
    expect(styles).toMatch(/HP_FILL =\s*[\s\S]*?bg-pink-500/)
    expect(styles).toMatch(/FLOAT_GC_CRIT = 'text-xl text-warning-fg/)
    expect(tokens.RARITY.diamond).toContain('text-rarity-diamond')
  })

  it('scopes every allowlist exception to a file, smell, exact value and reason', () => {
    const keys = new Set<string>()
    for (const entry of allowlist.entries) {
      expect(entry.why.length).toBeGreaterThan(0)
      expect(entry.file.length).toBeGreaterThan(0)
      for (const [smell, values] of Object.entries(entry.smells)) {
        expect(smell.length).toBeGreaterThan(0)
        for (const value of values) {
          const key = `${entry.file}|${smell}|${value}`
          expect(keys.has(key), `duplicate allowlist key ${key}`).toBe(false)
          keys.add(key)
        }
      }
    }
    expect(keys.size).toBeGreaterThan(0)
  })
})
