// Security plan B.2 / F2: no user-visible content may be cacheable.
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { objects } from './objects'
import { lobby } from './lobby'
import { babecock } from './babecock'
import { users } from './users'
import { createSignedObjectToken } from '../crypto'
import { createMockEnv, createTestIdentity, type TestIdentity } from '../test-utils'

const NO_STORE = 'no-store'

describe('B.2 — content responses are no-store', () => {
  let app: Hono<any>
  let env: any
  let owner: TestIdentity
  let objId: string

  beforeEach(async () => {
    env = await createMockEnv()
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
    objId = 'obj-nostore-' + Date.now()
    await env.DB.prepare(
      `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, is_story)
       VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,dGVzdA==', 1, 0)`,
    )
      .bind(objId, owner.orbitId)
      .run()
  })

  it('GET object (public, data-url inline path) → Cache-Control no-store', async () => {
    const res = await app.request(`/api/objects/${objId}`, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(NO_STORE)
  })

  it('GET object via signed token → no-store (HMAC-URL streaming must not cache either)', async () => {
    const { sig, exp, jti } = createSignedObjectToken(objId, 900)
    const res = await app.request(`/api/objects/${objId}?sig=${sig}&exp=${exp}&jti=${jti}`, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(NO_STORE)
  })

  // Static guard: the other three routers' media endpoints need heavy seeding
  // to hit at runtime; assert at the source level that NO long-lived
  // Cache-Control literal survives in any file that serves user content.
  it('source scan: no `max-age=` Cache-Control left in content routes', () => {
    for (const [mod, file] of [
      [objects, 'objects.ts'],
      [lobby, 'lobby.ts'],
      [babecock, 'babecock.ts'],
      [users, 'users.ts'],
    ] as const) {
      void mod
      const src = readFileSync(join(__dirname, file), 'utf8')
      const hits = src
        .split(/\r?\n/)
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /Cache-Control/i.test(l) && /max-age=(?!0)/.test(l))
      expect(hits, `${file} still sets long-lived Cache-Control: ${JSON.stringify(hits.map((h) => h.i + 1))}`).toEqual([])
    }
  })

  it('source scan: every Cache-Control in those files is no-store', () => {
    for (const file of ['objects.ts', 'lobby.ts', 'babecock.ts', 'users.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8')
      for (const line of src.split(/\r?\n/)) {
        if (/Cache-Control/i.test(line)) {
          expect(line).toContain(NO_STORE)
        }
      }
    }
  })
})
