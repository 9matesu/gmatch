// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * The vault flicker guard.
 *
 * The guard used to read the MODULE-level `vaultLookupSettled` set, which is
 * sticky for the whole session: once a url had been looked up — even on a
 * PREVIOUS visit to the gallery — every later mount of that url read as
 * "settled" the instant it appeared. The tile therefore revealed the remote
 * frame while its own local copy was still on its way, and the local copy
 * swapped in under the player's eyes ("the vault still flickers").
 *
 * The guard must wait for ITS OWN lookup. These tests pin that.
 */
describe('vault lookup hooks', () => {
  const bridge = {
    vaultGet: vi.fn(async (_url: string) => ({ local: null as string | null })),
    vaultHttpUrl: vi.fn(async (_url: string) => ({ local: null as string | null })),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    ;(window as unknown as { gmatch: unknown }).gmatch = bridge
    const mod = await import('./vault')
    mod._resetVaultLookups()
  })

  it('useVaultLookup settles with the local URL — one lookup, one answer', async () => {
    bridge.vaultGet.mockResolvedValueOnce({ local: 'vault://f/abc' })
    const { useVaultLookup } = await import('./vault')

    const { result } = renderHook(() => useVaultLookup('https://x/a.jpg'))

    // Before the lookup answers: not settled, no local URL.
    expect(result.current.settled).toBe(false)
    expect(result.current.local).toBeNull()

    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.local).toBe('vault://f/abc')
    // ONE lookup, not two: the URL and the gate can never disagree.
    expect(bridge.vaultGet).toHaveBeenCalledTimes(1)
  })

  it('useVaultLookup settles with NO local URL when there is no copy', async () => {
    bridge.vaultGet.mockResolvedValueOnce({ local: null })
    const { useVaultLookup } = await import('./vault')

    const { result } = renderHook(() => useVaultLookup('https://x/miss.jpg'))
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.local).toBeNull()
  })

  it('useVaultLookup is settled immediately when there is no url to look up', async () => {
    const { useVaultLookup } = await import('./vault')
    const { result } = renderHook(() => useVaultLookup(null))
    expect(result.current.settled).toBe(true)
    expect(result.current.local).toBeNull()
    expect(bridge.vaultGet).not.toHaveBeenCalled()
  })

  it('useVaultUrlLookups reports each url as settled only after ITS OWN lookup', async () => {
    bridge.vaultGet.mockResolvedValue({ local: null })
    const { useVaultUrlLookups } = await import('./vault')
    const urls = ['https://x/a.jpg', 'https://x/b.jpg']

    const { result } = renderHook(() => useVaultUrlLookups(urls))
    await waitFor(() => expect(result.current.settled.size).toBe(2))
    expect(result.current.settled.has('https://x/a.jpg')).toBe(true)
    expect(result.current.settled.has('https://x/b.jpg')).toBe(true)
  })

  it('a SECOND mount does not inherit the first mount\'s settled state', async () => {
    // THE REGRESSION. The module-level flag stays set after the first mount,
    // so the old guard was already satisfied on re-entry — which is exactly
    // when the remote frame flashed.
    bridge.vaultGet.mockResolvedValue({ local: null })
    const { useVaultUrlLookups, vaultLookupSettled } = await import('./vault')
    const urls = ['https://x/revisit.jpg']

    const first = renderHook(() => useVaultUrlLookups(urls))
    await waitFor(() => expect(first.result.current.settled.has(urls[0])).toBe(true))
    first.unmount()

    // The sticky module-level flag is (correctly) still set...
    expect(vaultLookupSettled(urls[0])).toBe(true)

    // ...but the per-mount set starts EMPTY: the new mount must wait for its
    // own lookup before it reveals anything.
    const second = renderHook(() => useVaultUrlLookups(urls))
    expect(second.result.current.settled.has(urls[0])).toBe(false)

    await waitFor(() => expect(second.result.current.settled.has(urls[0])).toBe(true))
  })
})
