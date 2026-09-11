import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { joinServer } from './join-server'
import { SERVER_MARKER_KEY } from '../firstRun/onboardingState'
import type { DirectoryServer } from '../components/servers/ServersView'

const row: DirectoryServer = { id: 'x', name: 'Budega', owner_id: 'o', password_required: 0, endpoint_hint: '192.168.0.42:8790' }

describe('joinServer', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
    } as Storage)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refuses in a browser build without the desktop bridge', async () => {
    const toast = vi.fn()
    vi.stubGlobal('window', {})
    expect(await joinServer(row, toast)).toBe('failed')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('desktop app'), 'warning')
  })

  it('stamps the onboarding marker and relaunches', async () => {
    const serverSet = vi.fn(async () => ({ ok: true }))
    const serverRelaunch = vi.fn()
    vi.stubGlobal('window', { gmatch: { serverSet, serverRelaunch } })
    expect(await joinServer(row, vi.fn())).toBe('relaunching')
    expect(storage.get(SERVER_MARKER_KEY)).toBe('http://192.168.0.42:8790')
    expect(serverSet).toHaveBeenCalledWith({ mode: 'client', url: 'http://192.168.0.42:8790' })
    expect(serverRelaunch).toHaveBeenCalledOnce()
  })
})
