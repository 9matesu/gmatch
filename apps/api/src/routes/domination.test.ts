import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import domination from './domination'
import { economy } from './economy'
import { economyIdle } from './economy-idle'
import { EconomyService } from '../economy'
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
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
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
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(JSON.stringify({ allowDesktopBackgroundChange: true, allowBlurEverything: true }), userB.orbitId).run()

    // trigger now costs g$ — fund the dominator first
    await new EconomyService(env.DB).credit(userA.orbitId, 10_000, {
      idempotencyKey: 'fund-dom-success', kind: 'reward', reference: 'test-fund',
    })

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
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
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
describe('domination economy (cost + victim payout)', () => {
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
    app.use('*', async (c2, next) => { c2.env = env as any; await next() })
    app.route('/api/domination', domination)
    app.route('/api/economy', economy)
    app.route('/api/economy', economyIdle)
  })

  function auth(identity: TestIdentity, method: string, path: string, body = '') {
    return signRequestHeaders(identity, method, path, body)
  }

  async function fund(identity: TestIdentity, amount: number) {
    await new EconomyService(env.DB).credit(identity.orbitId, amount, {
      idempotencyKey: `fund-${identity.orbitId}-${Math.random().toString(36).slice(2, 10)}`,
      kind: 'reward',
      reference: 'test-fund',
    })
  }

  async function balance(identity: TestIdentity): Promise<number> {
    const res = await app.request('/api/economy/balance', { headers: auth(identity, 'GET', '/api/economy/balance') })
    const j = await res.json() as any
    return Number(j.balance)
  }

  it('trigger debits the dominator and pays the victim a consent cut', async () => {
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(JSON.stringify({ allowPopupMessage: true }), userB.orbitId).run()
    await fund(userA, 10_000)
    const before = await balance(userA)
    const body = JSON.stringify({ targetId: userB.orbitId, action: 'message', payload: { text: 'hi' } })
    const res = await app.request('/api/domination/trigger', {
      method: 'POST', headers: auth(userA, 'POST', '/api/domination/trigger', body), body,
    })
    expect(res.status).toBe(200)
    const j = await res.json() as any
    expect(j.cost).toBe(500)
    expect(j.victimReward).toBe(200)
    expect(await balance(userA)).toBe(before - j.cost)
    expect(await balance(userB)).toBe(j.victimReward)
  })

  it('trigger fails with 402 when the dominator cannot pay', async () => {
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(JSON.stringify({ allowPopupMessage: true }), userB.orbitId).run()
    const body = JSON.stringify({ targetId: userB.orbitId, action: 'message', payload: { text: 'hi' } })
    const res = await app.request('/api/domination/trigger', {
      method: 'POST', headers: auth(userA, 'POST', '/api/domination/trigger', body), body,
    })
    expect(res.status).toBe(402)
    const j = await res.json() as any
    expect(j.error).toMatch(/not enough/i)
    expect(j.cost).toBe(500)
    // victim must NOT be paid when the charge failed
    expect(await balance(userB)).toBe(0)
  })

  it('GET /api/domination/prices returns the action cost table', async () => {
    const res = await app.request('/api/domination/prices', { headers: auth(userA, 'GET', '/api/domination/prices') })
    expect(res.status).toBe(200)
    const j = await res.json() as any
    expect(j.prices.message).toBe(500)
    expect(j.prices.camera).toBeGreaterThan(j.prices.message)
  })
})
