import { describe, expect, it } from 'vitest'
import {
  candidateLeaksIp,
  iceServersFor,
  isLiteralIp,
  parseCandidate,
  peerConnectionConfig,
  sanitizeCandidate,
  turnCredentials,
} from './ice-hygiene'

const hostV4 = 'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host'
const hostMdns = 'candidate:1 1 udp 2122260223 fe80::1 54321 typ host'
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

  it('srflx is always a public-IP leak (relay policy prevents gathering with TURN)', () => {
    expect(candidateLeaksIp(srflx)).toBe(true)
    expect(candidateLeaksIp(srflx)).toBe(true)
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
    expect(cfg.iceServers).toHaveLength(3)
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('with TURN: relay-only transport (no direct P2P, no IP exposure)', () => {
    const turn = { url: 'turn:x', username: 'u', credential: 'p' }
    const cfg = peerConnectionConfig(turn)
    expect(cfg.iceServers).toHaveLength(4)
    expect(cfg.iceTransportPolicy).toBe('relay')
    expect(iceServersFor(turn)[3]).toMatchObject({ urls: 'turn:x' })
  })
})
