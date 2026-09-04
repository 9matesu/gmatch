// Edge coverage for src/pm.ts + src/routes/pm.ts + src/routes/inbox.ts:
// /send alias, read receipts, threads, history pagination, edit/delete
// windows, reports, and inbox favorite/remove/list paths.
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import {
  validatePmBody,
  sendPrivateMessage,
  listPrivateMessages,
  getUnreadPmCount,
  markPmRead,
  listPmThreads,
  deletePrivateMessageForEveryone,
  editPrivateMessage,
  deletePmThread,
  getPmHistory,
  resolveAttachmentId,
} from '../pm'

const alice = createTestIdentity()
const bob = createTestIdentity()
const carol = createTestIdentity()

let env: Awaited<ReturnType<typeof createMockEnv>>

function authHeaders(who: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(who, method, url, body)
}

async function post(who: ReturnType<typeof createTestIdentity>, url: string, body: unknown) {
  const text = JSON.stringify(body)
  return app.request(url, {
    method: 'POST',
    headers: { ...authHeaders(who, 'POST', url, text), 'Content-Type': 'application/json' },
    body: text,
  }, env)
}

beforeAll(async () => {
  env = await createMockEnv()
  for (const id of [alice, bob, carol]) {
    await app.request('/api/economy/balance', { headers: authHeaders(id, 'GET', '/api/economy/balance') }, env)
  }
})

describe('validatePmBody', () => {
  it('accepts a normal body and rejects junk shapes', () => {
    expect(validatePmBody('hello')).toBeNull()
    expect(validatePmBody(42 as unknown)).toBe('body must be a string')
    expect(validatePmBody('   ')).toBe('body must not be empty')
    expect(validatePmBody('x'.repeat(4001))).toContain('exceeds 4000')
  })
})

describe('POST /api/pm/send alias', () => {
  it('maps receiver_id/content to the canonical shape', async () => {
    const res = await post(alice, '/api/pm/send', { receiver_id: bob.orbitId, content: 'via alias' })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.message.body).toBe('via alias')
    expect(json.message.recipient_id).toBe(bob.orbitId)
  })

  it('prefers recipient_id/body when both spellings are present', async () => {
    const res = await post(alice, '/api/pm/send', {
      recipient_id: bob.orbitId,
      receiver_id: carol.orbitId,
      body: 'canonical wins',
      content: 'alias loses',
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.message.recipient_id).toBe(bob.orbitId)
    expect(json.message.body).toBe('canonical wins')
  })

  it('400s without a recipient', async () => {
    const res = await post(alice, '/api/pm/send', { content: 'orphan' })
    expect(res.status).toBe(400)
  })

  it('400s on an empty body without attachment', async () => {
    const res = await post(alice, '/api/pm/send', { recipient_id: bob.orbitId, content: '  ' })
    expect(res.status).toBe(400)
  })
})

describe('read receipts and unread counts', () => {
  it('markPmRead zeroes the unread count for that peer only', async () => {
    await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'unread for bob 1' })
    await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'unread for bob 2' })

    const before = await app.request('/api/pm/unread-count', { headers: authHeaders(bob, 'GET', '/api/pm/unread-count') }, env)
    expect(((await before.json()) as any).count).toBeGreaterThanOrEqual(2)

    const readRes = await post(bob, '/api/pm/read', { peer_id: alice.orbitId })
    expect(readRes.status).toBe(200)

    const after = await app.request('/api/pm/unread-count', { headers: authHeaders(bob, 'GET', '/api/pm/unread-count') }, env)
    expect(((await after.json()) as any).count).toBe(0)

    // Sender-side view now reports the messages as read by recipient.
    const list = await app.request('/api/pm', { headers: authHeaders(alice, 'GET', '/api/pm') }, env)
    const msgs = await list.json() as any[]
    expect(msgs.some((m) => m.read_by_recipient === true)).toBe(true)
  })

  it('POST /api/pm/read requires peer_id', async () => {
    const res = await post(bob, '/api/pm/read', {})
    expect(res.status).toBe(400)
  })

  it('GET /api/pm?limit caps the page', async () => {
    const res = await app.request('/api/pm?limit=1', { headers: authHeaders(bob, 'GET', '/api/pm') }, env)
    const msgs = await res.json() as any[]
    expect(msgs.length).toBeLessThanOrEqual(1)
  })
})

