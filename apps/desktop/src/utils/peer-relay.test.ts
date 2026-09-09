import { describe, expect, it } from 'vitest'
import { peerRelayConfig, setPeerRelayServer } from './peer-relay'

// Task 1.1/3.5: the PeerJS cloud (0.peerjs.com) is a THIRD-PARTY server —
// it must not be used unless the user explicitly configures a self-hosted
// PeerServer. No config => relay disabled (WS swarm + courier still carry
// traffic; no dead end).
describe('peerRelayConfig (no public PeerJS cloud by default)', () => {
  it('undefined without a host — never falls back to 0.peerjs.com', () => {
    expect(peerRelayConfig({})).toBeUndefined()
    expect(peerRelayConfig({ NEXT_PUBLIC_PEERJS_HOST: '' })).toBeUndefined()
  })

  it('self-hosted peer server requires host + port', () => {
    expect(peerRelayConfig({ NEXT_PUBLIC_PEERJS_HOST: 'p2p.my.site' })).toBeUndefined()
    const cfg = peerRelayConfig({
      NEXT_PUBLIC_PEERJS_HOST: 'p2p.my.site',
      NEXT_PUBLIC_PEERJS_PORT: '443',
      NEXT_PUBLIC_PEERJS_PATH: '/peer',
    })
    expect(cfg).toEqual({ host: 'p2p.my.site', port: 443, path: '/peer', secure: true })
  })

  it('non-443/80 ports default to secure only on https-ish guesses; explicit wins', () => {
    expect(peerRelayConfig({ NEXT_PUBLIC_PEERJS_HOST: 'lan.host', NEXT_PUBLIC_PEERJS_PORT: '9000' }))
      .toEqual({ host: 'lan.host', port: 9000, path: '/', secure: false })
    expect(peerRelayConfig({ NEXT_PUBLIC_PEERJS_HOST: 'lan.host', NEXT_PUBLIC_PEERJS_PORT: '443' }))
      .toEqual({ host: 'lan.host', port: 443, path: '/', secure: true })
    expect(peerRelayConfig({ NEXT_PUBLIC_PEERJS_HOST: 'lan.host', NEXT_PUBLIC_PEERJS_PORT: '443', NEXT_PUBLIC_PEERJS_SECURE: '0' }))
      .toEqual({ host: 'lan.host', port: 443, path: '/', secure: false })
  })

  it('runtime override (setPeerRelayServer) enables without env', () => {
    setPeerRelayServer({ host: 'setup.local', port: 9100 })
    expect(peerRelayConfig({})).toEqual({ host: 'setup.local', port: 9100, path: '/', secure: false })
    setPeerRelayServer(null)
    expect(peerRelayConfig({})).toBeUndefined()
  })
})
