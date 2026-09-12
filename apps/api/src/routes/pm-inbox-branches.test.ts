// Remaining edge branches in src/pm.ts and src/routes/pm.ts: sender-wide
// bans, deleted_by='both' states, oversized edits, attachment mime on edit,
// reply_to threading, non-string body fields, and ReportError mapping.
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import {
  sendPrivateMessage,
  deletePrivateMessage,
  deletePrivateMessageForEveryone,
  editPrivateMessage,
  getUnreadPmCount,
  listPmThreads,
  markPmRead,
  deletePmThread,
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

describe('pm.ts data-layer bans and delete states', () => {
  it('a scope=all sender ban blocks sending', async () => {
    const dave = createTestIdentity()
    await app.request('/api/economy/balance', { headers: authHeaders(dave, 'GET', '/api/economy/balance') }, env)
    await env.DB.prepare("INSERT INTO Bans (id, user_id, banned_by, reason, scope) VALUES (?, ?, ?, 'wide', 'all')")
      .bind('ban-all-0001', dave.orbitId, dave.orbitId).run()
    const res = await sendPrivateMessage(env.DB, dave.orbitId, alice.orbitId, 'blocked')
    expect(res).toMatchObject({ error: 'You are restricted from sending private messages', status: 403 })
  })

  it('sendPrivateMessage re-validates the body even past the route', async () => {
    const res = await sendPrivateMessage(env.DB, alice.orbitId, bob.orbitId, '   ')
    expect(res).toMatchObject({ error: 'body must not be empty', status: 400 })
  })

  it('deletePrivateMessage 404s for unknown ids and is idempotent on both-deleted rows', async () => {
    expect(await deletePrivateMessage(env.DB, alice.orbitId, 'ghost-pm-00001')).toMatchObject({ status: 404 })

    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'both deleted' })
    const id = (await send.json() as any).message.id
    await env._client.execute("UPDATE PrivateMessages SET deleted_by = 'both' WHERE id = ?", [id])
    expect(await deletePrivateMessage(env.DB, alice.orbitId, id)).toEqual({ ok: true })
  })

  it('delete-for-everyone outside the window GCs when the recipient already soft-deleted', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'gc me' })
    const id = (await send.json() as any).message.id
    await env._client.execute("UPDATE PrivateMessages SET deleted_by = 'recipient', created_at = ? WHERE id = ?",
      [new Date(Date.now() - 30 * 60 * 1000).toISOString(), id])

    const res = await deletePrivateMessageForEveryone(env.DB, alice.orbitId, id)
    expect(res).toMatchObject({ ok: true, deletedForEveryone: false })
    const row = await env._client.execute('SELECT id FROM PrivateMessages WHERE id = ?', [id])
    expect(row.rows.length).toBe(0) // both sides gone -> garbage collected
  })

  it('delete-for-everyone is idempotent when sender already soft-deleted', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'already gone' })
    const id = (await send.json() as any).message.id
    await env._client.execute("UPDATE PrivateMessages SET deleted_by = 'sender', created_at = ? WHERE id = ?",
      [new Date(Date.now() - 30 * 60 * 1000).toISOString(), id])
    expect(await deletePrivateMessageForEveryone(env.DB, alice.orbitId, id)).toMatchObject({ ok: true, deletedForEveryone: false })
  })

  it('editPrivateMessage rejects oversized bodies and returns attachment mime', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'edit me' })
    const id = (await send.json() as any).message.id
    expect(await editPrivateMessage(env.DB, alice.orbitId, id, 'x'.repeat(4001))).toMatchObject({ status: 400 })

    // Attach an object to the row so the edit path resolves attachment_mime.
    await env._client.execute(
      `INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES ('pm-edit-obj', ?, 10, 'image/png')`,
      [alice.orbitId],
    )
    await env._client.execute('UPDATE PrivateMessages SET attachment_id = ? WHERE id = ?', ['pm-edit-obj', id])
    const res = await editPrivateMessage(env.DB, alice.orbitId, id, 'edited with attach')
    expect(res).toMatchObject({ body: 'edited with attach', attachment_id: 'pm-edit-obj', attachment_mime: 'image/png' })
  })
})

