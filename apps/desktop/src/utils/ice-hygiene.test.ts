import { describe, expect, it, vi } from 'vitest'
import {
  candidateLeaksIp,
  defaultIceConfig,
  iceServersFor,
  isLiteralIp,
  normalizeTurnEnv,
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
    // Global IPv6 is a routable direct path (the decentralized CGNAT fix).
    expect(isLiteralIp('2001:db8::42')).toBe(false)
    expect(isLiteralIp('fd00::1')).toBe(true)
    expect(isLiteralIp('fe80::1')).toBe(true)
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
    // Global IPv6 host candidates ARE signaled; private/link-local stay hidden.
    expect(candidateLeaksIp(hostV6)).toBe(false)
    expect(candidateLeaksIp('candidate:1 1 udp 2122260223 fd00::1 54321 typ host')).toBe(true)
    expect(candidateLeaksIp('candidate:1 1 udp 2122260223 fe80::1 54321 typ host')).toBe(true)
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
    expect(cfg.iceServers!.length).toBe(STUN_SERVERS.length)
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('with TURN: relay-only transport (no direct P2P, no IP exposure)', () => {
    const turn = { url: 'turn:x', username: 'u', credential: 'p' }
    const cfg = peerConnectionConfig(turn)
    expect(cfg.iceServers!.length).toBe(STUN_SERVERS.length + 1)
    expect(cfg.iceTransportPolicy).toBe('relay')
    // TURN is appended after the STUN list, wherever that list ends.
    expect(iceServersFor(turn).some((s) => s.urls === 'turn:x')).toBe(true)
  })

  // The old baked `openrelayproject` relay is dead (TEST-NET DNS + revoked
  // global credentials). No dead relay is offered: ICE never stalls on it,
  // and an explicit env/Settings TURN is the only way to get a relay path.
  it('no baked TURN: the dead free relay is not offered', () => {
    const cfg = defaultIceConfig({})
    expect(cfg.iceServers!.every((s) => String(s.urls).startsWith('stun:'))).toBe(true)
    expect(cfg.iceServers!.some((s) => String(s.urls).includes('openrelay'))).toBe(false)
  })

  it('STUN is one public, stateless endpoint (Cloudflare) — not four', () => {
    // One server, not a redundant list: every extra provider is one more
    // "Failed to resolve address" line in Chromium's log when DNS cannot reach
    // it, and the WS-relay swarm is the fallback. Keep this at one.
    expect(STUN_SERVERS).toHaveLength(1)
    expect(STUN_SERVERS[0]).toEqual({ urls: 'stun:stun.cloudflare.com:3478' })
    expect(STUN_SERVERS.every((s) => String(s.urls).startsWith('stun:'))).toBe(true)
  })

  it('defaultIceConfig: no config → STUN only, NOT forced relay', () => {
    const cfg = defaultIceConfig({})
    expect(cfg.iceServers).toEqual(STUN_SERVERS)
    expect(cfg.iceServers!.length).toBe(STUN_SERVERS.length)
    expect(cfg.iceServers!.some((s) => String(s.urls).startsWith('stun:'))).toBe(true)
    expect(cfg.iceTransportPolicy).toBeUndefined()
  })

  it('defaultIceConfig: explicit env → forced relay (zero-exposure posture)', () => {
    const cfg = defaultIceConfig({
      NEXT_PUBLIC_TURN_URL: 'turn:x',
      NEXT_PUBLIC_TURN_USERNAME: 'u',
      NEXT_PUBLIC_TURN_CREDENTIAL: 'p',
    })
    expect(cfg.iceTransportPolicy).toBe('relay')
    expect(cfg.iceServers!.some((s) => s.urls === 'turn:x')).toBe(true)
  })

  it('env contract unchanged: turnCredentials({}) is still null', () => {
    expect(turnCredentials({})).toBeNull()
  })

  it('falls back to a TURN relay saved in Settings (localStorage) when no env is set', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    expect(turnCredentials({})).toBeNull()
    store.set('gmatch.turn.v1', JSON.stringify({ url: 'turn:relay.example:3478', username: 'u', credential: 'p' }))
    expect(turnCredentials({})).toEqual({ url: 'turn:relay.example:3478', username: 'u', credential: 'p' })
    // Env stays authoritative over the stored relay.
    expect(turnCredentials({ NEXT_PUBLIC_TURN_URL: 'turn:env', NEXT_PUBLIC_TURN_USERNAME: 'e', NEXT_PUBLIC_TURN_CREDENTIAL: 'x' }))
      .toEqual({ url: 'turn:env', username: 'e', credential: 'x' })
    vi.unstubAllGlobals()
  })

  it('Settings TURN forces relay; env wins over Settings', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    // Nothing saved → STUN only, direct/srflx wins, no dead relay in the list.
    expect(defaultIceConfig({}).iceServers).toEqual(STUN_SERVERS)
    expect(defaultIceConfig({}).iceTransportPolicy).toBeUndefined()
    // A stored TURN is the only relay path and forces the zero-exposure posture.
    store.set('gmatch.turn.v1', JSON.stringify({ url: 'turn:settings', username: 'su', credential: 'sp' }))
    expect(turnCredentials({})).toEqual({ url: 'turn:settings', username: 'su', credential: 'sp' })
    expect(defaultIceConfig({}).iceTransportPolicy).toBe('relay')
    expect(defaultIceConfig({}).iceServers!.some((s) => s.urls === 'turn:settings')).toBe(true)
    // Env wins over Settings.
    const env = { NEXT_PUBLIC_TURN_URL: 'turn:env', NEXT_PUBLIC_TURN_USERNAME: 'eu', NEXT_PUBLIC_TURN_CREDENTIAL: 'ep' }
    expect(turnCredentials(env)).toEqual({ url: 'turn:env', username: 'eu', credential: 'ep' })
    expect(defaultIceConfig(env).iceServers!.some((s) => s.urls === 'turn:env')).toBe(true)
    expect(defaultIceConfig(env).iceServers!.some((s) => s.urls === 'turn:settings')).toBe(false)
    vi.unstubAllGlobals()
  })

  it('Vite VITE_TURN_* reaches the renderer where process.env does not', () => {
    const viteEnv = {
      VITE_TURN_URL: 'turn:vite.example:3478',
      VITE_TURN_USERNAME: 'vite-user',
      VITE_TURN_CREDENTIAL: 'vite-pass',
    }
    expect(normalizeTurnEnv(viteEnv)).toMatchObject({
      NEXT_PUBLIC_TURN_URL: 'turn:vite.example:3478',
      NEXT_PUBLIC_TURN_USERNAME: 'vite-user',
      NEXT_PUBLIC_TURN_CREDENTIAL: 'vite-pass',
    })
    expect(turnCredentials(viteEnv)).toEqual({ url: 'turn:vite.example:3478', username: 'vite-user', credential: 'vite-pass' })
    expect(defaultIceConfig(viteEnv).iceTransportPolicy).toBe('relay')
    // An explicitly injected NEXT_PUBLIC_ value still wins over the alias.
    expect(normalizeTurnEnv({ ...viteEnv, NEXT_PUBLIC_TURN_URL: 'turn:explicit' }).NEXT_PUBLIC_TURN_URL).toBe('turn:explicit')
  })
})
