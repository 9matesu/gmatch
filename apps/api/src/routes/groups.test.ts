import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const sender = createTestIdentity()
const member = createTestIdentity()
const outsider = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function registerUser(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
}

describe('Group Chat Messages API', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, sender)
    await registerUser(env, member)
    await registerUser(env, outsider)
  })

  it('sends and returns group messages with image attachments', async () => {
    // Create a group with the member.
    const createBody = JSON.stringify({ name: 'Test Group', member_ids: [member.orbitId] })
    const createRes = await app.request('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/groups', createBody) },
      body: createBody,
    }, env)
    expect(createRes.status).toBe(201)
    const created: any = await createRes.json()
    const groupId = created.group?.id
    expect(groupId).toBeTruthy()

    // Upload an image object.
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01])
    const payload = new Uint8Array([...jpegHeader, ...new TextEncoder().encode('group-attachment-data')])
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

    // Send a group message that carries only the attachment.
    const msgBody = JSON.stringify({ body: '', attachment_id: objectId })
    const sendRes = await app.request(`/api/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', `/api/groups/${groupId}/messages`, msgBody) },
      body: msgBody,
    }, env)
    expect(sendRes.status).toBe(200)
    const sent: any = await sendRes.json()
    expect(sent.message.attachment_id).toBe(objectId)

    // The group message list must expose the attachment for rendering.
    const listRes = await app.request(`/api/groups/${groupId}/messages`, {
      method: 'GET',
      headers: authHeaders(member, 'GET', `/api/groups/${groupId}/messages`),
    }, env)
    expect(listRes.status).toBe(200)
    const list: any[] = await listRes.json()
    expect(list.length).toBeGreaterThan(0)
    const row = list[list.length - 1]
    expect(row.attachment_id).toBe(objectId)
    expect(typeof row.attachment_url).toBe('string')
    expect(row.attachment_url.length).toBeGreaterThan(0)

    // Every group member is granted read access to the attachment.
    const memberRead = await app.request(`/api/objects/${objectId}`, { headers: authHeaders(member, 'GET', `/api/objects/${objectId}`) }, env)
    expect(memberRead.status).toBe(200)

    // An outsider is not.
    const outsiderRead = await app.request(`/api/objects/${objectId}`, { headers: authHeaders(outsider, 'GET', `/api/objects/${objectId}`) }, env)
    expect(outsiderRead.status).toBe(404)
  })

  it('rejects a non-member from posting to the group', async () => {
    const createBody = JSON.stringify({ name: 'Private Group', member_ids: [] })
    const createRes = await app.request('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/groups', createBody) },
      body: createBody,
    }, env)
    const created: any = await createRes.json()
    const groupId = created.group?.id
    expect(groupId).toBeTruthy()

    const msgBody = JSON.stringify({ body: 'intrusion' })
    const res = await app.request(`/api/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(outsider, 'POST', `/api/groups/${groupId}/messages`, msgBody) },
      body: msgBody,
    }, env)
    expect(res.status).toBe(403)
  })
})