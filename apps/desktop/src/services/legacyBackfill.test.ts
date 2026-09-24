// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runLegacyBackfill, isLegacyBackfillCompleted, resetLegacyBackfillState } from './legacyBackfill'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import * as storage from '../utils/storage'

describe('runLegacyBackfill', () => {
  const identity = generateIdentity() as OrbitIdentity
  const savedObjects: storage.StoredObject[] = []

  function stubLocalStorage() {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    } as Storage)
  }

  beforeEach(() => {
    savedObjects.length = 0
    stubLocalStorage()
    resetLegacyBackfillState()
    vi.spyOn(storage, 'saveObject').mockImplementation(async (obj) => {
      savedObjects.push(obj)
    })
    vi.spyOn(storage, 'getObject').mockImplementation(async (id) => {
      return savedObjects.find((o) => o.id === id) || null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exits cleanly if legacy server health probe fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/health')) {
        return new Response('offline', { status: 502 })
      }
      return new Response('{}', { status: 200 })
    })

    const progressLogs: string[] = []
    const res = await runLegacyBackfill(
      identity,
      (p) => progressLogs.push(p.phase),
      fetchMock as unknown as typeof globalThis.fetch,
    )

    expect(res.migratedCount).toBe(0)
    expect(progressLogs).toContain('checking')
    expect(progressLogs).toContain('idle')
    expect(savedObjects).toHaveLength(0)
    expect(isLegacyBackfillCompleted()).toBe(false)
  })

  it('fetches posts, comments, and media binary from gmatch.fly.dev and stores in IndexedDB', async () => {
    const fakeImageBuffer = new Uint8Array([137, 80, 78, 71]).buffer

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }
      if (url.includes('/api/posts?author_id=')) {
        return new Response(JSON.stringify({
          posts: [
            {
              id: 'my-post-1',
              author_id: identity.orbitId,
              author_name: 'Myself',
              url: '/api/objects/my-post-1',
              mime_type: 'image/png',
              caption: 'First post',
              tags: ['intro', 'test'],
              comment_count: 1,
              created_at: '2026-09-01T12:00:00.000Z',
            },
          ],
        }), { status: 200 })
      }
      if (url.includes('/api/posts?limit=100')) {
        return new Response(JSON.stringify({
          posts: [
            {
              id: 'my-post-1',
              author_id: identity.orbitId,
              url: '/api/objects/my-post-1',
            },
            {
              id: 'peer-post-2',
              author_id: 'peer-orbit-id',
              author_name: 'PeerPlayer',
              url: 'https://example.com/peer.png',
              mime_type: 'image/png',
              caption: 'Peer post',
              created_at: '2026-09-02T12:00:00.000Z',
            },
          ],
        }), { status: 200 })
      }
      if (url.includes('/api/posts/my-post-1')) {
        return new Response(JSON.stringify({
          id: 'my-post-1',
          comments: [
            { id: 'c1', author_id: 'peer-orbit-id', author_name: 'Peer', text: 'Great photo!' },
          ],
        }), { status: 200 })
      }
      if (url.includes('/api/objects/my-post-1') || url.includes('peer.png')) {
        return new Response(fakeImageBuffer, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      return new Response('not found', { status: 404 })
    })

    const progressLogs: string[] = []
    const res = await runLegacyBackfill(
      identity,
      (p) => progressLogs.push(`${p.phase}:${p.current}/${p.total}`),
      fetchMock as unknown as typeof globalThis.fetch,
    )

    expect(res.migratedCount).toBe(2)
    expect(savedObjects).toHaveLength(2)

    const myObj = savedObjects.find((o) => o.id === 'my-post-1')
    expect(myObj).toBeDefined()
    expect(myObj?.is_public).toBe(1)
    expect(myObj?.caption).toBe('First post')
    expect(myObj?.comments).toHaveLength(1)
    expect(myObj?.comments?.[0]).toMatchObject({ text: 'Great photo!' })
    expect(myObj?.data.byteLength).toBe(4)

    const peerObj = savedObjects.find((o) => o.id === 'peer-post-2')
    expect(peerObj).toBeDefined()
    expect(peerObj?.author_name).toBe('PeerPlayer')
    expect(peerObj?.is_public).toBe(1)

    expect(isLegacyBackfillCompleted()).toBe(true)
  })
})
