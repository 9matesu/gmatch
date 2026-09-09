// Spy-feed gate: only the attacker of an ACTIVE hack may read the target's
// posts/PM peeks. The hack itself is purchased via /store/purchase (in-memory
// debuff), so this test drives the real purchase path.
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const attacker = createTestIdentity()
const victim = createTestIdentity()
const stranger = createTestIdentity()

function auth(who: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(who, method, url, body)
}

async function get(who: any, url: string, env: any) {
  return app.request(url, { headers: auth(who, 'GET', url) }, env)
}

describe('GET /api/users/hacks/spy-feed/:targetId', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeEach(async () => {
    env = await createMockEnv()
    // seed users (GET /api/users upserts on first signed call)
    await get(attacker, '/api/users', env)
    await get(victim, '/api/users', env)
    await get(stranger, '/api/users', env)
    // victim posts something public
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_public, caption, created_at) VALUES ('spy-post-1', ?, 100, 'image/jpeg', 1, 'my secret deck', '2026-09-01T12:00:00Z')",
    ).bind(victim.orbitId).run()
    await env.DB.prepare(
      "INSERT INTO PrivateMessages (id, sender_id, recipient_id, body, created_at) VALUES ('spy-pm-1', ?, ?, 'lock in my secret deck strategies', '2026-09-01T12:30:00Z')",
    ).bind(victim.orbitId, attacker.orbitId).run()
  })

  it('403 without an active hack session', async () => {
    const res = await get(attacker, `/api/users/hacks/spy-feed/${victim.orbitId}`, env)
    expect(res.status).toBe(403)
  })

  it('403 for a stranger even if a hack exists', async () => {
    const res = await get(stranger, `/api/users/hacks/spy-feed/${victim.orbitId}`, env)
    expect(res.status).toBe(403)
  })

  it('200 with real data after buying a hack', async () => {
    // fund + buy the deny hack against the victim (store purchase registers the debuff)
    const { EconomyService } = await import('../economy')
    await new EconomyService(env.DB).credit(attacker.orbitId, 50_000, {
      idempotencyKey: 'fund-spy-test', kind: 'reward', reference: 'test',
    })
    // victim must be "online" (last_seen within 60s) and opted in to hacks
    await env.DB.prepare('UPDATE Users SET last_seen = ?, pc_domination_settings = ? WHERE id = ?')
      .bind(new Date().toISOString(), JSON.stringify({ allowHacks: true }), victim.orbitId).run()
    const buyBody = JSON.stringify({ item_id: 'item-hack-deny', target_id: victim.orbitId, idempotency_key: 'spy-buy-1' })
    const buy = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', '/api/users/store/purchase', buyBody) },
      body: buyBody,
    }, env)
    expect(buy.status).toBe(200)

    const res = await get(attacker, `/api/users/hacks/spy-feed/${victim.orbitId}`, env)
    expect(res.status).toBe(200)
    const j = await res.json() as any
    expect(j.hack.type).toBe('deny')
    expect(j.target.id).toBe(victim.orbitId)
    expect(j.posts.some((p: any) => p.caption === 'my secret deck')).toBe(true)
    expect(j.intercepted.some((m: any) => m.body.includes('secret deck'))).toBe(true)
  })
})
