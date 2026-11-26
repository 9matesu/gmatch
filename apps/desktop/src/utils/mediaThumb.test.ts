import { describe, expect, it, vi } from 'vitest'
import {
  THUMB_CACHE_MAX,
  canGenerateThumbs,
  createMediaThumbStore,
  isThumbEligible,
  type MediaThumbDeps,
} from './mediaThumb'

function makeDeps(overrides: Partial<MediaThumbDeps> = {}) {
  let seq = 0
  const deps: MediaThumbDeps = {
    load: vi.fn(async () => new Blob(['full-bytes'], { type: 'image/jpeg' })),
    render: vi.fn(async () => new Blob(['thumb-bytes'], { type: 'image/webp' })),
    createUrl: vi.fn(() => `blob:thumb-${++seq}`),
    revokeUrl: vi.fn(),
    now: () => 1_000,
    ...overrides,
  }
  return deps
}

describe('isThumbEligible', () => {
  it('leaves the main-process cache to its own thumbnailer', () => {
    expect(isThumbEligible('gmcache://f/abc.jpg')).toBe(false)
    expect(isThumbEligible('gmcache://thumb/abc.jpg')).toBe(false)
  })

  it('never re-encodes inline or remote bytes', () => {
    expect(isThumbEligible('data:image/png;base64,AAAA')).toBe(false)
    expect(isThumbEligible('https://cdn.example.com/a.jpg')).toBe(false)
    expect(isThumbEligible('http://booru.example/a.jpg')).toBe(false)
  })

  it('accepts the local stores that have no other resizer', () => {
    expect(isThumbEligible('blob:http://localhost/x')).toBe(true)
    expect(isThumbEligible('vault://f/deadbeef')).toBe(true)
    expect(isThumbEligible('http://127.0.0.1:9310/vault/x')).toBe(true)
    expect(isThumbEligible('http://localhost:9310/vault/x')).toBe(true)
  })

  it('rejects empty input', () => {
    expect(isThumbEligible(null)).toBe(false)
    expect(isThumbEligible(undefined)).toBe(false)
    expect(isThumbEligible('   ')).toBe(false)
  })
})

describe('canGenerateThumbs', () => {
  it('is false in a runtime with no document / createImageBitmap', () => {
    // This suite runs in node: no DOM. A caller must degrade to the original
    // instead of parking a tile behind a thumbnail that can never be produced.
    expect(canGenerateThumbs()).toBe(false)
  })
})

describe('createMediaThumbStore', () => {
  it('generates once and reuses the same url', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps)
    const a = await store.get('blob:a')
    const b = await store.get('blob:a')
    expect(a).toBe('blob:thumb-1')
    expect(b).toBe(a)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(store.size()).toBe(1)
  })

  it('dedupes concurrent requests for the same source', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps)
    const [a, b] = await Promise.all([store.get('blob:a'), store.get('blob:a')])
    expect(a).toBe(b)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(deps.render).toHaveBeenCalledTimes(1)
  })

  it('answers null when the source is not worth a thumbnail', async () => {
    const deps = makeDeps({ render: vi.fn(async () => null) })
    const store = createMediaThumbStore(deps)
    expect(await store.get('blob:tiny')).toBeNull()
    expect(store.size()).toBe(0)
    expect(deps.createUrl).not.toHaveBeenCalled()
  })

  it('answers null (and falls back) when loading or rendering throws', async () => {
    const load = vi.fn(async () => { throw new Error('boom') })
    const store = createMediaThumbStore(makeDeps({ load }))
    expect(await store.get('blob:broken')).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('remembers a failure briefly, then retries', async () => {
    let clock = 1_000
    const load = vi
      .fn<MediaThumbDeps['load']>()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue(new Blob(['ok'], { type: 'image/jpeg' }))
    const store = createMediaThumbStore(makeDeps({ load, now: () => clock }), { failTtlMs: 500 })

    expect(await store.get('blob:flaky')).toBeNull()
    expect(await store.get('blob:flaky')).toBeNull() // inside the failure window
    expect(load).toHaveBeenCalledTimes(1)

    clock += 501
    expect(await store.get('blob:flaky')).toBe('blob:thumb-1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entry and revokes its url', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps, { max: 2 })

    await store.get('blob:a')
    await store.get('blob:b')
    await store.get('blob:a') // refresh recency: b is now the oldest
    await store.get('blob:c')

    expect(store.size()).toBe(2)
    expect(store.peek('blob:b')).toBeNull()
    expect(store.peek('blob:a')).toBe('blob:thumb-1')
    expect(deps.revokeUrl).toHaveBeenCalledWith('blob:thumb-2')
  })

  it('never evicts a pinned (mounted) entry', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps, { max: 1 })

    await store.get('blob:a')
    store.pin('blob:a')
    await store.get('blob:b')

    // The bound yields to a mounted tile: revoking its url would blank it.
    expect(store.peek('blob:a')).toBe('blob:thumb-1')
    expect(store.size()).toBe(2)
    expect(deps.revokeUrl).not.toHaveBeenCalled()

    store.unpin('blob:a')
    await store.get('blob:c')
    expect(store.peek('blob:a')).toBeNull()
  })

  it('counts pins per mount', async () => {
    const store = createMediaThumbStore(makeDeps(), { max: 1 })
    await store.get('blob:a')
    store.pin('blob:a')
    store.pin('blob:a')
    store.unpin('blob:a')
    await store.get('blob:b')
    // Still pinned once: it survives.
    expect(store.peek('blob:a')).toBe('blob:thumb-1')
    store.unpin('blob:a')
    await store.get('blob:c')
    expect(store.peek('blob:a')).toBeNull()
  })

  it('clear revokes every url and empties the store', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps)
    await store.get('blob:a')
    await store.get('blob:b')
    store.clear()
    expect(store.size()).toBe(0)
    expect(deps.revokeUrl).toHaveBeenCalledTimes(2)
  })

  it('defaults to the documented bound', async () => {
    const deps = makeDeps()
    const store = createMediaThumbStore(deps)
    for (let i = 0; i < THUMB_CACHE_MAX + 5; i++) await store.get(`blob:${i}`)
    expect(store.size()).toBe(THUMB_CACHE_MAX)
  })
})