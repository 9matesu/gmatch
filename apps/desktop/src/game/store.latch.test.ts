import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
})

import { setupTag } from './tags'
import { fetchPostsMulti } from '../services/booru'
import { useGame, __resetFeedRetryForTests } from './store'

/**
 * The mid-round latch.
 *
 * `fetchFeed` used to `return` outright when a round was already in flight.
 * The most common caller of that path is a KO/advance that has just drained
 * the queue — so the exact request that would have refilled the feed was the
 * one being dropped, and the feed sat on a picture the player had already
 * used until the next auto-poll.
 */

const mockedMulti = vi.mocked(fetchPostsMulti)

/** A round that stays in flight until the returned release() is called. */
function slowRound() {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  mockedMulti.mockImplementationOnce(async () => {
    await gate
    return { posts: [], source: null, ok: false, offline: true }
  })
  return { release: () => release() }
}

describe('fetchFeed mid-round latch', () => {
  beforeEach(() => {
    mem.clear()
    mockedMulti.mockReset()
    useGame.getState().resetGame()
    __resetFeedRetryForTests()
    useGame.setState({ tags: [setupTag('creampie')] })
  })

  it('runs a follow-up round when a fetch is requested mid-round', async () => {
    const { release } = slowRound()
    const first = useGame.getState().fetchFeed()
    // Let the round actually enter flight before racing it.
    await Promise.resolve()
    expect(useGame.getState().fetching).toBe(true)

    // The dropped-request case: asked for while busy.
    void useGame.getState().fetchFeed()
    expect(mockedMulti).toHaveBeenCalledTimes(1)

    release()
    await first
    // The latched request is honoured once the round frees up.
    await vi.waitFor(() => expect(mockedMulti).toHaveBeenCalledTimes(2))
  })

  it('coalesces a burst of mid-round requests into ONE follow-up', async () => {
    const { release } = slowRound()
    const first = useGame.getState().fetchFeed()
    await Promise.resolve()

    // Five KOs land together; the feed only needs "something new once".
    for (let i = 0; i < 5; i++) void useGame.getState().fetchFeed()
    expect(mockedMulti).toHaveBeenCalledTimes(1)

    release()
    await first
    await vi.waitFor(() => expect(mockedMulti).toHaveBeenCalledTimes(2))
  })

  it('does not latch when nothing asked mid-round', async () => {
    const { release } = slowRound()
    const first = useGame.getState().fetchFeed()
    await Promise.resolve()
    release()
    await first
    await new Promise((r) => setTimeout(r, 10))
    // Exactly the one round, no phantom follow-up.
    expect(mockedMulti).toHaveBeenCalledTimes(1)
  })
})
