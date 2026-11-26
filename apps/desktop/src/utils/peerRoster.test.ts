import { describe, expect, it } from 'vitest'
import type { User } from '@orbit/shared'
import { mergeRoster, PeerRoster, pruneStalePeers, STALE_PEER_MS } from './peerRoster'

const u = (id: string, extra: Partial<User> = {}): User =>
  ({ id, publicKey: `pk-${id}`, createdAt: '2026-01-01T00:00:00Z', display_name: id, online: false, ...extra }) as User

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('mergeRoster', () => {
  it('adds unknown roster peers as online (the roster is the online set)', () => {
    const m = new Map<string, User>()
    expect(mergeRoster(m, [u('alice')], 'me')).toBe(true)
    expect(m.get('alice')?.online).toBe(true)
  })

  it('skips self and keeps known-online peers online with no spurious change', () => {
    const sighting = ago(10_000)
    const m = new Map<string, User>([['me', u('me')], ['alice', u('alice', { online: true, last_seen: sighting })]])
    expect(mergeRoster(m, [u('me'), u('alice', { online: true, last_seen: sighting })], 'me')).toBe(false)
    expect(m.get('alice')?.online).toBe(true)
  })

  it('refreshes profile fields on known peers', () => {
    const m = new Map<string, User>([['alice', u('alice', { display_name: 'Old' })]])
    expect(mergeRoster(m, [u('alice', { display_name: 'Alice <3', score: 42 })], 'me')).toBe(true)
    expect(m.get('alice')?.display_name).toBe('Alice <3')
    expect(m.get('alice')?.score).toBe(42)
  })

  it('a known peer that arrives with its keys keeps them', () => {
    // The direct-connect path needs the keys; a peer first seen as a bare
    // presence beacon must not stay keyless forever.
    const m = new Map<string, User>([['alice', u('alice')]])
    mergeRoster(m, [u('alice', { publicKey: 'pk-alice', encryptionPubKey: 'enc-alice' })], 'me')
    expect(m.get('alice')?.publicKey).toBe('pk-alice')
    expect(m.get('alice')?.encryptionPubKey).toBe('enc-alice')
  })

  it('downgrades leavers absent from the roster once their sighting goes stale', () => {
    const m = new Map<string, User>([['alice', u('alice', { online: true, last_seen: ago(STALE_PEER_MS + 1_000) })]])
    expect(mergeRoster(m, [], 'me')).toBe(true)
    expect(m.get('alice')?.online).toBe(false)
    // last_seen preserved for "x ago" display
    expect(m.get('alice')?.last_seen).toBeDefined()
  })

  it('does not downgrade within the grace window (missed tick, not a leaver)', () => {
    const m = new Map<string, User>([['alice', u('alice', { online: true, last_seen: ago(30_000) })]])
    expect(mergeRoster(m, [], 'me')).toBe(false)
    expect(m.get('alice')?.online).toBe(true)
  })

  it('leaves peers with no timestamp untouched (nothing to judge by)', () => {
    const m = new Map<string, User>([['alice', u('alice', { online: true })]])
    expect(mergeRoster(m, [], 'me')).toBe(false)
    expect(m.get('alice')?.online).toBe(true)
  })
})

