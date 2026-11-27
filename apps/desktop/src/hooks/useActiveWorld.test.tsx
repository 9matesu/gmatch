// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useActiveWorld } from './useActiveWorld'
import { DEFAULT_WORLD_ID, getActiveWorldId, setActiveWorldId, worldIdForAddress } from '../utils/serverWorlds'

const storage: Record<string, string> = {}
function stubStorage() {
  for (const k of Object.keys(storage)) delete storage[k]
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
  } as Storage)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setActiveWorldId(DEFAULT_WORLD_ID)
})

describe('useActiveWorld', () => {
  it('defaults to the official world and seeds the shared accessor', () => {
    stubStorage()
    const { result } = renderHook(() => useActiveWorld())
    expect(result.current).toBe(DEFAULT_WORLD_ID)
    expect(getActiveWorldId()).toBe(DEFAULT_WORLD_ID)
  })

  it('derives a world id from the committed client address', () => {
    stubStorage()
    storage['gmatch.api.url'] = 'http://192.168.0.42:8790'
    const { result } = renderHook(() => useActiveWorld())
    const expected = worldIdForAddress('http://192.168.0.42:8790')
    expect(result.current).toBe(expected)
    expect(getActiveWorldId()).toBe(expected)
  })

  it('confirms the authoritative id from server:state', async () => {
    stubStorage()
    vi.stubGlobal('gmatch', {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'http://x:8790', lanUrls: [], worldId: 'w_deadbeef' }),
    })
    const { result } = renderHook(() => useActiveWorld())
    await waitFor(() => expect(result.current).toBe('w_deadbeef'))
    expect(getActiveWorldId()).toBe('w_deadbeef')
  })
})
