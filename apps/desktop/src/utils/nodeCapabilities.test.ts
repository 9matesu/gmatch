import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import {
  _resetNodeCapabilityCache,
  cachedNodeCapability,
  hasStatefulRoutes,
} from './nodeCapabilities'

const answer = (status: number) => vi.fn(async () => ({ status } as Response))

const IDENTITY = generateIdentity()

describe('hasStatefulRoutes', () => {
  beforeEach(() => _resetNodeCapabilityCache())

  it('proves a stateful node from an auth failure (route exists)', async () => {
    expect(await hasStatefulRoutes('http://full.test', null, answer(401) as never)).toBe(true)
  })

  it('sends signed headers when an identity is given (full node answers 200, no 401 noise)', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      ({ status: 200, ok: true } as Response)) as unknown as typeof fetch
    expect(await hasStatefulRoutes('http://full.test', IDENTITY, fetchFn)).toBe(true)
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    const headers = init.headers as Headers
    expect(headers.get('X-Orbit-Id')).toBe(IDENTITY.orbitId)
    expect(headers.get('X-Orbit-Signature')).toBeTruthy()
  })

  it('treats 404 as a blind courier', async () => {
    expect(await hasStatefulRoutes('http://courier.test', null, answer(404) as never)).toBe(false)
    expect(cachedNodeCapability('http://courier.test')).toBe(false)
  })

  it('fails closed on a network error', async () => {
    const boom = vi.fn(async () => { throw new Error('offline') })
    expect(await hasStatefulRoutes('http://down.test', null, boom as never)).toBe(false)
  })

  it('caches per base and ignores a trailing slash', async () => {
    const fetchFn = answer(200)
    expect(await hasStatefulRoutes('http://full.test/', null, fetchFn as never)).toBe(true)
    expect(await hasStatefulRoutes('http://full.test', null, fetchFn as never)).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent probes', async () => {
    const fetchFn = answer(401)
    await Promise.all([
      hasStatefulRoutes('http://full.test', null, fetchFn as never),
      hasStatefulRoutes('http://full.test', null, fetchFn as never),
    ])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