describe('PeerRoster (the single owner of "who is online")', () => {
  const roster = () => new PeerRoster(null)

  it('a tracker-mesh peer becomes a visible roster peer', () => {
    const r = roster()
    const result = r.upsert({
      id: 'peer-1',
      publicKey: 'pk-1',
      createdAt: '2026-01-01T00:00:00Z',
      display_name: '',
    } as User)
    expect(result.changed).toBe(true)
    expect(result.becameOnline).toBe(true)
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].id).toBe('peer-1')
    expect(r.list()[0].online).toBe(true)
  })

  it('one merge rule: an empty field never erases what we already know', () => {
    const r = roster()
    r.upsert({ ...u('alice', { display_name: 'Alice' }) })
    r.upsert({ ...u('alice', { display_name: '' }), publicKey: 'pk-alice' })
    expect(r.get('alice')?.display_name).toBe('Alice')
  })

  it('one merge rule: a field that carries a value always wins', () => {
    const r = roster()
    r.upsert({ ...u('alice', { display_name: 'Alice' }) })
    r.upsert({ ...u('alice', { display_name: 'Alice <3' }) })
    expect(r.get('alice')?.display_name).toBe('Alice <3')
  })

  it('reports becameOnline only on the offline -> online transition', () => {
    const r = roster()
    expect(r.upsert(u('alice')).becameOnline).toBe(true)
    expect(r.upsert(u('alice')).becameOnline).toBe(false)
    r.markOffline('alice')
    expect(r.upsert(u('alice')).becameOnline).toBe(true)
  })

  it('subscribers see the roster change', () => {
    const r = roster()
    const seen: number[] = []
    r.subscribe((peers) => seen.push(peers.length))
    r.upsert(u('alice'))
    r.upsert(u('bob'))
    expect(seen).toEqual([0, 1, 2])
  })

  it('a subscriber can unsubscribe', () => {
    const r = roster()
    const seen: number[] = []
    const off = r.subscribe((peers) => seen.push(peers.length))
    off()
    r.upsert(u('alice'))
    expect(seen).toEqual([0])
  })

  it('the node roster reports the peers that just came online', () => {
    const r = roster()
    const newly = r.mergeServerRoster([u('alice'), u('me')], 'me')
    expect(newly.map((p) => p.id)).toEqual(['alice'])
    expect(r.get('alice')?.online).toBe(true)
    // Second poll: nobody new.
    expect(r.mergeServerRoster([u('alice'), u('me')], 'me')).toHaveLength(0)
  })

  it('a world switch marks everyone offline but keeps them known', () => {
    const r = roster()
    r.mergeServerRoster([u('alice')], 'me')
    expect(r.markAllOffline()).toBe(true)
    expect(r.get('alice')?.online).toBe(false)
    expect(r.list()).toHaveLength(1)
  })

  it('hydration loads persisted peers as offline and drops ghosts', () => {
    const r = roster()
    const now = Date.now()
    const loaded = r.hydrate(
      [
        u('fresh', { last_seen: new Date(now - 60_000).toISOString() }),
        u('ghost', { last_seen: new Date(now - 25 * 3600_000).toISOString() }),
      ],
      now,
    )
    expect(loaded).toBe(1)
    expect(r.get('fresh')?.online).toBe(false)
    expect(r.get('ghost')).toBeUndefined()
  })

  it('hydration never overwrites a peer we already know', () => {
    const r = roster()
    r.upsert(u('alice'))
    r.hydrate([u('alice', { display_name: 'Stale', online: false })])
    expect(r.get('alice')?.online).toBe(true)
    expect(r.get('alice')?.display_name).toBe('alice')
  })

  it('prune drops the ghosts and keeps the fresh ones', () => {
    const r = roster()
    const now = Date.now()
    r.upsert(u('fresh'), { seenAt: new Date(now - 60_000).toISOString() })
    r.upsert(u('ghost'), { seenAt: new Date(now - 25 * 3600_000).toISOString() })
    expect(r.prune(now)).toBe(1)
    expect(r.get('fresh')).toBeDefined()
    expect(r.get('ghost')).toBeUndefined()
  })

  it('a sighting is NOW: the incoming record timestamp is not inherited', () => {
    const r = roster()
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    r.upsert(u('alice', { last_seen: stale }))
    // The peer was seen now, so it must not be aged out by the next poll.
    expect(new Date(r.get('alice')!.last_seen!).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('a peer that arrives with its keys keeps them', () => {
    const r = roster()
    r.upsert(u('alice'))
    r.upsert(u('alice', { publicKey: 'pk-alice', encryptionPubKey: 'enc-alice' }))
    expect(r.get('alice')?.publicKey).toBe('pk-alice')
    expect(r.get('alice')?.encryptionPubKey).toBe('enc-alice')
  })
})

describe('pruneStalePeers (plan B1)', () => {
  const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString()
  const peer = (id: string, lastSeen: string): User =>
    ({ id, last_seen: lastSeen }) as unknown as User

  it('drops entries unseen for over 24h and keeps fresh ones', () => {
    const now = Date.now()
    const map = new Map<string, User>([
      ['fresh', peer('fresh', iso(60_000, now))],
      ['hours', peer('hours', iso(5 * 3600_000, now))],
      ['ghost', peer('ghost', iso(25 * 3600_000, now))],
      ['ancient', peer('ancient', iso(400 * 3600_000, now))],
    ])
    const dropped = pruneStalePeers(map, now)
    expect(dropped).toBe(2)
    expect(map.has('fresh')).toBe(true)
    expect(map.has('hours')).toBe(true)
    expect(map.has('ghost')).toBe(false)
    expect(map.has('ancient')).toBe(false)
  })

  it('never ages a peer that carries no timestamp at all', () => {
    const now = Date.now()
    const map = new Map<string, User>([['notime', peer('notime', '')]])
    expect(pruneStalePeers(map, now)).toBe(0)
    expect(map.has('notime')).toBe(true)
  })

  it('returns 0 and mutates nothing when everything is fresh', () => {
    const now = Date.now()
    const map = new Map<string, User>([['a', peer('a', iso(1_000, now))]])
    expect(pruneStalePeers(map, now)).toBe(0)
    expect(map.size).toBe(1)
  })
})
