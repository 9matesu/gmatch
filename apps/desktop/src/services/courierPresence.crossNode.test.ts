// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { broadcastPresence, fetchPresenceRosterFrom, PRESENCE_TOKEN } from './courierPresence'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { _resetNodeAddress } from '../utils/serverAddress'

/**
 * A peer that lives on ANOTHER node: the beacon says which node, and the
 * roster reports it, so the sealed envelope can go straight into that node's
 * mailbox. The node URL is signed — a rewritten address breaks the beacon.
 */
describe('courierPresence across nodes', () => {
  const alice = generateIdentity() as OrbitIdentity
  const bob = generateIdentity() as OrbitIdentity

  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage)
    _resetNodeAddress()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('announces the node it is connected to', async () => {
    localStorage.setItem('gmatch.api.url', 'http://node.test:8790')
    let captured: any = null
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string).env
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    expect(await broadcastPresence(bob, { displayName: 'Bob' }, fetchMock as unknown as typeof globalThis.fetch)).toBe(true)

    const beacon = JSON.parse(decodeURIComponent(escape(atob(captured.sealed))))
    expect(beacon.nodeUrl).toBe('http://node.test:8790')
  })

  it('names the node DIALABLY: a loopback base is useless to another machine', async () => {
    // The packaged app talks to its own node over 127.0.0.1. A peer reading
    // that address would dial ITS OWN loopback, so the beacon has to name the
    // address the node really answers on.
    localStorage.setItem('gmatch.api.url', 'http://127.0.0.1:8790')
    let captured: any = null
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/servers/node')) {
        return new Response(JSON.stringify({ lanUrls: ['http://172.28.48.1:8790', 'http://192.168.5.2:8790'] }), { status: 200 })
      }
      if (!init?.body) {
        // the node's public key probe — no seal available, signed path stands
        return new Response(JSON.stringify({ sealed_available: false }), { status: 200 })
      }
      captured = JSON.parse(String(init.body)).env
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    expect(await broadcastPresence(bob, { displayName: 'Bob' }, fetchMock as unknown as typeof globalThis.fetch)).toBe(true)

    const beacon = JSON.parse(decodeURIComponent(escape(atob(captured.sealed))))
    expect(beacon.nodeUrl).toBe('http://192.168.5.2:8790')
  })

  it('reports the node each peer lives on', async () => {    localStorage.setItem('gmatch.api.url', 'http://node.test:8790')
    let captured: any = null
    const putFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string).env
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    await broadcastPresence(bob, { displayName: 'Bob' }, putFetch as unknown as typeof globalThis.fetch)

    const getFetch = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ envelopes: [captured] }),
      { status: 200 },
    ))

    const roster = await fetchPresenceRosterFrom(
      'http://node.test:8790',
      alice.orbitId,
      getFetch as unknown as typeof globalThis.fetch,
    )
    expect(roster.users).toHaveLength(1)
    expect(roster.nodeById.get(bob.orbitId)).toBe('http://node.test:8790')
  })

  it('rejects a beacon whose node address was rewritten', async () => {
    localStorage.setItem('gmatch.api.url', 'http://node.test:8790')
    let captured: any = null
    const putFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string).env
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    await broadcastPresence(bob, { displayName: 'Bob' }, putFetch as unknown as typeof globalThis.fetch)

    // A relay swaps the node address: the signature no longer matches.
    const beacon = JSON.parse(decodeURIComponent(escape(atob(captured.sealed))))
    beacon.nodeUrl = 'http://evil.test:8790'
    const tampered = { ...captured, sealed: btoa(JSON.stringify(beacon)) }

    const getFetch = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ envelopes: [tampered] }),
      { status: 200 },
    ))

    const roster = await fetchPresenceRosterFrom(
      'http://node.test:8790',
      alice.orbitId,
      getFetch as unknown as typeof globalThis.fetch,
    )
    expect(roster.users).toHaveLength(0)
    expect(roster.nodeById.size).toBe(0)
  })

  it('a peer on a different node is visible through the shared hosted mailbox', async () => {
    localStorage.setItem('gmatch.api.url', 'http://node-b.test:8790')
    const boxes = new Map<string, any[]>()
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/mail/')) {
        const base = u.split('/api/mail/')[0]
        if (init?.method === 'PUT') {
          boxes.set(base, [...(boxes.get(base) ?? []), JSON.parse(String(init.body)).env])
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify({ envelopes: boxes.get(base) ?? [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ lanUrls: [] }), { status: 200 })
    })
    await broadcastPresence(bob, { displayName: 'Bob on node B' }, fetchMock as unknown as typeof globalThis.fetch)
    const roster = await fetchPresenceRosterFrom(
      'https://gmatch-rendezvous.mcos-mateus.workers.dev',
      alice.orbitId,
      fetchMock as unknown as typeof globalThis.fetch,
    )
    expect(roster.users.map((u) => u.id)).toContain(bob.orbitId)
  })

  it('reads the presence mailbox of another node', async () => {
    const getFetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe(`http://other.test:8790/api/mail/${PRESENCE_TOKEN}`)
      return new Response(JSON.stringify({ envelopes: [] }), { status: 200 })
    })
    const roster = await fetchPresenceRosterFrom(
      'http://other.test:8790',
      alice.orbitId,
      getFetch as unknown as typeof globalThis.fetch,
    )
    expect(roster.users).toEqual([])
  })
})
