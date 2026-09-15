import { describe, expect, it } from 'vitest'
import type { User } from '@orbit/shared'
import { mergeRoster, STALE_PEER_MS } from './peerRoster'

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
});
