import { describe, it, expect, vi } from 'vitest'
import { routeInboundFrame } from './useP2P'

/**
 * One inbound door for every pipe (relay socket, local-tab channel, direct
 * mesh). These are the contract tests: a frame the shared contract does not
 * recognise must never reach a handler, and a wrapped frame must reach exactly
 * the handler for its kind.
 */
describe('routeInboundFrame (one inbound door)', () => {
  const swarm = { type: 'SWARM_HAVE', ids: ['a'] } as const

  it('routes a SWARM_FRAME envelope to the swarm handler once', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    const ok = routeInboundFrame({ type: 'SWARM_FRAME', swarm }, onSwarm, onAnnounce)
    expect(ok).toBe(true)
    expect(onSwarm).toHaveBeenCalledWith(swarm)
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('routes a bare announcement to the announce handler', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    // A bare announcement (the direct mesh + local-tab pipes carry these): the
    // shared contract requires an announce type AND a user, so a bare
    // `{kind:'announce'}` is not one.
    const announce = {
      type: 'IMAGE_ANNOUNCE',
      user: { id: 'peer-1', publicKey: 'pk', createdAt: '' },
      timestamp: Date.now(),
      payload: { id: 'obj-1', owner_id: 'peer-1', size_bytes: 1, mime_type: 'image/jpeg', created_at: '' },
    }
    const ok = routeInboundFrame(announce, onSwarm, onAnnounce)
    expect(ok).toBe(true)
    expect(onAnnounce).toHaveBeenCalledTimes(1)
    expect(onSwarm).not.toHaveBeenCalled()
  })

  it('drops an announcement with no user (a self-described payload is not enough)', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    expect(routeInboundFrame({ type: 'IMAGE_ANNOUNCE', timestamp: 1 }, onSwarm, onAnnounce)).toBe(false)
    expect(routeInboundFrame({ type: 'CHAT' }, onSwarm, onAnnounce)).toBe(false)
    expect(onSwarm).not.toHaveBeenCalled()
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('drops a frame whose shape does not fit the declared one', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    // SWARM_FRAME with a non-object payload: the relay allowlist would refuse it
    // too, but the client must not assume that.
    expect(routeInboundFrame({ type: 'SWARM_FRAME', swarm: 42 }, onSwarm, onAnnounce)).toBe(false)
    expect(routeInboundFrame({ type: 'SWARM_FRAME' }, onSwarm, onAnnounce)).toBe(false)
    expect(routeInboundFrame({ type: 'feed', post: {} }, onSwarm, onAnnounce)).toBe(false)
    expect(routeInboundFrame(null, onSwarm, onAnnounce)).toBe(false)
    expect(routeInboundFrame('not a frame', onSwarm, onAnnounce)).toBe(false)
    expect(onSwarm).not.toHaveBeenCalled()
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('never treats a bare type key as a swarm frame (audit A2)', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    expect(routeInboundFrame({ type: 'SWARM_HAVE', ids: [] }, onSwarm, onAnnounce)).toBe(false)
    expect(onSwarm).not.toHaveBeenCalled()
    expect(onAnnounce).not.toHaveBeenCalled()
  })
})