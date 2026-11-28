// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_CENTRAL_URL, getCentralApiUrl, setCentralApiUrl, hasCentral } from './central'

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
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('central utils', () => {
  // A free, blind Worker is the default meeting point so mail and discovery
  // still work when no peer's node is reachable. It holds only ciphertext and
  // directory metadata — the world stays on each install's own node.
  it('defaults to the deployed blind rendezvous', () => {
    expect(getCentralApiUrl()).toBe(DEFAULT_CENTRAL_URL)
    expect(hasCentral()).toBe(true)
  })

  it('lets VITE_CENTRAL_URL override the default', () => {
    vi.stubEnv('VITE_CENTRAL_URL', 'https://my-node.example:9000')
    expect(getCentralApiUrl()).toBe('https://my-node.example:9000')
  })

  it('lets VITE_CENTRAL_URL=none opt out', () => {
    vi.stubEnv('VITE_CENTRAL_URL', 'none')
    expect(getCentralApiUrl()).toBe('')
    expect(hasCentral()).toBe(false)
  })

  it('respects setCentralApiUrl and localStorage', () => {
    setCentralApiUrl('http://custom-node:9000')
    expect(getCentralApiUrl()).toBe('http://custom-node:9000')
    expect(hasCentral()).toBe(true)
    setCentralApiUrl('') // clearing the override returns to the default rendezvous
    expect(getCentralApiUrl()).toBe(DEFAULT_CENTRAL_URL)
  })

  it('handles "none" central keyword', () => {
    setCentralApiUrl('none')
    expect(getCentralApiUrl()).toBe('')
    expect(hasCentral()).toBe(false)
  })

  // The Pages origin used to run the blind courier. It is a STATIC release
  // page now: there is no mailbox and no directory behind it, so a pointer to
  // it is dropped instead of dialed (an old install must not keep talking to
  // a service that no longer exists).
  it('drops a pointer to the retired Pages rendezvous instead of dialing it', () => {
    setCentralApiUrl('https://gmatch.pages.dev')
    expect(getCentralApiUrl()).toBe('')
    expect(hasCentral()).toBe(false)
  })

  it('drops the Pages preview subdomains too', () => {
    setCentralApiUrl('https://preview.gmatch.pages.dev')
    expect(getCentralApiUrl()).toBe('')
  })
})
