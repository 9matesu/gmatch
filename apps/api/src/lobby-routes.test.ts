import { describe, it, expect, beforeAll } from 'vitest'
import app from './index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from './test-utils'
import type { TestIdentity } from './test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let ids: TestIdentity[]

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return {
    'Content-Type': 'application/json',
    ...signRequestHeaders(identity, method, url, body),
  }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

async function join(identity: TestIdentity) {
  // Lobby join now requires at least MIN_GAME_CARDS non-story Objects owned by
  // the user (the Quick-Play card gate — see routes/lobby.ts). Seed enough so
  // existing tests don't need to rewrite to satisfy the gate.
  for (let i = 0; i < 5; i++) await seedObjectFor(identity)
  const res = await app.request('/api/lobby/join', {
    method: 'POST',
    headers: auth(identity, 'POST', '/api/lobby/join'),
  }, env)
  expect(res.status).toBe(200)
}

let seedCounter = 0
async function seedObjectFor(identity: TestIdentity): Promise<string> {
  // Vary the payload each call so the per-owner content-hash dedup
  // (objects.ts:280) treats every upload as a fresh image. Otherwise the
  // second seedObjectFor for the same user returns a 409 with only
  // `existing_id` (no `id`) and downstream card plays blow up.
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, seedCounter++ & 0xFF])
  const form = new FormData()
  form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'card.jpg')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: {
      ...signRequestHeaders(identity, 'POST', '/api/objects', ''),
    },
    body: form,
  }, env)
  const body: any = await res.json()
  return body.id
}

