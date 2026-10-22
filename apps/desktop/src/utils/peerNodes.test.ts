// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  _resetPeerNodes,
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

  it('forgets a peer without touching the others', () => {
    rememberPeerNode('peer-1', 'http://a.test:8790')
    rememberPeerNode('peer-2', 'http://b.test:8790')
    _resetPeerNodes()
    expect(peerNodeFor('peer-1')).toBeNull()
  })
})
