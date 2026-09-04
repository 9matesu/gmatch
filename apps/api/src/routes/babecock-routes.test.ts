// Coverage for src/routes/babecock.ts: public entry content serving, round
// start/join via multipart uploads, host entry add, reorder validation,
// invites, decline, and the advance tick.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { startRound, advanceBabecock } from '../babecock'
import { BABECOCK_ROUND_SECONDS } from '@orbit/shared'

const host = createTestIdentity()
const joiner = createTestIdentity()
const stranger = createTestIdentity()

let env: Awaited<ReturnType<typeof createMockEnv>>

function authHeaders(who: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(who, method, url, body)
}

const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3, 4, 5])
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9, 9])
const WEBM = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 1, 2, 3, 4, 5, 6, 7, 8])
const GARBAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])

function imageForm(files: Array<{ bytes: Uint8Array; type: string; name: string }>, extra?: Record<string, string>) {
  const form = new FormData()
  for (const f of files) {
    form.append('image', new Blob([f.bytes as unknown as BlobPart], { type: f.type }), f.name)
  }
  for (const [k, v] of Object.entries(extra || {})) form.append(k, v)
  return form
}

beforeAll(async () => {
  env = await createMockEnv()
  for (const id of [host, joiner, stranger]) {
    await app.request('/api/economy/balance', { headers: authHeaders(id, 'GET', '/api/economy/balance') }, env)
  }
})

beforeEach(async () => {
  await env._client.execute('DELETE FROM BabecockEntries').catch(() => {})
  await env._client.execute('DELETE FROM BabecockRounds').catch(() => {})
  await env._client.execute('DELETE FROM BabecockInvites').catch(() => {})
})

describe('GET /api/babecock/entries/:id/content (public)', () => {
  it('serves a stored babecock blob with detected mime', async () => {
    await env.BUCKET!.put('babecock/entry-abc', JPEG as unknown as Uint8Array, { httpMetadata: { contentType: 'image/jpeg' } })
    const res = await app.request('/api/babecock/entries/entry-abc/content', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf[0]).toBe(0xFF)
  })

  it('falls back to objects/ then lobby/ prefixes', async () => {
    await env.BUCKET!.put('objects/entry-def', PNG as unknown as Uint8Array, { httpMetadata: { contentType: 'image/png' } })
    const res = await app.request('/api/babecock/entries/entry-def/content', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')

    await env.BUCKET!.put('lobby/entry-ghi', JPEG as unknown as Uint8Array, { httpMetadata: { contentType: 'image/jpeg' } })
    const res2 = await app.request('/api/babecock/entries/entry-ghi/content', {}, env)
    expect(res2.status).toBe(200)
  })

  it('404s for an unknown entry', async () => {
    const res = await app.request('/api/babecock/entries/does-not-exist/content', {}, env)
    expect(res.status).toBe(404)
  })

  it('503s when no bucket is configured', async () => {
    const res = await app.request('/api/babecock/entries/x/content', {}, { DB: env.DB } as any)
    expect(res.status).toBe(503)
  })
})

describe('POST /api/babecock/start', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/babecock/start', { method: 'POST', body: imageForm([]) }, env)
    expect(res.status).toBe(401)
  })

  it('starts a round from a multipart image upload', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' }]) },
      env,
    )
    expect(res.status).toBe(201)
    const json = await res.json() as any
    expect(json.round.status).toBe('open')
    expect(json.round.entries).toHaveLength(1)
    expect(json.round.entries[0].content_url).toMatch(/^\/api\/babecock\/entries\/.+\/content$/)
  })

  it('400s when no image is provided', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([]) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('at least one image')
  })

  it('400s on an empty file', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: new Uint8Array([]), type: 'image/jpeg', name: 'e.jpg' }]) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Uploaded file is empty')
  })

  it('400s on invalid magic bytes', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: GARBAGE, type: 'image/jpeg', name: 'g.jpg' }]) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('magic bytes')
  })

  it('400s on a video upload', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: WEBM, type: 'video/webm', name: 'v.webm' }]) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Babecock accepts images only')
  })

  it('400s when a JSON body is sent instead of multipart form data', async () => {
    const body = JSON.stringify({})
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: { ...authHeaders(host, 'POST', '/api/babecock/start', body), 'Content-Type': 'application/json' }, body },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Failed to parse upload form data')
  })

  it('rejects a private-IP url field with the proxy failure message', async () => {
    const form = imageForm([], { url: 'http://127.0.0.1:9/x.png' })
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: form },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Could not fetch that link')
  })

  it('409s while another round is open', async () => {
    await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' }]) },
      env,
    )
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(joiner, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: PNG, type: 'image/png', name: 'b.png' }]) },
      env,
    )
    expect(res.status).toBe(409)
  })
})

