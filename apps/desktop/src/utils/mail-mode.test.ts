import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectMailMode, cachedMailMode, _resetMailModeCache } from './mail-mode'

function fetchReturning(status: number) {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
}

beforeEach(() => _resetMailModeCache())

describe('courier-mode detection', () => {
  it('404 on /api/pm (inbox route deleted, v1.2.4+) means courier', async () => {
    expect(await detectMailMode('http://site.test', fetchReturning(404))).toBe('courier')
    expect(cachedMailMode('http://site.test/')).toBe('courier')
  })

  it('OLD node still mounting /api/pm (401/200/403) keeps the legacy inbox', async () => {
    for (const status of [200, 401, 403]) {
      _resetMailModeCache()
      expect(await detectMailMode('http://host.test', fetchReturning(status))).toBe('legacy')
    }
  })

  it('network failure falls back to courier (the only mail path on current nodes)', async () => {
    const boom = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await detectMailMode('http://down.test', boom)).toBe('courier')
  })

  it('result is cached after a successful probe', async () => {
    const f = fetchReturning(404)
    await detectMailMode('http://site.test', f)
    await detectMailMode('http://site.test', fetchReturning(200))
    expect(cachedMailMode('http://site.test')).toBe('courier')
  })

  it('concurrent detects share one request', async () => {
    const slowFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return new Response('{}', { status: 401 })
    }) as unknown as typeof fetch
    const [a, b] = await Promise.all([
      detectMailMode('http://x.test', slowFn),
      detectMailMode('http://x.test', slowFn),
    ])
    expect(a).toBe('legacy')
    expect(b).toBe('legacy')
    expect(slowFn).toHaveBeenCalledTimes(1)
  })

  it('identifies official gmatch.fly.dev and goonmatch.fly.dev without probing', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    expect(await detectMailMode('https://gmatch.fly.dev', fetchFn)).toBe('courier')
    expect(await detectMailMode('https://goonmatch.fly.dev/', fetchFn)).toBe('courier')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
