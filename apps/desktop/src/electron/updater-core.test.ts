import { describe, expect, it } from 'vitest'
import {
  isNewer,
  parsePortableName,
  parseDigest,
  parseRelease,
  shaFromReleaseJson,
  planCheck,
  sanitizePath,
  buildUpdaterScript,
  isPrivateFeedUrl,
} from '../../electron/updater-core.cjs'
import { isNewer as isNewerTs } from '../utils/version'

const asset = (name: string, url?: string, digest?: string) => ({
  name,
  browser_download_url: url ?? `https://github.com/9matesu/goongrid/releases/download/v1.0.0/${name}`,
  ...(digest ? { digest } : {}),
})

describe('updater-core (portable self-update)', () => {
  it('parsePortableName matches only our artifact', () => {
    expect(parsePortableName('gMatch-1.1.4-portable.exe')).toBe('1.1.4')
    expect(parsePortableName('gMatch-Setup-1.1.4.exe')).toBe(null)
    expect(parsePortableName('other.exe')).toBe(null)
  })

  it('parseDigest normalizes sha256-<hex> and rejects junk', () => {
    expect(parseDigest(`sha256-${'ab'.repeat(32)}`)).toBe('ab'.repeat(32))
    expect(parseDigest('md5-1234')).toBe(null)
    expect(parseDigest(undefined)).toBe(null)
  })

  it('parseRelease picks the highest portable asset', () => {
    const rel = parseRelease({ assets: [asset('gMatch-1.2.10-portable.exe'), asset('gMatch-1.2.9-portable.exe')] })
    expect(rel?.version).toBe('1.2.10')
    expect(rel?.digest).toBe(null)
    expect(parseRelease({ assets: [] })).toBe(null)
    expect(parseRelease({ tag_name: 'v1.2.3', assets: [] })).toMatchObject({ version: '1.2.3', missingAsset: true })
  })

  it('planCheck decides current vs download vs error', () => {
    expect(planCheck({ assets: [asset('gMatch-1.1.3-portable.exe')] }, '1.1.3')).toEqual({ action: 'current', version: '1.1.3' })
    const dl = planCheck({ assets: [asset('gMatch-1.2.0-portable.exe')] }, '1.1.3')
    expect(dl.action).toBe('download')
    expect((dl as { url: string }).url).toContain('gMatch-1.2.0-portable.exe')
    expect(planCheck({}, '1.1.3').action).toBe('error')
    expect(planCheck({ tag_name: 'v9.9.9', assets: [] }, '1.1.3').action).toBe('error')
  })

  it('planCheck refuses http assets unless insecure (local smoke override)', () => {
    const rel = { assets: [{ name: 'gMatch-2.0.0-portable.exe', browser_download_url: 'http://127.0.0.1:9/gMatch-2.0.0-portable.exe' }] }
    expect(planCheck(rel, '1.1.3').action).toBe('error')
    expect(planCheck(rel, '1.1.3', { insecure: true }).action).toBe('download')
  })

  it('shaFromReleaseJson matches the same version only', () => {
    const hex = 'cd'.repeat(32)
    expect(shaFromReleaseJson({ version: '1.2.0', sha256: hex }, '1.2.0')).toBe(hex)
    expect(shaFromReleaseJson({ version: '1.1.0', sha256: hex }, '1.2.0')).toBe(null)
    expect(shaFromReleaseJson({ version: '1.2.0', sha256: 'short' }, '1.2.0')).toBe(null)
    expect(shaFromReleaseJson(null, '1.2.0')).toBe(null)
  })

  it('sanitizePath strips cmd.exe metacharacters', () => {
    expect(sanitizePath('C:\\a b\\x"&y^z|.exe')).toBe('C:\\a b\\xyz.exe')
    expect(sanitizePath('normal\\path\\ok.exe')).toBe('normal\\path\\ok.exe')
  })

  it('buildUpdaterScript: retry-move, relaunch, self-delete', () => {
    const s = buildUpdaterScript({ source: 'C:\\d\\new.exe', target: 'C:\\d\\old.exe', logPath: 'C:\\log\\main.log' })
    expect(s).toContain(':retry')
    expect(s).toContain('move /y "C:\\d\\new.exe" "C:\\d\\old.exe"')
    expect(s).toContain('GEQ 30')
    expect(s).toContain('start "" "C:\\d\\old.exe"')
    expect(s).toContain('del "%~f0"')
    expect(s).toContain('C:\\log\\main.log')
  })

  it('site release.json shape (private-repo reality): version, url, verified digest', () => {
    const meta = { file: 'gMatch-1.2.0-portable.exe', version: '1.2.0', sha256: 'ef'.repeat(32) }
    const plan = planCheck(meta, '1.1.3')
    expect(plan.action).toBe('download')
    expect(plan).toMatchObject({ version: '1.2.0', url: 'https://gmatch.pages.dev/releases/gMatch-1.2.0-portable.exe', digest: 'ef'.repeat(32) })
    expect(planCheck({ ...meta, downloadUrl: 'https://example.test/a/gMatch-1.2.0-portable.exe' }, '1.1.3')).toMatchObject({ url: 'https://example.test/a/gMatch-1.2.0-portable.exe' })
    expect(planCheck(meta, '1.2.0').action).toBe('current')
    expect(planCheck({ file: 'evil.zip', version: '9.9.9' }, '1.1.3').action).toBe('error')
    expect(planCheck({ version: '1.2.0', downloadUrl: 'http://x/y.exe' }, '1.1.3').action).toBe('error')
    expect(planCheck({ version: '1.2.0', downloadUrl: 'http://x/y.exe' }, '1.1.3', { insecure: true })).toMatchObject({ action: 'download', name: 'y.exe' })
  })

  it('a node feed on the user\'s own network may be plain http', () => {
    // The node this install talks to (their machine, their LAN) is a host the
    // user chose: http is acceptable there, and nowhere else.
    expect(isPrivateFeedUrl('http://127.0.0.1:8790/release.json')).toBe(true)
    expect(isPrivateFeedUrl('http://localhost:8790/release.json')).toBe(true)
    expect(isPrivateFeedUrl('http://192.168.1.10:8790/release.json')).toBe(true)
    expect(isPrivateFeedUrl('http://10.0.0.4:8790/release.json')).toBe(true)
    expect(isPrivateFeedUrl('http://172.16.3.4:8790/release.json')).toBe(true)
    expect(isPrivateFeedUrl('https://gmatch.pages.dev/release.json')).toBe(false)
    expect(isPrivateFeedUrl('http://93.184.216.34/release.json')).toBe(false)
    expect(isPrivateFeedUrl('nonsense')).toBe(false)
  })

  it('renderer TS mirror behaves identically (drift guard)', () => {
    for (const [a, b] of [['1.1.10', '1.1.9'], ['1.1.3', '1.1.3'], ['2', '1.9.9'], ['1.0', '1.0.0']] as const) {
      expect(isNewer(a, b)).toBe(isNewerTs(a, b))
    }
    expect(isNewer('1.1.10', '1.1.9')).toBe(true)
  })
})
