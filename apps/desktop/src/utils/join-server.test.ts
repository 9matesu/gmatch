import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { joinServer } from './join-server'
import { SERVER_MARKER_KEY } from '../firstRun/onboardingState'
import type { DirectoryServer } from '../components/servers/ServersView'

const row: DirectoryServer = { id: 'x', name: 'Budega', owner_id: 'o', password_required: 0, endpoint_hint: '192.168.0.42:8790' }

function healthyFetch() {
  return vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response(JSON.stringify({}), { status: 404 })
  })
}

describe('joinServer', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
    } as Storage)
    vi.stubGlobal('fetch', healthyFetch())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refuses when the destination is unreachable and writes nothing', async () => {
    const toast = vi.fn()
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await joinServer(row, toast, async () => null)).toBe('failed')
    expect(storage.get(SERVER_MARKER_KEY)).toBeUndefined()
  })

  it('stamps the onboarding marker and connects in-app without relaunch', async () => {
    const serverSet = vi.fn(async () => ({ ok: true }))
    const serverRelaunch = vi.fn()
    vi.stubGlobal('window', { gmatch: { serverSet, serverRelaunch } })
    expect(await joinServer(row, vi.fn(), async () => null)).toBe('connected')
    expect(storage.get(SERVER_MARKER_KEY)).toBe('http://192.168.0.42:8790')
    expect(serverSet).toHaveBeenCalledWith({ mode: 'client', url: 'http://192.168.0.42:8790' })
    expect(serverRelaunch).not.toHaveBeenCalled()
  })
})
