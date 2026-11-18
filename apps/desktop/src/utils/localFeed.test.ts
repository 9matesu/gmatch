// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueOutbox, OUTBOX_KEY, setOutboxState } from '../services/postOutbox'
import { localFeedPosts } from './localFeed'

const identity = { orbitId: 'u1' }

// Node 26 exposes a global `localStorage` that is undefined without
// --localstorage-file; stub it the way the store tests do.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage)

beforeEach(() => {
  mem.clear()
})

describe('localFeedPosts', () => {
  it('rebuilds a durable local post the node has not echoed back', () => {
    enqueueOutbox({
      objectId: 'o1',
      postGroup: 'g1',
      registerBody: { id: 'o1', mime_type: 'image/png', post_caption: 'hello', tags: 'a,b' },
      gossipInput: {
        id: 'o1',
        contentHash: 'h',
        mimeType: 'image/png',
        sizeBytes: 1,
        magnetUri: 'm',
        caption: 'hello',
      },
    })

    const rows = localFeedPosts(identity, 'Tester')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'g1',
      author_id: 'u1',
      author_name: 'Tester',
      url: '/api/objects/o1',
      caption: 'hello',
      tags: ['a', 'b'],
      sync_state: 'local',
    })
  })

  it('survives a reload (the outbox is localStorage, not memory)', () => {
    enqueueOutbox({ objectId: 'o2', registerBody: { id: 'o2', mime_type: 'image/png' }, gossipInput: null })
    expect(mem.get(OUTBOX_KEY)).toBeTruthy()
    expect(localFeedPosts(identity, 'Tester').map((r) => r.id)).toContain('o2')
  })

  it('keeps showing a pending post until the server row lands', () => {
    enqueueOutbox({ objectId: 'o3', registerBody: { id: 'o3', mime_type: 'image/png' }, gossipInput: null })
    setOutboxState('o3', 'pending')
    expect(localFeedPosts(identity, 'Tester')[0].sync_state).toBe('pending')
  })

  it('is empty without an identity', () => {
    enqueueOutbox({ objectId: 'o4', registerBody: { id: 'o4' }, gossipInput: null })
    expect(localFeedPosts(null, 'Nobody')).toEqual([])
  })
})