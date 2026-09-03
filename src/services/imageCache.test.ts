import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetImageCache, clearImageCache, imageCacheStats, prefetchImages, resolveImage } from './imageCache'

afterEach(() => {
  vi.unstubAllGlobals()
  __resetImageCache()
})

describe('imageCache (no backends)', () => {
  it('falls through to the remote URL when nothing is available', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('indexedDB', undefined)
    await expect(resolveImage('https://x/1.png')).resolves.toBe('https://x/1.png')
  })

  it('prefetch never throws', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('indexedDB', undefined)
    expect(() => prefetchImages(['https://x/1.png', 'https://x/2.png'])).not.toThrow()
  })

  it('stats report no backend, clear is a no-op', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('indexedDB', undefined)
    await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'none' })
    await expect(clearImageCache()).resolves.toBeUndefined()
  })

  it('uses the Electron disk bridge when present', async () => {
    const cacheImage = vi.fn().mockResolvedValue({ local: 'gooncache://f/abc.png' })
    vi.stubGlobal('window', { goongrid: { cacheImage } })
    await expect(resolveImage('https://x/1.png')).resolves.toBe('gooncache://f/abc.png')
    expect(cacheImage).toHaveBeenCalledWith('https://x/1.png')
  })

  it('falls back to remote when the bridge misses', async () => {
    const cacheImage = vi.fn().mockResolvedValue({ local: null })
    const cacheStats = vi.fn().mockResolvedValue({ files: 3, bytes: 42 })
    vi.stubGlobal('window', { goongrid: { cacheImage, cacheStats } })
    await expect(resolveImage('https://x/1.png')).resolves.toBe('https://x/1.png')
    await expect(imageCacheStats()).resolves.toEqual({ files: 3, bytes: 42, backend: 'disk' })
  })
})
