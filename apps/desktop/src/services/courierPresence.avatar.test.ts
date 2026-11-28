// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import { broadcastPresence, fetchPresenceRosterFrom } from './courierPresence'
import { resolveContentAddressedMedia } from '../utils/contentAddressedMedia'
import { registerLocalObject, sha256HexBlob } from '../utils/p2pSwarm'
import { SwarmTestNetwork } from '../utils/swarmHarness'
import { _resetNodeAddress } from '../utils/serverAddress'

/**
 * Cross-node AVATARS, both directions. A peer's `pfp_url` is a node-local
 * `/api/objects/<id>` that 404s on the reader's node, so the signed presence
 * beacon now carries the avatar's CONTENT hash. The reader's roster exposes it
 * as `urn:sha256:<hash>`, and Avatar.tsx resolves it through the SAME verified
 * ladder as a peer post — local bytes, then the swarm by hash. No node, no
 * provider hotlink, and bytes that do not hash to the address are refused.
 */

const AVATAR = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])], { type: 'image/png' })

function mailboxFetch(boxes: Map<string, any[]>) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/mail/')) {
      const base = u.split('/api/mail/')[0]
      if (init?.method === 'PUT') {
        boxes.set(base, [...(boxes.get(base) ?? []), JSON.parse(String(init.body)).env])
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ envelopes: boxes.get(base) ?? [] }), { status: 200 })
    }
    // node address probe + any other node call: no LAN address to advertise
    return new Response(JSON.stringify({ lanUrls: [] }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
}

describe('cross-node avatars (presence avatar hash)', () => {
  const alice = generateIdentity() as OrbitIdentity
  const bob = generateIdentity() as OrbitIdentity

  beforeAll(() => {
    // jsdom's Blob has no arrayBuffer(); Chromium (the real runtime) does. The
    // production hashing path is unchanged — this only lets the test hash.
    if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result as ArrayBuffer)
          fr.onerror = () => reject(fr.error)
          fr.readAsArrayBuffer(this)
        })
      }
    }
  })

  beforeEach(() => {
    const store = new Map<string, string>()
    store.set('gmatch.api.url', 'http://node-a.test:8790')
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

  it("advertises the avatar's content hash for a node-local object id, and the reader resolves it", async () => {
    const contentHash = await sha256HexBlob(AVATAR)
    const objectId = '11111111-1111-4111-8111-111111111111'
    // A holds the avatar bytes locally under the node-local object id (as
    // forgeMediaLocally / the media picker do after an upload).
    registerLocalObject(objectId, AVATAR)

    const boxes = new Map<string, any[]>()
    const fetchMock = mailboxFetch(boxes)
    expect(await broadcastPresence(alice, { displayName: 'Alice', pfpUrl: `/api/objects/${objectId}` }, fetchMock)).toBe(true)

    // The signed beacon carries the content hash, not the node-local path.
    const env = boxes.get('http://node-a.test:8790')![0]
    const beacon = JSON.parse(decodeURIComponent(escape(atob(env.sealed))))
    expect(beacon.pfpHash).toBe(contentHash)

    // B reads the roster: the avatar is a content address it can verify.
    const roster = await fetchPresenceRosterFrom('http://node-a.test:8790', bob.orbitId, fetchMock)
    const peer = roster.users.find((u) => u.id === alice.orbitId)!
    expect(peer.pfp_url).toBe(`urn:sha256:${contentHash}`)

    // B resolves the bytes off the swarm (A seeds by content hash), verified.
    const net = new SwarmTestNetwork()
    const a = net.createNode('author')
    const b = net.createNode('reader')
    a.session.registerLocalObject(contentHash, AVATAR)
    const bytes = await resolveContentAddressedMedia(null, contentHash, {
      timeoutMs: 3000,
      deps: {
        readLocal: async (id) => b.durable.get(id) ?? null,
        requestSwarm: (id, t, opts) => b.session.requestObject(id, t, opts.expectedHash),
      },
    })
    expect(bytes).not.toBeNull()
    expect(await sha256HexBlob(bytes!)).toBe(contentHash)
    expect(new Uint8Array(await bytes!.arrayBuffer())).toEqual(new Uint8Array(await AVATAR.arrayBuffer()))
  })

  it('both directions: each side advertises a hash the other resolves', async () => {
    const aliceHash = await sha256HexBlob(AVATAR)
    const bobAvatar = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const bobHash = await sha256HexBlob(bobAvatar)
    registerLocalObject('aaaa', AVATAR)
    registerLocalObject('bbbb', bobAvatar)

    const boxes = new Map<string, any[]>()
    const fetchMock = mailboxFetch(boxes)
    await broadcastPresence(alice, { displayName: 'Alice', pfpUrl: '/api/objects/aaaa' }, fetchMock)
    await broadcastPresence(bob, { displayName: 'Bob', pfpUrl: '/api/objects/bbbb' }, fetchMock)

    const roster = await fetchPresenceRosterFrom('http://node-a.test:8790', alice.orbitId, fetchMock)
    const bobRow = roster.users.find((u) => u.id === bob.orbitId)!
    expect(bobRow.pfp_url).toBe(`urn:sha256:${bobHash}`)
    // ...and the hash A advertises is its own.
    const envs = boxes.get('http://node-a.test:8790')!
    const aliceBeacon = JSON.parse(decodeURIComponent(escape(atob(envs[0].sealed))))
    expect(aliceBeacon.pfpHash).toBe(aliceHash)
  })

  it('refuses bytes that do not hash to the advertised avatar address', async () => {
    const contentHash = await sha256HexBlob(AVATAR)
    const net = new SwarmTestNetwork()
    const liar = net.createNode('liar')
    const b = net.createNode('reader')
    liar.session.registerLocalObject(contentHash, new Blob(['not the avatar'], { type: 'image/png' }))

    const bytes = await resolveContentAddressedMedia(null, contentHash, {
      timeoutMs: 500,
      deps: {
        readLocal: async (id) => b.durable.get(id) ?? null,
        requestSwarm: (id, t, opts) => b.session.requestObject(id, t, opts.expectedHash),
      },
    })
    expect(bytes).toBeNull()
    expect(b.durable.has(contentHash)).toBe(false)
  })

  it('a peer with no provable avatar hash stays honest (no fabricated picture)', async () => {
    const boxes = new Map<string, any[]>()
    const fetchMock = mailboxFetch(boxes)
    // A provider URL is not a verified keep: no hash is derived, none is sent.
    expect(await broadcastPresence(alice, { displayName: 'Alice', pfpUrl: 'https://cdn.test/a.png' }, fetchMock)).toBe(true)
    const env = boxes.get('http://node-a.test:8790')![0]
    const beacon = JSON.parse(decodeURIComponent(escape(atob(env.sealed))))
    expect(beacon.pfpHash).toBeUndefined()

    const roster = await fetchPresenceRosterFrom('http://node-a.test:8790', bob.orbitId, fetchMock)
    const peer = roster.users.find((u) => u.id === alice.orbitId)!
    // The original ref is kept; the reader's Avatar falls back to geometry if
    // it cannot load, never a fabricated or hotlinked "verified" picture.
    expect(peer.pfp_url).toBe('https://cdn.test/a.png')
  })

  it('a tampered avatar hash breaks the signature and the beacon is dropped', async () => {
    registerLocalObject('cccc', AVATAR)
    const boxes = new Map<string, any[]>()
    const fetchMock = mailboxFetch(boxes)
    await broadcastPresence(alice, { displayName: 'Alice', pfpUrl: '/api/objects/cccc' }, fetchMock)

    const env = boxes.get('http://node-a.test:8790')![0]
    const beacon = JSON.parse(decodeURIComponent(escape(atob(env.sealed))))
    beacon.pfpHash = 'f'.repeat(64)
    const tampered = { ...env, sealed: btoa(JSON.stringify(beacon)) }

    const getFetch = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ envelopes: [tampered] }),
      { status: 200 },
    )) as unknown as typeof globalThis.fetch
    const roster = await fetchPresenceRosterFrom('http://node-a.test:8790', bob.orbitId, getFetch)
    expect(roster.users).toHaveLength(0)
  })
})