import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  __resetNameDirectoryForTests,
  nameFor,
  signedNameFor,
  nameRoster,
  rememberName,
  rememberNames,
  rememberSignedName,
  rememberPresenceName,
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

  it('keeps DM self-labels out of the signed class chat vs feed readers use', () => {
    // A label a peer wrote about itself in a DM is a chat convenience, never a
    // verified identity. It stays in `nameFor` (chat) but `signedNameFor` — the
    // only class the feed/comment projection trusts — never sees it.
    rememberName('dm-peer', 'I Am Totally Alice')
    expect(nameFor('dm-peer')).toBe('I Am Totally Alice')
    expect(signedNameFor('dm-peer')).toBeUndefined()
  })

  it('treats the node directory as trusted, but never a DM self-label', () => {
    // Both signed profile.update ops and node rows arrive through the batch
    // funnel, so both belong to the trusted class the feed may read. A DM
    // label arrives through the single-write funnel and stays chat-only.
    rememberNames([{ id: 'node-peer', display_name: 'Node Name' }])
    expect(nameFor('node-peer')).toBe('Node Name')
    expect(signedNameFor('node-peer')).toBe('Node Name')
    rememberName('dm-peer', 'Self Label')
    expect(nameFor('dm-peer')).toBe('Self Label')
    expect(signedNameFor('dm-peer')).toBeUndefined()
  })

  it('a signed profile.update name outranks any DM label everywhere', () => {
    rememberName('p', 'Self Declared DM Label')
    rememberNames([{ id: 'p', display_name: 'Node Name' }])
    rememberSignedName('p', 'Signed Rename')
    expect(nameFor('p')).toBe('Signed Rename')
    expect(signedNameFor('p')).toBe('Signed Rename')
    // A later DM label can never demote a trusted name.
    rememberName('p', 'Later DM Label')
    expect(nameFor('p')).toBe('Signed Rename')
    expect(signedNameFor('p')).toBe('Signed Rename')
  })

  it('persists signed and DM provenance separately across a restart', () => {
    rememberSignedName('s1', 'Signed One')
    rememberName('d1', 'Dm One')
    __resetNameDirectoryForTests()
    hydrateFromStorage()
    expect(signedNameFor('s1')).toBe('Signed One')
    expect(signedNameFor('d1')).toBeUndefined()
    expect(nameFor('d1')).toBe('Dm One')
  })

  it('seeds a verified beacon name into the trusted class the feed reads', () => {
    rememberPresenceName('beacon-peer', 'CrossNode Browser')
    expect(signedNameFor('beacon-peer')).toBe('CrossNode Browser')
    expect(nameFor('beacon-peer')).toBe('CrossNode Browser')
  })

  it('never overwrites a node row or a profile.update with a beacon name', () => {
    rememberPresenceName('beacon-peer', 'Beacon Name')
    rememberNames([{ id: 'beacon-peer', display_name: 'Node Name' }])
    expect(signedNameFor('beacon-peer')).toBe('Node Name')
    // A stale beacon read again must not demote the stronger source.
    rememberPresenceName('beacon-peer', 'Stale Beacon Name')
    expect(signedNameFor('beacon-peer')).toBe('Node Name')
    // A later profile.update is the actor's own signed statement: it wins too.
    rememberSignedName('beacon-peer', 'Renamed By Profile Update')
    rememberPresenceName('beacon-peer', 'Stale Beacon Name')
    expect(signedNameFor('beacon-peer')).toBe('Renamed By Profile Update')
  })

  it('a later profile.update prevails over an earlier signed beacon', () => {
    rememberPresenceName('b', 'Beacon Name')
    rememberSignedName('b', 'Renamed By Profile Update')
    expect(signedNameFor('b')).toBe('Renamed By Profile Update')
  })

  it('never freezes a minted placeholder from a beacon as a permanent name', () => {
    rememberPresenceName('p1', 'User_376a02')
    rememberPresenceName('p2', 'Player')
    expect(signedNameFor('p1')).toBeUndefined()
    expect(signedNameFor('p2')).toBeUndefined()
  })

  it('a beacon seed survives a restart', () => {
    rememberPresenceName('beacon-peer', 'CrossNode Browser')
    __resetNameDirectoryForTests()
    hydrateFromStorage()
    expect(signedNameFor('beacon-peer')).toBe('CrossNode Browser')
  })
})
