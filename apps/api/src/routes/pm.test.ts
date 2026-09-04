import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const sender = createTestIdentity()
const recipient = createTestIdentity()
const outsider = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function registerUser(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
}

async function setDisplayName(env: any, identity: ReturnType<typeof createTestIdentity>, name: string) {
  const body = JSON.stringify({ display_name: name })
  await app.request('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(identity, 'PATCH', '/api/users/profile', body) },
    body,
  }, env)
}

describe('Private Messages API', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, sender)
    await registerUser(env, recipient)
    await registerUser(env, outsider)
    await setDisplayName(env, sender, 'Sender Sam')
    await setDisplayName(env, recipient, 'Recipient Rita')
  })

  it('POST /api/pm requires recipient_id', async () => {
    const body = JSON.stringify({ body: 'hello' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/pm rejects empty body', async () => {
    const body = JSON.stringify({ recipient_id: recipient.orbitId, body: '   ' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/pm rejects PM to self', async () => {
    const body = JSON.stringify({ recipient_id: sender.orbitId, body: 'soliloquy' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/pm rejects unknown recipient', async () => {
    const body = JSON.stringify({ recipient_id: '00000000-0000-0000-0000-000000000000', body: 'hi' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(404)
  })

  it('POST /api/pm sends successfully between two registered users', async () => {
    const body = JSON.stringify({ recipient_id: recipient.orbitId, body: 'knock knock' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message?.body).toBe('knock knock')
    expect(json.message?.sender_id).toBe(sender.orbitId)
    expect(json.message?.recipient_id).toBe(recipient.orbitId)
  })

  it('GET /api/pm lists messages for the participant', async () => {
    const res = await app.request('/api/pm', {
      headers: authHeaders(sender, 'GET', '/api/pm'),
    }, env)
    expect(res.status).toBe(200)
    const list: any[] = await res.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].body).toBe('knock knock')
    expect(list[0].sender_name).toBe('Sender Sam')
    expect(list[0].recipient_name).toBe('Recipient Rita')
  })

  it('GET /api/pm scoped to peer filters correctly', async () => {
    // Send a second PM to the same recipient
    const body = JSON.stringify({ recipient_id: recipient.orbitId, body: 'round 2' })
    await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    // Auth signature covers only the pathname (middleware strips the query), so
    // sign the bare `/api/pm` URL here.
    const url = `/api/pm?peer=${recipient.orbitId}`
    const res = await app.request(url, { headers: authHeaders(sender, 'GET', '/api/pm') }, env)
    const list: any[] = await res.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.every((m) => m.sender_id === sender.orbitId || m.recipient_id === sender.orbitId)).toBe(true)
    expect(list.every((m) =>
      m.sender_id === recipient.orbitId || m.recipient_id === recipient.orbitId
    )).toBe(true)
    expect(list.length).toBe(2)
  })

  it('GET /api/pm excludes an outsider', async () => {
    const res = await app.request('/api/pm', {
      headers: authHeaders(outsider, 'GET', '/api/pm'),
    }, env)
    const list: any[] = await res.json()
    expect(list.length).toBe(0)
  })

  it('GET /api/pm/unread-count returns count for recipient', async () => {
    const res = await app.request('/api/pm/unread-count', {
      headers: authHeaders(recipient, 'GET', '/api/pm/unread-count'),
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.count).toBeGreaterThanOrEqual(2)
  })

  it('DELETE /api/pm/:id rejects a non-participant', async () => {
    // Fetch a message id first
    const listRes = await app.request('/api/pm', { headers: authHeaders(sender, 'GET', '/api/pm') }, env)
    const list: any[] = await listRes.json()
    const id = list[0].id
    const url = `/api/pm/${id}`
    const res = await app.request(url, {
      method: 'DELETE',
      headers: authHeaders(outsider, 'DELETE', url),
    }, env)
    expect(res.status).toBe(403)
  })

  it('DELETE /api/pm/:id soft-deletes for one side', async () => {
    const listRes = await app.request('/api/pm', { headers: authHeaders(sender, 'GET', '/api/pm') }, env)
    const list: any[] = await listRes.json()
    const id = list[0].id
    const url = `/api/pm/${id}`
    const res = await app.request(url, {
      method: 'DELETE',
      headers: authHeaders(sender, 'DELETE', url),
    }, env)
    expect(res.status).toBe(200)
    // Sender's list should still see the message? No — soft-deleted_by = 'sender'
    // means the sender should NOT see it in their list anymore. See listPrivateMessages:
    // it returns messages where deleted_by IS NULL OR deleted_by = other side.
    // Sender's list should drop it (deleted_by = 'sender'; not visible on sender side).
    const senderListRes = await app.request('/api/pm', { headers: authHeaders(sender, 'GET', '/api/pm') }, env)
    const senderList: any[] = await senderListRes.json()
    expect(senderList.find((m) => m.id === id)).toBeUndefined()
    // Recipient should still see it
    const recipListRes = await app.request('/api/pm', { headers: authHeaders(recipient, 'GET', '/api/pm') }, env)
    const recipList: any[] = await recipListRes.json()
    expect(recipList.find((m) => m.id === id)).toBeTruthy()
  })

  it('DELETE /api/pm/:id garbage-collects when both sides soft-delete', async () => {
    // Pick the latest sender-side message; we already soft-deleted one earlier.
    // Send a fresh PM, then have both sides delete it.
    const body = JSON.stringify({ recipient_id: recipient.orbitId, body: 'doomed' })
    const sendRes = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    const sendJson: any = await sendRes.json()
    const id = sendJson.message.id

    // Recipient deletes first
    const recipUrl = `/api/pm/${id}`
    await app.request(recipUrl, {
      method: 'DELETE',
      headers: authHeaders(recipient, 'DELETE', recipUrl),
    }, env)
    // Sender deletes — should garbage-collect the row
    const senderUrl = `/api/pm/${id}`
    await app.request(senderUrl, {
      method: 'DELETE',
      headers: authHeaders(sender, 'DELETE', senderUrl),
    }, env)

    // Recipient list should not contain the message anymore
    const recipListRes = await app.request('/api/pm', { headers: authHeaders(recipient, 'GET', '/api/pm') }, env)
    const recipList: any[] = await recipListRes.json()
    expect(recipList.find((m) => m.id === id)).toBeUndefined()
  })

  it('GET /api/pm without auth returns 401', async () => {
    const res = await app.request('/api/pm', {}, env)
    expect(res.status).toBe(401)
  })

  it('stores PM bodies encrypted at rest', async () => {
    const body = JSON.stringify({ recipient_id: recipient.orbitId, body: 'top secret payload' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(200)

    const raw = await env.DB.prepare(
      'SELECT body FROM PrivateMessages WHERE sender_id = ? AND recipient_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(sender.orbitId, recipient.orbitId).first<{ body: string }>()
    expect(raw?.body).toBeTruthy()
    expect(raw!.body.startsWith('enc:v1:')).toBe(true)
    expect(raw!.body).not.toContain('top secret payload')
  })

  it('grants the recipient read access to a sent attachment object', async () => {
    // Upload a private (non-public) object as the sender.
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])
    const payload = new Uint8Array([...jpegHeader, ...new TextEncoder().encode('pm-attachment-data')])
    const form = new FormData()
    form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'attach.jpg')
    form.append('encrypted', 'false')
    const uploadRes = await app.request('/api/objects', {
      method: 'POST',
      headers: authHeaders(sender, 'POST', '/api/objects'),
      body: form,
    }, env)
    expect(uploadRes.status).toBe(201)
    const uploadJson: any = await uploadRes.json()
    const objectId = uploadJson.id

    // Send a PM with that attachment.
    const pmBody = JSON.stringify({ recipient_id: recipient.orbitId, body: '', attachment_id: objectId })
    const pmRes = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/pm', pmBody) },
      body: pmBody,
    }, env)
    expect(pmRes.status).toBe(200)

    // The recipient must now be able to read the object (Recipients grant row).
    const recipUrl = `/api/objects/${objectId}`
    const recipRead = await app.request(recipUrl, { headers: authHeaders(recipient, 'GET', recipUrl) }, env)
    expect(recipRead.status).toBe(200)

    // Control: an unrelated user still cannot read it.
    const outsiderUrl = `/api/objects/${objectId}`
    const outsiderRead = await app.request(outsiderUrl, { headers: authHeaders(outsider, 'GET', outsiderUrl) }, env)
    expect(outsiderRead.status).toBe(404)
  })
})

describe('Private Messages — ban scope enforcement', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const bannedSender = createTestIdentity()
  const recip = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, bannedSender)
    await registerUser(env, recip)
  })

  it('a PM-banned sender cannot send PMs', async () => {
    // Insert a ban row with scope='pm' directly via DB
    await env.DB.prepare(
      "INSERT INTO Bans (id, user_id, banned_by, reason, scope, ban_scope_pm) VALUES (?, ?, ?, ?, 'pm', 1)"
    ).bind('ban-test-id', bannedSender.orbitId, bannedSender.orbitId, 'test ban').run()

    const body = JSON.stringify({ recipient_id: recip.orbitId, body: 'still trying' })
    const res = await app.request('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bannedSender, 'POST', '/api/pm', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })
})
