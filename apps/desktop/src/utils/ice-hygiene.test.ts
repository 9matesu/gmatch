import { describe, expect, it } from 'vitest'
import {
  candidateLeaksIp,
  defaultIceConfig,
  effectiveTurn,
  iceServersFor,
  isLiteralIp,
  parseCandidate,
  peerConnectionConfig,
  sanitizeCandidate,
  STUN_SERVERS,
  turnCredentials,
} from './ice-hygiene'

const hostV4 = 'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host'

const mdnsHost = 'candidate:1 1 udp 2122260223 my-laptop.local 54321 typ host'
const hostV6 = 'candidate:1 1 udp 2122260223 2001:db8::42 54321 typ host'
const srflx = 'candidate:2 1 udp 1685790719 203.0.113.7 41234 typ srflx raddr 192.168.1.5 rport 54321'
const relay = 'candidate:3 1 udp 150 198.51.100.9 50000 typ relay raddr 203.0.113.7 rport 41234'

describe('isLiteralIp', () => {
  it('flags v4 and v6, allows mDNS', () => {
    expect(isLiteralIp('192.168.1.5')).toBe(true)
    expect(isLiteralIp('2001:db8::42')).toBe(true)
    expect(isLiteralIp('my-laptop.local')).toBe(false)
    expect(isLiteralIp('')).toBe(false)
  })
})

describe('parseCandidate', () => {
  it('extracts address and type', () => {
    expect(parseCandidate(hostV4)).toEqual({ address: '192.168.1.5', type: 'host' })
    expect(parseCandidate('aice candidate:9 1 tcp 100 10.0.0.1 9 typ host')).toEqual({
      address: '10.0.0.1',
      type: 'host',
    })
    expect(parseCandidate('garbage')).toBeNull()
    expect(parseCandidate(null as unknown as string)).toBeNull()
  })
})

describe('candidateLeaksIp', () => {
  it('drops host candidates with literal IPs, keeps mDNS hosts', () => {
    expect(candidateLeaksIp(hostV4)).toBe(true)
    expect(candidateLeaksIp(hostV6)).toBe(true)
    expect(candidateLeaksIp(mdnsHost)).toBe(false)
  })

  it('srflx IS the NAT traversal — reflexive candidates are exchanged', () => {
    expect(candidateLeaksIp(srflx)).toBe(false)
  })

  it('relay candidates never leak the user', () => {
    expect(candidateLeaksIp(relay)).toBe(false)
    expect(candidateLeaksIp(relay)).toBe(false)
  })

  it('unknown shapes fail closed', () => {
    expect(candidateLeaksIp('nonsense')).toBe(true)
  })
})

describe('sanitizeCandidate', () => {
  it('passes the end-of-candidates marker through', () => {
    const done = { candidate: '' }
    expect(sanitizeCandidate(done)).toBe(done)
  })

  it('nulls leaking candidates', () => {
    expect(sanitizeCandidate({ candidate: hostV4 })).toBeNull()
    expect(sanitizeCandidate({ candidate: mdnsHost })).not.toBeNull()
  })
})

describe('turnCredentials + config', () => {
  it('needs all three env values', () => {
    expect(turnCredentials({})).toBeNull()
    expect(turnCredentials({ NEXT_PUBLIC_TURN_URL: 'turn:x' })).toBeNull()
    expect(
      turnCredentials({
        NEXT_PUBLIC_TURN_URL: 'turn:x',
        NEXT_PUBLIC_TURN_USERNAME: 'u',
        NEXT_PUBLIC_TURN_CREDENTIAL: 'p',
      }),
    ).toEqual({ url: 'turn:x', username: 'u', credential: 'p' })
  })

  it('without TURN: STUN only, no forced transport policy', () => {
    const cfg = peerConnectionConfig(null)
    expect(cfg.iceServers).toHaveLength(1)
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('with TURN: relay-only transport (no direct P2P, no IP exposure)', () => {
    const turn = { url: 'turn:x', username: 'u', credential: 'p' }
    const cfg = peerConnectionConfig(turn)
    expect(cfg.iceServers).toHaveLength(2)
    expect(cfg.iceTransportPolicy).toBe('relay')
    expect(iceServersFor(turn)[1]).toMatchObject({ urls: 'turn:x' })
  })

  // Fix 1.0.1 #4: no hardcoded API keys/credentials. The old defaultTurn()
  // shipped baked-in OpenRelay creds (a third-party relay the user never
  // chose). With no TURN configured, the config is STUN-only and does NOT
  // force relay; a user who wants cross-NAT relay sets NEXT_PUBLIC_TURN_*.
  it('no defaultTurn export — credentials are never hardcoded', async () => {
    const mod = await import('./ice-hygiene')
    expect((mod as Record<string, unknown>).defaultTurn).toBeUndefined()
  })

  it('STUN is Cloudflare (stateless, anonymous NAT discovery)', () => {
    expect(STUN_SERVERS).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }])
  })

  it('defaultIceConfig: no env → STUN only (1 server), NOT forced relay', () => {
    const cfg = defaultIceConfig({})
    expect(cfg.iceServers).toHaveLength(1)
    expect(cfg.iceServers!.every((s) => String(s.urls).startsWith('stun:'))).toBe(true)
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('effectiveTurn: null without env, the user config when set', () => {
    expect(effectiveTurn({})).toBeNull()
    expect(effectiveTurn({
      NEXT_PUBLIC_TURN_URL: 'turn:y',
      NEXT_PUBLIC_TURN_USERNAME: 'u2',
      NEXT_PUBLIC_TURN_CREDENTIAL: 'p2',
    })).toEqual({ url: 'turn:y', username: 'u2', credential: 'p2' })
  })

  it('defaultIceConfig: explicit env → forced relay (zero-exposure posture)', () => {
    const cfg = defaultIceConfig({
      NEXT_PUBLIC_TURN_URL: 'turn:x',
      NEXT_PUBLIC_TURN_USERNAME: 'u',
      NEXT_PUBLIC_TURN_CREDENTIAL: 'p',
    })
    expect(cfg.iceTransportPolicy).toBe('relay')
    expect(cfg.iceServers![1].urls).toBe('turn:x')
  })

  it('env contract unchanged: turnCredentials({}) is still null', () => {
    expect(turnCredentials({})).toBeNull()
  })
})
