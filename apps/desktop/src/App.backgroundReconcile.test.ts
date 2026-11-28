// @vitest-environment jsdom
// Review 8: the peer-online / foreground reconcile dispatches MEDIA_RETRY_EVENT
// from a `finally`, so a failed dynamic import or a throwing pending-transfer
// resume can never skip the retry that re-resolves tiles whose seeder just came
// online. The whole wave is throttled (~15s) and is not spent on a hidden tab.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  autoReplicateOwnPosts: vi.fn(async () => true),
  sharedSocialOperationLog: vi.fn(() => ({})),
  flushPostOutbox: vi.fn(async () => ({ registered: 0, replicated: 0 })),
  rearmMissingReplicated: vi.fn(async () => undefined),
  resumePendingTransfers: vi.fn(async (_resolve: unknown) => undefined),
  requestSwarmObject: vi.fn(async () => new Blob()),
}))

vi.mock('./services/socialPostImport', () => ({ autoReplicateOwnPosts: m.autoReplicateOwnPosts }))
vi.mock('./services/socialOperationLog', () => ({ sharedSocialOperationLog: m.sharedSocialOperationLog }))
vi.mock('./services/postOutbox', () => ({
  outboxStatesByGroup: vi.fn(() => ({})),
  flushPostOutbox: m.flushPostOutbox,
  rearmMissingReplicated: m.rearmMissingReplicated,
}))
vi.mock('./utils/pendingTransfers', () => ({ resumePendingTransfers: m.resumePendingTransfers }))
vi.mock('./utils/p2pSwarm', () => ({
  PEER_ONLINE_EVENT: 'gmatch-peer-online',
  requestSwarmObject: m.requestSwarmObject,
}))

import { createBackgroundReconcile } from './App'

const identity = { orbitId: 'me' } as any

function makeReconcile() {
  const clock = { now: 1000, hidden: false }
  const dispatchRetry = vi.fn()
  const refreshFeed = vi.fn()
  const loadCards = vi.fn()
  const reconcile = createBackgroundReconcile({
    identity,
    now: () => clock.now,
    hidden: () => clock.hidden,
    dispatchRetry,
    refreshFeed,
    loadCards,
  })
  return { reconcile, clock, dispatchRetry, refreshFeed, loadCards }
}

describe('App background reconcile (review 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.autoReplicateOwnPosts.mockResolvedValue(true)
    m.flushPostOutbox.mockResolvedValue({ registered: 0, replicated: 0 })
    m.rearmMissingReplicated.mockResolvedValue(undefined)
    m.resumePendingTransfers.mockResolvedValue(undefined)
  })

  it('dispatches the retry wave even when the import/work throws', async () => {
    const { reconcile, dispatchRetry } = makeReconcile()
    m.autoReplicateOwnPosts.mockRejectedValueOnce(new Error('dynamic import / op failed'))
    reconcile()
    await vi.waitFor(() => expect(dispatchRetry).toHaveBeenCalledTimes(1))
  })

  it('dispatches the retry wave even when resumePendingTransfers throws', async () => {
    const { reconcile, dispatchRetry } = makeReconcile()
    m.resumePendingTransfers.mockRejectedValueOnce(new Error('pendingTransfers failed'))
    reconcile()
    await vi.waitFor(() => expect(dispatchRetry).toHaveBeenCalledTimes(1))
    expect(m.autoReplicateOwnPosts).toHaveBeenCalledTimes(1)
  })

  it('runs the whole wave at most once per 15s and never while hidden', async () => {
    const { reconcile, clock, dispatchRetry } = makeReconcile()
    reconcile()
    await vi.waitFor(() => expect(m.autoReplicateOwnPosts).toHaveBeenCalledTimes(1))
    clock.now = 2000
    reconcile()
    expect(m.autoReplicateOwnPosts).toHaveBeenCalledTimes(1)

    clock.hidden = true
    clock.now = 30_000
    reconcile()
    expect(m.autoReplicateOwnPosts).toHaveBeenCalledTimes(1)

    clock.hidden = false
    reconcile()
    await vi.waitFor(() => expect(m.autoReplicateOwnPosts).toHaveBeenCalledTimes(2))
    expect(dispatchRetry).toHaveBeenCalledTimes(2)
  })
})
