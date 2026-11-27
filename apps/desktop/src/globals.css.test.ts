import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** CSS-only fixes still get a pinned rule: a permanent compositing layer on
 *  every holo tile is a real source of black flashes in dense grids. */
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')

describe('holo surface compositing', () => {
  it('promotes only the hovered holo card, not every tile in the grid', () => {
    const base = css.match(/\.holo-card\s*\{[^}]*\}/)?.[0] ?? ''
    expect(base).not.toMatch(/will-change\s*:\s*transform/)
    expect(css).toMatch(/\.holo-card(?::hover|:focus-visible)[^{]*\{[^}]*will-change\s*:\s*transform/)
  })
})

describe('primary action theming', () => {
  it('reads the accent token so the button survives the light theme', () => {
    const base = css.match(/\.create-action\s*\{[^}]*\}/)?.[0] ?? ''
    const hover = css.match(/\.create-action:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(base).not.toMatch(/background(?:-color)?\s*:\s*#(?:fff|ffffff|e4e4e7)\b/i)
    expect(base).toMatch(/background-color\s*:\s*var\(--color-retro-accent\)/)
    expect(hover).toMatch(/background\s*:\s*var\(--color-retro-accent-hover\)/)
  })
})
