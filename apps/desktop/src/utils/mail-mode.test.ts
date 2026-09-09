import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectMailMode, cachedMailMode, _resetMailModeCache } from './mail-mode'

function fetchReturning(status: number) {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
}

beforeEach(() => _resetMailModeCache())

describe('courier-mode detection', () => {
  it('404 on /api/pm means SITE (blind courier)', async () => {
    expect(await detectMailMode('http://site.test', fetchReturning(404))).toBe('courier')
    expect(cachedMailMode('http://site.test/')).toBe('courier')
  })

  it('401/200/403 on /api/pm means full node (legacy inbox)', async () => {
    for (const status of [200, 401, 403]) {
      _resetMailModeCache()
      expect(await detectMailMode('http://host.test', fetchReturning(status))).toBe('legacy')
    }
  })

  it('network failure falls back to legacy (never a dead end)', async () => {
    const boom = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await detectMailMode('http://down.test', boom)).toBe('legacy')
  })

  it('result is cached after a successful probe', async () => {
    const f = fetchReturning(404)
    await detectMailMode('http://site.test', f)
    await detectMailMode('http://site.test', fetchReturning(200))
    expect(cachedMailMode('http://site.test')).toBe('courier')
  })
})
