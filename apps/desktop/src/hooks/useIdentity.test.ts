import { describe, it, expect, beforeEach } from 'vitest'
import { generateIdentity, restoreIdentity } from '@orbit/crypto'

// Mock localStorage for node test environment. Proxy-backed so Object.keys()
// returns stored keys (as real localStorage does) — wipeUserStorage scans it.
const mockStorage: Record<string, string> = {}
const storageImpl = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = String(val) },
  removeItem: (key: string) => { delete mockStorage[key] },
  clear: () => { for (const k of Object.keys(mockStorage)) delete mockStorage[k] },
}
global.localStorage = new Proxy(storageImpl, {
  ownKeys: () => Object.keys(mockStorage),
  getOwnPropertyDescriptor: (_t, k) =>
    typeof k === 'string' && k in mockStorage
      ? { enumerable: true, configurable: true, value: mockStorage[k] }
      : undefined,
}) as unknown as Storage

describe('Identity Export, Import and Logout Cleanup', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k]
  })

  it('generates a valid identity with ed25519 and x25519 keypairs', () => {
    const id = generateIdentity()
    expect(id.orbitId).toHaveLength(64)
    expect(id.privateKeyHex).toHaveLength(64)
    expect(id.publicKeyHex).toHaveLength(64)
    expect(id.encryptionPrivHex).toHaveLength(64)
    expect(id.encryptionPubHex).toHaveLength(64)
  })

  it('restores matching public keys and orbitId from private keys', () => {
    const original = generateIdentity()
    const restored = restoreIdentity(original.privateKeyHex, original.encryptionPrivHex)
    expect(restored.orbitId).toBe(original.orbitId)
    expect(restored.publicKeyHex).toBe(original.publicKeyHex)
    expect(restored.encryptionPubHex).toBe(original.encryptionPubHex)
  })

  it('clears all user-specific metadata and tags on logout', async () => {
    // Populate user metadata
    mockStorage['orbit_identity'] = JSON.stringify(generateIdentity())
    mockStorage['orbit_display_name'] = 'TestUser'
    mockStorage['orbit_tags'] = JSON.stringify(['gamer', 'retro'])
    mockStorage['orbit_pending_tags'] = JSON.stringify(['pending'])
    mockStorage['goonmatch-friends'] = JSON.stringify(['friend-1'])
    mockStorage['orbit_chat_messages'] = JSON.stringify([{ text: 'hi' }])
    // Social-onboarding state (mirrors wipeUserStorage in useIdentity.ts):
    mockStorage['orbit_onboarding_v2:anonymous'] = '{"version":1,"current":"ready","completed":["server","profile","ready"]}'
    mockStorage['orbit_onboarding_v2:deadbeef'] = '{"version":1,"current":"ready","completed":["ready"]}'
    mockStorage['gmatch.onboarding.serverUrl'] = 'http://192.168.0.42:8790'
    mockStorage['orbit_tour_v1:deadbeef'] = '{"version":1,"index":3,"status":"active"}'
    mockStorage['goonMatch_age_verified'] = 'true'

    // Run the REAL wipe (wipeUserStorage is what clearIdentity calls)
    const { wipeUserStorage } = await import('./useIdentity')
    globalThis.window = globalThis as unknown as Window & typeof globalThis
    wipeUserStorage()

    expect(mockStorage['orbit_identity']).toBeUndefined()
    expect(mockStorage['orbit_display_name']).toBeUndefined()
    expect(mockStorage['orbit_tags']).toBeUndefined()
    expect(mockStorage['orbit_pending_tags']).toBeUndefined()
    expect(mockStorage['goonmatch-friends']).toBeUndefined()
    expect(mockStorage['orbit_chat_messages']).toBeUndefined()
    expect(mockStorage['orbit_onboarding_v2:anonymous']).toBeUndefined()
    expect(mockStorage['orbit_onboarding_v2:deadbeef']).toBeUndefined()
    expect(mockStorage['gmatch.onboarding.serverUrl']).toBeUndefined()
    expect(mockStorage['orbit_tour_v1:deadbeef']).toBeUndefined()
    expect(mockStorage['goonMatch_age_verified']).toBe('true') // age survives logout
  })

  it('restores exported JSON identity with tags and display name', () => {
    const baseId = generateIdentity()
    const exportPayload = {
      ...baseId,
      displayName: 'ImportedHero',
      tags: ['alpha', 'omega'],
      version: 1,
    }

    const jsonStr = JSON.stringify(exportPayload)
    const parsed = JSON.parse(jsonStr)
    const restored = restoreIdentity(parsed.privateKeyHex, parsed.encryptionPrivHex)

    expect(restored.orbitId).toBe(baseId.orbitId)
    expect(parsed.displayName).toBe('ImportedHero')
    expect(parsed.tags).toEqual(['alpha', 'omega'])
  })
})
