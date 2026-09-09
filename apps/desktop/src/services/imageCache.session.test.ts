// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { resolveImage, imageCacheStats, prefetchImages, _test } from './imageCache'

// Session-only policy (security plan B.1): resolveImage may cache in MEMORY
// (this module instance) but must never touch IndexedDB, and init must
// destroy the legacy 'goongrid-img' DB.

// jsdom lacks URL.createObjectURL/revokeObjectURL — emulate blob: URLs so the
// session-cache hit path can be asserted.
const origCreate = URL.createObjectURL
const origRevoke = URL.revokeObjectURL
let objN = 0
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => `blob:mock-${++objN}` })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
})
afterAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: origCreate })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: origRevoke })
})

beforeEach(() => {
  vi.unstubAllGlobals()
  // Object.assign(window, ...) in the bridge test mutates the real window —
  // scrub it so no backend bleeds across tests.
  try { delete (window as { gmatch?: unknown }).gmatch } catch { /* frozen env */ }
  _test.resetSessionCache()
})

describe('resolveImage (session-only)', () => {
  it('returns empty input untouched', async () => {
    expect(await resolveImage('')).toBe('')
  })

  it('video URLs always stream from source (not cached)', async () => {
    expect(await resolveImage('https://cdn.example/clip.mp4')).toBe('https://cdn.example/clip.mp4')
  })

  it('Electron bridge wins when present (gmcache://)', async () => {
    vi.stubGlobal('window', Object.assign(window, {
      gmatch: { cacheImage: vi.fn(async () => ({ local: 'gmcache://f/abc.png' })) },
    }))
    expect(await resolveImage('https://x.test/a.png')).toBe('gmcache://f/abc.png')
  })

  it('no bridge + no window.gmatch: fetches once into the SESSION cache; a second resolve serves the blob: URL (RAM, same object)', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const first = await resolveImage('https://tbib.org/images/1/a.png')
    expect(first).toBe('https://tbib.org/images/1/a.png') // miss shows remote now
    // await the background store (fetch->blob->set is a macrotask chain)
    await vi.waitFor(() => expect(_test.sessionCacheSize()).toBe(1))
    const second = await resolveImage('https://tbib.org/images/1/a.png')
    expect(second).toMatch(/^blob:/) // hit from session RAM
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP errors and non-media blobs are not cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })) as unknown as typeof fetch)
    await resolveImage('https://tbib.org/images/1/miss.png')
    await new Promise((r) => setTimeout(r, 0))
    expect(_test.sessionCacheSize()).toBe(0)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'text/html' }) })) as unknown as typeof fetch)
    await resolveImage('https://tbib.org/images/1/html.png')
    await new Promise((r) => setTimeout(r, 0))
    expect(_test.sessionCacheSize()).toBe(0)
  })

  it('LRU cap evicts oldest session entries', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })) as unknown as typeof fetch)
    const CAP = _test.SESSION_CAP
    for (let i = 0; i <= CAP; i++) await resolveImage(`https://tbib.org/images/${i}.png`)
    await new Promise((r) => setTimeout(r, 5))
    expect(_test.sessionCacheSize()).toBeLessThanOrEqual(CAP)
  })

  it('IndexedDB is NEVER opened (session-only rule)', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('indexedDB', { open: openSpy } as unknown as IDBDatabase)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) })) as unknown as typeof fetch)
    await resolveImage('https://x.test/a.png')
    await imageCacheStats()
    await new Promise((r) => setTimeout(r, 0))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('clearSessionCache drops memory + revokes object URLs', async () => {
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })) as unknown as typeof fetch)
    await resolveImage('https://tbib.org/images/1/z.png')
    await new Promise((r) => setTimeout(r, 0))
    expect(_test.sessionCacheSize()).toBe(1)
    await _test.clearSessionCache()
    expect(_test.sessionCacheSize()).toBe(0)
  })

  it('prefetchImages feeds the session cache, capped at 11 urls', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    prefetchImages(Array.from({ length: 30 }, (_, i) => `https://tbib.org/images/p${i}.png`))
    await new Promise((r) => setTimeout(r, 5))
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(11)
  })
})
