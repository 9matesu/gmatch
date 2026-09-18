// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveImage, imageCacheStats, prefetchImages } from './imageCache'

beforeEach(() => {
  vi.unstubAllGlobals()
  try { delete (window as { gmatch?: unknown }).gmatch } catch { /* frozen env */ }
})

describe('resolveImage (bridge / disk cache)', () => {
  it('returns empty input untouched', async () => {
    expect(await resolveImage('')).toBe('')
  })

  it('Electron bridge wins when present (gmcache://)', async () => {
    vi.stubGlobal('window', Object.assign(window, {
      gmatch: { cacheImage: vi.fn(async () => ({ local: 'gmcache://f/abc.png' })) },
    }))
    expect(await resolveImage('https://x.test/a.png')).toBe('gmcache://f/abc.png')
  })

  it('IndexedDB is NEVER opened', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('indexedDB', { open: openSpy } as unknown as IDBDatabase)
    await resolveImage('https://x.test/a.png')
    await imageCacheStats()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('prefetchImages never throws', () => {
    expect(() => prefetchImages(Array.from({ length: 30 }, (_, i) => `https://tbib.org/images/p${i}.png`))).not.toThrow()
  })
})
