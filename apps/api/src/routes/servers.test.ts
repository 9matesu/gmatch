// T3: public server directory (register/list/unregister/heartbeat).
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const owner = createTestIdentity()
const other = createTestIdentity()

function headers(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function register(env: any, identity: any, body: Record<string, unknown>) {
  const raw = JSON.stringify(body)
  return app.request('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers(identity, 'POST', '/api/servers', raw) },
    body: raw,
  }, env)
}

describe('Server directory API', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    // auto-register identities via GET /api/users (orbitAuth side effect)
    await app.request('/api/users', { headers: headers(owner, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: headers(other, 'GET', '/api/users') }, env)
  })

  it('registers a server and lists it', async () => {
    const createBody = { name: 'Mateus Hub', description: 'friends only', endpoint_hint: 'example.org:8790', password_required: true }
    const res = await register(env, owner, createBody)
    expect(res.status).toBe(201)
    const created = (await res.json()) as { server: { id: string; name: string; owner_id: string; password_required: number } }
    expect(created.server.name).toBe('Mateus Hub')
    expect(created.server.password_required).toBe(1)

    const listRes = await app.request('/api/servers', {}, env)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { servers: Array<{ id: string; owner_id?: string; name?: string }> }
    expect(list.servers.some((s) => s.id === created.server.id)).toBe(true)
    // listing exposes NO endpoint IPs to anonymous callers
    expect(JSON.stringify(list.servers)).not.toContain('example.org')

    // ...but signed-in callers get the hint (they are the ones who join)
    const authListRes = await app.request('/api/servers', { headers: headers(other, 'GET', '/api/servers') }, env)
    const authList = (await authListRes.json()) as { servers: Array<Record<string, unknown>> }
    expect(JSON.stringify(authList.servers)).toContain('example.org')
  })

  it('directory carries host-reported counts; junk counts stay null', async () => {
    const good = await register(env, owner, { name: 'Counted Node', user_count: 42, online_count: 7, owner_name: 'x'.repeat(80) })
    expect(good.status).toBe(201)
    const bad = await register(env, other, { name: 'Junk Counts', user_count: -5, online_count: 'x' })
    expect(bad.status).toBe(201)

    const list = (await (await app.request('/api/servers?_ts=1', {}, env)).json()) as { servers: Array<Record<string, unknown>> }
    const counted = list.servers.find((s) => s.name === 'Counted Node')
    expect(counted?.user_count).toBe(42)
    expect(counted?.online_count).toBe(7)
    // owner_name is stored (clamped to 40 in POST) but NEVER listed — the
    // public browser shows servers, not admins.
    expect(counted?.owner_name).toBeUndefined()
    const junked = list.servers.find((s) => s.name === 'Junk Counts')
    expect(junked?.user_count).toBeNull()
    expect(junked?.online_count).toBeNull()
    expect(junked?.owner_name ?? null).toBe(null)
  })

  it('re-register with the same owner+name upserts (no duplicates)', async () => {
    const body = { name: 'Upsert Node', description: '', endpoint_hint: '', password_required: false }
    const first = await register(env, owner, body)
    const second = await register(env, owner, body)
    const a = ((await first.json()) as any).server.id
    const b = ((await second.json()) as any).server.id
    expect(a).toBe(b)
    expect(second.status).toBe(201)
  })

  it('rejects invalid names/endpoints', async () => {
    const noName = await register(env, owner, { name: '   ' })
    expect(noName.status).toBe(400)
    const junk = await register(env, owner, { name: 'X', endpoint_hint: 'javascript:alert' })
    expect(junk.status).toBe(400)
  })

  it('dashboard: counts for anonymous, userlist (id-truncated) for signed callers', async () => {
    const anon = await app.request('/api/servers/dashboard', {}, env)
    expect(anon.status).toBe(200)
    const anonBody = (await anon.json()) as { users: unknown[]; members_total: number; posts_24h: number }
    expect(anonBody.users).toEqual([])
    expect(anonBody.members_total).toBeGreaterThanOrEqual(2)
    expect(typeof anonBody.posts_24h).toBe('number')

    const authed = await app.request('/api/servers/dashboard', { headers: headers(owner, 'GET', '/api/servers/dashboard') }, env)
    expect(authed.status).toBe(200)
    const body = (await authed.json()) as { users: Array<{ id: string; online: boolean }> }
    expect(body.users.length).toBeGreaterThanOrEqual(1)
    // truncated ids: exactly 8 chars, never the full orbitId
    expect(body.users.every((u) => u.id.length === 8)).toBe(true)
    expect(JSON.stringify(body)).not.toContain(owner.orbitId.slice(16))
  })

  it('delete is owner-only; heartbeat refreshes last_seen', async () => {
    const created = await register(env, owner, { name: 'Temp Node' })
    const id = ((await created.json()) as any).server.id

    const notOwner = await app.request(`/api/servers/${id}`, { method: 'DELETE', headers: headers(other, 'DELETE', `/api/servers/${id}`) }, env)
    expect(notOwner.status).toBe(403)

    const ping = await app.request(`/api/servers/${id}/ping`, { method: 'POST', headers: headers(owner, 'POST', `/api/servers/${id}/ping`) }, env)
    expect(ping.status).toBe(200)

    const del = await app.request(`/api/servers/${id}`, { method: 'DELETE', headers: headers(owner, 'DELETE', `/api/servers/${id}`) }, env)
    expect(del.status).toBe(200)
    const after = await app.request('/api/servers', {}, env)
    const list = (await after.json()) as { servers: Array<{ id: string }> }
    expect(list.servers.some((s) => s.id === id)).toBe(false)
  })

  it('owner can rename a directory entry; others cannot', async () => {
    const created = await register(env, owner, { name: 'Rename Me', description: 'old', endpoint_hint: 'rename.test:8790' })
    const id = ((await created.json()) as any).server.id

    const forbidden = await app.request(`/api/servers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(other, 'PATCH', `/api/servers/${id}`, JSON.stringify({ name: 'Hijacked' })) },
      body: JSON.stringify({ name: 'Hijacked' }),
    }, env)
    expect(forbidden.status).toBe(403)

    const ok = await app.request(`/api/servers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(owner, 'PATCH', `/api/servers/${id}`, JSON.stringify({ name: 'Renamed Node', description: 'new' })) },
      body: JSON.stringify({ name: 'Renamed Node', description: 'new' }),
    }, env)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as any
    expect(body.server.name).toBe('Renamed Node')
    expect(body.server.description).toBe('new')
    expect(body.server.id).toBe(id)
  })

  it('private servers are listed only to their owner; owner_name never listed; flag survives heartbeat', async () => {
    const created = await register(env, owner, { name: 'Hidden Realm', endpoint_hint: 'secret.host:8790', private: true })
    expect(created.status).toBe(201)
    const row = (await created.json()) as { server: { id: string; is_private: number } }
    expect(row.server.is_private).toBe(1)

    // anonymous and other authed callers never see the row at all
    const anon = (await (await app.request('/api/servers', {}, env)).json()) as { servers: Array<{ id: string }> }
    expect(anon.servers.some((s) => s.id === row.server.id)).toBe(false)
    const otherList = (await (await app.request('/api/servers', { headers: headers(other, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string }> }
    expect(otherList.servers.some((s) => s.id === row.server.id)).toBe(false)

    // the owner sees their own private row
    const ownList = (await (await app.request('/api/servers', { headers: headers(owner, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string; name?: string }> }
    expect(ownList.servers.find((s) => s.id === row.server.id)?.name).toBe('Hidden Realm')

    // owner_name is NEVER a listed column (the browser shows handles, not admins)
    expect(JSON.stringify(anon.servers)).not.toContain('owner_name')
    expect('owner_name' in ownList.servers[0]).toBe(false)

    // heartbeat replay WITHOUT the flag must not flip it back to public
    await register(env, owner, { name: 'Hidden Realm' })
    const after = (await (await app.request('/api/servers', { headers: headers(owner, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string; is_private: number }> }
    expect(after.servers.find((s) => s.id === row.server.id)?.is_private).toBe(1)

    // owner flips it back to public via PATCH
    await app.request(`/api/servers/${row.server.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(owner, 'PATCH', `/api/servers/${row.server.id}`, JSON.stringify({ private: false })) },
      body: JSON.stringify({ private: false }),
    }, env)
    const pub = (await (await app.request('/api/servers', { headers: headers(other, 'GET', '/api/servers') }, env)).json()) as { servers: Array<{ id: string }> }
    expect(pub.servers.some((s) => s.id === row.server.id)).toBe(true)
  })
})

// plan §5: central-node master admin over the directory (is_admin gate).
describe('Server directory admin API', () => {
  const master = createTestIdentity()
  const member = createTestIdentity()
  let env: Awaited<ReturnType<typeof createMockEnv>>

  async function hide(env: any, id: string, hidden: boolean) {
    const raw = JSON.stringify({ hidden })
    return app.request(`/api/servers/admin/directory/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(master, 'PATCH', `/api/servers/admin/directory/${id}`, raw) },
      body: raw,
    }, env)
  }

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: headers(master, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: headers(member, 'GET', '/api/users') }, env)
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(master.orbitId).run()
    await register(env, member, { name: 'Admin Probe', description: 'd', endpoint_hint: 'probe.test:8790', password_required: false })
  })

  it('rejects unauthenticated and non-admin callers', async () => {
    const anon = await app.request('/api/servers/admin/dashboard', {}, env)
    expect([401, 403]).toContain(anon.status)
    const asMember = await app.request('/api/servers/admin/dashboard', { headers: headers(member, 'GET', '/api/servers/admin/dashboard') }, env)
    expect(asMember.status).toBe(403)
  })

  it('master sees the dashboard totals', async () => {
    const res = await app.request('/api/servers/admin/dashboard', { headers: headers(master, 'GET', '/api/servers/admin/dashboard') }, env)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.totals.total).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(json.recent)).toBe(true)
  })

  it('directory listing exposes endpoint hints to the master', async () => {
    const res = await app.request('/api/servers/admin/directory', { headers: headers(master, 'GET', '/api/servers/admin/directory') }, env)
    const json = await res.json() as any
    expect(json.servers.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(json.servers)).toContain('probe.test')
    const probe = json.servers.find((s: any) => s.name === 'Admin Probe')
    expect('hidden' in probe).toBe(true)
    expect('blocked' in probe).toBe(true)
  })

  it('hiding an entry removes it from the public directory but not the admin one', async () => {
    const dir = (await (await app.request('/api/servers/admin/directory', { headers: headers(master, 'GET', '/api/servers/admin/directory') }, env)).json()) as any
    const id = dir.servers.find((s: any) => s.name === 'Admin Probe').id
    const patch = await hide(env, id, true)
    expect(patch.status).toBe(200)
    expect((await patch.json()).server.hidden).toBe(1)

    const pub = (await (await app.request('/api/servers', {}, env)).json()) as any
    expect(pub.servers.some((s: any) => s.id === id)).toBe(false)
    const adm = (await (await app.request('/api/servers/admin/directory', { headers: headers(master, 'GET', '/api/servers/admin/directory') }, env)).json()) as any
    expect(adm.servers.some((s: any) => s.id === id)).toBe(true)
  })

  it('master can force-unregister any entry', async () => {
    const dir = (await (await app.request('/api/servers/admin/directory', { headers: headers(master, 'GET', '/api/servers/admin/directory') }, env)).json()) as any
    const id = dir.servers.find((s: any) => s.name === 'Admin Probe').id
    const del = await app.request(`/api/servers/admin/directory/${id}`, { method: 'DELETE', headers: headers(master, 'DELETE', `/api/servers/admin/directory/${id}`) }, env)
    expect(del.status).toBe(200)
    const after = (await (await app.request('/api/servers/admin/directory', { headers: headers(master, 'GET', '/api/servers/admin/directory') }, env)).json()) as any
    expect(after.servers.some((s: any) => s.id === id)).toBe(false)
  })
})

describe('Server node API', () => {
  const host = createTestIdentity()
  const member = createTestIdentity()
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: headers(host, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: headers(member, 'GET', '/api/users') }, env)
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(host.orbitId).run()
  })

  it('defaults the node name to gmatch', async () => {
    const res = await app.request('/api/servers/node', { headers: headers(host, 'GET', '/api/servers/node') }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.name).toBe('gmatch')
    expect(body.isAdmin).toBe(true)
  })

  it('host admin can rename the node and dashboard reflects it', async () => {
    const raw = JSON.stringify({ name: 'Mateus World', description: 'fly node' })
    const patch = await app.request('/api/servers/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(host, 'PATCH', '/api/servers/node', raw) },
      body: raw,
    }, env)
    expect(patch.status).toBe(200)
    expect((await patch.json()).server.name).toBe('Mateus World')

    const dash = await app.request('/api/servers/dashboard', {}, env)
    const dashBody = (await dash.json()) as any
    expect(dashBody.name).toBe('Mateus World')
  })

  it('rejects non-admin node rename', async () => {
    const raw = JSON.stringify({ name: 'Hijack' })
    const res = await app.request('/api/servers/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(member, 'PATCH', '/api/servers/node', raw) },
      body: raw,
    }, env)
    expect(res.status).toBe(403)
  })

  it('node can remember its directory row id (create-server claim)', async () => {
    const did = 'a'.repeat(64)
    const raw = JSON.stringify({ directory_id: did.toUpperCase() })
    const patch = await app.request('/api/servers/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(host, 'PATCH', '/api/servers/node', raw) },
      body: raw,
    }, env)
    expect(patch.status).toBe(200)
    const get = await app.request('/api/servers/node', { headers: headers(host, 'GET', '/api/servers/node') }, env)
    expect((await get.json() as any).directoryId).toBe(did)

    const bad = JSON.stringify({ directory_id: 'not-a-dir-id' })
    const res = await app.request('/api/servers/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers(host, 'PATCH', '/api/servers/node', bad) },
      body: bad,
    }, env)
    expect(res.status).toBe(400)
  })
})
