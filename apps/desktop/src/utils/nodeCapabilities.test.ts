import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetNodeCapabilityCache,
  cachedNodeCapability,
  hasStatefulRoutes,
} from './nodeCapabilities'

const answer = (status: number) => vi.fn(async () => ({ status } as Response))

describe('hasStatefulRoutes', () => {
  beforeEach(() => _resetNodeCapabilityCache())

  it('proves a stateful node from an auth failure (route exists)', async () => {
    expect(await hasStatefulRoutes('http://full.test', answer(401) as never)).toBe(true)
  })

  it('treats 404 as a blind courier', async () => {
    expect(await hasStatefulRoutes('http://courier.test', answer(404) as never)).toBe(false)
    expect(cachedNodeCapability('http://courier.test')).toBe(false)
  })

  it('fails closed on a network error', async () => {
    const boom = vi.fn(async () => { throw new Error('offline') })
    expect(await hasStatefulRoutes('http://down.test', boom as never)).toBe(false)
  })

  it('caches per base and ignores a trailing slash', async () => {
    const fetchFn = answer(200)
    expect(await hasStatefulRoutes('http://full.test/', fetchFn as never)).toBe(true)
    expect(await hasStatefulRoutes('http://full.test', fetchFn as never)).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent probes', async () => {
    const fetchFn = answer(401)
    await Promise.all([
      hasStatefulRoutes('http://full.test', fetchFn as never),
      hasStatefulRoutes('http://full.test', fetchFn as never),
    ])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
