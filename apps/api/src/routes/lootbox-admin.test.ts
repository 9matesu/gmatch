import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const admin = createTestIdentity()
const player = createTestIdentity()

function auth(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function register(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: auth(identity, 'GET', '/api/users') }, env)
}

describe('Lootbox admin management', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await register(env, admin)
    await register(env, player)
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(admin.orbitId).run()
  })

  it('creates an unreleased lootbox that is hidden from the store', async () => {
    const body = JSON.stringify({ name: 'Test Box', cost: 100, card_count: 2 })
    const res = await app.request('/api/admin/settings/lootboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin, 'POST', '/api/admin/settings/lootboxes', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.id).toBeTruthy()

    const storeRes = await app.request('/api/users/store/items', { headers: auth(player, 'GET', '/api/users/store/items') }, env)
    const store: any = await storeRes.json()
    const ids = store.items.map((i: any) => i.id)
    expect(ids).not.toContain(json.id)
    expect(ids).toContain('item-pack-rare') // legacy released seed still present
  })

  it('releases a lootbox and it appears in the store', async () => {
    const create = JSON.stringify({ name: 'Release Me', cost: 50, card_count: 1 })
    const created = await app.request('/api/admin/settings/lootboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin, 'POST', '/api/admin/settings/lootboxes', create) },
      body: create,
    }, env)
    const id = (await created.json()).id

    const patch = JSON.stringify({ released: true })
    await app.request(`/api/admin/settings/lootboxes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(admin, 'PATCH', `/api/admin/settings/lootboxes/${id}`, patch) },
      body: patch,
    }, env)

    const storeRes = await app.request('/api/users/store/items', { headers: auth(player, 'GET', '/api/users/store/items') }, env)
    const store: any = await storeRes.json()
    expect(store.items.map((i: any) => i.id)).toContain(id)
  })

  it('rejects non-admin access to lootbox management', async () => {
    const body = JSON.stringify({ name: 'Nope' })
    const res = await app.request('/api/admin/settings/lootboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(player, 'POST', '/api/admin/settings/lootboxes', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })

  it('persists tags and lifecycle state through draft → released → archived', async () => {
    const create = JSON.stringify({ name: 'Tagged Box', cost: 10, card_count: 1, tags: ['anime', 'cyber', 'anime'] })
    const created = await app.request('/api/admin/settings/lootboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin, 'POST', '/api/admin/settings/lootboxes', create) },
      body: create,
    }, env)
    expect(created.status).toBe(200)
    const id = (await created.json()).id

    const list = await app.request('/api/admin/settings/lootboxes', { headers: auth(admin, 'GET', '/api/admin/settings/lootboxes') }, env)
    const listJson: any = await list.json()
    const row = listJson.lootboxes.find((l: any) => l.id === id)
    expect(row.state).toBe('draft')
    expect(row.tags).toEqual(['anime', 'cyber'])
    expect(row.version).toBe(1)

    const release = JSON.stringify({ state: 'released' })
    const relRes = await app.request(`/api/admin/settings/lootboxes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(admin, 'PATCH', `/api/admin/settings/lootboxes/${id}`, release) },
      body: release,
    }, env)
    expect(relRes.status).toBe(200)

    const storeRes = await app.request('/api/users/store/items', { headers: auth(player, 'GET', '/api/users/store/items') }, env)
    const store: any = await storeRes.json()
    expect(store.items.map((i: any) => i.id)).toContain(id)

    const archive = await app.request(`/api/admin/settings/lootboxes/${id}`, { method: 'DELETE', headers: auth(admin, 'DELETE', `/api/admin/settings/lootboxes/${id}`) }, env)
    expect(archive.status).toBe(200)

    const storeAfter = await app.request('/api/users/store/items', { headers: auth(player, 'GET', '/api/users/store/items') }, env)
    const storeAfterJson: any = await storeAfter.json()
    expect(storeAfterJson.items.map((i: any) => i.id)).not.toContain(id)
  })
})