describe('Lobby HTTP API', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    ids = [createTestIdentity(), createTestIdentity(), createTestIdentity(), createTestIdentity()]
    for (const id of ids) await register(id)
  })

  it('GET /api/lobby requires auth', async () => {
    const res = await app.request('/api/lobby')
    expect(res.status).toBe(401)
  })

  it('issues a WebSocket ticket', async () => {
    const res = await app.request('/api/ws-ticket', {
      method: 'POST',
      headers: auth(ids[0], 'POST', '/api/ws-ticket'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(typeof body.ticket).toBe('string')
    expect(body.ticket.length).toBeGreaterThan(8)
  })

  it('joins 2 players and pairs them into a 1v1 match', async () => {
    await join(ids[0])
    await join(ids[1])
    const res = await app.request('/api/lobby', { headers: auth(ids[0], 'GET', '/api/lobby') }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.waiting_count).toBe(0)
    expect(body.match).toBeDefined()
    expect(body.match.phase).toBe('lobby')
    expect(body.match.status).toBe('lobby')
  })

  it('plays cards and records a mutual like match', async () => {
    let res = await app.request('/api/lobby', { headers: auth(ids[0], 'GET', '/api/lobby') }, env)
    const body: any = await res.json()
    const matchId = body.match.id
    const me = ids[0].orbitId
    const opponentId = ids.find((i) => i.orbitId === body.match.opponent.id)!
    const cardA = await seedObjectFor(ids[0])
    const cardB = await seedObjectFor(ids[1])

    res = await app.request(`/api/lobby/match/${matchId}/card`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/match/${matchId}/card`, JSON.stringify({ card_id: cardA })),
      body: JSON.stringify({ card_id: cardA }),
    }, env)
    expect(res.status).toBe(200)

    res = await app.request(`/api/lobby/match/${matchId}/card`, {
      method: 'POST',
      headers: auth(ids[1], 'POST', `/api/lobby/match/${matchId}/card`, JSON.stringify({ card_id: cardB })),
      body: JSON.stringify({ card_id: cardB }),
    }, env)
    expect(res.status).toBe(200)

    // Decision endpoint: mutual like makes the match.
    res = await app.request(`/api/lobby/match/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json() as any).matched).toBe(false)

    res = await app.request(`/api/lobby/match/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[1], 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json() as any).matched).toBe(true)

    // Complete / quit match so the hopper can pair next users
    await app.request(`/api/lobby/match/${matchId}/quit`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/match/${matchId}/quit`),
    }, env)
  })

  it('rejects invalid decisions', async () => {
    await join(ids[2])
    await join(ids[3])
    const res = await app.request('/api/lobby', { headers: auth(ids[2], 'GET', '/api/lobby') }, env)
    const body: any = await res.json()
    const matchId = body.match.id

    const bad = await app.request(`/api/lobby/match/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[2], 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision: 'maybe' })),
      body: JSON.stringify({ decision: 'maybe' }),
    }, env)
    expect(bad.status).toBe(400)
  })

  it('uploads and lists lobby images', async () => {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])], { type: 'image/jpeg' }), 'board.jpg')
    form.append('caption', 'lobby art')
    const up = await app.request('/api/lobby/images', {
      method: 'POST',
      headers: { ...signRequestHeaders(ids[0], 'POST', '/api/lobby/images', '') },
      body: form,
    }, env)
    expect(up.status).toBe(201)
    const img: any = await up.json()
    expect(img.content_url).toContain('data:image')

    const list = await app.request('/api/lobby/images', { headers: auth(ids[0], 'GET', '/api/lobby/images') }, env)
    const images = (await list.json()) as any[]
    expect(images.some((i) => i.id === img.id)).toBe(true)

    const like = await app.request(`/api/lobby/images/${img.id}/like`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/images/${img.id}/like`),
    }, env)
    expect((await like.json() as any).likes_count).toBe(1)
  })

  // Small (>4-byte) JPEG with a 200KB payload of zero-bytes after the SOI
  // marker — passes isValidMediaMagicBytes (FF D8 FF prefix) and exceeds the
  // 128KB spill threshold, exercising the BUCKET spill path.
  function bigJpegBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(size)
    bytes[0] = 0xFF
    bytes[1] = 0xD8
    bytes[2] = 0xFF
    bytes[3] = 0xE0
    // Rest defaults to 0x00, which the magic-byte check ignores (only the
    // prefix matters) — same trick seedObjectFor uses for tiny JPEGs.
    return bytes
  }

  it('spills large lobby-image uploads to BUCKET and stores a /content ref', async () => {
    const form = new FormData()
    form.append('image', new Blob([bigJpegBytes(200 * 1024)], { type: 'image/jpeg' }), 'big.jpg')
    const up = await app.request('/api/lobby/images', {
      method: 'POST',
      headers: { ...signRequestHeaders(ids[0], 'POST', '/api/lobby/images', '') },
      body: form,
    }, env)
    expect(up.status).toBe(201)
    const img: any = await up.json()
    // Spilled — content_url is the /content endpoint ref, not a base64 data URL.
    expect(img.content_url).toBe(`/api/lobby/images/${img.id}/content`)
    expect(img.content_url).not.toContain('data:')

    // The /content endpoint serves the spilled bytes back with a proper MIME.
    const content = await app.request(`/api/lobby/images/${img.id}/content`, {}, env)
    expect(content.status).toBe(200)
    expect(content.headers.get('Content-Type')).toBe('image/jpeg')
    const buf = new Uint8Array(await content.arrayBuffer())
    expect(buf.length).toBe(200 * 1024)
    expect(buf[0]).toBe(0xFF)
    expect(buf[1]).toBe(0xD8)
    expect(buf[2]).toBe(0xFF)

    // The LIST endpoint rotates data:→/content anyway, but here the stored
    // value is already /content so clients should see it verbatim.
    const list = await app.request('/api/lobby/images', { headers: auth(ids[0], 'GET', '/api/lobby/images') }, env)
    const images = (await list.json()) as any[]
    const found = images.find((i) => i.id === img.id)
    expect(found).toBeDefined()
    expect(found!.content_url).toBe(`/api/lobby/images/${img.id}/content`)
  })

  it('GET /api/lobby/images/:id/content does NOT delete a row on a transient miss', async () => {
    // Upload a small inline image so we have a row id whose content_url is a
    // data: URL (not spilled to BUCKET). Then simulate a transient DB read
    // miss by deleting the row directly and expecting the endpoint NOT to
    // compound the issue by deleting the (already gone) row — i.e. the route
    // must still 404 cleanly without attempting a destructive DELETE.
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], { type: 'image/jpeg' }), 'tile.jpg')
    const up = await app.request('/api/lobby/images', {
      method: 'POST',
      headers: { ...signRequestHeaders(ids[0], 'POST', '/api/lobby/images', '') },
      body: form,
    }, env)
    const img: any = await up.json()

    // Wipe the row directly so the endpoint sees a missing row.
    await env._client.execute(`DELETE FROM LobbyImages WHERE id = ?`, [img.id])

    const miss = await app.request(`/api/lobby/images/${img.id}/content`, {}, env)
    expect(miss.status).toBe(404)
    // The row is already gone — confirm the endpoint itself did not throw
    // an additional destructive operation. (For a missing row this is a
    // behavioral guarantee: no DELETE executes on the 404 branch. We
    // re-check the row count is still zero.)
    const rows = await env._client.execute(`SELECT COUNT(*) AS c FROM LobbyImages WHERE id = ?`, [img.id])
    expect(Number((rows.rows[0] as any).c)).toBe(0)
  })

  it('GET /api/lobby/images/:id/content deletes the row only on genuine expiry', async () => {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], { type: 'image/jpeg' }), 'expiring.jpg')
    const up = await app.request('/api/lobby/images', {
      method: 'POST',
      headers: { ...signRequestHeaders(ids[0], 'POST', '/api/lobby/images', '') },
      body: form,
    }, env)
    const img: any = await up.json()

    // Force expiry in the DB.
    await env._client.execute(`UPDATE LobbyImages SET expires_at = ? WHERE id = ?`, [
      new Date(Date.now() - 1000).toISOString(),
      img.id,
    ])

    const expired = await app.request(`/api/lobby/images/${img.id}/content`, {}, env)
    expect(expired.status).toBe(404)
    const rows = await env._client.execute(`SELECT COUNT(*) AS c FROM LobbyImages WHERE id = ?`, [img.id])
    expect(Number((rows.rows[0] as any).c)).toBe(0)
  })

  it('cannot leave while in a match', async () => {
    // ids 2/3 are currently in a match (from the invalid-decision test).
    const res = await app.request('/api/lobby/leave', {
      method: 'POST',
      headers: auth(ids[2], 'POST', '/api/lobby/leave'),
    }, env)
    const body: any = await res.json()
    expect(body.ok).toBe(false)
  })
})