import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WORLD_ID, DEFAULT_WORLD_NAME,
  worldKeyFromAddress, worldIdForKey, worldIdForAddress,
  isDefaultWorld, namespaceStorageKey, worldDbName, worldLabel,
} from './serverWorlds'

describe('serverWorlds', () => {
  it('the default world is "official" and keeps the legacy root', () => {
    expect(DEFAULT_WORLD_ID).toBe('official')
    expect(worldIdForKey('')).toBe(DEFAULT_WORLD_ID)
    expect(worldIdForAddress('')).toBe(DEFAULT_WORLD_ID)
    expect(isDefaultWorld(DEFAULT_WORLD_ID)).toBe(true)
    expect(isDefaultWorld(undefined)).toBe(true)
    expect(namespaceStorageKey('gmatch.save.v1', DEFAULT_WORLD_ID)).toBe('gmatch.save.v1')
    expect(worldDbName(DEFAULT_WORLD_ID)).toBe('')
  })

  it('canonicalises an address the same way the directory does', () => {
    expect(worldKeyFromAddress('https://Host.TEST:8790/')).toBe('host.test:8790')
    expect(worldKeyFromAddress('  http://192.168.0.9:8790  ')).toBe('192.168.0.9:8790')
    expect(worldIdForAddress('https://Host.TEST:8790/')).toBe(worldIdForAddress('host.test:8790'))
  })

  it('two addresses for one server map to ONE world id; two servers never collide', () => {
    expect(worldIdForAddress('https://world.test:8790')).toBe(worldIdForAddress('http://world.test:8790/'))
    expect(worldIdForAddress('one.test:8790')).not.toBe(worldIdForAddress('two.test:8790'))
    expect(worldIdForAddress('world.test:8790')).toMatch(/^w_[0-9a-f]{8}$/)
  })

  it('namespaces per-world storage but never the default', () => {
    const id = worldIdForAddress('friends.test:8790')
    expect(isDefaultWorld(id)).toBe(false)
    expect(namespaceStorageKey('gmatch.save.v1', id)).toBe(`gmatch.save.v1::${id}`)
    expect(worldDbName(id)).toBe(id)
  })

  it('labels a world by name, else a stable fallback', () => {
    expect(worldLabel(DEFAULT_WORLD_ID, '')).toBe(DEFAULT_WORLD_NAME)
    expect(worldLabel('w_deadbeef', '')).toBe('World w_deadbeef')
    expect(worldLabel('w_deadbeef', 'My Realm')).toBe('My Realm')
  })
})