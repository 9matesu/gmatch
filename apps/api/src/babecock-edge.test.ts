// Edge coverage for src/babecock.ts core + src/routes/babecock.ts branches
// not reachable from the happy-path suites: empty image lists, deadline
// expiry at the data layer, invite state machine (accepted/declined/expired),
// purge with blob deletion, and route-level guards (no-bucket fallback,
// oversized image lists, join error mapping).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from './index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from './test-utils'
import {
  startRound,
  addHostEntries,
  joinRound,
  advanceBabecock,
  purgeExpiredBabecock,
  inviteToRound,
  declineInvite,
  getCurrentRound,
} from './babecock'
import { BABECOCK_ROUND_SECONDS } from '@orbit/shared'
import type { D1Turso } from './db'

let env: Awaited<ReturnType<typeof createMockEnv>>
let db: D1Turso

const host = createTestIdentity()
const guest = createTestIdentity()

function authHeaders(who: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(who, method, url, body)
}

function uid(i: number): string {
  return `bce-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)`,
    [userId, `pk-${userId}`, name, new Date().toISOString()],
  )
}

const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3])

beforeAll(async () => {
  env = await createMockEnv()
  db = env.DB
  for (const id of [host, guest]) {
    await app.request('/api/economy/balance', { headers: authHeaders(id, 'GET', '/api/economy/balance') }, env)
  }
})

beforeEach(async () => {
  await env._client.execute('DELETE FROM BabecockEntries').catch(() => {})
  await env._client.execute('DELETE FROM BabecockRounds').catch(() => {})
  await env._client.execute('DELETE FROM BabecockInvites').catch(() => {})
})

describe('babecock core guards', () => {
  it('startRound rejects an empty image array', async () => {
    const h = uid(1)
    await seedUser(h, 'H')
    await expect(startRound(db, h, [])).rejects.toMatchObject({ status: 400 })
  })

  it('addHostEntries validates images, round state, host, and deadline', async () => {
    const h = uid(2)
    const other = uid(3)
    await seedUser(h, 'H')
    await seedUser(other, 'O')
    const round = await startRound(db, h, 'data:image/jpeg;base64,x', 'image/jpeg')

    await expect(addHostEntries(db, round.id, h, [])).rejects.toMatchObject({ status: 400 })
    await expect(
      addHostEntries(db, 'missing-round-1', h, [{ contentUrl: 'data:image/jpeg;base64,y', mimeType: 'image/jpeg' }]),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      addHostEntries(db, round.id, other, [{ contentUrl: 'data:image/jpeg;base64,y', mimeType: 'image/jpeg' }]),
    ).rejects.toMatchObject({ status: 403 })

    // Expire the deadline in-place (round stays 'open' in the DB).
    await env._client.execute('UPDATE BabecockRounds SET phase_deadline = ? WHERE id = ?', [Date.now() - 1000, round.id])
    await expect(
      addHostEntries(db, round.id, h, [{ contentUrl: 'data:image/jpeg;base64,y', mimeType: 'image/jpeg' }]),
    ).rejects.toMatchObject({ status: 409, message: 'This Babecock round already finished' })
  })

  it('joinRound rejects a past-deadline open round', async () => {
    const h = uid(4)
    const j = uid(5)
    await seedUser(h, 'H')
    await seedUser(j, 'J')
    const round = await startRound(db, h, 'data:image/jpeg;base64,x', 'image/jpeg')
    await env._client.execute('UPDATE BabecockRounds SET phase_deadline = ? WHERE id = ?', [Date.now() - 1, round.id])
    await expect(joinRound(db, round.id, j, 'data:image/jpeg;base64,y', 'image/jpeg')).rejects.toMatchObject({
      status: 409,
      message: 'This Babecock round already finished',
    })
  })

  it('invite state machine: accepted rejects, declined/expired revive', async () => {
    const h = uid(6)
    const a = uid(7)
    const b = uid(8)
    await seedUser(h, 'H')
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    const round = await startRound(db, h, 'data:image/jpeg;base64,x', 'image/jpeg')

    // accepted -> re-invite 409s
    const invA = await inviteToRound(db, round.id, h, a)
    await joinRound(db, round.id, a, 'data:image/jpeg;base64,j', 'image/jpeg')
    await expect(inviteToRound(db, round.id, h, a)).rejects.toMatchObject({ status: 409, message: 'That player already accepted' })

    // declined -> re-invite revives the same row
    const invB = await inviteToRound(db, round.id, h, b)
    await declineInvite(db, invB.id, b)
    const revived = await inviteToRound(db, round.id, h, b)
    expect(revived.id).toBe(invB.id)
    expect(revived.status).toBe('open')

    // Second decline hits the non-open early return (no throw, no change).
    await declineInvite(db, invB.id, b)
    const still = await db.prepare('SELECT status FROM BabecockInvites WHERE id = ?').bind(invB.id).first<{ status: string }>()
    expect(still?.status).toBe('declined')
  })

  it('declineInvite 404s for unknown invites', async () => {
    await expect(declineInvite(db, 'ghost-invite-1', uid(9))).rejects.toMatchObject({ status: 404 })
  })

  it('getCurrentRound without a viewer skips my_entry lookup', async () => {
    const h = uid(10)
    await seedUser(h, 'H')
    const round = await startRound(db, h, 'data:image/jpeg;base64,x', 'image/jpeg')
    const current = await getCurrentRound(db)
    expect(current?.id).toBe(round.id)
    expect(current?.my_entry).toBeNull()
  })

  it('purgeExpiredBabecock deletes blobs for lapsed gallery rounds', async () => {
    const h = uid(11)
    await seedUser(h, 'H')
    // Store a real blob keyed like a babecock entry, then wire the entry URL
    // to it so the purge path hits bucket.delete().
    const blobId = 'purge-blob-01'
    await env.BUCKET!.put(`babecock/${blobId}`, JPEG as unknown as Uint8Array, { httpMetadata: { contentType: 'image/jpeg' } })
    const roundId = `purge-round-${Math.random().toString(36).slice(2, 8)}`
    await env._client.execute(
      `INSERT INTO BabecockRounds (id, host_id, status, phase_deadline, gallery_expires_at) VALUES (?, ?, 'closed', ?, datetime('now', '-2 hours'))`,
      [roundId, h, Date.now() - 7_200_000],
    )
    await env._client.execute(
      `INSERT INTO BabecockEntries (id, round_id, user_id, content_url, mime_type) VALUES (?, ?, ?, ?, 'image/jpeg')`,
      ['pe-1', roundId, h, `/api/babecock/entries/${blobId}/content`],
    )

    await purgeExpiredBabecock(db, env.BUCKET!)

    const round = await env._client.execute('SELECT id FROM BabecockRounds WHERE id = ?', [roundId])
    expect(round.rows.length).toBe(0)
    const missing = await env.BUCKET!.get(`babecock/${blobId}`)
    expect(missing).toBeNull()
  })
})

