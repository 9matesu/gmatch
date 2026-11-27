import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import domination from './domination'
import { purgeDeadDominationUsers, DEAD_DOMINATION_HANDLES } from '../../scripts/purge-dead-domination-users'
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

  it('drops blank / default-placeholder ("Unknown") names from /targets', async () => {
    const blank = createTestIdentity()
    const placeholder = createTestIdentity()
    const sql = "INSERT INTO Users (id, public_key, display_name, pc_domination_enabled, last_seen) VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    await env.DB.prepare(sql).bind(blank.orbitId, blank.publicKeyHex, '   ').run()
    await env.DB.prepare(sql).bind(placeholder.orbitId, placeholder.publicKeyHex, 'Unknown User').run()
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(userB.orbitId).run()

    const res = await app.request('/api/domination/targets', {
      headers: auth(userA, 'GET', '/api/domination/targets'),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    const ids = json.targets.map((t: any) => t.id)
    expect(ids).toContain(userB.orbitId)
    expect(ids).not.toContain(blank.orbitId)
    expect(ids).not.toContain(placeholder.orbitId)
  })
})
describe('domination is fully free (zero wallet writes)', () => {
  let app: Hono
  let env: { DB: any }
  let userA: TestIdentity
  let userB: TestIdentity

  // Each action's payload must satisfy its consent + wire schema.
  const ACTIONS: Record<string, unknown> = {
    wallpaper: { url: 'https://example.com/a.jpg' },
    game_bg: { url: 'https://example.com/b.jpg' },
    popup_video: { url: 'https://example.com/c.mp4' },
    message: { text: 'hi' },
    text_overlay: { text: 'hi', position: 'top' },
    blur: { intensity: 8 },
    camera: { quality: 0.8 },
  }

  beforeEach(async () => {
    env = await createMockEnv()
    userA = createTestIdentity()
    userB = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userA.orbitId, userA.publicKeyHex, 'UserA').run()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userB.orbitId, userB.publicKeyHex, 'UserB').run()
    app = new Hono()
    app.use('*', async (c2, next) => { c2.env = env as any; await next() })
    app.route('/api/domination', domination)
  })

  function auth(identity: TestIdentity, method: string, path: string, body = '') {
    return signRequestHeaders(identity, method, path, body)
  }

  async function walletWrites() {
    const [wallets, ledger, ops] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) n FROM Wallets').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) n FROM LedgerTransactions').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) n FROM EconomicOperations').first<{ n: number }>(),
    ])
    return { wallets: Number(wallets?.n ?? 0), ledger: Number(ledger?.n ?? 0), ops: Number(ops?.n ?? 0) }
  }

  it('sends every action with zero wallet, ledger or economy-operation writes', async () => {
    const consents = {
      allowDesktopBackgroundChange: true,
      allowGameBackgroundChange: true,
      allowPopupVideo: true,
      allowPopupMessage: true,
      allowTextOverlay: true,
      allowBlurEverything: true,
      allowRemoteCamera: true,
    }
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(JSON.stringify(consents), userB.orbitId).run()
    expect(await walletWrites()).toEqual({ wallets: 0, ledger: 0, ops: 0 })

    for (const [action, payload] of Object.entries(ACTIONS)) {
      const body = JSON.stringify({ targetId: userB.orbitId, action, payload })
      const res = await app.request('/api/domination/trigger', {
        method: 'POST', headers: auth(userA, 'POST', '/api/domination/trigger', body), body,
      })
      expect(res.status, action).toBe(200)
      const json = await res.json() as any
      expect(json).toMatchObject({ success: true, actionId: expect.any(String) })
      expect(json).not.toHaveProperty('cost')
      expect(json).not.toHaveProperty('victimReward')
    }

    expect(await walletWrites()).toEqual({ wallets: 0, ledger: 0, ops: 0 })
    const recorded = await env.DB.prepare('SELECT COUNT(*) n FROM DominationActions').first<{ n: number }>()
    expect(Number(recorded?.n)).toBe(Object.keys(ACTIONS).length)
  })

  it('no longer serves a prices table', async () => {
    const res = await app.request('/api/domination/prices', { headers: auth(userA, 'GET', '/api/domination/prices') })
    expect(res.status).toBe(404)
  })

  it('GET /api/domination/targets exposes an online flag per target', async () => {
    await env.DB.prepare("UPDATE Users SET pc_domination_enabled = 1, display_name = 'OnlineOne', last_seen = ? WHERE id = ?")
      .bind(new Date().toISOString(), userB.orbitId).run()
    const res = await app.request('/api/domination/targets', { headers: auth(userA, 'GET', '/api/domination/targets') })
    const j = await res.json() as any
    const t = j.targets.find((x: any) => x.id === userB.orbitId)
    expect(t.online).toBe(true)
    expect(t.last_seen).toBeTruthy()
  })

  it('POST /api/domination/ack/:id marks the action delivered for its victim only', async () => {
    await env.DB.prepare('UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ?, last_seen = ? WHERE id = ?')
      .bind(JSON.stringify({ allowPopupMessage: true }), new Date().toISOString(), userB.orbitId).run()
    const body = JSON.stringify({ targetId: userB.orbitId, action: 'message', payload: { text: 'yo' } })
    const trig = await app.request('/api/domination/trigger', {
      method: 'POST', headers: auth(userA, 'POST', '/api/domination/trigger', body), body,
    })
    expect(trig.status).toBe(200)
    const { actionId } = await trig.json() as any
    // stranger cannot ack
    const userC = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userC.orbitId, userC.publicKeyHex, 'UserC').run()
    const bad = await app.request(`/api/domination/ack/${actionId}`, {
      method: 'POST', headers: auth(userC, 'POST', `/api/domination/ack/${actionId}`),
    })
    expect([403, 404]).toContain(bad.status)
    // the victim acks: status flips to executed
    const ok = await app.request(`/api/domination/ack/${actionId}`, {
      method: 'POST', headers: auth(userB, 'POST', `/api/domination/ack/${actionId}`),
    })
    expect(ok.status).toBe(200)
    const row = await env.DB.prepare('SELECT status, executed_at FROM DominationActions WHERE id = ?').bind(actionId).first<any>()
    expect(row.status).toBe('executed')
    expect(row.executed_at).toBeTruthy()
    // outgoing list now shows it as executed
    const out = await app.request('/api/domination/outgoing', { headers: auth(userA, 'GET', '/api/domination/outgoing') })
    const oj = await out.json() as any
    expect(oj.actions.find((a: any) => a.id === actionId).status).toBe('executed')
  })
})

