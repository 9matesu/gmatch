import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import domination from './domination'
import { createMockEnv, type TestIdentity, createTestIdentity, signRequestHeaders } from '../test-utils'

describe('domination routes', () => {
  let app: Hono
  let env: { DB: any }
  let userA: TestIdentity
  let userB: TestIdentity

  beforeEach(async () => {
    env = await createMockEnv()
    userA = createTestIdentity()
    userB = createTestIdentity()

    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userA.orbitId, userA.publicKeyHex, 'UserA').run()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userB.orbitId, userB.publicKeyHex, 'UserB').run()

    app = new Hono()
    app.use('*', async (c, next) => {
      c.env = env as any
      await next()
    })
    app.route('/api/domination', domination)
  })

  function auth(identity: TestIdentity, method: string, path: string, body = '') {
    return signRequestHeaders(identity, method, path, body)
  }

  it('GET /api/domination/settings returns default settings', async () => {
    const res = await app.request('/api/domination/settings', {
      headers: auth(userA, 'GET', '/api/domination/settings'),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.enabled).toBe(false)
    expect(json.settings).toEqual({})
  })

  it('PUT /api/domination/settings updates consent and master state', async () => {
    const payload = {
      enabled: true,
      settings: {
        allowDesktopBackgroundChange: true,
        allowPopupVideo: true,
        allowBlurEverything: true,
      },
    }
    const res = await app.request('/api/domination/settings', {
      method: 'PUT',
      headers: auth(userA, 'PUT', '/api/domination/settings', JSON.stringify(payload)),
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(200)

    const check = await app.request('/api/domination/settings', {
      headers: auth(userA, 'GET', '/api/domination/settings'),
    })
    const json = await check.json() as any
    expect(json.enabled).toBe(true)
    expect(json.settings.allowDesktopBackgroundChange).toBe(true)
    expect(json.settings.allowPopupVideo).toBe(true)
  })

  it('POST /api/domination/trigger rejects targeting yourself', async () => {
    const res = await app.request('/api/domination/trigger', {
      method: 'POST',
      headers: auth(userA, 'POST', '/api/domination/trigger', JSON.stringify({ targetId: userA.orbitId, action: 'blur' })),
      body: JSON.stringify({ targetId: userA.orbitId, action: 'blur' }),
    })
    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error).toContain('Cannot target yourself')
  })

  it('POST /api/domination/trigger blocks if victim has not enabled domination', async () => {
    const res = await app.request('/api/domination/trigger', {
      method: 'POST',
      headers: auth(userA, 'POST', '/api/domination/trigger', JSON.stringify({ targetId: userB.orbitId, action: 'blur' })),
      body: JSON.stringify({ targetId: userB.orbitId, action: 'blur' }),
    })
    expect(res.status).toBe(403)
    const json = await res.json() as any
    expect(json.error).toContain('Target has not enabled PC Domination')
  })

  it('POST /api/domination/trigger blocks if victim lacks specific action consent', async () => {
    // Enable for victim B, but only for wallpaper
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ? WHERE id = ?")
      .bind(JSON.stringify({ allowDesktopBackgroundChange: true }), userB.orbitId).run()

    const res = await app.request('/api/domination/trigger', {
      method: 'POST',
      headers: auth(userA, 'POST', '/api/domination/trigger', JSON.stringify({ targetId: userB.orbitId, action: 'blur' })),
      body: JSON.stringify({ targetId: userB.orbitId, action: 'blur' }),
    })
    expect(res.status).toBe(403)
    const json = await res.json() as any
    expect(json.error).toContain('Target has not consented to blur')
  })

  it('POST /api/domination/trigger succeeds when target consents', async () => {
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ? WHERE id = ?")
      .bind(JSON.stringify({ allowDesktopBackgroundChange: true, allowBlurEverything: true }), userB.orbitId).run()

    const res = await app.request('/api/domination/trigger', {
      method: 'POST',
      headers: auth(userA, 'POST', '/api/domination/trigger', JSON.stringify({
        targetId: userB.orbitId,
        action: 'blur',
        payload: { intensity: 10, duration: 5000 },
      })),
      body: JSON.stringify({
        targetId: userB.orbitId,
        action: 'blur',
        payload: { intensity: 10, duration: 5000 },
      }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.actionId).toBeDefined()

    // Verify recorded in history for victim
    const hist = await app.request('/api/domination/history', {
      headers: auth(userB, 'GET', '/api/domination/history'),
    })
    const histJson = await hist.json() as any
    expect(histJson.actions.length).toBe(1)
    expect(histJson.actions[0].action).toBe('blur')

    // Verify recorded in outgoing for dominator
    const out = await app.request('/api/domination/outgoing', {
      headers: auth(userA, 'GET', '/api/domination/outgoing'),
    })
    const outJson = await out.json() as any
    expect(outJson.actions.length).toBe(1)
    expect(outJson.actions[0].victim_id).toBe(userB.orbitId)
  })

  it('GET /api/domination/targets returns list with consent metadata', async () => {
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ? WHERE id = ?")
      .bind(JSON.stringify({ allowPopupVideo: true }), userB.orbitId).run()

    const res = await app.request('/api/domination/targets', {
      headers: auth(userA, 'GET', '/api/domination/targets'),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.targets.length).toBe(1)
    expect(json.targets[0].id).toBe(userB.orbitId)
    expect(json.targets[0].enabled).toBe(true)
    expect(json.targets[0].consents.allowPopupVideo).toBe(true)
  })
})
