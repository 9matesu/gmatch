import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { saveBotConfig } from '../bot-image-api'

const alice = createTestIdentity()
const bob = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function registerUser(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
}

function makePngBlob(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
  ])
  return new Blob([bytes], { type: 'image/png' })
}

async function createCardObject(env: any, identity: ReturnType<typeof createTestIdentity>) {
  const formData = new FormData()
  formData.append('image', makePngBlob(), 'card.png')
  formData.append('caption', 'Duel card')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: signRequestHeaders(identity, 'POST', '/api/objects'),
    body: formData,
  }, env)
  expect(res.status).toBe(201)
  const json: any = await res.json()
  return json.id as string
}

describe('Slideshows API', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let cardId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await saveBotConfig(env.DB, { enabled: false })
    await registerUser(env, alice)
    await registerUser(env, bob)
    cardId = await createCardObject(env, alice)
  })

  it('creates a cards slideshow and resolves its items', async () => {
    const body = JSON.stringify({ title: 'My deck', source: 'cards', items: [{ object_id: cardId }] })
    const res = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.slideshow.id).toBeTruthy()
    expect(json.slideshow.source).toBe('cards')

    const itemsRes = await app.request(`/api/slideshows/${json.slideshow.id}/items`, {
      headers: authHeaders(alice, 'GET', `/api/slideshows/${json.slideshow.id}/items`),
    }, env)
    expect(itemsRes.status).toBe(200)
    const itemsJson: any = await itemsRes.json()
    expect(itemsJson.items.length).toBe(1)
    expect(itemsJson.items[0].object_id).toBe(cardId)
  })

  it('lists only the caller\'s slideshows and blocks cross-user access', async () => {
    const createBody = JSON.stringify({ title: 'Private', source: 'cards', items: [{ object_id: cardId }] })
    const created = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', createBody) },
      body: createBody,
    }, env)
    const createdJson: any = await created.json()
    const id = createdJson.slideshow.id

    const bobList = await app.request('/api/slideshows', { headers: authHeaders(bob, 'GET', '/api/slideshows') }, env)
    expect((await bobList.json()).slideshows.length).toBe(0)

    const bobGet = await app.request(`/api/slideshows/${id}`, { headers: authHeaders(bob, 'GET', `/api/slideshows/${id}`) }, env)
    expect(bobGet.status).toBe(404)
  })

  it('creates an api slideshow and returns an items array (empty when providers disabled)', async () => {
    const body = JSON.stringify({ title: 'Tag feed', source: 'api', tags: ['scenery'] })
    const res = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.slideshow.source).toBe('api')
    expect(json.slideshow.tags).toContain('scenery')

    const itemsRes = await app.request(`/api/slideshows/${json.slideshow.id}/items`, {
      headers: authHeaders(alice, 'GET', `/api/slideshows/${json.slideshow.id}/items`),
    }, env)
    expect(itemsRes.status).toBe(200)
    expect(Array.isArray((await itemsRes.json()).items)).toBe(true)
  })

  it('stores tags verbatim and still rejects invalid sources', async () => {
    // Client-side filtering only: the server accepts any tags (blocking
    // happens in the desktop client via shared/blocklist.json).
    const anyTags = JSON.stringify({ source: 'api', tags: ['loli'] })
    const res = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', anyTags) },
      body: anyTags,
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json()).slideshow.tags).toContain('loli')

    const badSource = JSON.stringify({ source: 'nope', items: [{ object_id: cardId }] })
    const res2 = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', badSource) },
      body: badSource,
    }, env)
    expect(res2.status).toBe(400)
  })

  it('deletes a slideshow owned by the caller', async () => {
    const body = JSON.stringify({ title: 'To delete', source: 'cards', items: [{ object_id: cardId }] })
    const created = await app.request('/api/slideshows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/slideshows', body) },
      body,
    }, env)
    const json: any = await created.json()
    const id = json.slideshow.id

    const del = await app.request(`/api/slideshows/${id}`, {
      method: 'DELETE',
      headers: authHeaders(alice, 'DELETE', `/api/slideshows/${id}`),
    }, env)
    expect(del.status).toBe(200)

    const after = await app.request(`/api/slideshows/${id}`, { headers: authHeaders(alice, 'GET', `/api/slideshows/${id}`) }, env)
    expect(after.status).toBe(404)
  })
})
