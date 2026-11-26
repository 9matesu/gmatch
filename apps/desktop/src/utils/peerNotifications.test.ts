import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PEER_NOTIFICATIONS_CHANGED_EVENT,
  markPeerNotificationsRead,
  readPeerNotificationReads,
} from './peerNotifications'

/**
 * Peer-lane notifications (a report about my content, soon a follow/like/comment)
 * have no node row and no chat stamp, so nothing persisted whether the player
 * had read one. The row is derived from the operation log, which does not change
 * by being looked at — so an unread report counted toward the badge FOREVER and
 * the badge could not clear. The read state lives here instead.
 *
 * localStorage and a dispatching window are stubbed: the repo runs vitest under
 * `environment: 'node'`, so neither exists by default.
 */
function stubStorageEnv(): { store: Map<string, string>; events: string[] } {
  const store = new Map<string, string>()
  const events: string[] = []
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
  vi.stubGlobal('window', {
    dispatchEvent: (e: { type: string }) => { events.push(e.type); return true },
  })
  return { store, events }
}

describe('peerNotifications (durable, identity-scoped read state)', () => {
  let store: Map<string, string>
  let events: string[]

  beforeEach(() => {
    ({ store, events } = stubStorageEnv())
  })

  it('reads a marked row back after a reload', () => {
    markPeerNotificationsRead('me', ['op-1'])
    expect([...readPeerNotificationReads('me')]).toEqual(['op-1'])
  })

  it('marks several ids at once', () => {
    markPeerNotificationsRead('me', ['op-1', 'op-2'])
    expect(readPeerNotificationReads('me').size).toBe(2)
  })

  it('scopes read state per identity — one account never sees another’s', () => {
    markPeerNotificationsRead('alice', ['op-1'])
    markPeerNotificationsRead('bob', ['op-2'])
    expect([...readPeerNotificationReads('alice')]).toEqual(['op-1'])
    expect([...readPeerNotificationReads('bob')]).toEqual(['op-2'])
  })

  it('announces a real change so the centre re-reads', () => {
    markPeerNotificationsRead('me', ['op-1'])
    expect(events).toEqual([PEER_NOTIFICATIONS_CHANGED_EVENT])
  })

  it('does not announce a no-op write', () => {
    markPeerNotificationsRead('me', ['op-1'])
    events.length = 0
    markPeerNotificationsRead('me', ['op-1'])
    expect(events).toEqual([])
  })

  it('ignores an empty identity or empty id list', () => {
    markPeerNotificationsRead(null, ['op-1'])
    markPeerNotificationsRead('me', [])
    markPeerNotificationsRead('me', [''])
    expect(readPeerNotificationReads('me').size).toBe(0)
    expect(readPeerNotificationReads(null).size).toBe(0)
    expect(events).toEqual([])
  })

  it('survives a corrupt store instead of throwing', () => {
    store.set('gmatch_peer_notifications_read_v1:me', '{not json')
    expect(readPeerNotificationReads('me').size).toBe(0)
    markPeerNotificationsRead('me', ['op-1'])
    expect([...readPeerNotificationReads('me')]).toEqual(['op-1'])
  })
})
