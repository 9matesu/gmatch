// Security plan B.4 / F4: no hardcoded admin PIN, hashed comparison, lockout.
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { admin, _resetPinLockout } from './admin'
import { createMockEnv, signRequestHeaders, createTestIdentity } from '../test-utils'

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('B.4 — admin PIN hardening', () => {
  let app: Hono<any>
  let env: any
  let adminId: ReturnType<typeof createTestIdentity>

  beforeEach(async () => {
    env = await createMockEnv()
    adminId = createTestIdentity()
    _resetPinLockout()
    app = new Hono()
    app.route('/api/admin', admin)
  })

  async function postPin(pin: string, extraEnv?: Record<string, unknown>) {
    return app.request(
      '/api/admin/verify-pin',
      {
        method: 'POST',
        headers: signRequestHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin })),
        body: JSON.stringify({ pin }),
      },
      { ...env, ...extraEnv },
    )
  }

  it('no ADMIN_PIN / ADMIN_PIN_HASH configured → 503 (feature disabled, no default)', async () => {
    const res = await postPin('anything')
    expect(res.status).toBe(503)
    // the old hardcoded default MUST NOT authenticate
    const resDefault = await postPin('Ionwarehouse1')
    expect(resDefault.status).toBe(503)
  })

  it('ADMIN_PIN_HASH: correct pin 200 + grants admin; wrong pin 401', async () => {
    const hash = await sha256hex('s3cret-pin')
    const ok = await postPin('s3cret-pin', { ADMIN_PIN_HASH: hash })
    expect(ok.status).toBe(200)
    const bad = await postPin('wrong', { ADMIN_PIN_HASH: hash })
    expect(bad.status).toBe(401)
  })

  it('plaintext ADMIN_PIN still works (dev/self-host convenience)', async () => {
    const res = await postPin('dev-pin', { ADMIN_PIN: 'dev-pin' })
    expect(res.status).toBe(200)
  })

  it('lockout: 5 wrong attempts → 429 even with the CORRECT pin afterwards', async () => {
    const hash = await sha256hex('right')
    for (let i = 0; i < 5; i++) {
      const r = await postPin('wrong' + i, { ADMIN_PIN_HASH: hash })
      expect(r.status).toBe(401)
    }
    const locked = await postPin('right', { ADMIN_PIN_HASH: hash })
    expect(locked.status).toBe(429)
  })

  it('success clears the failure window', async () => {
    const hash = await sha256hex('right')
    for (let i = 0; i < 4; i++) await postPin('wrong', { ADMIN_PIN_HASH: hash })
    expect((await postPin('right', { ADMIN_PIN_HASH: hash })).status).toBe(200)
    // 4 more wrong after the success must not lock (window was reset)
    for (let i = 0; i < 4; i++) await postPin('wrong', { ADMIN_PIN_HASH: hash })
    expect((await postPin('right', { ADMIN_PIN_HASH: hash })).status).toBe(200)
  })

  it('source scan: the old hardcoded fallback is gone from the repo', () => {
    const src = readFileSync(join(__dirname, 'admin.ts'), 'utf8')
    expect(src).not.toMatch(/Ionw\w+/)
  })

  // Wave 2 (E1): PIN + allowlisted identity, or nothing.
  it('ADMIN_ORBIT_ID set: correct PIN from a NON-admin identity → 401 + lockout counts', async () => {
    const hash = await sha256hex('s3cret')
    const intruder = createTestIdentity()
    const req = (id: typeof adminId) => app.request(
      '/api/admin/verify-pin',
      { method: 'POST', headers: signRequestHeaders(id, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 's3cret' })), body: JSON.stringify({ pin: 's3cret' }) },
      { ...env, ADMIN_PIN_HASH: hash, ADMIN_ORBIT_ID: adminId.orbitId },
    )
    expect((await req(intruder)).status).toBe(401)
    // 5 attempts → the intruder is locked out like any pin-guesser
    for (let i = 0; i < 4; i++) expect((await req(intruder)).status).toBe(401)
    expect((await req(intruder)).status).toBe(429)
    // the real admin still passes
    expect((await req(adminId)).status).toBe(200)
  })
})
