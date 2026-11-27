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
    expect(parsePortableName('gMatch-1.1.4-portable.AppImage')).toBe('1.1.4')
    expect(parsePortableName('gMatch-1.1.4-portable.deb')).toBe('1.1.4')
    expect(parsePortableName('gMatch-Setup-1.1.4.exe')).toBe(null)
    expect(parsePortableName('other.exe')).toBe(null)
  })

  it('parseDigest normalizes sha256-<hex> and rejects junk', () => {
    expect(parseDigest(`sha256-${'ab'.repeat(32)}`)).toBe('ab'.repeat(32))
    expect(parseDigest('md5-1234')).toBe(null)
    expect(parseDigest(undefined)).toBe(null)
  })

  // GitHub serves `"digest":"sha256:<hex>"` (COLON). The dash-only regex made
  // every real asset hash parse to null, so the download was refused as
  // unverified and the update never installed.
  it('parseDigest accepts the real GitHub colon form', () => {
    expect(parseDigest(`sha256:${'cd'.repeat(32)}`)).toBe('cd'.repeat(32))
    expect(parseDigest(`SHA256:${'ef'.repeat(32)}`)).toBe('ef'.repeat(32))
    expect(parseDigest(`sha256:${'ab'.repeat(20)}`)).toBe(null) // not 64 hex
    expect(parseDigest('sha256:')).toBe(null)
  })

  it('a real GitHub asset digest reaches the download plan', () => {
    const plan = planCheck(
      { assets: [asset('gMatch-1.2.0-portable.exe', undefined, `sha256:${'9d'.repeat(32)}`)] },
      '1.1.3',
    )
    expect(plan).toMatchObject({ action: 'download', digest: '9d'.repeat(32) })
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

  it('planCheck selects only the artifact the current OS can swap', () => {
    const release = {
      tag_name: 'v2.0.0',
      assets: [
        asset('gMatch-2.0.0-portable.exe'),
        asset('gMatch-2.0.0-portable.AppImage'),
        asset('gMatch-2.0.0-portable.deb'),
      ],
    }
    expect(planCheck(release, '1.9.0', { platform: 'win32' })).toMatchObject({ name: 'gMatch-2.0.0-portable.exe' })
    expect(planCheck(release, '1.9.0', { platform: 'linux' })).toMatchObject({ name: 'gMatch-2.0.0-portable.AppImage' })
    expect(planCheck(release, '1.9.0', { platform: 'darwin' })).toMatchObject({ name: 'gMatch-2.0.0-portable.AppImage' })
    // A deb is packaging, not a portable swap: it never becomes a download plan.
    expect(planCheck({ ...release, assets: [release.assets[2]] }, '1.9.0', { platform: 'linux' }).action).toBe('error')
  })

  it('planCheck refuses http assets unless insecure (local smoke override)', () => {
    const rel = { assets: [{ name: 'gMatch-2.0.0-portable.exe', browser_download_url: 'http://127.0.0.1:9/gMatch-2.0.0-portable.exe' }] }
    expect(planCheck(rel, '1.1.3').action).toBe('error')
    expect(planCheck(rel, '1.1.3', { insecure: true }).action).toBe('download')
  })

  it('a node manifest with no downloadUrl resolves against the node that served it', () => {
    // The node's own release.json (scripts/stage-release.cjs) has no absolute
    // URL: the artifact lives at /releases/<file> on THAT node.
    const manifest = { file: 'gMatch-1.7.0-portable.exe', version: '1.7.0', sha256: 'ab'.repeat(32), sizeBytes: 10 }
    expect(planCheck(manifest, '1.6.8', { base: 'http://192.168.1.10:8790', insecure: true })).toMatchObject({
      action: 'download',
      url: 'http://192.168.1.10:8790/releases/gMatch-1.7.0-portable.exe',
    })
    // No absolute URL and no base: not a usable source, so it never invents a host.
    expect(planCheck(manifest, '1.6.8', {})).toMatchObject({ action: 'error' })
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

  it('buildUpdaterScript: Windows batch retry-move, relaunch, self-delete', () => {
    const s = buildUpdaterScript({ source: 'C:\\d\\new.exe', target: 'C:\\d\\old.exe', logPath: 'C:\\log\\main.log', platform: 'win32' })
    expect(s).toContain(':retry')
    expect(s).toContain('move /y "C:\\d\\new.exe" "C:\\d\\old.exe"')
    expect(s).toContain('GEQ 30')
    expect(s).toContain('start "" "C:\\d\\old.exe"')
    expect(s).toContain('del "%~f0"')
    expect(s).toContain('C:\\log\\main.log')
  })

  it('buildUpdaterScript: POSIX sh swap on Linux/macOS', () => {
    const s = buildUpdaterScript({
      source: '/home/u/new.AppImage', target: '/home/u/old.AppImage', logPath: '/home/u/main.log', platform: 'linux',
    })
    expect(s.startsWith('#!/bin/sh')).toBe(true)
    expect(s).toContain("mv -f '/home/u/new.AppImage' '/home/u/old.AppImage'")
    expect(s).toContain('while [ "$TRIES" -lt 30 ]')
    expect(s).toContain('sleep "$WAIT"')
    expect(s).toContain("chmod +x '/home/u/old.AppImage'")
    expect(s).toContain('rm -f "$0"')
    expect(s).toContain('/home/u/main.log')
    expect(buildUpdaterScript({
      source: '/home/u/new.AppImage', target: '/home/u/old.AppImage', logPath: '/home/u/main.log', platform: 'darwin',
    })).toBe(s)
  })

  it('release.json shape: version, url, verified digest', () => {
    const meta = { file: 'gMatch-1.2.0-portable.exe', version: '1.2.0', sha256: 'ef'.repeat(32) }
    // The manifest is served by a node: the artifact lives at /releases/<file>
    // on THAT node, never on a hosted page.
    const plan = planCheck(meta, '1.1.3', { base: 'http://127.0.0.1:8790', insecure: true })
    expect(plan.action).toBe('download')
    expect(plan).toMatchObject({ version: '1.2.0', url: 'http://127.0.0.1:8790/releases/gMatch-1.2.0-portable.exe', digest: 'ef'.repeat(32) })
    expect(planCheck({ ...meta, downloadUrl: 'https://example.test/a/gMatch-1.2.0-portable.exe' }, '1.1.3')).toMatchObject({ url: 'https://example.test/a/gMatch-1.2.0-portable.exe' })
    expect(planCheck(meta, '1.2.0', { base: 'http://127.0.0.1:8790', insecure: true }).action).toBe('current')
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
