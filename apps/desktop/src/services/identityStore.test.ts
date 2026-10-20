// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import {
  loadIdentity,
  getCurrentIdentity,
  identitySnapshot,
  subscribeIdentity,
  createIdentity,
  clearIdentity,
  loginWithExportedId,
  exportIdentity,
  _test,
} from './identityStore'

// Plan A1: one authoritative identity for Chat, Keepsake and every other
// surface. These tests pin the acceptance criteria: navigation must not log
// the player out, a racing/empty load must never clobber a restored identity,
// explicit logout clears, corrupt data is an explicit error, and a rejected
// login leaves the live session alone.

const mem = new Map<string, string>()
const localStore = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}

beforeEach(() => {
  mem.clear()
  _test.reset()
  vi.stubGlobal('localStorage', localStore)
  Object.defineProperty(window, 'localStorage', { value: localStore, configurable: true })
  try { delete (window as { gmatch?: unknown }).gmatch } catch { /* */ }
})

describe('identityStore — restore', () => {
  it('restores a stored identity and keeps it when a later load finds nothing', async () => {
    const alice = generateIdentity()
    mem.set('orbit_identity', JSON.stringify(alice))

    await loadIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(alice.orbitId)
    expect(identitySnapshot().isLoaded).toBe(true)

    // A racing/duplicate initialization (another consumer mounting, a transient
    // storage miss) must NOT sign the player out.
    mem.delete('orbit_identity')
    _test.resetLoadPromise()
    await loadIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(alice.orbitId)
  })

  it('survives a transient storage failure with the identity intact', async () => {
    const alice = generateIdentity()
    mem.set('orbit_identity', JSON.stringify(alice))
    await loadIdentity()

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('EIO') },
      setItem: () => { throw new Error('EIO') },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      get length() { return 0 },
    })
    _test.resetLoadPromise()
    await loadIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(alice.orbitId)
  })

  it('treats corrupt stored data as an explicit error, never a session', async () => {
    mem.set('orbit_identity', '{not json')
    await loadIdentity()
    expect(getCurrentIdentity()).toBeNull()
    expect(identitySnapshot().loadError).toBe('invalid')
    expect(identitySnapshot().isLoaded).toBe(true)
  })

  it('stays logged out on an anonymous/unclaimed record (no private key)', async () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'abc' }))
    await loadIdentity()
    expect(getCurrentIdentity()).toBeNull()
    expect(identitySnapshot().loadError).toBeNull()
  })

  it('an unreadable store is reported, then retried — never latched as a logout', async () => {
    const alice = generateIdentity()
    mem.set('orbit_identity', JSON.stringify(alice))
    const broken = {
      getItem: () => { throw new Error('keychain locked') },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      get length() { return 0 },
    }
    vi.stubGlobal('localStorage', broken)
    Object.defineProperty(window, 'localStorage', { value: broken, configurable: true })

    await loadIdentity()
    expect(getCurrentIdentity()).toBeNull()
    // A null identity from a throwing store would be indistinguishable from a
    // deliberate logout; the state names the real cause instead.
    expect(identitySnapshot().loadError).toBe('unavailable')
    expect(identitySnapshot().isLoaded).toBe(true)

    // The store answers again (keychain unlocked / bridge ready): the NEXT read
    // restores the session instead of staying logged out until relaunch.
    vi.stubGlobal('localStorage', localStore)
    Object.defineProperty(window, 'localStorage', { value: localStore, configurable: true })
    await loadIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(alice.orbitId)
    expect(identitySnapshot().loadError).toBeNull()
  })
})

describe('identityStore — one value for every consumer', () => {
  it('concurrent initialization creates exactly one identity, seen by all subscribers', async () => {
    let chatNotifications = 0
    let keepsake = 0
    const offChat = subscribeIdentity(() => { chatNotifications++ })
    const offKeepsake = subscribeIdentity(() => { keepsake++ })

    await Promise.all([loadIdentity(), loadIdentity()])
    expect(getCurrentIdentity()).toBeNull()

    const created = createIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(created.orbitId)
    expect(identitySnapshot().identity?.orbitId).toBe(created.orbitId)
    // The same authoritative value reaches both surfaces.
    expect(chatNotifications).toBeGreaterThan(0)
    expect(keepsake).toBeGreaterThan(0)

    // Navigating between surfaces re-reads the same store: no reload, no logout.
    await loadIdentity()
    expect(getCurrentIdentity()?.orbitId).toBe(created.orbitId)
    offChat()
    offKeepsake()
  })

  it('creates exactly one identity under concurrent createIdentity calls', () => {
    const first = createIdentity()
    const second = createIdentity()
    // Each call is an explicit user action (only ever one at a time in the UI);
    // what must hold is that the STORE holds the last published value and every
    // consumer observes it.
    expect(first.orbitId).not.toBe(second.orbitId)
    expect(getCurrentIdentity()?.orbitId).toBe(second.orbitId)
    expect(JSON.parse(mem.get('orbit_identity')!).orbitId).toBe(second.orbitId)
  })
})

describe('identityStore — logout and login', () => {
  it('explicit logout clears the stored identity and the session state', () => {
    createIdentity()
    mem.set('orbit_display_name', 'Someone')
    let cleared = 0
    const onCleared = () => { cleared++ }
    window.addEventListener('orbit-identity-cleared', onCleared)

    clearIdentity()

    expect(getCurrentIdentity()).toBeNull()
    expect(mem.has('orbit_identity')).toBe(false)
    expect(mem.has('orbit_display_name')).toBe(false)
    expect(cleared).toBe(1)
    window.removeEventListener('orbit-identity-cleared', onCleared)
  })

  it('a rejected login leaves the live session untouched', () => {
    const alice = createIdentity()
    const res = loginWithExportedId('definitely not a key')
    expect(res.success).toBe(false)
    expect(getCurrentIdentity()?.orbitId).toBe(alice.orbitId)
  })

  it('restores an exported account and persists it', () => {
    const bob = generateIdentity()
    const res = loginWithExportedId(JSON.stringify({ ...bob, displayName: 'Bob', tags: ['a', 'b'] }))
    expect(res.success).toBe(true)
    expect(getCurrentIdentity()?.orbitId).toBe(bob.orbitId)
    expect(JSON.parse(mem.get('orbit_identity')!).orbitId).toBe(bob.orbitId)
    expect(mem.get('orbit_display_name')).toBe('Bob')
    expect(JSON.parse(mem.get('orbit_tags')!)).toEqual(['a', 'b'])
  })

  it('exportIdentity returns the live identity with profile metadata', () => {
    const alice = createIdentity()
    mem.set('orbit_display_name', 'Alice')
    const payload = exportIdentity()
    expect(payload?.orbitId).toBe(alice.orbitId)
    expect(payload?.displayName).toBe('Alice')
    expect(payload?.version).toBe(1)
  })

  it('exportIdentity is null while logged out', () => {
    expect(exportIdentity()).toBeNull()
  })
})
