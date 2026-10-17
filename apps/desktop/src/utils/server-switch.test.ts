import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { switchClientWorld, _resetSwitchSeqForTests } from './server-switch'
import { SERVER_MARKER_KEY } from '../firstRun/onboardingState'

const TARGET = { name: 'Budega', endpointHint: '192.168.0.42:8790' }
const URL = 'http://192.168.0.42:8790'

function okFetch(extra?: (url: string) => Response | null) {
  return vi.fn(async (url: string) => {
    const hit = extra?.(String(url))
    if (hit) return hit
    if (String(url).endsWith('/api/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (String(url).endsWith('/api/servers/dashboard')) return new Response(JSON.stringify({ users: [] }), { status: 200 })
    return new Response(JSON.stringify({}), { status: 404 })
  })
}

describe('switchClientWorld', () => {
  const storage = new Map<string, string>()
  const cookie: { value: string } = { value: '' }
  beforeEach(() => {
    storage.clear()
    _resetSwitchSeqForTests()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
    } as Storage)
    vi.stubGlobal('window', {
      gmatch: { serverSet: vi.fn(async () => ({ ok: true })) },
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('document', { get cookie() { return cookie.value }, set cookie(v: string) { cookie.value = v } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('commits marker, override, cookie and persists without relaunch', async () => {
    const toast = vi.fn()
    const out = await switchClientWorld(TARGET, { toast, identity: { orbitId: 'o' }, fetchImpl: okFetch() })
    expect(out).toBe('switched')
    expect(storage.get(SERVER_MARKER_KEY)).toBe(URL)
    expect(storage.get('gmatch.api.url')).toBe(URL)
    expect(cookie.value).toContain(encodeURIComponent(URL))
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('restarts'), expect.anything())
  })

  it('probe failure writes nothing and keeps the previous world', async () => {
    storage.set('gmatch.api.url', 'http://old:8790')
    storage.set(SERVER_MARKER_KEY, 'http://old:8790')
    const toast = vi.fn()
    const out = await switchClientWorld(TARGET, {
      toast, identity: { orbitId: 'o' },
      fetchImpl: vi.fn(async () => { throw new Error('down') }),
    })
    expect(out).toBe('failed')
    expect(storage.get('gmatch.api.url')).toBe('http://old:8790')
    expect(storage.get(SERVER_MARKER_KEY)).toBe('http://old:8790')
  })

  it('rejects courier hosts as data destinations', async () => {
    const toast = vi.fn()
    const out = await switchClientWorld(
      { name: 'Central', endpointHint: 'https://gmatch-wcz1.onrender.com' },
      { toast, fetchImpl: okFetch() },
    )
    expect(out).toBe('failed')
    expect(storage.get('gmatch.api.url')).toBeUndefined()
  })

  it('restores previous persistence when serverSet fails', async () => {
    storage.set('gmatch.api.url', 'http://old:8790')
    vi.stubGlobal('window', {
      gmatch: { serverSet: vi.fn(async () => ({ ok: false, error: 'nope' })) },
      dispatchEvent: vi.fn(),
    })
    const toast = vi.fn()
    const out = await switchClientWorld(TARGET, { toast, fetchImpl: okFetch() })
    expect(out).toBe('failed')
    expect(storage.get('gmatch.api.url')).toBe('http://old:8790')
    expect(toast).toHaveBeenCalledWith('nope', 'error')
  })

  it('concurrent attempts: only the newest notifies', async () => {
    const dispatched: string[] = []
    vi.stubGlobal('window', {
      gmatch: { serverSet: vi.fn(async () => ({ ok: true })) },
      dispatchEvent: (e: CustomEvent) => void dispatched.push(e.type),
    })
    let release!: () => void
    const gate = new Promise<Response>((resolve) => { release = () => resolve(new Response('{}', { status: 200 })) })
    const slowFetch = vi.fn(async () => gate)
    const toast = vi.fn()
    const first = switchClientWorld(TARGET, { toast, fetchImpl: slowFetch })
    const second = switchClientWorld({ name: 'Other', endpointHint: '10.0.0.9:8790' }, { toast, fetchImpl: okFetch() })
    release()
    expect(await first).toBe('stale')
    expect(await second).toBe('switched')
    expect(dispatched.filter((t) => t === 'gmatch-api-base-changed')).toHaveLength(1)
  })
})
