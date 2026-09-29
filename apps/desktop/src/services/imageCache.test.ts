import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearImageCache, devFetchable, imageCacheStats, prefetchImages, resolveImage, resolveImageNow, _test } from './imageCache'

afterEach(() => {
  vi.unstubAllGlobals()
  _test.resetSessionCache()
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

  it('bounds concurrent prefetch so a sweep cannot starve the on-demand path', async () => {
    // A queue update can produce 27 prefetches at once. Firing them all
    // straight at the IPC bridge means the picture the player is actually
    // waiting on queues behind 26 speculative ones.
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const cacheImage = vi.fn(
      () =>
        new Promise<{ local: string | null }>((r) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          release.push(() => {
            inFlight--
            r({ local: null })
          })
        }),
    )
    vi.stubGlobal('window', { gmatch: { cacheImage } })

    const urls = Array.from({ length: 12 }, (_, i) => `https://x/${i}.png`)
    prefetchImages(urls, 12)
    // Only the bounded number start immediately.
    await Promise.resolve()
    expect(peak).toBeLessThanOrEqual(2)

    // Draining lets the rest through.
    for (let i = 0; i < 40 && release.length; i++) {
      const next = release.shift()
      next?.()
      await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(cacheImage).toHaveBeenCalledTimes(12)
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('resolveImageNow bypasses the prefetch queue', async () => {
    // The current picture must never wait behind speculative fetches. Only
    // the PREFETCH urls hang here; the urgent one answers immediately, which
    // is the whole claim being tested.
    const hold: Array<() => void> = []
    const cacheImage = vi.fn((url: string) => {
      if (url.endsWith('urgent.png')) return Promise.resolve({ local: 'gmcache://now.png' })
      return new Promise<{ local: string | null }>((r) => hold.push(() => r({ local: null })))
    })
    vi.stubGlobal('window', { gmatch: { cacheImage } })

    // Occupy both background lanes.
    prefetchImages(['https://x/a.png', 'https://x/b.png', 'https://x/c.png'], 3)
    await new Promise((r) => setTimeout(r, 0))
    expect(hold.length).toBeGreaterThan(0)

    // Even with both lanes busy, the on-demand resolve returns immediately.
    await expect(resolveImageNow('https://x/urgent.png')).resolves.toBe('gmcache://now.png')
    for (const h of hold) h()
  })

  it('dedupes a URL that is already being prefetched', async () => {
    const cacheImage = vi.fn(() => new Promise<{ local: string | null }>(() => {}))
    vi.stubGlobal('window', { gmatch: { cacheImage } })
    prefetchImages(['https://x/1.png'], 1)
    await Promise.resolve()
    prefetchImages(['https://x/1.png'], 1)
    await Promise.resolve()
    expect(cacheImage).toHaveBeenCalledTimes(1)
  })

  it('stats report no backend, clear is a no-op', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('indexedDB', undefined)
    await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'none' })
    await expect(clearImageCache()).resolves.toEqual({ files: 0, bytes: 0, backend: 'disk' })
  })

  it('uses the Electron memory bridge when present', async () => {
    const cacheImage = vi.fn().mockResolvedValue({ local: 'gmcache://f/abc.png' })
    vi.stubGlobal('window', { gmatch: { cacheImage } })
    await expect(resolveImage('https://x/1.png')).resolves.toBe('gmcache://f/abc.png')
    expect(cacheImage).toHaveBeenCalledWith('https://x/1.png')
  })

  it('falls back to remote when the bridge misses', async () => {
    const cacheImage = vi.fn().mockResolvedValue({ local: null })
    const cacheStats = vi.fn().mockResolvedValue({ files: 3, bytes: 42 })
    vi.stubGlobal('window', { gmatch: { cacheImage, cacheStats } })
    await expect(resolveImage('https://x/1.png')).resolves.toBe('https://x/1.png')
    await expect(imageCacheStats()).resolves.toEqual({ files: 3, bytes: 42, backend: 'disk' })
  })
})

describe('devFetchable (vite-dev same-origin bytes)', () => {
  it('maps known image hosts to local proxies', () => {
    expect(devFetchable('https://tbib.org/images/1/a.jpg')).toBe('/booru/tbib/images/1/a.jpg')
    expect(devFetchable('https://xbooru.com/images/2/b.png')).toBe('/booru/xbooru/images/2/b.png')
    expect(devFetchable('https://img.xbooru.com/images/235/f58df51bba880e6f880c14ec46c87401.jpeg')).toBe(
      '/px?u=https%3A%2F%2Fimg.xbooru.com%2Fimages%2F235%2Ff58df51bba880e6f880c14ec46c87401.jpeg'
    )
    expect(devFetchable('https://media.redgifs.com/Foo.mp4')).toBe('/rg-media/Foo.mp4')
    expect(devFetchable('https://m11.imhentai.xxx/1728478/1.jpg')).toBe(
      '/px?u=https%3A%2F%2Fm11.imhentai.xxx%2F1728478%2F1.jpg',
    )
    // yande.re 302s to files.yande.re — /px follows server-side (vite proxy passes the 302 to the browser, which dies on CORS)
    expect(devFetchable('https://yande.re/image/abc/x.jpg')).toBe('/px?u=https%3A%2F%2Fyande.re%2Fimage%2Fabc%2Fx.jpg')
    expect(devFetchable('https://files.yande.re/image/abc/x.jpg')).toBe(
      '/px?u=https%3A%2F%2Ffiles.yande.re%2Fimage%2Fabc%2Fx.jpg',
    )
  })

  it('null for unknown hosts and junk', () => {
    expect(devFetchable('https://x/1.png')).toBeNull()
    expect(devFetchable('not a url')).toBeNull()
  })
})
