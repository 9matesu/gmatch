import { describe, expect, it } from 'vitest'
import type { User } from '@orbit/shared'
import { areItemsStructurallyEqual, areUsersStructurallyEqual, presenceBucket } from './compare'

const user = (over: Partial<User> = {}): User =>
  ({
    id: 'u1',
    publicKey: 'pk',
    createdAt: '2026-01-01T00:00:00.000Z',
    online: true,
    display_name: 'Ana',
    ...over,
  }) as User

describe('areUsersStructurallyEqual', () => {
  it('is true for two identical rosters', () => {
    expect(areUsersStructurallyEqual([user()], [user()])).toBe(true)
  })

  // The regression that froze every balance in the app. The server pins the
  // caller to index 0 and keeps `online` true on the heartbeat, so balance was
  // the ONLY field that ever differed between polls — and it was not compared,
  // so setUsers returned `prev` and the wallet never moved.
  it.each([
    ['balance', { balance: 1234 }],
    ['score', { score: 42 }],
    ['reputation', { reputation: 900 }],
    ['daily_score', { daily_score: 7 }],
    ['matches_won', { matches_won: 3 }],
    ['matches_lost', { matches_lost: 2 }],
    ['gacha_items_collected', { gacha_items_collected: 5 }],
    ['likes_received', { likes_received: 8 }],
    ['followers_count', { followers_count: 2 }],
    ['following_count', { following_count: 2 }],
    ['posts_count', { posts_count: 4 }],
  ])('detects a changed %s', (_field, over) => {
    expect(areUsersStructurallyEqual([user()], [user(over)])).toBe(false)
  })

  it('detects identity, presence, name, tags and avatar changes', () => {
    expect(areUsersStructurallyEqual([user()], [user({ id: 'u2' })])).toBe(false)
    expect(areUsersStructurallyEqual([user()], [user({ online: false })])).toBe(false)
    expect(areUsersStructurallyEqual([user()], [user({ display_name: 'Bo' })])).toBe(false)
    expect(areUsersStructurallyEqual([user()], [user({ tags: ['a'] })])).toBe(false)
    expect(areUsersStructurallyEqual([user()], [user({ pfp_url: '/x.png' })])).toBe(false)
  })

  it('detects a length change', () => {
    expect(areUsersStructurallyEqual([user()], [user(), user({ id: 'u2' })])).toBe(false)
  })

  // The app injects a synthetic self-entry with no `balance` when the server's
  // capped directory omits you. A raw `undefined !== 0` comparison would make
  // every poll look like a change and re-render the whole app forever.
  it('treats a missing balance as 0, not as a change', () => {
    expect(areUsersStructurallyEqual([user()], [user({ balance: 0 })])).toBe(true)
    expect(areUsersStructurallyEqual([user({ balance: 0 })], [user()])).toBe(true)
    expect(areUsersStructurallyEqual([user({ balance: 5 })], [user()])).toBe(false)
  })

  it('normalises boolean-ish flags', () => {
    expect(areUsersStructurallyEqual([user()], [user({ is_private: 0 as never })])).toBe(true)
    expect(areUsersStructurallyEqual([user()], [user({ is_private: true })])).toBe(false)
  })

  // THE PRESENCE SPLIT BRAIN. `last_seen` was never compared, and `online`
  // stays true across every heartbeat, so for any continuously-active user the
  // guard returned true, setUsers returned `prev`, and the roster's `last_seen`
  // froze. isUserOnline treats a present-but-stale timestamp as authoritative
  // over the flag, so the profile modal read "Offline" for someone the arena
  // and chat hub — which compute presence server-side, fresh — called Online.
  it('detects a last_seen that moved by more than one bucket', () => {
    const t = Date.parse('2026-01-01T00:00:00.000Z')
    expect(areUsersStructurallyEqual([user()], [user({ last_seen: new Date(t).toISOString() })])).toBe(false)
  })

  it('ignores heartbeat jitter inside a single bucket (no render storm)', () => {
    const t = Date.parse('2026-01-01T00:00:00.000Z')
    const a = user({ last_seen: new Date(t).toISOString() })
    // +10s is inside the 15s bucket: the heartbeat moved, but nothing the UI
    // renders has.
    const b = user({ last_seen: new Date(t + 10_000).toISOString() })
    expect(areUsersStructurallyEqual([a], [b])).toBe(true)
    // +40s crosses a bucket boundary and must be seen.
    const c = user({ last_seen: new Date(t + 40_000).toISOString() })
    expect(areUsersStructurallyEqual([a], [c])).toBe(false)
  })

  it('cannot hide an offline transition inside a bucket', () => {
    // Bucketing must never make a stale sighting look unchanged to a caller
    // that also flipped the flag, and must never swallow first/last sighting.
    const t = Date.parse('2026-01-01T00:00:00.000Z')
    expect(
      areUsersStructurallyEqual(
        [user({ last_seen: new Date(t).toISOString(), online: true })],
        [user({ last_seen: undefined, online: false })],
      ),
    ).toBe(false)
  })

  it('buckets an unparseable timestamp as no sighting', () => {
    expect(presenceBucket(undefined)).toBe(0)
    expect(presenceBucket('not-a-date')).toBe(0)
    expect(presenceBucket('2026-01-01T00:00:00.000Z')).toBeGreaterThan(0)
  })
})

describe('areItemsStructurallyEqual', () => {
  it('detects a changed caption and media', () => {
    const a = { id: 'o1', content_url: '/x', is_favorited: false, caption: 'hi' }
    const asItem = (o: typeof a) => o as unknown as Parameters<typeof areItemsStructurallyEqual>[0][number]
    expect(areItemsStructurallyEqual([asItem(a)], [asItem({ ...a })])).toBe(true)
    expect(areItemsStructurallyEqual([asItem(a)], [asItem({ ...a, caption: 'yo' })])).toBe(false)
    expect(areItemsStructurallyEqual([asItem(a)], [asItem({ ...a, content_url: '/y' })])).toBe(false)
  })
})