describe('round lifecycle via routes', () => {
  let roundId: string

  beforeEach(async () => {
    const round = await startRound(env.DB, host.orbitId, 'data:image/jpeg;base64,x', 'image/jpeg')
    roundId = round.id
  })

  it('GET /current returns the open round for a viewer', async () => {
    const res = await app.request('/api/babecock/current', { headers: authHeaders(joiner, 'GET', '/api/babecock/current') }, env)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.round.id).toBe(roundId)
    expect(json.round.entries).toHaveLength(1)
  })

  it('GET /gallery lists closed rounds after the deadline', async () => {
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * 1000)
    const res = await app.request('/api/babecock/gallery', { headers: authHeaders(joiner, 'GET', '/api/babecock/gallery') }, env)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.rounds.some((r: any) => r.id === roundId)).toBe(true)
  })

  it('POST /round/:id/entries lets the host add images', async () => {
    const res = await app.request(
      `/api/babecock/round/${roundId}/entries`,
      { method: 'POST', headers: authHeaders(host, 'POST', `/api/babecock/round/${roundId}/entries`), body: imageForm([{ bytes: PNG, type: 'image/png', name: 'p.png' }]) },
      env,
    )
    expect(res.status).toBe(201)
    expect((await res.json()).round.entries).toHaveLength(2)
  })

  it('POST /round/:id/entries 404s for an unknown round', async () => {
    const res = await app.request(
      '/api/babecock/round/no-such-round/entries',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/round/no-such-round/entries'), body: imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' }]) },
      env,
    )
    expect(res.status).toBe(404)
  })

  it('POST /:id/join adds a joiner entry and marks their invite accepted', async () => {
    const inviteRes = await app.request(
      `/api/babecock/${roundId}/invite`,
      {
        method: 'POST',
        headers: { ...authHeaders(host, 'POST', `/api/babecock/${roundId}/invite`, JSON.stringify({ invitee_id: joiner.orbitId })), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitee_id: joiner.orbitId }),
      },
      env,
    )
    expect(inviteRes.status).toBe(201)
    const { invite } = await inviteRes.json() as any
    expect(invite.status).toBe('open')

    const joinRes = await app.request(
      `/api/babecock/${roundId}/join`,
      { method: 'POST', headers: authHeaders(joiner, 'POST', `/api/babecock/${roundId}/join`), body: imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'j.jpg' }]) },
      env,
    )
    expect(joinRes.status).toBe(200)
    expect((await joinRes.json()).round.entries).toHaveLength(2)

    const mine = await app.request('/api/babecock/invites', { headers: authHeaders(joiner, 'GET', '/api/babecock/invites') }, env)
    const mineJson = await mine.json() as any
    expect(mineJson.invites.find((i: any) => i.id === invite.id).status).toBe('accepted')
  })

  it('POST /:id/join rejects multiple images and empty uploads', async () => {
    const multi = await app.request(
      `/api/babecock/${roundId}/join`,
      {
        method: 'POST',
        headers: authHeaders(joiner, 'POST', `/api/babecock/${roundId}/join`),
        body: imageForm([
          { bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' },
          { bytes: JPEG, type: 'image/jpeg', name: 'b.jpg' },
        ]),
      },
      env,
    )
    expect(multi.status).toBe(400)
    expect((await multi.json()).error).toContain('one image per round')

    const empty = await app.request(
      `/api/babecock/${roundId}/join`,
      { method: 'POST', headers: authHeaders(stranger, 'POST', `/api/babecock/${roundId}/join`), body: imageForm([]) },
      env,
    )
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toBe('Provide an image to join')
  })

  it('POST /:id/invite validates input and host ownership', async () => {
    const noId = await app.request(
      `/api/babecock/${roundId}/invite`,
      {
        method: 'POST',
        headers: { ...authHeaders(host, 'POST', `/api/babecock/${roundId}/invite`, '{}'), 'Content-Type': 'application/json' },
        body: '{}',
      },
      env,
    )
    expect(noId.status).toBe(400)
    expect((await noId.json()).error).toBe('invitee_id is required')

    const notHost = await app.request(
      `/api/babecock/${roundId}/invite`,
      {
        method: 'POST',
        headers: { ...authHeaders(stranger, 'POST', `/api/babecock/${roundId}/invite`, JSON.stringify({ invitee_id: joiner.orbitId })), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitee_id: joiner.orbitId }),
      },
      env,
    )
    expect(notHost.status).toBe(403)
  })

  it('POST /invites/:id/decline declines and 404s for unknown invites', async () => {
    const inviteRes = await app.request(
      `/api/babecock/${roundId}/invite`,
      {
        method: 'POST',
        headers: { ...authHeaders(host, 'POST', `/api/babecock/${roundId}/invite`, JSON.stringify({ invitee_id: joiner.orbitId })), 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitee_id: joiner.orbitId }),
      },
      env,
    )
    const { invite } = await inviteRes.json() as any

    const decline = await app.request(
      `/api/babecock/invites/${invite.id}/decline`,
      { method: 'POST', headers: authHeaders(joiner, 'POST', `/api/babecock/invites/${invite.id}/decline`) },
      env,
    )
    expect(decline.status).toBe(200)
    expect((await decline.json()).ok).toBe(true)

    const missing = await app.request(
      '/api/babecock/invites/no-such-invite/decline',
      { method: 'POST', headers: authHeaders(joiner, 'POST', '/api/babecock/invites/no-such-invite/decline') },
      env,
    )
    expect(missing.status).toBe(404)
  })
})

