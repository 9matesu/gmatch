// T6: snapshot export/import is admin-only and refuses node-local/security tables.
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const admin = createTestIdentity()
const member = createTestIdentity()

async function register(env: any, id: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
}

describe('server snapshot (T6)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await register(env, admin)
    await register(env, member)
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(admin.orbitId).run()
  })

  it('non-admin export -> 403', async () => {
    const res = await app.request('/api/snapshot', { headers: signRequestHeaders(member, 'GET', '/api/snapshot') }, env)
    expect(res.status).toBe(403)
  })

  it('admin export -> versioned JSON with users', async () => {
    const res = await app.request('/api/snapshot', { headers: signRequestHeaders(admin, 'GET', '/api/snapshot') }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: number; exported_at: string; tables: Record<string, unknown[]> }
    expect(body.version).toBe(1)
    expect(body.tables.Users.length).toBeGreaterThanOrEqual(2)
    // node-local secrets never in a snapshot
    expect(body.tables.SystemMeta).toBeUndefined()
    expect(body.tables.ServerDirectory).toBeUndefined()
    expect(body.tables.Sessions).toBeUndefined()
  })

  it('import rejects unknown/blocked tables and bad versions', async () => {
    const badVersion = JSON.stringify({ version: 99, tables: { Users: [{ id: admin.orbitId }] } })
    const r1 = await app.request('/api/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequestHeaders(admin, 'POST', '/api/snapshot/import', badVersion) },
      body: badVersion,
    }, env)
    expect(r1.status).toBe(400)

    const blocked = JSON.stringify({ version: 1, tables: { Sessions: [{ id: 's' }] } })
    const r2 = await app.request('/api/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequestHeaders(admin, 'POST', '/api/snapshot/import', blocked) },
      body: blocked,
    }, env)
    expect(r2.status).toBe(400)
  })

  it('member round-trip: export -> wipe row -> import restores', async () => {
    // create a follow edge
    const body = '{}'
    const followPath = `/api/users/${member.orbitId}/follow`
    const made = await app.request(followPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequestHeaders(admin, 'POST', followPath, body) },
      body,
    }, env)
    expect(made.status).toBe(200)
    const exp = (await (await app.request('/api/snapshot', { headers: signRequestHeaders(admin, 'GET', '/api/snapshot') }, env)).json()) as { version: number; tables: Record<string, unknown[]> }
    expect((exp.tables.Followers || []).length).toBeGreaterThanOrEqual(1)
    await env.DB.prepare('DELETE FROM Followers WHERE follower_id = ?').bind(admin.orbitId).run()
    const imp = await app.request('/api/snapshot/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequestHeaders(admin, 'POST', '/api/snapshot/import', JSON.stringify(exp)) },
      body: JSON.stringify(exp),
    }, env)
    expect(imp.status).toBe(200)
    const body2 = (await imp.json()) as { restored: Record<string, number> }
    expect(body2.restored.Followers).toBeGreaterThanOrEqual(1)
    const back = await env.DB.prepare('SELECT follower_id FROM Followers WHERE follower_id = ?').bind(admin.orbitId).first()
    expect(back).toBeTruthy()
  })
})