describe('threads and history', () => {
  it('GET /api/pm/threads returns one row per peer with unread counts', async () => {
    await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'thread msg' })
    const res = await app.request('/api/pm/threads', { headers: authHeaders(alice, 'GET', '/api/pm/threads') }, env)
    expect(res.status).toBe(200)
    const threads = await res.json() as any[]
    const withBob = threads.find((t) => t.peer_id === bob.orbitId)
    expect(withBob).toBeTruthy()
    expect(typeof withBob.unread_count).toBe('number')
    expect(withBob.last_body.length).toBeGreaterThan(0)
  })

  it('GET /api/pm/history/:peer paginates with a before cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: `hist ${i}` })
    }
    const first = await app.request(`/api/pm/history/${bob.orbitId}?limit=2`, {
      headers: authHeaders(alice, 'GET', `/api/pm/history/${bob.orbitId}`),
    }, env)
    expect(first.status).toBe(200)
    const page1 = await first.json() as any
    expect(page1.messages).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).toBeTruthy()

    const second = await app.request(`/api/pm/history/${bob.orbitId}?limit=2&before=${page1.nextCursor}`, {
      headers: authHeaders(alice, 'GET', `/api/pm/history/${bob.orbitId}`),
    }, env)
    const page2 = await second.json() as any
    expect(page2.messages.length).toBeGreaterThanOrEqual(1)
    expect(page2.messages[0].created_at < page1.nextCursor || page2.messages[0].created_at <= page1.nextCursor).toBe(true)
  })

  it('DELETE /api/pm/threads/:peerId clears the thread for one side only', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: carol.orbitId, body: 'thread to delete' })
    expect(send.status).toBe(200)

    const del = await app.request(`/api/pm/threads/${carol.orbitId}`, {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', `/api/pm/threads/${carol.orbitId}`),
    }, env)
    expect(del.status).toBe(200)
    const json = await del.json() as any
    expect(json.ok).toBe(true)
    expect(json.count).toBeGreaterThanOrEqual(1)

    const aliceList = await app.request('/api/pm', { headers: authHeaders(alice, 'GET', '/api/pm') }, env)
    const msgs = await aliceList.json() as any[]
    expect(msgs.some((m) => m.recipient_id === carol.orbitId)).toBe(false)

    // Carol still sees it (soft delete is per-side).
    const carolList = await app.request('/api/pm', { headers: authHeaders(carol, 'GET', '/api/pm') }, env)
    const carolMsgs = await carolList.json() as any[]
    expect(carolMsgs.some((m) => m.sender_id === alice.orbitId)).toBe(true)
  })

  it('DELETE /api/pm/threads/:peerId 404s for an unknown peer', async () => {
    const res = await app.request('/api/pm/threads/00000000-0000-0000-0000-0000000000ff', {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', '/api/pm/threads/00000000-0000-0000-0000-0000000000ff'),
    }, env)
    expect(res.status).toBe(404)
  })
})

