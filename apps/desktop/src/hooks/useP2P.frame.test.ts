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

/**
 * The relay stamp is a claim until the OWN node's socket proves it. A socket to
 * another node is a peer pipe: that node can stamp whatever it likes, so the
 * sender must never borrow the stamp to attribute an object to a third party.
 */
describe('routeInboundFrame pipe origin', () => {
  const user = { id: 'attacker', publicKey: 'pk', createdAt: '' }
  const stamped = {
    type: 'SWARM_FRAME',
    relayedBy: 'victim',
    swarm: {
      type: 'IMAGE_ANNOUNCE',
      user,
      timestamp: 1,
      payload: { id: 'obj-1', owner_id: 'victim', size_bytes: 1, mime_type: 'image/jpeg', created_at: '' },
    },
  }

  it('keeps relayedBy from the HOME node socket only', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    // The home node stamps the sender it authenticated; a forged claim that
    // disagrees is dropped by the shared contract.
    expect(routeInboundFrame(stamped, onSwarm, onAnnounce, 'home-relay')).toBe(false)
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('discards a hostile stamp from an extra relay socket before narrowing', () => {
    const onSwarm = vi.fn()
    const onAnnounce = vi.fn()
    // Stripped BEFORE parseSwarmAnnounce, otherwise the forged stamp would
    // either drop a valid frame or (when equal to user.id) vouch for it.
    expect(routeInboundFrame(stamped, onSwarm, onAnnounce, 'extra-relay')).toBe(true)
    expect(onAnnounce).toHaveBeenCalledTimes(1)
    expect(onAnnounce.mock.calls[0][0].relayedBy).toBeUndefined()
    expect(onAnnounce.mock.calls[0][0].user.id).toBe('attacker')
  })

  it('also strips a stamp on the direct mesh and local-tab pipes', () => {
    for (const origin of ['mesh', 'local-tab'] as const) {
      const onAnnounce = vi.fn()
      routeInboundFrame(stamped, vi.fn(), onAnnounce, origin)
      expect(onAnnounce.mock.calls[0][0].relayedBy).toBeUndefined()
    }
  })
})