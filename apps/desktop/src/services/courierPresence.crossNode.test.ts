// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { broadcastPresence, fetchPresenceRosterFrom, PRESENCE_TOKEN } from './courierPresence'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'

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

  it('reports the node each peer lives on', async () => {
    localStorage.setItem('gmatch.api.url', 'http://node.test:8790')
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
