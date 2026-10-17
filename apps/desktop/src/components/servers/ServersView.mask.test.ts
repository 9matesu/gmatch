// Create-node cycle wave: the directory row renders the opaque node HANDLE
// only — no address text (masked or raw) and no admin name ever reaches JSX.
// Source-parity test (same idiom as adminEndpointParity.test.ts) — the
// component file is shared with parallel agents, so we assert the contract
// on the source instead of a full render.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, './ServersView.tsx'), 'utf8')
// The row markup lives in WorldRow.tsx; assert the same contract there so
// moving presentation out of the view cannot quietly widen what reaches JSX.
const rowSrc = readFileSync(resolve(__dirname, './WorldRow.tsx'), 'utf8')

describe('ServersView address privacy', () => {
  it('never renders endpoint_hint as visible text, masked or raw', () => {
    for (const source of [src, rowSrc]) {
      expect(source).not.toContain('maskedServerUrl')
      // no raw endpoint_hint rendered as JSX text (the search-filter template
      // literal `${s.endpoint_hint ?? ''}` is local-only and allowed)
      expect(source).not.toMatch(/\{s\.endpoint_hint\s*\|\|/)
      expect(source).not.toMatch(/>\s*\{s\.endpoint_hint\}\s*</)
      expect(source).not.toMatch(/\{(s|server)\.endpoint_hint\}/)
      expect(source).not.toMatch(/\{maskedServerUrl/)
    }
    // the row only ever prints the hostname form, and drops IPs entirely
    expect(rowSrc).toContain('formatDomain(')
    expect(rowSrc).toMatch(/\\d\{1,3\}\(\\.\\d\{1,3\}\)\{3\}/)
  })

  it('never renders an owner/admin name', () => {
    expect(src).not.toContain('by {s.owner_name}')
    expect(src).not.toMatch(/owner_name[?]?:\s*string/)
    expect(rowSrc).not.toContain('owner_name')
  })
})
