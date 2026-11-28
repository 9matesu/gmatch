// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  _resetPeerNodes,
  isPrivateNodeUrl,
  knownNodes,
  normalizeNodeUrl,
  peerNodeFor,
  rememberKnownNode,
  rememberPeerNode,
} from './peerNodes'

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('peer node registry', () => {
  it('remembers where a peer lives', () => {
    rememberPeerNode('peer-1', 'http://192.168.1.10:8790')
    expect(peerNodeFor('peer-1')).toBe('http://192.168.1.10:8790')
  })

  it('normalizes the URL and rejects a non-http one', () => {
    expect(normalizeNodeUrl('http://node.test:8790/')).toBe('http://node.test:8790')
    expect(normalizeNodeUrl('node.test')).toBeNull()
    expect(normalizeNodeUrl('')).toBeNull()
  })

  it('collects the nodes it has heard about', () => {
    rememberKnownNode('http://a.test:8790')
    rememberKnownNode('http://b.test:8790')
    rememberKnownNode('http://a.test:8790')
    expect(knownNodes()).toEqual(['http://a.test:8790', 'http://b.test:8790'])
  })

  it('remembers the node a peer named', () => {
    rememberPeerNode('peer-2', 'http://c.test:8790')
    expect(knownNodes()).toContain('http://c.test:8790')
  })

  it('classifies a peer node as dialable only when it is publicly routable', () => {
    // A beacon names the node the PEER can reach. On another network these are
    // private literals we cannot dial; the sealed rendezvous is the fallback.
    for (const url of [
      'http://10.0.0.4:8790',
      'http://172.16.3.4:8790',
      'http://192.168.1.215:8790',
      'http://100.64.12.7:8790',
      'http://127.0.0.1:8790',
      'http://169.254.10.2:8790',
      'http://[::1]:8790',
    ]) expect(isPrivateNodeUrl(url), url).toBe(true)

    for (const url of [
      'http://bob-node.test:8790',
      'https://gmatch-rendezvous.mcos-mateus.workers.dev',
      'http://93.184.216.34:8790',
    ]) expect(isPrivateNodeUrl(url), url).toBe(false)

    expect(isPrivateNodeUrl('not a url')).toBe(true)
  })

  it('forgets a peer without touching the others', () => {
    rememberPeerNode('peer-1', 'http://a.test:8790')
    rememberPeerNode('peer-2', 'http://b.test:8790')
    _resetPeerNodes()
    expect(peerNodeFor('peer-1')).toBeNull()
  })
})