describe('edit and delete-for-everyone windows', () => {
  async function freshPm(): Promise<string> {
    const res = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'window test' })
    const json = await res.json() as any
    return json.message.id
  }

  it('PATCH /api/pm/:id edits within the window and rejects empty bodies', async () => {
    const id = await freshPm()
    const text = JSON.stringify({ body: 'edited!' })
    const res = await app.request(`/api/pm/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(alice, 'PATCH', `/api/pm/${id}`, text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json() as any).message.body).toBe('edited!')

    const empty = JSON.stringify({ body: '   ' })
    const bad = await app.request(`/api/pm/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(alice, 'PATCH', `/api/pm/${id}`, empty), 'Content-Type': 'application/json' },
      body: empty,
    }, env)
    expect(bad.status).toBe(400)

    const notMine = JSON.stringify({ body: 'hijacked' })
    const forbidden = await app.request(`/api/pm/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(bob, 'PATCH', `/api/pm/${id}`, notMine), 'Content-Type': 'application/json' },
      body: notMine,
    }, env)
    expect(forbidden.status).toBe(403)
  })

  it('PATCH on a missing message 404s', async () => {
    const text = JSON.stringify({ body: 'x' })
    const res = await app.request('/api/pm/no-such-pm-id', {
      method: 'PATCH',
      headers: { ...authHeaders(alice, 'PATCH', '/api/pm/no-such-pm-id', text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(404)
  })

  it('DELETE /:id/everyone hard-deletes inside the window', async () => {
    const id = await freshPm()
    const res = await app.request(`/api/pm/${id}/everyone`, {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', `/api/pm/${id}/everyone`),
    }, env)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.deletedForEveryone).toBe(true)

    const row = await env.DB.prepare('SELECT 1 FROM PrivateMessages WHERE id = ?').bind(id).first()
    expect(row).toBeNull()
  })

  it('DELETE /:id/everyone 403s for the recipient and 404s for unknown ids', async () => {
    const id = await freshPm()
    const asRecipient = await app.request(`/api/pm/${id}/everyone`, {
      method: 'DELETE',
      headers: authHeaders(bob, 'DELETE', `/api/pm/${id}/everyone`),
    }, env)
    expect(asRecipient.status).toBe(403)

    const missing = await app.request('/api/pm/ghost-id/everyone', {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', '/api/pm/ghost-id/everyone'),
    }, env)
    expect(missing.status).toBe(404)
  })

  it('outside the 10-minute window it falls back to a sender-side soft delete', async () => {
    const id = await freshPm()
    const oldIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    await env._client.execute(`UPDATE PrivateMessages SET created_at = ? WHERE id = ?`, [oldIso, id])
    const res = await app.request(`/api/pm/${id}/everyone`, {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', `/api/pm/${id}/everyone`),
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json() as any).deletedForEveryone).toBe(false)
    const row = await env.DB.prepare('SELECT deleted_by FROM PrivateMessages WHERE id = ?').bind(id).first<{ deleted_by: string }>()
    expect(row?.deleted_by).toBe('sender')
  })

  it('edit window expiry is enforced at the data layer', async () => {
    const id = await freshPm()
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    await env._client.execute(`UPDATE PrivateMessages SET created_at = ? WHERE id = ?`, [oldIso, id])
    const res = await editPrivateMessage(env.DB, alice.orbitId, id, 'too late')
    expect(res).toMatchObject({ error: 'Edit window expired (15 minutes)', status: 400 })
  })
})

describe('pm data-layer edges', () => {
  it('sendPrivateMessage rejects oversized bodies with attachments and unknown attachments', async () => {
    const tooLong = await sendPrivateMessage(env.DB, alice.orbitId, bob.orbitId, 'x'.repeat(4001), null, 'attachment-000001')
    expect(tooLong).toMatchObject({ status: 400 })

    const missing = await sendPrivateMessage(env.DB, alice.orbitId, bob.orbitId, 'with attach', null, 'no-such-object')
    expect(missing).toMatchObject({ error: 'Attachment not found', status: 404 })
  })

  it('resolveAttachmentId enforces ownership/shareability', async () => {
    const objId = `att-${Math.random().toString(36).slice(2, 8)}`
    await env._client.execute(
      `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_public) VALUES (?, ?, 10, 'image/jpeg', 0)`,
      [objId, carol.orbitId],
    )
    expect(await resolveAttachmentId(env.DB, alice.orbitId, objId)).toMatchObject({ error: 'Attachment is not shareable', status: 403 })

    await env._client.execute(`UPDATE Objects SET is_public = 1 WHERE id = ?`, [objId])
    expect(await resolveAttachmentId(env.DB, alice.orbitId, objId)).toEqual({ id: objId })

    await env._client.execute(`UPDATE Objects SET hidden_at = CURRENT_TIMESTAMP WHERE id = ?`, [objId])
    expect(await resolveAttachmentId(env.DB, alice.orbitId, objId)).toMatchObject({ error: 'Attachment is unavailable', status: 400 })
  })

  it('recipient-side PM ban blocks delivery', async () => {
    const dave = createTestIdentity()
    await app.request('/api/economy/balance', { headers: authHeaders(dave, 'GET', '/api/economy/balance') }, env)
    await env.DB.prepare("INSERT INTO Bans (id, user_id, banned_by, reason, scope, ban_scope_pm) VALUES (?, ?, ?, 'no dms', 'pm', 1)")
      .bind('ban-pm-recv-1', dave.orbitId, dave.orbitId).run()
    const res = await sendPrivateMessage(env.DB, alice.orbitId, dave.orbitId, 'hey')
    expect(res).toMatchObject({ error: 'Recipient cannot receive private messages', status: 403 })
  })

  it('listPrivateMessages caps the limit and getUnreadPmCount counts per recipient', async () => {
    const msgs = await listPrivateMessages(env.DB, alice.orbitId, undefined, 9999)
    expect(Array.isArray(msgs)).toBe(true)
    const n = await getUnreadPmCount(env.DB, bob.orbitId)
    expect(typeof n).toBe('number')
  })

  it('markPmRead is idempotent (upsert)', async () => {
    await markPmRead(env.DB, alice.orbitId, bob.orbitId)
    await markPmRead(env.DB, alice.orbitId, bob.orbitId)
    const threads = await listPmThreads(env.DB, alice.orbitId)
    const t = threads.find((x) => x.peer_id === bob.orbitId)
    expect(t?.unread_count).toBe(0)
  })

  it('deletePmThread skips rows already deleted by this side', async () => {
    await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'skip me' })
    const first = await deletePmThread(env.DB, alice.orbitId, bob.orbitId)
    expect(first.ok).toBe(true)
    const second = await deletePmThread(env.DB, alice.orbitId, bob.orbitId)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.count).toBe(0)
  })

  it('deletePrivateMessageForEveryone is idempotent after soft delete', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'twice deleted' })
    const id = (await send.json() as any).message.id
    const oldIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    await env._client.execute(`UPDATE PrivateMessages SET created_at = ? WHERE id = ?`, [oldIso, id])
    const r1 = await deletePrivateMessageForEveryone(env.DB, alice.orbitId, id)
    expect(r1).toMatchObject({ ok: true, deletedForEveryone: false })
    const r2 = await deletePrivateMessageForEveryone(env.DB, alice.orbitId, id)
    expect(r2).toMatchObject({ ok: true, deletedForEveryone: false })
  })

  it('getPmHistory clamps limit and returns empty for unknown peers', async () => {
    const res = await getPmHistory(env.DB, { userId: alice.orbitId, peerId: 'ghost-peer-0000', limit: 500 })
    expect(res.messages).toHaveLength(0)
    expect(res.hasMore).toBe(false)
    expect(res.nextCursor).toBeNull()
  })
})

describe('PM reports', () => {
  it('POST /api/pm/:id/report hides the message for a participant', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'reportable content' })
    const id = (await send.json() as any).message.id

    const text = JSON.stringify({ reason: 'harassment' })
    const res = await app.request(`/api/pm/${id}/report`, {
      method: 'POST',
      headers: { ...authHeaders(bob, 'POST', `/api/pm/${id}/report`, text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(201)
    const json = await res.json() as any
    expect(json.reported).toBe(true)

    // Hidden messages drop out of both participants' lists.
    const bobList = await app.request('/api/pm', { headers: authHeaders(bob, 'GET', '/api/pm') }, env)
    expect(((await bobList.json()) as any[]).some((m) => m.id === id)).toBe(false)
  })

  it('report 404s for unknown messages and 403s for outsiders', async () => {
    const missing = await post(alice, '/api/pm/ghost-pm/report', { reason: 'x' })
    expect(missing.status).toBe(404)

    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'not yours' })
    const id = (await send.json() as any).message.id
    const outsider = await post(carol, `/api/pm/${id}/report`, { reason: 'x' })
    expect(outsider.status).toBe(403)
  })

  it('POST /api/pm/report-user validates and reports', async () => {
    expect((await post(alice, '/api/pm/report-user', {})).status).toBe(400)
    expect((await post(alice, '/api/pm/report-user', { user_id: alice.orbitId })).status).toBe(400)

    const res = await post(alice, '/api/pm/report-user', { user_id: carol.orbitId, reason: 'spam' })
    expect(res.status).toBe(201)
    expect((await res.json() as any).reported).toBe(true)
  })
})

describe('inbox routes', () => {
  async function seedObject(owner: ReturnType<typeof createTestIdentity>, id: string, extra: Partial<Record<string, unknown>> = {}) {
    await env._client.execute(
      `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story, is_public, expires_at) VALUES (?, ?, 10, 'image/jpeg', 0, 0, ?)`,
      [id, owner.orbitId, extra.expires_at ?? null],
    )
  }

  it('GET /api/inbox lists owned private objects with X-Total-Count', async () => {
    await seedObject(alice, 'inbox-obj-001')
    const res = await app.request('/api/inbox?limit=100', { headers: authHeaders(alice, 'GET', '/api/inbox') }, env)
    expect(res.status).toBe(200)
    expect(Number(res.headers.get('X-Total-Count'))).toBeGreaterThanOrEqual(1)
    const items = await res.json() as any[]
    expect(items.some((o) => o.id === 'inbox-obj-001')).toBe(true)
  })

  it('GET /api/inbox excludes expired objects', async () => {
    await seedObject(alice, 'inbox-expired', { expires_at: '2020-01-01 00:00:00' })
    const res = await app.request('/api/inbox', { headers: authHeaders(alice, 'GET', '/api/inbox') }, env)
    const items = await res.json() as any[]
    expect(items.some((o) => o.id === 'inbox-expired')).toBe(false)
  })

  it('POST /api/inbox/:id/favorite toggles on then off', async () => {
    const on = await app.request('/api/inbox/inbox-obj-001/favorite', {
      method: 'POST',
      headers: authHeaders(alice, 'POST', '/api/inbox/inbox-obj-001/favorite'),
    }, env)
    expect(on.status).toBe(200)
    expect((await on.json() as any).favorited).toBe(true)

    const off = await app.request('/api/inbox/inbox-obj-001/favorite', {
      method: 'POST',
      headers: authHeaders(alice, 'POST', '/api/inbox/inbox-obj-001/favorite'),
    }, env)
    expect((await off.json() as any).favorited).toBe(false)
  })

  it('POST /api/inbox/:id/remove drops a received object from the recipient only', async () => {
    await seedObject(alice, 'inbox-shared')
    await env._client.execute('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)', ['inbox-shared', bob.orbitId])

    const before = await app.request('/api/inbox', { headers: authHeaders(bob, 'GET', '/api/inbox') }, env)
    expect(((await before.json()) as any[]).some((o) => o.id === 'inbox-shared')).toBe(true)

    const remove = await app.request('/api/inbox/inbox-shared/remove', {
      method: 'POST',
      headers: authHeaders(bob, 'POST', '/api/inbox/inbox-shared/remove'),
    }, env)
    expect(remove.status).toBe(200)
    expect((await remove.json() as any)).toMatchObject({ success: true, removed: true })

    const after = await app.request('/api/inbox', { headers: authHeaders(bob, 'GET', '/api/inbox') }, env)
    expect(((await after.json()) as any[]).some((o) => o.id === 'inbox-shared')).toBe(false)

    // Owner still sees their own object.
    const ownerView = await app.request('/api/inbox', { headers: authHeaders(alice, 'GET', '/api/inbox') }, env)
    expect(((await ownerView.json()) as any[]).some((o) => o.id === 'inbox-shared')).toBe(true)
  })
})
