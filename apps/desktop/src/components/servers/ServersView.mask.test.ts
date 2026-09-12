// Create-node cycle wave: the directory row renders the opaque node HANDLE
// only — no address text (masked or raw) and no admin name ever reaches JSX.
// Source-parity test (same idiom as adminEndpointParity.test.ts) — the
// component file is shared with parallel agents, so we assert the contract
// on the source instead of a full render.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, './ServersView.tsx'), 'utf8')

describe('ServersView address privacy', () => {
  it('never renders endpoint_hint as visible text, masked or raw', () => {
    expect(src).not.toContain('maskedServerUrl')
    // no raw endpoint_hint rendered as JSX text (the search-filter template
    // literal `${s.endpoint_hint ?? ''}` is local-only and allowed)
    expect(src).not.toMatch(/\{s\.endpoint_hint\s*\|\|/)
    expect(src).not.toMatch(/>\s*\{s\.endpoint_hint\}\s*</)
    expect(src).not.toMatch(/\{maskedServerUrl/)
  })

  it('never renders an owner/admin name', () => {
    expect(src).not.toContain('by {s.owner_name}')
    expect(src).not.toMatch(/owner_name[?]?:\s*string/)
  })
})
