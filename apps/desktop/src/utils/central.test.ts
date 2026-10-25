// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getCentralApiUrl, setCentralApiUrl, hasCentral, COURIER_ORIGIN } from './central'

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('central utils', () => {
  it('defaults to the Cloudflare courier (directory + mail rendezvous)', () => {
    expect(getCentralApiUrl()).toBe(COURIER_ORIGIN)
    expect(COURIER_ORIGIN).toBe('https://gmatch.pages.dev')
    expect(hasCentral()).toBe(true)
  })

  it('respects setCentralApiUrl and localStorage', () => {
    setCentralApiUrl('http://custom-node:9000')
    expect(getCentralApiUrl()).toBe('http://custom-node:9000')
    setCentralApiUrl('')
    expect(getCentralApiUrl()).toBe(COURIER_ORIGIN)
  })

  it('handles "none" central keyword', () => {
    setCentralApiUrl('none')
    expect(getCentralApiUrl()).toBe('')
    expect(hasCentral()).toBe(false)
  })
})
