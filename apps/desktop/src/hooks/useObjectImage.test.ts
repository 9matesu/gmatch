// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

// The LRU in useObjectImage caps at 24 entries. A feed with more than 24
// object-backed posts evicts the earlier ones — and the current eviction path
// calls URL.revokeObjectURL unconditionally, killing the blob URL that a
// mounted <img>/<video> is still pointing at. That is the "loads, then flips
// to Image unavailable / No preview" report.
const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }

vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn(async (url: string) => {
    const id = String(url).split('/').pop() || 'x'
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => new Blob([id], { type: 'image/png' }),
    }
  }),
}))

let blobSeq = 0
const createSpy = vi.fn(() => `blob:obj-${++blobSeq}`)
const revokeSpy = vi.fn()

beforeEach(async () => {
  blobSeq = 0
  createSpy.mockClear()
  revokeSpy.mockClear()
  const { __resetObjectImageCacheForTests } = await import('./useObjectImage')
  __resetObjectImageCacheForTests()
  // jsdom has no createObjectURL. Assign onto the existing URL object — do NOT
  // replace the global, `new URL()` must keep working for the other modules.
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy
})

afterEach(() => {
  cleanup()
})

describe('useObjectImage magic-byte video sniffing', () => {
  it('marks typeless local bytes with mp4 magic as video', async () => {
    const { useObjectImage } = await import('./useObjectImage')
    const { registerLocalObject } = await import('../utils/p2pSwarm')
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0])
    registerLocalObject('vid-sniff-1', new Blob([mp4], { type: '' }))

    const h = renderHook(() => useObjectImage('vid-sniff-1', identity))
    await waitFor(() => expect(h.result.current.url).toMatch(/^blob:/))
    expect(h.result.current.isVideo).toBe(true)
    expect(h.result.current.failed).toBe(false)
    h.unmount()
  })

  it('keeps concrete image bytes as image (no sniff override)', async () => {
    const { useObjectImage } = await import('./useObjectImage')
    const { registerLocalObject } = await import('../utils/p2pSwarm')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    registerLocalObject('img-sniff-1', new Blob([png], { type: 'image/png' }))

    const h = renderHook(() => useObjectImage('img-sniff-1', identity))
    await waitFor(() => expect(h.result.current.url).toMatch(/^blob:/))
    expect(h.result.current.isVideo).toBe(false)
    h.unmount()
  })
})

describe('useObjectImage eviction (signed media vanish)', () => {
  it('never revokes the blob URL of a still-mounted entry when the cap overflows', async () => {
    const { useObjectImage } = await import('./useObjectImage')

    const pinned = renderHook(() => useObjectImage('obj-000', identity))
    await waitFor(() => expect(pinned.result.current.url).toMatch(/^blob:/))
    const liveUrl = pinned.result.current.url as string

    // Overflow the 24-slot LRU with 40 other objects. Each is unmounted right
    // after it resolves, so only the first one stays mounted.
    for (let i = 1; i <= 40; i += 1) {
      const h = renderHook(() =>
        useObjectImage(`obj-${String(i).padStart(3, '0')}`, identity),
      )
      await waitFor(() =>
        expect(Boolean(h.result.current.url) || h.result.current.failed).toBe(true),
      )
      h.unmount()
    }

    // The mounted entry still points at liveUrl — it must never have been revoked.
    expect(revokeSpy).not.toHaveBeenCalledWith(liveUrl)

    pinned.unmount()
  })
})