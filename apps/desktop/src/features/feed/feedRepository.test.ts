import { describe, it, expect, vi } from 'vitest'
import { fetchFeedSnapshot, fetchPostById, feedTimelineUnchanged } from './feedRepository'
import type { FeedPost } from '../../components/feed/GMatchFeed'
import type { OrbitIdentity } from '@orbit/crypto'

/**
 * Feed repository contract: the ordering rules that keep the snapshot from
 * clobbering a fresh push, and the deep-link read that never accepts an answer
 * for a different id. The network is a stub — this is the contract, not a test
 * of `orbitFetch`.
 */

const identity = { orbitId: 'self' } as unknown as OrbitIdentity

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

function post(id: string, createdAt = '2026-01-01T00:00:00.000Z'): FeedPost {
  return {
    id,
    author_id: 'peer-1',
    author_name: 'Peer One',
    url: `https://cdn.test/${id}.jpg`,
    mime_type: 'image/jpeg',
    caption: '',
    created_at: createdAt,
    like_count: 0,
    comment_count: 0,
    is_liked: false,
    is_saved: false,
  }
}

describe('fetchFeedSnapshot', () => {
  it('returns the snapshot posts and ok=true', async () => {
    const fetch = vi.fn(async () => res(200, { posts: [post('a')] }))
    const snap = await fetchFeedSnapshot({ fetch, pushed: new Map() }, identity, 1, () => 1)
    expect(snap.ok).toBe(true)
    expect(snap.stale).toBe(false)
    expect(snap.posts.map((p) => p.id)).toEqual(['a'])
  })

  it('reports 404 as a state, not a failure (ok=false, not stale)', async () => {
    const fetch = vi.fn(async () => res(404))
    const snap = await fetchFeedSnapshot({ fetch, pushed: new Map() }, identity, 1, () => 1)
    expect(snap.ok).toBe(false)
    expect(snap.stale).toBe(false)
  })

  it('marks the response stale when a newer request superseded it', async () => {
    const fetch = vi.fn(async () => res(200, { posts: [post('a')] }))
    // seq 1 is no longer current (current is 2)
    const snap = await fetchFeedSnapshot({ fetch, pushed: new Map() }, identity, 1, () => 2)
    expect(snap.stale).toBe(true)
    expect(snap.posts).toEqual([])
  })

  it('marks a malformed body as not-ok without throwing', async () => {
    const fetch = vi.fn(async () => res(200, { nope: true }))
    const snap = await fetchFeedSnapshot({ fetch, pushed: new Map() }, identity, 1, () => 1)
    expect(snap.ok).toBe(false)
  })

  it('folds a remembered push in front of the snapshot until it is listed', async () => {
    const pushed = new Map([['pushed', { post: post('pushed', '2026-02-01T00:00:00.000Z'), at: Date.now() }]])
    const fetch = vi.fn(async () => res(200, { posts: [post('a')] }))
    const snap = await fetchFeedSnapshot({ fetch, pushed }, identity, 1, () => 1)
    expect(snap.posts.map((p) => p.id)).toEqual(['pushed', 'a'])
  })
})

describe('fetchPostById', () => {
  it('accepts an answer for the id asked for', async () => {
    const fetch = vi.fn(async () => res(200, { post: post('x') }))
    const got = await fetchPostById({ fetch, pushed: new Map() }, identity, 'x')
    expect(got?.id).toBe('x')
  })

  it('refuses an answer for a DIFFERENT id (never pins a wrong post)', async () => {
    const fetch = vi.fn(async () => res(200, { post: post('y') }))
    const got = await fetchPostById({ fetch, pushed: new Map() }, identity, 'x')
    expect(got).toBeNull()
  })

  it('returns null on a 404 (blind courier / P2P-only post)', async () => {
    const fetch = vi.fn(async () => res(404))
    const got = await fetchPostById({ fetch, pushed: new Map() }, identity, 'x')
    expect(got).toBeNull()
  })
})

describe('feedTimelineUnchanged', () => {
  it('is true when the rows render the same pixels', () => {
    const a = [post('a')]
    const b = [{ ...post('a') }]
    expect(feedTimelineUnchanged(a, b)).toBe(true)
  })

  it('is false when a row field changed', () => {
    const a = [post('a')]
    const b = [{ ...post('a'), like_count: 5 }]
    expect(feedTimelineUnchanged(a, b)).toBe(false)
  })

  it('is false when the ids differ', () => {
    expect(feedTimelineUnchanged([post('a')], [post('b')])).toBe(false)
  })
})