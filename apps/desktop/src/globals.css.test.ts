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