describe('babecock route guards', () => {
  function imageForm(files: Array<{ bytes: Uint8Array; type: string; name: string }>) {
    const form = new FormData()
    for (const f of files) form.append('image', new Blob([f.bytes as unknown as BlobPart], { type: f.type }), f.name)
    return form
  }

  it('falls back to data: URLs when no bucket is configured', async () => {
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' }]) },
      { DB: env.DB } as any,
    )
    expect(res.status).toBe(201)
    const json = await res.json() as any
    expect(json.round.entries[0].content_url).toMatch(/^data:image\/jpeg;base64,/)
    // Clean up the round created against the shared DB.
    await env._client.execute('DELETE FROM BabecockEntries').catch(() => {})
    await env._client.execute('DELETE FROM BabecockRounds').catch(() => {})
  })

  it('rejects more than 100 images', async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({ bytes: JPEG, type: 'image/jpeg', name: `i${i}.jpg` }))
    const res = await app.request(
      '/api/babecock/start',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/start'), body: imageForm(files) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('at most 100 images')
  })

  it('POST /round/:id/entries 400s on an empty form', async () => {
    const res = await app.request(
      '/api/babecock/round/whatever/entries',
      { method: 'POST', headers: authHeaders(host, 'POST', '/api/babecock/round/whatever/entries'), body: imageForm([]) },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Provide at least one image')
  })

  it('POST /:id/invite with malformed JSON still validates invitee_id', async () => {
    const text = '{broken'
    const res = await app.request(
      '/api/babecock/round-abc/invite',
      { method: 'POST', headers: { ...authHeaders(host, 'POST', '/api/babecock/round-abc/invite', text), 'Content-Type': 'application/json' }, body: text },
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invitee_id is required')
  })

  it('POST /:id/join maps round errors to their status codes', async () => {
    const form = imageForm([{ bytes: JPEG, type: 'image/jpeg', name: 'j.jpg' }])
    const missing = await app.request(
      '/api/babecock/no-such-round/join',
      { method: 'POST', headers: authHeaders(guest, 'POST', '/api/babecock/no-such-round/join'), body: form },
      env,
    )
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toBe('This Babecock round is no longer open')
  })

  it('GET /current returns null round when none is open', async () => {
    const res = await app.request('/api/babecock/current', { headers: authHeaders(guest, 'GET', '/api/babecock/current') }, env)
    expect(res.status).toBe(200)
    expect((await res.json()).round).toBeNull()
  })
})
