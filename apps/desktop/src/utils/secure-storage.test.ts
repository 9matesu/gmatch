// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initSecureStorage,
  getSecureItem,
  setSecureItem,
  removeSecureItem,
  SECURE_KEYS,
  _test,
} from './secure-storage'

// Security plan B.3: Electron builds keep SECURE_KEYS out of localStorage
// (plaintext leveldb). initSecureStorage migrates existing plaintext values
// into the DPAPI-backed main-process KV, then serves the renderer from a RAM
// mirror with async write-through.

// This jsdom build doesn't expose a global localStorage (only document);
// provide a spec-shaped in-memory one for the tests.
function makeLocalStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
  }
}
const localStore = makeLocalStorage()
vi.stubGlobal('localStorage', localStore)
Object.defineProperty(window, 'localStorage', { value: localStore, configurable: true })

function mockBridge() {
  const store = new Map<string, string>()
  const bridge = {
    secureAvailable: vi.fn(async () => true),
    secureGet: vi.fn(async (k: string) => store.get(k) ?? null),
    secureSet: vi.fn(async (k: string, v: string) => { store.set(k, v) }),
    secureDelete: vi.fn(async (k: string) => { store.delete(k) }),
  }
  vi.stubGlobal('window', Object.assign(window, { gmatch: bridge }))
  return { store, bridge }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', localStore)
  localStore.clear()
  _test.reset()
  try { delete (window as { gmatch?: unknown }).gmatch } catch { /* */ }
})

describe('secure-storage (Electron path)', () => {
  it('migrates plaintext localStorage → secure KV and PURGES localStorage', async () => {
    const identity = JSON.stringify({ orbitId: 'abc', privateKeyHex: 'deadbeef' })
    localStorage.setItem('orbit_identity', identity)
    const { store, bridge } = mockBridge()
    await initSecureStorage()
    // moved into the KV:
    expect(store.get('orbit_identity')).toBe(identity)
    expect(bridge.secureSet).toHaveBeenCalledWith('orbit_identity', identity)
    // gone from localStorage:
    expect(localStorage.getItem('orbit_identity')).toBeNull()
    // still readable synchronously from the RAM mirror:
    expect(getSecureItem('orbit_identity')).toBe(identity)
  })

  it('KV value wins over a stale localStorage copy', async () => {
    localStorage.setItem('orbit_identity', 'STALE')
    const { store } = mockBridge()
    store.set('orbit_identity', 'FRESH')
    await initSecureStorage()
    expect(getSecureItem('orbit_identity')).toBe('FRESH')
    expect(localStorage.getItem('orbit_identity')).toBeNull()
  })

  it('set writes RAM + async-through to the KV and never localStorage', async () => {
    const { bridge } = mockBridge()
    await initSecureStorage()
    setSecureItem('orbit_identity', 'V')
    expect(getSecureItem('orbit_identity')).toBe('V')
    expect(localStorage.getItem('orbit_identity')).toBeNull()
    await vi.waitFor(() => expect(bridge.secureSet).toHaveBeenCalledWith('orbit_identity', 'V'))
  })

  it('remove deletes from RAM + KV', async () => {
    mockBridge()
    await initSecureStorage()
    setSecureItem('orbit_identity', 'V')
    removeSecureItem('orbit_identity')
    expect(getSecureItem('orbit_identity')).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    const b = (window as unknown as { gmatch: { secureDelete: ReturnType<typeof vi.fn> } }).gmatch
    expect(b.secureDelete.mock.calls.some(([k]) => k === 'orbit_identity')).toBe(true)
  })

  it('beforeunload forces a KV flush of pending writes', async () => {
    const { bridge } = mockBridge()
    await initSecureStorage()
    setSecureItem('orbit_identity', 'LAST')
    window.dispatchEvent(new Event('beforeunload'))
    await new Promise((r) => setTimeout(r, 0))
    expect(bridge.secureSet).toHaveBeenCalledWith('orbit_identity', 'LAST')
  })

  it('SECURE_KEYS covers identity, admin identity, courier threads, pfps', () => {
    expect(SECURE_KEYS).toContain('orbit_identity')
    expect(SECURE_KEYS).toContain('orbit_admin_identity')
    expect(SECURE_KEYS).toContain('orbit_mail_threads_v1')
    expect(SECURE_KEYS).toContain('goonmatch_pfps')
  })
})

describe('secure-storage (browser fallback)', () => {
  it('without the bridge it behaves exactly like localStorage', async () => {
    await initSecureStorage() // no window.gmatch — plain mode
    localStorage.setItem('orbit_identity', 'X')
    expect(getSecureItem('orbit_identity')).toBe('X')
    setSecureItem('orbit_identity', 'Y')
    expect(localStorage.getItem('orbit_identity')).toBe('Y')
    removeSecureItem('orbit_identity')
    expect(localStorage.getItem('orbit_identity')).toBeNull()
  })
})
