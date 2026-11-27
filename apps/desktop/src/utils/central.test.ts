// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getCentralApiUrl, setCentralApiUrl, hasCentral } from './central'

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
  // The node you are connected to IS the directory and the mail relay: a
  // hosted rendezvous is a third party that has to exist, be paid for and be
  // trusted with every sealed envelope's metadata. It is opt-in now.
  it('defaults to NO hosted rendezvous — the node you are on is the meeting point', () => {
    expect(getCentralApiUrl()).toBe('')
    expect(hasCentral()).toBe(false)
  })

  it('respects setCentralApiUrl and localStorage', () => {
    setCentralApiUrl('http://custom-node:9000')
    expect(getCentralApiUrl()).toBe('http://custom-node:9000')
    expect(hasCentral()).toBe(true)
    setCentralApiUrl('')
    expect(getCentralApiUrl()).toBe('')
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