describe('POST /api/babecock/round/:id/reorder', () => {
  let roundId: string
  let entryIds: string[]

  beforeEach(async () => {
    const round = await startRound(env.DB, host.orbitId, [
      { contentUrl: 'data:image/jpeg;base64,a', mimeType: 'image/jpeg' },
      { contentUrl: 'data:image/jpeg;base64,b', mimeType: 'image/jpeg' },
    ])
    roundId = round.id
    entryIds = round.entries.map((e) => e.id)
  })

  async function reorder(body: unknown, who = host) {
    const text = JSON.stringify(body)
    return app.request(
      `/api/babecock/round/${roundId}/reorder`,
      {
        method: 'POST',
        headers: { ...authHeaders(who, 'POST', `/api/babecock/round/${roundId}/reorder`, text), 'Content-Type': 'application/json' },
        body: text,
      },
      env,
    )
  }

  it('403s for a non-host and unknown round', async () => {
    expect((await reorder({ placements: [] }, stranger)).status).toBe(403)
    const text = JSON.stringify({ placements: [] })
    const unknown = await app.request(
      '/api/babecock/round/no-such/reorder',
      { method: 'POST', headers: { ...authHeaders(host, 'POST', '/api/babecock/round/no-such/reorder', text), 'Content-Type': 'application/json' }, body: text },
      env,
    )
    expect(unknown.status).toBe(403)
  })

  it('400s when placements do not cover every entry exactly once', async () => {
    const partial = await reorder({ placements: [{ entry_id: entryIds[0], grid_position: 0 }] })
    expect(partial.status).toBe(400)

    const dup = await reorder({
      placements: [
        { entry_id: entryIds[0], grid_position: 0 },
        { entry_id: entryIds[0], grid_position: 1 },
      ],
    })
    expect(dup.status).toBe(400)

    const dupPos = await reorder({
      placements: [
        { entry_id: entryIds[0], grid_position: 0 },
        { entry_id: entryIds[1], grid_position: 0 },
      ],
    })
    expect(dupPos.status).toBe(400)
  })

  it('applies valid placements and grows the grid for high positions', async () => {
    const res = await reorder({
      placements: [
        { entry_id: entryIds[1], grid_position: 9 },
        { entry_id: entryIds[0], grid_position: 0 },
      ],
      grid_size: 4,
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.ok).toBe(true)
    expect(json.grid_size).toBe(4)

    const current = await app.request('/api/babecock/current', { headers: authHeaders(host, 'GET', '/api/babecock/current') }, env)
    const round = (await current.json() as any).round
    expect(round.entries.find((e: any) => e.id === entryIds[1]).grid_position).toBe(9)
  })

  it('409s once the round is closed', async () => {
    await advanceBabecock(env.DB, Date.now() + (BABECOCK_ROUND_SECONDS + 1) * 1000)
    const res = await reorder({
      placements: [
        { entry_id: entryIds[0], grid_position: 0 },
        { entry_id: entryIds[1], grid_position: 1 },
      ],
    })
    expect(res.status).toBe(409)
  })
})
