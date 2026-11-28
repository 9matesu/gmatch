// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { directPathFromRemoteIp, isCrossNodePeer } from './useP2P'
import { _resetPeerNodes, rememberPeerNode } from '../utils/peerNodes'

/**
 * U6 follow-up: a FULL node (courierOnlyWs=false) must still make ONE bounded
 * direct mesh dial to a peer whose signed presence beacon names a DIFFERENT
 * node — otherwise media BYTES have no transport between two isolated full
 * nodes. A same-node peer keeps the local relay and gets no dial, and the
 * transport label stays relay until the DataChannel actually opens (owned by
 * the transport registry, exercised in transportState.test.ts).
 *
 * These pin the decision seam (`isCrossNodePeer`) that `pullRoster` gates the
 * dial on, plus the registry phase a failed attempt leaves behind.
 */

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as Storage)
  _resetPeerNodes()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SELF_BASE = 'http://127.0.0.1:8790'
const PEER = 'peer-cross'

describe('isCrossNodePeer (full-node direct-dial decision)', () => {
  it('is true for a peer whose beacon names a different, dialable node', () => {
    rememberPeerNode(PEER, 'http://192.168.1.20:8790')
    expect(isCrossNodePeer(PEER, SELF_BASE)).toBe(true)
  })

  it('is false for a peer on the SAME node as us', () => {
    rememberPeerNode(PEER, SELF_BASE)
    expect(isCrossNodePeer(PEER, SELF_BASE)).toBe(false)
  })

  it('is false when we do not know the peer node (no beacon address yet)', () => {
    expect(isCrossNodePeer(PEER, SELF_BASE)).toBe(false)
  })

  it('is false for a peer whose node is loopback (not dialable cross-machine)', () => {
    rememberPeerNode(PEER, 'http://127.0.0.1:9999')
    expect(isCrossNodePeer(PEER, SELF_BASE)).toBe(false)
  })
})

describe('a failed cross-node direct attempt leaves the label on relay', () => {
  it('startDirectAttempt -> markDirectFailed(true) demotes to relay, never direct', async () => {
    const { createTransportRegistry, transportLabel } = await import('../utils/transportState')
    const reg = createTransportRegistry()
    // No settled route yet: the label says nothing (never "P2P direct").
    expect(transportLabel(reg.phaseFor(PEER))).toBeNull()
    reg.startDirectAttempt(PEER)
    expect(transportLabel(reg.phaseFor(PEER))).toBeNull()
    // The dial failed but the node relay is wired: honest fallback label.
    reg.markDirectFailed(PEER, 'ice failed', true)
    expect(reg.phaseFor(PEER)).toBe('relay')
    expect(transportLabel(reg.phaseFor(PEER))).toBe('relay via node (NAT)')
  })
})

describe('the direct-path ladder is honest', () => {
  it('a slow IPv6/Radmin handshake is not killed by a 12s registry deadline', async () => {
    const { createTransportRegistry } = await import('../utils/transportState')
    let t = 1000
    const reg = createTransportRegistry({ now: () => t })
    reg.startDirectAttempt(PEER)
    t += 20_000
    // The mesh dial allows 30s; the registry must not declare it dead sooner.
    expect(reg.isDirectAttemptOverdue(PEER)).toBe(false)
    t += 11_000
    expect(reg.isDirectAttemptOverdue(PEER)).toBe(true)
  })

  it('global IPv6 and Radmin are direct; CGNAT-only is not', () => {
    expect(directPathFromRemoteIp('2601:646:1234::1')).toBe('ipv6')
    expect(directPathFromRemoteIp('2001:0:14c9:cd04:3c06:4c04:759c:b4a5')).toBe('ipv6')
    expect(directPathFromRemoteIp('26.26.113.34')).toBe('radmin')
    expect(directPathFromRemoteIp('100.64.0.1')).toBeNull()
    expect(directPathFromRemoteIp('192.168.6.3')).toBeNull()
  })

  it('labels IPv6/Radmin only after validation; CGNAT-only stays relay', async () => {
    const { createTransportRegistry, transportLabel } = await import('../utils/transportState')
    const reg = createTransportRegistry()
    reg.markDirectFailed('cg', 'ice failed: no pair', true)
    expect(reg.phaseFor('cg')).toBe('relay')
    expect(transportLabel(reg.phaseFor('cg'), false, false)).toBe('relay via node (NAT)')

    reg.markDirectValidated('v6', false, true)
    expect(transportLabel(reg.phaseFor('v6'), reg.isDirectViaRadmin('v6'), reg.isDirectViaIpv6('v6'))).toBe('P2P direct (IPv6)')
    reg.markDirectValidated('vpn', true, false)
    expect(transportLabel(reg.phaseFor('vpn'), reg.isDirectViaRadmin('vpn'), reg.isDirectViaIpv6('vpn'))).toBe('VPN direct (Radmin)')
  })
})