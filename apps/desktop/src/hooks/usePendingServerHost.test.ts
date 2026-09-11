// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { claimPendingHost } from './usePendingServerHost'
import { rememberPendingHost, peekPendingHost } from '../utils/server-host-pending'
import { _test as secureTest } from '../utils/secure-storage'
import { generateIdentity } from '@orbit/crypto'

const identity = generateIdentity() as never

const HOST_KEY = ['gmatch', 'server', 'host'].join('.')

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
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  secureTest.reset()
  stubLocalStorage()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('claimPendingHost (create-server host claim)', () => {
  it('no pending record -> no-op', async () => {
    const fetchMock = vi.fn()
    const toasts: string[] = []
    expect(await claimPendingHost(identity, (m) => toasts.push(m), fetchMock as never)).toBe('none')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('admin node: renames, links directory id, applies password, wipes pending', async () => {
    rememberPendingHost({ name: 'My Realm', description: 'home', password: 'secret', directoryId: 'd'.repeat(64) })
    const seen: { url: string; method?: string; body?: string }[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      seen.push({ url, method: init?.method, body: init?.body ? String(init.body) : undefined })
      if (url.includes('/api/servers/node')) {
        if (init?.method === 'PATCH') return json({ server: { name: 'My Realm', isAdmin: true } })
        return json({ name: 'gmatch', description: '', directoryId: null, isAdmin: true })
      }
      if (url.includes('/api/server/password')) return json({ enabled: true })
      return json({})
    })
    const toasts: string[] = []
    const out = await claimPendingHost(identity, (m) => toasts.push(m), fetchMock as unknown as typeof globalThis.fetch)
    expect(out).toBe('ok')
    const patch = seen.find((s) => s.url.includes('/api/servers/node') && s.method === 'PATCH')
    expect(JSON.parse(patch!.body!)).toMatchObject({ name: 'My Realm', description: 'home', directory_id: 'd'.repeat(64) })
    const pw = seen.find((s) => s.url.includes('/api/server/password'))
    expect(JSON.parse(pw!.body!)).toMatchObject({ password: 'secret' })
    expect(toasts.join('|')).toMatch(/you are its admin/i)
    expect(peekPendingHost()).toBeNull()
  })

  it('node owned by someone else: pending is wiped with an error, never renamed', async () => {
    rememberPendingHost({ name: 'Hijack' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/servers/node') && init?.method === 'PATCH') throw new Error('must not PATCH')
      if (String(input).includes('/api/servers/node')) return json({ name: 'gmatch', isAdmin: false })
      return json({})
    })
    const toasts: string[] = []
    expect(await claimPendingHost(identity, (m) => toasts.push(m), fetchMock as unknown as typeof globalThis.fetch)).toBe('taken')
    expect(toasts.join('|')).toMatch(/canceled/i)
    expect(peekPendingHost()).toBeNull()
  })

  it('sidecar still booting: keep pending for the retry tick', async () => {
    rememberPendingHost({ name: 'My Realm' })
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    const toasts: string[] = []
    expect(await claimPendingHost(identity, (m) => toasts.push(m), fetchMock as unknown as typeof globalThis.fetch)).toBe('retry')
    expect(peekPendingHost()).not.toBeNull()
    expect(toasts).toHaveLength(0)
  })
})