describe('dead domination users purge', () => {
  it('removes both named handles and their domination rows, then no-ops', async () => {
    const env = await createMockEnv()
    const pairs: Array<{ id: string; displayName: string }> = []
    for (const handle of DEAD_DOMINATION_HANDLES) {
      const u = createTestIdentity()
      pairs.push({ id: u.orbitId, displayName: handle })
      await env.DB.prepare("INSERT INTO Users (id, public_key, display_name, pc_domination_enabled, last_seen) VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(u.orbitId, u.publicKeyHex, handle).run()
      await env.DB.prepare('INSERT INTO DominationActions (id, dominator_id, victim_id, action, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`dom-${handle}`, u.orbitId, u.orbitId, 'message', 'sent', new Date().toISOString()).run()
    }
    const real = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(real.orbitId, real.publicKeyHex, 'RealPlayer').run()

    const first = await purgeDeadDominationUsers(env.DB, pairs)
    expect(first.deleted.sort()).toEqual(pairs.map((p) => p.id).sort())
    const survivors = await env.DB.prepare('SELECT id FROM Users').all<{ id: string }>()
    expect(survivors.results.map((r) => r.id)).toEqual([real.orbitId])
    const actions = await env.DB.prepare('SELECT id FROM DominationActions').all<{ id: string }>()
    expect(actions.results).toEqual([])

    const second = await purgeDeadDominationUsers(env.DB, pairs)
    expect(second.deleted).toEqual([])
    expect(second.missing.sort()).toEqual(pairs.map((p) => p.id).sort())
    expect((await env.DB.prepare('SELECT id FROM Users').all<{ id: string }>()).results.map((r) => r.id)).toEqual([real.orbitId])
  })

  it('never deletes a real account whose name only collides by case/trailing space', async () => {
    const env = await createMockEnv()
    const pairs: Array<{ id: string; displayName: string }> = []
    for (const handle of DEAD_DOMINATION_HANDLES) {
      const u = createTestIdentity()
      pairs.push({ id: u.orbitId, displayName: handle })
      await env.DB.prepare("INSERT INTO Users (id, public_key, display_name, pc_domination_enabled, last_seen) VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(u.orbitId, u.publicKeyHex, handle).run()
    }
    // A REAL player whose name differs only by UPPERCASE + a trailing space:
    // LOWER(TRIM(display_name)) collides with the first dead handle, but the
    // explicit id pair for the dead user must not match this row.
    const real = createTestIdentity()
    const realName = `${DEAD_DOMINATION_HANDLES[0].toUpperCase()} `
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(real.orbitId, real.publicKeyHex, realName).run()
    await env.DB.prepare('INSERT INTO Wallets (user_id, balance) VALUES (?, 1234)').bind(real.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
      .bind(`obj-${real.orbitId}`, real.orbitId, 100, 'image/jpeg').run()

    const first = await purgeDeadDominationUsers(env.DB, pairs)
    expect(first.deleted.sort()).toEqual(pairs.map((p) => p.id).sort())

    // The real user and its wallet + object rows survive untouched.
    const survivor = await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind(real.orbitId).first<{ id: string }>()
    expect(survivor?.id).toBe(real.orbitId)
    const wallet = await env.DB.prepare('SELECT balance FROM Wallets WHERE user_id = ?').bind(real.orbitId).first<{ balance: number }>()
    expect(wallet?.balance).toBe(1234)
    const object = await env.DB.prepare('SELECT id FROM Objects WHERE id = ?').bind(`obj-${real.orbitId}`).first<{ id: string }>()
    expect(object?.id).toBe(`obj-${real.orbitId}`)

    // A second purge changes nothing.
    const second = await purgeDeadDominationUsers(env.DB, pairs)
    expect(second.deleted).toEqual([])
    const stillThere = await env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind(real.orbitId).first<{ id: string }>()
    expect(stillThere?.id).toBe(real.orbitId)
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM Objects').first<{ n: number }>()).toMatchObject({ n: 1 })
  })
})
