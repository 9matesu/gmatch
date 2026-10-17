// POST /api/watchparty: url -> proxy/parse -> stored Object -> in-memory party.
// proxyAndStoreExternal is mocked (unit under test is the route wiring, the
// proxy's own behavior has proxy.test.ts).
import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../proxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../proxy')>()
  return {
    ...actual,
    proxyAndStoreExternal: vi.fn(async (url: string) => {
      if (url.includes('junk')) return null
      return {
        storedUrl: `/api/objects/${url.length}`,
        mimeType: 'video/mp4',
        isVideo: true,
        bytesStored: 1234,
        isProxied: 1 as const,
        proxiedMime: 'video/mp4',
      }
    }),
  }
})

import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { __resetParties, settingsWatch } from '../watchparty'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let id: TestIdentity

function auth(method: string, url: string, body?: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(id, method, url, body) }
}

beforeAll(async () => {
  env = await createMockEnv()
  id = createTestIdentity()
  await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
})

describe('POST /api/watchparty', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/watchparty', { method: 'POST' }, env)
    expect(res.status).toBe(401)
  })

  it('creates a party from a video URL', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/page', name: 'Night' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    expect(json.party.id).toBeTruthy()
    expect(json.party.url.startsWith('/api/objects/')).toBe(true)

    // Audit A4: the stored media row must carry an expiry (ephemeral rooms).
    const objId = json.party.url.replace('/api/objects/', '')
    const row: any = await env.DB.prepare('SELECT expires_at FROM Objects WHERE id = ?').bind(objId).first()
    expect(row.expires_at).toBeTruthy()

    const get = await app.request(`/api/watchparty/${json.party.id}`, { headers: auth('GET', `/api/watchparty/${json.party.id}`) }, env)
    expect(get.status).toBe(200)
    const snap: any = await get.json()
    expect(snap.name).toBe('Night')
    expect(snap.frame.action).toBe('pause')
  })

  it('rejects unparseable URLs with 422', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/junk-page' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as any).error).toContain('playable video')
  })

  it('rejects garbage schemes', async () => {
    const body = JSON.stringify({ url: 'javascript:alert(1)' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
  })

  it('names stored media from the page title or url basename', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/deep/holiday-mix.mp4' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    expect(json.party.name).not.toBe('Party')
    expect(json.party.name.toLowerCase()).toContain('holiday')
  })

  it('audit A5: more than 60 parses per minute is 429', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/v', name: '' })
    let last = 0
    for (let i = 0; i < 61; i++) {
      const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
      last = res.status
      expect([201, 429]).toContain(last)
    }
    expect(last).toBe(429)
  })
})

describe('private-room authorization', () => {
  it('hides private snapshots by ID, then allows invite redeem + snapshot', async () => {
    __resetParties()
    const host = createTestIdentity()
    const guest = createTestIdentity()
    const hostAuth = (method: string, url: string, body?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(host, method, url, body) })
    const guestAuth = (method: string, url: string, body?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(guest, method, url, body) })

    const createBody = JSON.stringify({ url: 'https://example.com/private-video.mp4', name: 'Private' })
    const created = await app.request('/api/watchparty', { method: 'POST', headers: hostAuth('POST', '/api/watchparty', createBody), body: createBody }, env)
    expect(created.status).toBe(201)
    const partyId = ((await created.json()) as any).party.id as string
    expect(settingsWatch(host.orbitId, { party: partyId, isPrivate: true })).not.toBeNull()

    // A stranger cannot mint invites for a room they do not host.
    const mintBody = JSON.stringify({})
    const denied = await app.request(`/api/watchparty/${partyId}/invite`, { method: 'POST', headers: guestAuth('POST', `/api/watchparty/${partyId}/invite`, mintBody), body: mintBody }, env)
    expect(denied.status).toBe(403)

    // Private snapshot is hidden by ID before redeem.
    const hidden = await app.request(`/api/watchparty/${partyId}`, { headers: guestAuth('GET', `/api/watchparty/${partyId}`) }, env)
    expect(hidden.status).toBe(404)

    const minted = await app.request(`/api/watchparty/${partyId}/invite`, { method: 'POST', headers: hostAuth('POST', `/api/watchparty/${partyId}/invite`, mintBody), body: mintBody }, env)
    expect(minted.status).toBe(200)
    const invite = ((await minted.json()) as any).invite as string
    expect(typeof invite).toBe('string')

    const joinBody = JSON.stringify({ invite: 'wrong' })
    const badRedeem = await app.request(`/api/watchparty/${partyId}/join`, { method: 'POST', headers: guestAuth('POST', `/api/watchparty/${partyId}/join`, joinBody), body: joinBody }, env)
    expect(badRedeem.status).toBe(404)

    const goodBody = JSON.stringify({ invite })
    const goodRedeem = await app.request(`/api/watchparty/${partyId}/join`, { method: 'POST', headers: guestAuth('POST', `/api/watchparty/${partyId}/join`, goodBody), body: goodBody }, env)
    expect(goodRedeem.status).toBe(200)

    const snap = await app.request(`/api/watchparty/${partyId}`, { headers: guestAuth('GET', `/api/watchparty/${partyId}`) }, env)
    expect(snap.status).toBe(200)
  })
})

