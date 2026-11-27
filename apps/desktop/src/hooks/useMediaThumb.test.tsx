// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const store = vi.hoisted(() => ({
  peek: vi.fn((): string | null => null),
  get: vi.fn(async (): Promise<string | null> => null),
  pin: vi.fn(),
  unpin: vi.fn(),
}))

const runtime = vi.hoisted(() => ({ capable: true }))

vi.mock('../utils/mediaThumb', async (importActual) => {
  const actual = await importActual<typeof import('../utils/mediaThumb')>()
  // jsdom has no `createImageBitmap`; these tests are about the hook's own
  // lifecycle, so the runtime capability is explicit and switchable.
  return { ...actual, mediaThumbStore: () => store, canGenerateThumbs: () => runtime.capable }
})

import { useMediaThumb, type MediaThumbState } from './useMediaThumb'

beforeEach(() => {
  vi.clearAllMocks()
  runtime.capable = true
  store.peek.mockReturnValue(null)
  store.get.mockResolvedValue('blob:thumb')
})

describe('useMediaThumb', () => {
  it('does no work at all when the caller did not ask for a thumbnail', () => {
    const { result } = renderHook(() => useMediaThumb('blob:x', false))
    expect(result.current).toEqual<MediaThumbState>({ url: null, pending: false })
    expect(store.peek).not.toHaveBeenCalled()
    expect(store.pin).not.toHaveBeenCalled()
  })

  it('answers idle for a source with no renderer thumbnailer', () => {
    const { result } = renderHook(() => useMediaThumb('https://cdn.example/a.jpg', true))
    expect(result.current).toEqual<MediaThumbState>({ url: null, pending: false })
    expect(store.get).not.toHaveBeenCalled()
  })

  it('reports pending, then the generated url', async () => {
    const { result } = renderHook(() => useMediaThumb('blob:x', true))
    expect(result.current.pending).toBe(true)
    await waitFor(() =>
      expect(result.current).toEqual<MediaThumbState>({ url: 'blob:thumb', pending: false }),
    )
  })

  it('uses a cached thumbnail without a pending frame', () => {
    store.peek.mockReturnValue('blob:cached')
    const { result } = renderHook(() => useMediaThumb('blob:x', true))
    expect(result.current).toEqual<MediaThumbState>({ url: 'blob:cached', pending: false })
    expect(store.get).not.toHaveBeenCalled()
  })

  it('settles to full-size when no thumbnail could be made', async () => {
    store.get.mockResolvedValue(null)
    const { result } = renderHook(() => useMediaThumb('blob:x', true))
    expect(result.current.pending).toBe(true)
    await waitFor(() =>
      expect(result.current).toEqual<MediaThumbState>({ url: null, pending: false }),
    )
  })

  it('pins while mounted and unpins on unmount', async () => {
    const { unmount } = renderHook(() => useMediaThumb('blob:x', true))
    await waitFor(() => expect(store.pin).toHaveBeenCalledWith('blob:x'))
    unmount()
    expect(store.unpin).toHaveBeenCalledWith('blob:x')
  })

  it('does nothing when the runtime cannot generate thumbnails', () => {
    // No `createImageBitmap` (a test/embedded runtime): never park a tile
    // behind a thumbnail that can never be produced.
    runtime.capable = false
    const { result } = renderHook(() => useMediaThumb('blob:x', true))
    expect(result.current).toEqual<MediaThumbState>({ url: null, pending: false })
    expect(store.get).not.toHaveBeenCalled()
    expect(store.pin).not.toHaveBeenCalled()
  })
})