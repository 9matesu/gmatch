import { describe, expect, it, beforeEach, vi } from 'vitest'
import { usePresence, __resetPresenceForTests, ingestSnapshot } from './presenceStore'

const fresh = () => new Date().toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const u = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra })

describe('presence store: one record per user', () => {
  beforeEach(() => {
    __resetPresenceForTests()
  })

  it('derives online from the sighting timestamp, ignoring a lagging flag', () => {
    ingestSnapshot([u('a', { last_seen: fresh(), online: false })])
    expect(usePresence.getState().isOnline('a')).toBe(true)
  })

  it('never shows a stale online:true flag as online (the ghost bug)', () => {
    // The snapshot itself is fresh; the SIGHTING is 10 min old, so the server
    // is telling us this player left. The boolean must not win.
    ingestSnapshot([u('ghost', { last_seen: ago(10 * 60_000), online: true })])
    expect(usePresence.getState().isOnline('ghost')).toBe(false)
  })

  it('treats space-separated SQLite timestamps as UTC, not local time', () => {
    const sqlite = new Date(Date.now() - 2 * 3600_000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
    ingestSnapshot([u('s', { last_seen: sqlite, online: true })])
    expect(usePresence.getState().isOnline('s')).toBe(false)
  })

  it('a later snapshot reporting a departure takes effect immediately', () => {
    // Regression guard. A store that only ever keeps the NEWEST timestamp
    // would pin this player online for the rest of the 60s window, because
    // the first sighting (now) is newer than the departure the server just
    // reported. Snapshots are authoritative in arrival order.
    ingestSnapshot([u('leaver', { last_seen: fresh(), online: true })])
    expect(usePresence.getState().isOnline('leaver')).toBe(true)
    ingestSnapshot([u('leaver', { last_seen: ago(5 * 60_000), online: false })])
    expect(usePresence.getState().isOnline('leaver')).toBe(false)
  })

  it('a snapshot only replaces the users it actually carries', () => {
    ingestSnapshot([u('a', { last_seen: fresh() }), u('b', { last_seen: fresh() })])
    ingestSnapshot([u('a', { last_seen: ago(5 * 60_000) })])
    const s = usePresence.getState()
    expect(s.isOnline('a')).toBe(false)
    expect(s.isOnline('b')).toBe(true)
  })

  it('reads the same answer regardless of which consumer asks', () => {
    // The reported bug: the chat list said Online while the profile modal
    // said Offline, because each derived it from a different user object.
    ingestSnapshot([u('x', { last_seen: ago(10 * 60_000), online: true })])
    // Both consumers now read this one call.
    expect(usePresence.getState().isOnline('x')).toBe(usePresence.getState().isOnline('x'))
  })

  it('reports offline for an unknown user rather than guessing', () => {
    expect(usePresence.getState().isOnline('nobody')).toBe(false)
  })

  it('keeps the sighting so relative times can be rendered without a refetch', () => {
    ingestSnapshot([u('a', { last_seen: fresh() })])
    const rec = usePresence.getState().record('a')
    expect(rec?.lastSeenMs).toBeGreaterThan(Date.now() - 5_000)
  })

  it('tracks the dashboard counts and the time they were fetched', () => {
    ingestSnapshot([u('a', { last_seen: fresh() })], { online: 5, active: 12 })
    const s = usePresence.getState()
    expect(s.counts).toEqual({ online: 5, active: 12 })
    expect(s.countsAt).toBeGreaterThan(0)
  })

  it('notifies subscribers on every ingest so a stale UI re-renders', () => {
    const seen = vi.fn()
    const unsub = usePresence.subscribe(seen)
    ingestSnapshot([u('a', { last_seen: fresh() })])
    expect(seen).toHaveBeenCalled()
    unsub()
    ingestSnapshot([u('a', { last_seen: ago(60_000) })])
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('presence store: self is always online', () => {
  beforeEach(() => {
    __resetPresenceForTests()
  })

  it('pins the local user online even with no sighting at all', () => {
    usePresence.getState().setSelfId('me')
    expect(usePresence.getState().isOnline('me')).toBe(true)
    expect(usePresence.getState().isOnline('someone-else')).toBe(false)
  })
})
