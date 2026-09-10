// Security plan B.7 / F10: signed object URLs — 15-minute TTL, single-use jti.
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { objects } from './objects'
import { createSignedObjectToken, verifySignedObjectToken, DEFAULT_SIGNED_TTL_SECONDS, _resetUsedJtis } from '../crypto'
import { createMockEnv, createTestIdentity, signRequestHeaders, type TestIdentity } from '../test-utils'

describe('B.7 — signed URL hardening', () => {
  let app: Hono<any>
  let env: any
  let owner: TestIdentity
  let objId: string

  beforeEach(async () => {
    env = await createMockEnv()
    _resetUsedJtis()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.env = env
      return next()
    })
    app.route('/api/objects', objects)
    owner = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, is_admin) VALUES (?, ?, 0)')
      .bind(owner.orbitId, owner.publicKeyHex)
      .run()
    objId = 'obj-sig-' + Date.now()
    await env.DB.prepare(
      `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story)
       VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 0, 0)`,
    )
      .bind(objId, owner.orbitId)
      .run()
  })

  it('default TTL is 15 minutes (900s)', () => {
    expect(DEFAULT_SIGNED_TTL_SECONDS).toBe(900)
    const { exp } = createSignedObjectToken(objId)
    const delta = exp - Math.floor(Date.now() / 1000)
    expect(delta).toBeGreaterThan(890)
    expect(delta).toBeLessThanOrEqual(900)
  })

  it('token carries a jti; verification requires it', () => {
    const { sig, exp, jti } = createSignedObjectToken(objId)
    expect(jti).toMatch(/^[0-9a-f]{16,}$/)
    expect(verifySignedObjectToken(objId, sig, exp, jti)).toBe(true)
    expect(verifySignedObjectToken(objId, sig, exp, '')).toBe(false) // old URLs without jti are dead
    expect(verifySignedObjectToken(objId, sig, exp, jti.toUpperCase())).toBe(false)
  })

  it('single-use: the SECOND verification of the same jti fails', () => {
    const { sig, exp, jti } = createSignedObjectToken(objId)
    expect(verifySignedObjectToken(objId, sig, exp, jti)).toBe(true)
    expect(verifySignedObjectToken(objId, sig, exp, jti)).toBe(false)
  })

  it('route: GET with fresh sig+exp+jti → 200; replay → 401; missing jti → 401', async () => {
    const { sig, exp, jti } = createSignedObjectToken(objId)
    const ok = await app.request(`/api/objects/${objId}?sig=${sig}&exp=${exp}&jti=${jti}`, { method: 'GET' })
    expect(ok.status).toBe(200)
    const replay = await app.request(`/api/objects/${objId}?sig=${sig}&exp=${exp}&jti=${jti}`, { method: 'GET' })
    expect(replay.status).toBe(401)
    const legacy = createSignedObjectToken(objId)
    const noJti = await app.request(`/api/objects/${objId}?sig=${legacy.sig}&exp=${legacy.exp}`, { method: 'GET' })
    expect(noJti.status).toBe(401)
  })

  it('mint endpoint returns a jti-bearing URL', async () => {
    const headers = signRequestHeaders(owner, 'GET', `/api/objects/${objId}/signed-url`)
    const res = await app.request(`/api/objects/${objId}/signed-url`, { method: 'GET', headers })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { url: string; jti?: string }
    expect(data.jti).toMatch(/^[0-9a-f]{16,}$/)
    expect(data.url).toContain(`jti=${data.jti}`)
    // and the minted URL actually works exactly once
    const first = await app.request(data.url, { method: 'GET' })
    expect(first.status).toBe(200)
    const second = await app.request(data.url, { method: 'GET' })
    expect(second.status).toBe(401)
  })

  it('expired token fails even with unused jti', () => {
    const { sig, jti } = createSignedObjectToken(objId, 900)
    const past = Math.floor(Date.now() / 1000) - 5
    expect(verifySignedObjectToken(objId, sig, past, jti)).toBe(false)
  })
})
