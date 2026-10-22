import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { releasesDir, safeReleaseName, serveRelease } from './releases'

/**
 * A node can serve the portable build to its peers: the update feed travels
 * between the people who use the app, not from a host somebody has to pay for.
 */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gmatch-releases-'))
}

describe('node release feed', () => {
  it('has no feed unless a directory is configured', async () => {
    expect(releasesDir({})).toBeNull()
    expect(await serveRelease('/release.json', { RELEASES_DIR: '' })).toBeNull()
  })

  it('serves the manifest and the artifact it names', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'release.json'), JSON.stringify({
      file: 'gMatch-9.9.9-portable.exe',
      version: '9.9.9',
      sha256: 'a'.repeat(64),
      sizeBytes: 3,
    }))
    writeFileSync(join(dir, 'gMatch-9.9.9-portable.exe'), 'EXE')

    const manifest = await serveRelease('/release.json', { RELEASES_DIR: dir })
    expect(manifest?.status).toBe(200)
    const body = await manifest!.json()
    expect(body.version).toBe('9.9.9')
    expect(body.sha256).toHaveLength(64)

    const artifact = await serveRelease('/releases/gMatch-9.9.9-portable.exe', { RELEASES_DIR: dir })
    expect(artifact?.status).toBe(200)
    expect(artifact?.headers.get('Content-Length')).toBe('3')
    expect(await artifact!.text()).toBe('EXE')
  })

  it('404s a missing manifest and a missing artifact', async () => {
    const dir = tempDir()
    expect((await serveRelease('/release.json', { RELEASES_DIR: dir }))?.status).toBe(404)
    expect((await serveRelease('/releases/nope.exe', { RELEASES_DIR: dir }))?.status).toBe(404)
  })

  it('refuses a path that tries to escape the releases directory', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'secret.txt'), 'nope')
    // A path is reduced to its base name: the file can never be reached
    // OUTSIDE the releases directory.
    expect(safeReleaseName('../secret.txt')).toBe('secret.txt')
    expect(safeReleaseName('sub/secret.txt')).toBe('secret.txt')
    expect(safeReleaseName('')).toBeNull()
    expect(safeReleaseName('..')).toBeNull()
    expect(safeReleaseName('bad name.exe')).toBeNull()
    // The traversal never reaches outside: only the base name is used.
    const res = await serveRelease('/releases/..%2Fsecret.txt', { RELEASES_DIR: dir })
    expect(res?.status).toBe(404)
  })

  it('ignores a path that is not a release path', async () => {
    const dir = tempDir()
    expect(await serveRelease('/api/health', { RELEASES_DIR: dir })).toBeNull()
  })
})
