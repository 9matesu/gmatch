import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CONFIG_SCHEMA,
  CONFIG_VERSION,
  parseConfigBundle,
  applyConfigBundle,
  configDownloadFilename,
  readRawSettings,
} from './configBackup'

const identity = {
  orbitId: 'abc123def456',
  publicKeyHex: 'pubkeyhex',
  privateKeyHex: 'privkeyhex',
  encryptionPubKey: 'encpub',
  encryptionPubHex: 'encpubhex',
  encryptionPrivHex: 'encpriv',
  displayName: 'Tester',
  tags: ['chill'],
  version: 1,
  exportedAt: new Date().toISOString(),
}

function mockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    _store: store,
  }
}

beforeEach(() => {
  const ls = mockLocalStorage()
  ;(globalThis as any).localStorage = ls
  ;(globalThis as any).window = globalThis
})

afterEach(() => {
  delete (globalThis as any).localStorage
  delete (globalThis as any).window
})

describe('config backup bundle', () => {
  it('parseConfigBundle accepts a valid bundle and rejects malformed input', () => {
    const bundle = { schema: CONFIG_SCHEMA, version: CONFIG_VERSION, exportedAt: 'now', identity }
    const parsed = parseConfigBundle(JSON.stringify(bundle))
    expect(parsed).toBeTruthy()
    expect(parsed!.identity.privateKeyHex).toBe('privkeyhex')

    expect(parseConfigBundle('not json')).toBeNull()
    expect(parseConfigBundle(JSON.stringify({ schema: 'other', identity }))).toBeNull()
    expect(parseConfigBundle(JSON.stringify({ schema: CONFIG_SCHEMA, identity: {} }))).toBeNull()
  })

  it('applyConfigBundle restores settings, cards, and friends into localStorage', () => {
    applyConfigBundle({
      settings: { galleryCols: '3', soundEffects: false },
      cards: { p2pGallery: [{ id: 'x' }], unlockedStories: ['story-1'] },
      friends: { friends: ['friend-1'], blocked: ['blocked-1'], relationships: [{ id: 'rel-1' }] },
    })

    const settings = readRawSettings()
    expect(settings).toBeTruthy()
    expect(settings!.galleryCols).toBe('3')
    expect(settings!.soundEffects).toBe(false)

    expect((globalThis as any).localStorage.getItem('orbit_p2p_gallery')).toContain('"id":"x"')
    expect((globalThis as any).localStorage.getItem('orbit_unlocked_stories')).toContain('story-1')
    expect((globalThis as any).localStorage.getItem('goonmatch-friends')).toContain('friend-1')
    expect((globalThis as any).localStorage.getItem('goonmatch-blocked')).toContain('blocked-1')
    expect((globalThis as any).localStorage.getItem('goonmatch-relationships')).toContain('rel-1')
  })

  it('applyConfigBundle merges settings over existing values', () => {
    ;(globalThis as any).localStorage.setItem('goonmatch-settings', JSON.stringify({ galleryCols: '2', soundEffects: true }))
    applyConfigBundle({ settings: { soundEffects: false } })
    const settings = readRawSettings()
    expect(settings!.galleryCols).toBe('2')
    expect(settings!.soundEffects).toBe(false)
  })

  it('reports which slices were restored', () => {
    const result = applyConfigBundle({
      settings: { accentColor: 'gold' },
      cards: { p2pGallery: [], unlockedStories: [] },
      friends: { friends: [], blocked: [], relationships: [] },
    })
    expect(result.restored).toContain('settings')
    expect(result.restored).toContain('p2p_gallery')
    expect(result.restored).toContain('friends')
  })

  it('configDownloadFilename embeds the orbit id', () => {
    expect(configDownloadFilename({ schema: CONFIG_SCHEMA, version: CONFIG_VERSION, exportedAt: 'now', identity })).toBe('goonmatch-abc123de.goon-config.json')
  })
})