describe('POST /api/watchparty with localEntry', () => {
  const HASH = 'c'.repeat(64)
  let oidSeq = 0
  const nextOid = () => {
    oidSeq += 1
    return `11111111-2222-3333-4444-55555555555${oidSeq}`
  }

  async function seedObject(oid: string, ownerId: string, isPublic = 0) {
    await env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, content_hash, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(oid, ownerId, 1234, 'video/mp4', `urn:sha256:${HASH}`, HASH, isPublic).run()
  }

  it('creates a room from a verified local entry', async () => {
    __resetParties()
    const host = createTestIdentity()
    const oid = nextOid()
    await seedObject(oid, host.orbitId)
    const hostAuth = (method: string, url: string, body?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(host, method, url, body) })
    const body = JSON.stringify({ localEntry: { objectId: oid, name: 'clip.mp4', hash: HASH, size: 1234 }, name: 'Movie night' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: hostAuth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    expect(json.party.queue[0].hash).toBe(HASH)
    expect(json.party.queue[0].local).toBe(true)
  })

  it('rejects bad references, mismatched hashes, and missing rows', async () => {
    __resetParties()
    const host = createTestIdentity()
    const hostAuth = (method: string, url: string, body?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(host, method, url, body) })
    const post = async (entry: unknown) => {
      const body = JSON.stringify({ localEntry: entry })
      const res = await app.request('/api/watchparty', { method: 'POST', headers: hostAuth('POST', '/api/watchparty', body), body }, env)
      return res.status
    }
    const oid = nextOid()
    await seedObject(oid, host.orbitId)
    expect(await post({ objectId: 'nope', name: 'x', hash: HASH, size: 1 })).toBe(422)
    expect(await post({ objectId: oid, name: 'x', hash: 'd'.repeat(64), size: 1 })).toBe(422) // hash mismatch
    expect(await post({ objectId: nextOid(), name: 'x', hash: HASH, size: 1 })).toBe(422) // no row seeded
  })

  it('refuses strangers for private rows but allows recipients', async () => {
    __resetParties()
    const host = createTestIdentity()
    const guest = createTestIdentity()
    const oid = nextOid()
    await seedObject(oid, host.orbitId)
    await env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(oid, guest.orbitId).run()
    const guestAuth = (method: string, url: string, body?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(guest, method, url, body) })
    const body = JSON.stringify({ localEntry: { objectId: oid, name: 'clip.mp4', hash: HASH, size: 1234 } })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: guestAuth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)

    const stranger = createTestIdentity()
    const strangerAuth = (method: string, url: string, b?: string) => ({ 'Content-Type': 'application/json', ...signRequestHeaders(stranger, method, url, b) })
    const denied = await app.request('/api/watchparty', { method: 'POST', headers: strangerAuth('POST', '/api/watchparty', body), body }, env)
    expect(denied.status).toBe(403)
  })
})
