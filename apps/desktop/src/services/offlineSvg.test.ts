import { describe, expect, it } from 'vitest'
import { offlineSvg } from './offlineSvg'

describe('offlineSvg (SPEC §6)', () => {
  it('returns a data-URI SVG with gradient, tag text and OFFLINE badge', () => {
    const uri = offlineSvg(['1girl', 'wet'])
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length))
    expect(svg).toContain('linearGradient')
    expect(svg).toContain('1girl wet')
    expect(svg).toContain('OFFLINE')
  })

  it('escapes XML-hostile tag text', () => {
    const svg = decodeURIComponent(offlineSvg(['<script>']).slice('data:image/svg+xml,'.length))
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('handles empty tag list', () => {
    expect(offlineSvg([])).toContain('goongrid')
  })
})
