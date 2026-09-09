// T5: optional server password. The hash lives ONLY on the node (host machine
// SystemMeta row); verification issues a per-orbitId in-memory token; 5 wrong
// attempts lock verify for 15 minutes; existing members are grandfathered.
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { resetPasswordStateForTests } from '../routes/password'

const host = createTestIdentity()
const newcomer = createTestIdentity()
const stranger = createTestIdentity()

async function register(env: any, id: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
}

function setPw(id: ReturnType<typeof createTestIdentity>, body: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(id, 'POST', '/api/server/password', body) }
}

describe('server password (T5)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeEach(async () => {
    resetPasswordStateForTests()
    env = await createMockEnv()
    await register(env, host)
    await register(env, newcomer)
    // flag host as admin so /password accepts it
    await env.DB.prepare('UPDATE Users SET is_admin = 1 WHERE id = ?').bind(host.orbitId).run()
  })

  it('status: enabled false by default; anon set -> 401', async () => {
    const st = await (await app.request('/api/server/password-status', {}, env)).json()
    expect((st as { enabled: boolean }).enabled).toBe(false)
    const pwBody = JSON.stringify({'password': 'hunter2' })
    const anon = await app.request('/api/server/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pwBody,
    }, env)
    expect(anon.status).toBe(401)
  })

  it('admin sets password -> enabled; empty body clears it', async () => {
    const pwBody = JSON.stringify({'password': 'hunter2' })
    const res = await app.request('/api/server/password', {
      method: 'POST', headers: setPw(host, pwBody), body: pwBody,
    }, env)
    expect(res.status).toBe(200)
    expect(((await app.request('/api/server/password-status', {}, env)).status)).toBe(200)
    const st = (await (await app.request('/api/server/password-status', {}, env)).json()) as { enabled: boolean }
    expect(st.enabled).toBe(true)
    const clear = await app.request('/api/server/password', {
      method: 'POST', headers: setPw(host, ''), body: '',
    }, env)
    expect(clear.status).toBe(200)
    const st2 = (await (await app.request('/api/server/password-status', {}, env)).json()) as { enabled: boolean }
    expect(st2.enabled).toBe(false)
  })

  it('5 wrong verifies lock the caller for 15 min (429)', async () => {
    const pwBody = JSON.stringify({'password': 'hunter2' })
    await app.request('/api/server/password', { method: 'POST', headers: setPw(host, pwBody), body: pwBody }, env)
    // the 5th wrong attempt arms the lock; the next call is refused with 429
    let last: Response | undefined
    for (let i = 0; i < 6; i++) {
      const bad = JSON.stringify({'password': 'wrong' })
      last = await app.request('/api/server/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signRequestHeaders(stranger, 'POST', '/api/server/verify', bad) },
        body: bad,
      }, env)
    }
    expect(last!.status).toBe(429)
    expect(((await last!.json()) as { error: string }).error).toMatch(/locked/i)
  })

  it('gate: stranger posting a protected route WITHOUT verify -> 403 code', async () => {
    const pwBody = JSON.stringify({'password': 'hunter2' })
    await app.request('/api/server/password', { method: 'POST', headers: setPw(host, pwBody), body: pwBody }, env)
    // stranger has NEVER verified — a signed POST to a protected mutation is
    // rejected by the GATE before orbitAuth even auto-creates their row.
    const path = '/api/users/' + host.orbitId + '/follow'
    const denied = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(stranger, 'POST', path, '{}') },
      body: '{}',
    }, env)
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { code: string }).code).toBe('SERVER_PASSWORD_REQUIRED')

    // host (grandfathered in the epoch snapshot) still reaches the route
    // (follows themselves → app-level 4xx, but NOT the gate's 403)
    const okPath = '/api/users/' + newcomer.orbitId + '/follow'
    const ok = await app.request(okPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(host, 'POST', okPath, '{}') },
      body: '{}',
    }, env)
    expect(ok.status).not.toBe(403)
  })

  it('correct verify issues a token; gate exempts old members', async () => {
    const pwBody = JSON.stringify({'password': 'hunter2' })
    await app.request('/api/server/password', { method: 'POST', headers: setPw(host, pwBody), body: pwBody }, env)
    const ok = JSON.stringify({'password': 'hunter2' })
    const verifyRes = await app.request('/api/server/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(newcomer, 'POST', '/api/server/verify', ok) },
      body: ok,
    }, env)
    expect(verifyRes.status).toBe(200)
    // Verification is PERSISTED on the node (survives restarts): a later
    // signed write by this user must pass the gate without any extra header.
    const writePath = '/api/users/' + host.orbitId + '/follow'
    const passed = await app.request(writePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(newcomer, 'POST', writePath, '{}') },
      body: '{}',
    }, env)
    expect(passed.status).not.toBe(403)
  })
})