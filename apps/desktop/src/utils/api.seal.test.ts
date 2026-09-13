// T2 client-side: orbitFetch seals non-GET string-body mutations to the node
// pubkey served by GET /api/identity, and transparently falls back to the
// legacy signed-plaintext path when the node offers no key.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { orbitFetch, _resetNodeKeyCache } from './api'

const client = generateIdentity()

function identityLike() {
  return {
    orbitId: client.orbitId,
    publicKeyHex: client.publicKeyHex,
    privateKeyHex: client.privateKeyHex,
    encryptionPubHex: client.encryptionPubHex,
    encryptionPrivHex: client.encryptionPrivHex,
  }
}

function fetchCalls(fn: unknown): Array<[string, RequestInit?]> {
  return (fn as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls
}

beforeEach(() => {
  _resetNodeKeyCache()
})

describe('orbitFetch request sealing', () => {
  it('POST travels as X-Orbit-Sealed ciphertext when the node advertises a pubkey', async () => {
    const node = generateIdentity()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/api/identity')) {
        return new Response(JSON.stringify({ server_pubkey: node.encryptionPubHex, sealed_available: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const res = await orbitFetch('/api/posts', { method: 'POST', body: JSON.stringify({ caption: 'super-seekrit-text' }) }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)

    const post = calls.find((c) => c.url.includes('/api/posts'))!
    const headers = new Headers(post.init!.headers as HeadersInit)
    expect(headers.get('X-Orbit-Sealed')).toBeTruthy()
    // signed headers are NOT exposed in the clear anymore...
    expect(headers.get('X-Orbit-Signature')).toBeNull()
    // ...and the body carries no plaintext (outer body is a placeholder; the
    // server rebuilds the request from the sealed envelope).
    expect(String(post.init!.body)).not.toContain('super-seekrit-text')
    const seal = headers.get('X-Orbit-Sealed')!
    expect(seal.length).toBeGreaterThan(100)
  })

  it('GET seals identity headers (wave 2 B2): no X-Orbit-* in the clear', async () => {
    const node = generateIdentity()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/identity')) {
        return new Response(JSON.stringify({ server_pubkey: node.encryptionPubHex, sealed_available: true }), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const res = await orbitFetch('/api/users', { method: 'GET' }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)
    const getCall = fetchCalls(fetchImpl).find(([u]) => String(u).includes('/api/users'))!
    const headers = new Headers(getCall[1]!.headers as HeadersInit)
    expect(headers.get('X-Orbit-Sealed')).toBeTruthy()
    expect(headers.get('X-Orbit-Id')).toBeNull()
    expect(headers.get('X-Orbit-Signature')).toBeNull()
  })

  it('node without a pubkey => legacy signed path, no seal header', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/identity')) {
        return new Response(JSON.stringify({ server_pubkey: null, sealed_available: false }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const res = await orbitFetch('/api/posts', { method: 'POST', body: JSON.stringify({ caption: 'plain' }) }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)
    const postCall = fetchCalls(fetchImpl).find(([u]) => String(u).includes('/api/posts'))!
    const headers = new Headers(postCall[1]!.headers as HeadersInit)
    expect(headers.get('X-Orbit-Sealed')).toBeNull()
    expect(headers.get('X-Orbit-Signature')).toBeTruthy()
  })

  it('identity fetch failure is swallowed and the request still goes out signed', async () => {
    let n = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/identity')) {
        n++
        throw new Error('offline')
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const res = await orbitFetch('/api/posts', { method: 'POST', body: '{}' }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)
    expect(n).toBe(1)
  })

  it('seals a CROSS-ORIGIN request to the TARGET node key, not the local node', async () => {
    const centralKey = generateIdentity()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url) === 'https://central.test/api/identity') {
        return new Response(JSON.stringify({ server_pubkey: centralKey.encryptionPubHex, sealed_available: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const res = await orbitFetch('https://central.test/api/servers', { method: 'POST', body: JSON.stringify({ name: 'X' }) }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)
    // the identity probe used for sealing must target central.test, not the local API_BASE
    expect(calls.some((c) => c.url === 'https://central.test/api/identity')).toBe(true)
    const post = calls.find((c) => c.url === 'https://central.test/api/servers')!
    const headers = new Headers(post.init!.headers as HeadersInit)
    expect(headers.get('X-Orbit-Sealed')).toBeTruthy()
  })

  it('large JSON bodies (> 4KB) skip sealing and go out signed in plaintext', async () => {
    // the edge rejects oversized headers (403/431) — profile pictures hit
    // this at ~5KB of data: URL. Plaintext-signed is the working path.
    const node = generateIdentity()
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/identity')) {
        return new Response(JSON.stringify({ server_pubkey: node.encryptionPubHex, sealed_available: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const big = JSON.stringify({ pfp_url: 'data:image/jpeg;base64,' + 'A'.repeat(9000) })
    const res = await orbitFetch('/api/users/profile', { method: 'PATCH', body: big }, identityLike(), fetchImpl)
    expect(res.status).toBe(200)
    const calls = fetchCalls(fetchImpl)
    const patch = calls.find(([u]) => String(u).includes('/api/users/profile'))!
    const headers = new Headers(patch[1]!.headers as HeadersInit)
    expect(headers.get('X-Orbit-Sealed')).toBeNull()
    expect(headers.get('X-Orbit-Signature')).toBeTruthy()
    expect(String(patch[1]!.body)).toBe(big)
  })

})
