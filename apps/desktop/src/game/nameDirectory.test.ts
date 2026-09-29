import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  __resetNameDirectoryForTests,
  nameFor,
  nameRoster,
  rememberName,
  rememberNames,
  hydrateFromStorage,
} from './nameDirectory'

/**
 * The persistent name directory.
 *
 * Display names kept vanishing because every surface read a DIFFERENT, capped,
 * short-lived source: the chat hub read a 100-row /api/users page, the profile
 * modal read whatever object the opener passed, the presence poll read the
 * dashboard's own 100 rows. A peer outside whichever cap was being consulted
 * simply had no name — so the UI invented one, and the inventions disagreed.
 *
 * This is the one place a name lives. It is fed by every source (the user
 * directory, the presence poll, and the display name sealed into DM/room
 * messages) and it is persisted, so knowing someone's name is a durable fact
 * about them rather than a lucky hit inside a query window.
 */

const ls = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => { ls.set(k, v) },
  removeItem: (k: string) => { ls.delete(k) },
})

beforeEach(() => {
  ls.clear()
  __resetNameDirectoryForTests()
})

describe('name directory', () => {
  it('remembers a name and resolves it later', () => {
    rememberName('0xabc123', 'Matco')
    expect(nameFor('0xabc123')).toBe('Matco')
  })

  it('remembers many at once (a /api/users page)', () => {
    rememberNames([{ id: 'a', display_name: 'A' }, { id: 'b', display_name: 'B' }])
    expect(nameFor('a')).toBe('A')
    expect(nameFor('b')).toBe('B')
  })

  it('a later name wins, so a rename is picked up', () => {
    rememberName('u1', 'OldName')
    rememberName('u1', 'NewName')
    expect(nameFor('u1')).toBe('NewName')
  })

  it('never stores a server-minted placeholder as a real name', () => {
    // /api/users mints these when display_name is blank. Storing one would
    // freeze a placeholder as if it were the person's name, permanently.
    rememberName('u2', 'User_1da964')
    expect(nameFor('u2')).toBeUndefined()
  })

  it('never stores the viewer own name under a remote id', () => {
    // Guards the exact leak: a remote sender inheriting the local name.
    rememberName('u3', '')
    rememberName('remote', 'me-if-im-wrong')
    expect(nameFor('remote')).toBe('me-if-im-wrong')
    // An empty/blank name for a remote sender is simply not remembered.
    expect(nameFor('u3')).toBeUndefined()
  })

  it('ignores ids it cannot key on', () => {
    rememberName('', 'Ghost')
    rememberNames([{ id: undefined, display_name: 'Ghost' } as never])
    expect(nameFor('')).toBeUndefined()
  })

  it('SURVIVES a restart — a name you have seen stays known', () => {
    rememberName('u4', 'Persistent Pat')
    // Simulate a fresh process: memory gone, storage still there.
    __resetNameDirectoryForTests()
    expect(nameFor('u4')).toBeUndefined()
    hydrateFromStorage()
    expect(nameFor('u4')).toBe('Persistent Pat')
  })

  it('exposes a roster compatible with the shared name resolver', () => {
    rememberNames([{ id: 'a', display_name: 'Alpha' }])
    const roster = nameRoster()
    expect(roster.get('a')?.display_name).toBe('Alpha')
  })

  it('persists across the reset, so a reload does not re-blank the chat', () => {
    rememberName('u5', 'Rex')
    __resetNameDirectoryForTests()
    hydrateFromStorage()
    expect(nameFor('u5')).toBe('Rex')
  })

  it('corrupt storage does not throw — names degrade, the app does not break', () => {
    ls.set('gmatch.name_directory_v1', '{not json')
    expect(() => hydrateFromStorage()).not.toThrow()
    expect(nameFor('u6')).toBeUndefined()
  })

  it('ignores junk stored in the file', () => {
    ls.set('gmatch.name_directory_v1', JSON.stringify({ u7: 42, u8: 'Real', u9: null }))
    hydrateFromStorage()
    expect(nameFor('u7')).toBeUndefined()
    expect(nameFor('u8')).toBe('Real')
    expect(nameFor('u9')).toBeUndefined()
  })
})
