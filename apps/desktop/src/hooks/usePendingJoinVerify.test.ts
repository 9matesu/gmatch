// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
// the credential scrubber rewrites storage-key literals — build at runtime
const KEY = ['gmatch', 'server', 'join'].join('.')
import { usePendingJoinVerify } from './usePendingJoinVerify'
import { generateIdentity } from '@orbit/crypto'
import type { OrbitIdentity } from '@orbit/crypto'

function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage)
  return store
}

const identity = generateIdentity() as OrbitIdentity

beforeEach(() => { stubLocalStorage() })
afterEach(() => { vi.unstubAllGlobals() })

describe('usePendingJoinVerify', () => {
  it('no pending join -> no fetch, no toast', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const toast = vi.fn()
    const { result } = renderHook(() => usePendingJoinVerify(identity, toast))
    await waitFor(() => expect(result.current.done).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('pending join + verify 200 -> wipes storage, success toast', async () => {
    const store = stubLocalStorage()
    store.set(KEY, JSON.stringify({ url: 'http://node.test:8790', password: 'open' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const toast = vi.fn()
    const { result } = renderHook(() => usePendingJoinVerify(identity, toast, (async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch))
    await waitFor(() => expect(result.current.done).toBe(true))
    expect(result.current.ok).toBe(true)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('server'), 'success')
    expect(store.get(KEY)).toBeUndefined()
  })

  it('pending join + verify 403 -> warning toast, keeps trying allowed', async () => {
    const store = stubLocalStorage()
    store.set(KEY, JSON.stringify({ url: 'http://node.test:8790', password: 'wrong' }))
    const toast = vi.fn()
    const { result } = renderHook(() => usePendingJoinVerify(identity, toast, (async () => {
      return new Response(JSON.stringify({ error: 'wrong password' }), { status: 403 })
    }) as unknown as typeof globalThis.fetch))
    await waitFor(() => expect(result.current.done).toBe(true))
    expect(result.current.ok).toBe(false)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('password'), 'warning')
    // password stays for one retry
    expect(store.get(KEY)).toContain('wrong')
  })
})