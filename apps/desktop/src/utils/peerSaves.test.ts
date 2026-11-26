import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PEER_SAVES_CHANGED_EVENT,
  readPeerSavedIds,
  setPeerSaved,
} from './peerSaves'

/**
 * A peer-replicated post has no node row, so `POST /api/posts/:id/save` 404s it
 * and the bookmark used to vanish. These save ids live here instead — and the
 * store must survive a reload, stay scoped to ONE identity, and announce every
 * real change (the mounted projection re-reads on the event).
 *
 * localStorage (and a window that can dispatch) are stubbed: the repo runs
 * vitest under `environment: 'node'`, so neither exists by default.
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

describe('peerSaves (durable, identity-scoped bookmarks)', () => {
  let store: Map<string, string>
  let events: string[]

  beforeEach(() => {
    ({ store, events } = stubStorageEnv())
  })

  it('reads a saved peer id back after a reload', () => {
    setPeerSaved('me', 'post-1', true)
    // A reload is a fresh read of the same durable store.
    expect([...readPeerSavedIds('me')]).toEqual(['post-1'])
  })

  it('removes a bookmark', () => {
    setPeerSaved('me', 'post-1', true)
    setPeerSaved('me', 'post-1', false)
    expect(readPeerSavedIds('me').size).toBe(0)
  })

  it('scopes bookmarks per identity — one account never sees another’s', () => {
    setPeerSaved('alice', 'post-1', true)
    setPeerSaved('bob', 'post-2', true)
    expect([...readPeerSavedIds('alice')]).toEqual(['post-1'])
    expect([...readPeerSavedIds('bob')]).toEqual(['post-2'])
  })

  it('announces a real change so the projection re-reads', () => {
    setPeerSaved('me', 'post-1', true)
    expect(events).toEqual([PEER_SAVES_CHANGED_EVENT])
    setPeerSaved('me', 'post-1', false)
    expect(events).toHaveLength(2)
  })

  it('does not announce a no-op write', () => {
    setPeerSaved('me', 'post-1', true)
    events.length = 0
    // Already saved: nothing changed, so nothing should re-project.
    setPeerSaved('me', 'post-1', true)
    expect(events).toEqual([])
    // Removing an id that was never saved is equally quiet.
    setPeerSaved('me', 'never', false)
    expect(events).toEqual([])
  })

  it('ignores an empty identity or post id', () => {
    setPeerSaved(null, 'post-1', true)
    setPeerSaved('me', '', true)
    expect(readPeerSavedIds('me').size).toBe(0)
    expect(readPeerSavedIds(null).size).toBe(0)
    expect(events).toEqual([])
  })

  it('survives a corrupt store instead of throwing', () => {
    store.set('gmatch_peer_saves_v1:me', '{not json')
    expect(readPeerSavedIds('me').size).toBe(0)
    // A write repairs it.
    setPeerSaved('me', 'post-1', true)
    expect([...readPeerSavedIds('me')]).toEqual(['post-1'])
  })
})
