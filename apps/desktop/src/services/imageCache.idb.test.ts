// @vitest-environment node
/**
 * IndexedDB browser path for imageCache — exercised with fake-indexeddb and
 * NO window.goongrid bridge (the Electron disk path lives in imageCache.test.ts).
 * NOTE: vitest runs with import.meta.env.DEV === true, so only hosts with a
 * vite dev proxy (devFetchable) get background-fetched — tests use tbib.org.
 */
import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetImageCache,
  clearImageCache,
  devFetchable,
  imageCacheStats,
  prefetchImages,
  resolveImage,
} from './imageCache'

/** Let queued microtasks + fake-IDB async callbacks drain. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

const imgBlob = (text: string): Blob => new Blob([text], { type: 'image/png' })
const proxied = (name: string): string => `https://tbib.org/images/${name}.png`

beforeEach(() => {
  // Fresh fake IndexedDB per test — no cross-test cache bleed.
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetImageCache()
})

describe('resolveImage (IndexedDB path)', () => {
  it('returns empty input untouched', async () => {
    await expect(resolveImage('')).resolves.toBe('')
  })

  it('caches a fetched blob in IDB and serves it as an object URL on the next view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(imgBlob('png-bytes'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const url = proxied('hit')
    // Miss: remote URL now, background fetch warms the store.
    await expect(resolveImage(url)).resolves.toBe(url)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await settle()
    expect(await imageCacheStats()).toEqual({ files: 1, bytes: 9, backend: 'browser' })
    // Hit: object URL, no refetch.
    const obj = await resolveImage(url)
    expect(obj).toMatch(/^blob:/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Second hit reuses the memoized object URL.
    await expect(resolveImage(url)).resolves.toBe(obj)
  })

  it('skips the background fetch for unknown hosts in dev (no CORS proxy)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveImage('https://unknown.host/x.png')).resolves.toBe('https://unknown.host/x.png')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await imageCacheStats()).files).toBe(0)
  })

  it('does not store HTTP errors, non-media blobs, or failed fetches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))
    await resolveImage(proxied('err'))
    await settle()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Blob(['text'], { type: 'text/plain' }), { status: 200 })),
    )
    await resolveImage(proxied('type'))
    await settle()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await resolveImage(proxied('boom'))
    await settle()
    expect((await imageCacheStats()).files).toBe(0)
  })

  it('stores video blobs too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Blob(['mp4'], { type: 'video/mp4' }), { status: 200 })),
    )
    await resolveImage(proxied('clip'))
    await settle()
    expect((await imageCacheStats()).files).toBe(1)
  })

  it('falls back to the remote URL when object-URL creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imgBlob('bytes'), { status: 200 })))
    const url = proxied('blobfail')
    await resolveImage(url)
    await settle()
    const RealURL = globalThis.URL
    const BrokenURL = function (input: string | URL, base?: string) {
      return new RealURL(input as string, base)
    } as unknown as typeof URL
    ;(BrokenURL as unknown as { createObjectURL: () => string }).createObjectURL = () => {
      throw new Error('object URLs disabled')
    }
    ;(BrokenURL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL }).revokeObjectURL =
      RealURL.revokeObjectURL
    vi.stubGlobal('URL', BrokenURL)
    await expect(resolveImage(url)).resolves.toBe(url)
  })

  it('treats a malformed stored row as a miss', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('goongrid-img', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('blobs')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite')
      tx.objectStore('blobs').put({ ts: 1, bytes: 4 } as never, proxied('badrow'))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    const fetchMock = vi.fn().mockResolvedValue(new Response(imgBlob('fresh'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const url = proxied('badrow')
    await expect(resolveImage(url)).resolves.toBe(url)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('degrades gracefully when the cached connection cannot open transactions', async () => {
    // Capture the module's own connection (patch the instance, never the
    // prototype — fake-indexeddb internals share IDBDatabase.prototype).
    const factoryProto = IDBFactory.prototype
    const realOpen = factoryProto.open
    let req: IDBOpenDBRequest | null = null
    factoryProto.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
      req = realOpen.apply(this, args)
      return req
    }
    await imageCacheStats() // warms the module's memoized connection
    factoryProto.open = realOpen
    const db = (req as unknown as IDBOpenDBRequest).result
    db.transaction = (() => {
      throw new Error('connection closed')
    }) as unknown as IDBDatabase['transaction']
    try {
      // idbGet null -> miss path (unknown host, no dev proxy) -> remote URL.
      await expect(resolveImage('https://unknown.host/txfail.png')).resolves.toBe(
        'https://unknown.host/txfail.png',
      )
      await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'browser' })
      await expect(clearImageCache()).resolves.toBeUndefined()
    } finally {
      delete (db as { transaction?: unknown }).transaction
    }
  })

  it('LRU cap drops the oldest rows past IDB_CAP (250)', async () => {
    // Seed 250 rows directly (fast), then let one module idbPut cross the cap.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('goongrid-img', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('blobs')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite')
      const store = tx.objectStore('blobs')
      for (let i = 0; i < 250; i++) {
        const key = `https://tbib.org/images/lru/${String(i).padStart(3, '0')}.png`
        store.put({ blob: imgBlob('x'), ts: i, bytes: 1 } as never, key)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    expect((await imageCacheStats()).files).toBe(250)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imgBlob('x'), { status: 200 })))
    const fresh = 'https://tbib.org/images/lru/250.png'
    await resolveImage(fresh)
    await settle()
    // The 251st put evicted the lexicographically-first key (lru/000).
    const s = await imageCacheStats()
    expect(s.files).toBe(250)
    expect(s.backend).toBe('browser')
    await expect(resolveImage('https://tbib.org/images/lru/000.png')).resolves.toBe(
      'https://tbib.org/images/lru/000.png',
    )
    await expect(resolveImage(fresh)).resolves.toMatch(/^blob:/)
  }, 20_000)
})

describe('prefetchImages (IndexedDB path)', () => {
  it('warms the window of URLs and ignores blanks', async () => {
    // Fresh Response per call — a Response body can only be consumed once.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(imgBlob('warm'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    prefetchImages([
      proxied('p1'),
      '',
      proxied('p2'),
      ...Array.from({ length: 20 }, (_, i) => proxied(`px${i}`)),
    ])
    await settle()
    // slice(0, 11) caps the window; the blank entry is skipped -> 10 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect((await imageCacheStats()).files).toBe(10)
  })

  it('never throws on garbage input', () => {
    expect(() => prefetchImages(null as unknown as string[])).not.toThrow()
  })
})

describe('clearImageCache (IndexedDB path)', () => {
  it('empties the store and revokes object URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imgBlob('bytes'), { status: 200 })))
    const url = proxied('clear')
    await resolveImage(url)
    await settle()
    expect((await imageCacheStats()).files).toBe(1)
    const obj = await resolveImage(url)
    expect(obj).toMatch(/^blob:/)
    await clearImageCache()
    expect(await imageCacheStats()).toEqual({ files: 0, bytes: 0, backend: 'browser' })
    // After clear the URL is a miss again and re-fetches.
    await expect(resolveImage(url)).resolves.toBe(url)
  })
})

describe('imageCacheStats / clearImageCache bridge fallbacks', () => {
  it('falls through to IDB when the disk bridge stats reject', async () => {
    vi.stubGlobal('window', { goongrid: { cacheStats: vi.fn().mockRejectedValue(new Error('ipc down')) } })
    expect((await imageCacheStats()).backend).toBe('browser')
  })

  it('uses the disk bridge clear and swallows its failure', async () => {
    const clearCache = vi.fn().mockResolvedValue({ files: 0, bytes: 0 })
    vi.stubGlobal('window', { goongrid: { clearCache } })
    await clearImageCache()
    expect(clearCache).toHaveBeenCalledOnce()
    vi.stubGlobal('window', { goongrid: { clearCache: vi.fn().mockRejectedValue(new Error('nope')) } })
    await expect(clearImageCache()).resolves.toBeUndefined()
  })

  it('falls through to remote when the disk bridge throws', async () => {
    vi.stubGlobal('window', {
      goongrid: { cacheImage: vi.fn().mockRejectedValue(new Error('ipc down')) },
    })
    await expect(resolveImage('https://cdn.test/bridge.png')).resolves.toBe('https://cdn.test/bridge.png')
  })
})

describe('defensive catch branches', () => {
  it('bridge() swallows a throwing window.goongrid getter', async () => {
    const w = {}
    Object.defineProperty(w, 'goongrid', {
      get() {
        throw new Error('getter exploded')
      },
      configurable: true,
    })
    vi.stubGlobal('window', w)
    await expect(resolveImage('https://cdn.test/getter.png')).resolves.toBe('https://cdn.test/getter.png')
  })

  it('idbAvailable() swallows a throwing indexedDB getter', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    try {
      Object.defineProperty(globalThis, 'indexedDB', {
        get() {
          throw new Error('getter exploded')
        },
        configurable: true,
      })
      await expect(resolveImage('https://cdn.test/noidb.png')).resolves.toBe('https://cdn.test/noidb.png')
      await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'none' })
    } finally {
      if (desc) Object.defineProperty(globalThis, 'indexedDB', desc)
    }
  })

  it('openIdb() resolves null when indexedDB.open throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('open exploded')
      },
    } as unknown as IDBFactory)
    await expect(resolveImage('https://cdn.test/openfail.png')).resolves.toBe('https://cdn.test/openfail.png')
    await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'none' })
  })

  it('idbGet/idbPut/idbStats/idbClear swallow throwing store requests', async () => {
    // Warm the module's connection before patching store methods.
    await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'browser' })
    const proto = IDBObjectStore.prototype
    const real = {
      get: proto.get,
      put: proto.put,
      openCursor: proto.openCursor,
      clear: proto.clear,
      count: proto.count,
    }
    const boom = (name: keyof typeof real): void => {
      proto[name] = (() => {
        throw new Error(`${name} exploded`)
      }) as never
    }
    try {
      boom('get')
      await expect(resolveImage('https://unknown.host/getfail.png')).resolves.toBe(
        'https://unknown.host/getfail.png',
      )
      proto.get = real.get
      boom('put')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imgBlob('x'), { status: 200 })))
      await resolveImage(proxied('putfail'))
      await settle()
      proto.put = real.put
      boom('openCursor')
      await expect(imageCacheStats()).resolves.toEqual({ files: 0, bytes: 0, backend: 'browser' })
      proto.openCursor = real.openCursor
      boom('clear')
      await expect(clearImageCache()).resolves.toBeUndefined()
      proto.clear = real.clear
      boom('count')
      await resolveImage(proxied('countfail'))
      await settle()
      proto.count = real.count
    } finally {
      Object.assign(proto, real)
    }
  })

  it('revokeObjectUrls swallows a throwing revoke', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(imgBlob('x'), { status: 200 })))
    const url = proxied('revoketest')
    await resolveImage(url)
    await settle()
    await resolveImage(url) // creates the object URL
    const RealURL = globalThis.URL
    const BrokenURL = function (input: string | URL, base?: string) {
      return new RealURL(input as string, base)
    } as unknown as typeof URL
    ;(BrokenURL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
      RealURL.createObjectURL
    ;(BrokenURL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {
      throw new Error('revoke exploded')
    }
    vi.stubGlobal('URL', BrokenURL)
    await expect(clearImageCache()).resolves.toBeUndefined()
  })
})

describe('devFetchable extra arms', () => {
  it('maps paheal and imhentai subdomains, rejects http', () => {
    expect(devFetchable('https://rule34.paheal.net/_images/a.jpg')).toBe('/booru/paheal/_images/a.jpg')
    expect(devFetchable('https://m11.imhentai.xxx/1/a.jpg')).toBe(
      '/px?u=https%3A%2F%2Fm11.imhentai.xxx%2F1%2Fa.jpg',
    )
    expect(devFetchable('http://tbib.org/images/1/a.jpg')).toBeNull()
  })
})