describe('routes/pm.ts field handling', () => {
  it('honours reply_to threading', async () => {
    const first = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'root msg' })
    const rootId = (await first.json() as any).message.id
    const reply = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'threaded reply', reply_to: rootId })
    expect(reply.status).toBe(200)
    const json = await reply.json() as any
    expect(json.message.reply_to).toBe(rootId)
  })

  it('ignores non-string fields and falls back to defaults', async () => {
    const res = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 42, reply_to: 7, attachment_id: {} })
    expect(res.status).toBe(400) // body stayed '' -> validation error
    expect((await res.json()).error).toBe('body must not be empty')
  })

  it('/send surfaces send errors with their status', async () => {
    const res = await post(alice, '/api/pm/send', { recipient_id: '00000000-0000-0000-0000-0000000000fe', body: 'nobody' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Recipient not found')
  })

  it('/send ignores non-string fields', async () => {
    const res = await post(alice, '/api/pm/send', { receiver_id: 5, content: 9 })
    expect(res.status).toBe(400)
  })

  it('report routes map ReportError to its status', async () => {
    // Reporting a nonexistent user -> resolveTargetOwner misses -> 404.
    const res = await post(alice, '/api/pm/report-user', { user_id: 'ghost-user-000000' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Content not found')

    // Reporting yourself is caught earlier by the route (400).
    expect((await post(alice, '/api/pm/report-user', { user_id: alice.orbitId })).status).toBe(400)
  })

  it('POST /:id/report with a non-string reason uses the default', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: carol.orbitId, body: 'report default reason' })
    const id = (await send.json() as any).message.id
    const text = JSON.stringify({ reason: 123 })
    const res = await app.request(`/api/pm/${id}/report`, {
      method: 'POST',
      headers: { ...authHeaders(carol, 'POST', `/api/pm/${id}/report`, text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(201)
    expect((await res.json()).reported).toBe(true)
  })
})

describe('routes/inbox.ts failure path', () => {
  it('returns an empty list when the DB blows up mid-query', async () => {
    const brokenEnv = {
      DB: {
        prepare: () => {
          throw new Error('db exploded')
        },
      },
    }
    const res = await app.request('/api/inbox', { headers: authHeaders(alice, 'GET', '/api/inbox') }, brokenEnv as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe('pm.ts defensive catch paths', () => {
  const brokenDb = {
    prepare: () => {
      throw new Error('db exploded')
    },
  } as any

  it('getUnreadPmCount swallows DB failures and returns 0', async () => {
    expect(await getUnreadPmCount(brokenDb, alice.orbitId)).toBe(0)
  })

  it('listPmThreads swallows DB failures and returns []', async () => {
    expect(await listPmThreads(brokenDb, alice.orbitId)).toEqual([])
  })

  it('markPmRead swallows insert failures', async () => {
    await expect(markPmRead(brokenDb, alice.orbitId, bob.orbitId)).resolves.toBeUndefined()
  })

  it('deletePmThread garbage-collects rows the peer already soft-deleted', async () => {
    const send = await post(alice, '/api/pm', { recipient_id: bob.orbitId, body: 'peer deleted first' })
    const id = (await send.json() as any).message.id
    await env._client.execute("UPDATE PrivateMessages SET deleted_by = 'recipient' WHERE id = ?", [id])

    const res = await deletePmThread(env.DB, alice.orbitId, bob.orbitId)
    expect(res).toMatchObject({ ok: true })
    const row = await env._client.execute('SELECT id FROM PrivateMessages WHERE id = ?', [id])
    expect(row.rows.length).toBe(0)
  })
})
