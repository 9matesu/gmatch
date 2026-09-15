// Version-skew contract (fix/resilience wave): a NEWER client sending an
// unknown profile field must not 400 on an OLDER server, and an
// avatar/bio-only PATCH must work on an auth-created row that has no
// display_name yet. Essential mutations never break forward-compat.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { users } from './users'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function build(withName: boolean) {
  const env = await createMockEnv()
  const app = new Hono()
  app.use('*', async (c, next) => { c.env = env; return next() })
  app.route('/api/users', users)
  app.route('/api/objects', (await import('./objects')).objects)
  const id = createTestIdentity()
  if (withName) {
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)')
      .bind(id.orbitId, id.publicKeyHex, 'Skew Tester', new Date().toISOString()).run()
  } else {
    // Exact auth-middleware provisioning shape (middleware/auth.ts:164).
    await env.DB.prepare('INSERT INTO Users (id, public_key, last_seen) VALUES (?, ?, ?)')
      .bind(id.orbitId, id.publicKeyHex, new Date().toISOString()).run()
  }
  return { env, app, id }
}

function patchReq(id: ReturnType<typeof createTestIdentity>, body: string) {
  return { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', ...signRequestHeaders(id, 'PATCH', '/api/users/profile', body) } }
}

describe('profile PATCH forward-compat', () => {
  it('ignores unknown fields and still applies bio', async () => {
    const { env, app, id } = await build(true)
    const res = await app.request('/api/users/profile', patchReq(id, JSON.stringify({ bio: 'hello world', pronouns: 'they/them' })))
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT bio FROM Users WHERE id = ?').bind(id.orbitId).first<{ bio: string }>()
    expect(row?.bio).toBe('hello world')
  })

  it('sets pfp via object ref even when the row has no display_name', async () => {
    const { app, id } = await build(false)
    const form = new FormData()
    form.append('image', new File([Buffer.from(PNG_B64, 'base64')], 'a.png', { type: 'image/png' }))
    form.append('is_avatar', '1')
    const up = await app.request('/api/objects', { method: 'POST', body: form, headers: signRequestHeaders(id, 'POST', '/api/objects') })
    expect(up.status).toBe(201)
    const { id: objId } = await up.json() as { id: string }
    const res = await app.request('/api/users/profile', patchReq(id, JSON.stringify({ pfp_url: `/api/objects/${objId}` })))
    expect(res.status).toBe(200) // was 400 "Display name is required"
  })
})
