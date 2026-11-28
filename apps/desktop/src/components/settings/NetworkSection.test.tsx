// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { directPathSummary } from './NetworkSection'

/**
 * The settings surface must never claim a direct route from an adapter
 * listing alone — only a validated DataChannel (peer chip) may read direct.
 */
describe('directPathSummary', () => {
  it('names a global IPv6 / Radmin candidate without claiming a direct route', () => {
    const text = directPathSummary({
      globalIpv6: '2001:0:14c9:cd04:3c06:4c04:759c:b4a5',
      radminIp: '26.26.113.34',
      exeFound: true,
    })
    expect(text).toContain('2001:0:14c9:cd04:3c06:4c04:759c:b4a5')
    expect(text).toContain('26.26.113.34')
    expect(text).toContain('confirmed only when a peer\'s DataChannel opens')
  })

  it('says plainly when the machine has neither path', () => {
    const text = directPathSummary({ globalIpv6: null, radminIp: null, exeFound: false })
    expect(text).toContain('No global IPv6 and no Radmin 26.x adapter detected')
    expect(text).toContain('falls back to the node relay')
  })

  it('distinguishes an installed-but-unjoined Radmin from no adapter', () => {
    expect(directPathSummary({ globalIpv6: null, radminIp: null, exeFound: true })).toContain('no 26.x adapter is up')
    expect(directPathSummary({ globalIpv6: null, radminIp: '26.1.2.3', exeFound: false })).toContain('Radmin adapter 26.1.2.3')
  })
})
