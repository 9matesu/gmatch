// Wave 2 (B3): the directory row must render masked coordinates only.
// Source-parity test (same idiom as adminEndpointParity.test.ts) — the
// component file is shared with parallel agents, so we assert the contract
// on the source instead of a full render.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, './ServersView.tsx'), 'utf8')

describe('ServersView IP masking', () => {
  it('renders endpoint_hint only through maskedServerUrl', () => {
    expect(src).toContain('maskedServerUrl')
    // no raw endpoint_hint rendered as JSX text (the search-filter template
    // literal `${s.endpoint_hint ?? ''}` is local-only and allowed)
    expect(src).not.toMatch(/\{s\.endpoint_hint\s*\|\|/)
    expect(src).not.toMatch(/>\s*\{s\.endpoint_hint\}\s*</)
  })
})
