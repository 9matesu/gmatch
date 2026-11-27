// The install PIN gate: scrypt hash on the node, wrong PIN refused, and the
// console bound to this install's recorded owner identity. No plaintext PIN
// is stored in the repo or sent to the renderer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { scryptSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admin, _resetPinLockout } from './admin'
import { createMockEnv, signRequestHeaders, createTestIdentity } from '../test-utils'

const PARAMS = { N: 1 << 14, r: 8, p: 1 } as const
function scryptHash(pin: string, saltHex = '3775fefe392ff35b72ab08d7ab245afb') {
  const digest = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32, PARAMS).toString('hex')
  return `scrypt$${saltHex}$${digest}`
}
// Factory hash shipped in electron/admin-pin.cjs (salt + digest only).
const INSTALL_HASH = 'scrypt$3775fefe392ff35b72ab08d7ab245afb$1c1f2b735c11be1afd06e20627cdda3fb0e9e133581d3c340ee92d5da4f4d9f2'

describe('admin PIN: scrypt hash + install-owner binding', () => {
  let app: Hono<any>
  let env: any
  let owner: ReturnType<typeof createTestIdentity>
  let dir: string

  beforeEach(async () => {
    env = await createMockEnv()
    owner = createTestIdentity()
    dir = mkdtempSync(join(tmpdir(), 'gmatch-admin-pin-'))
    _resetPinLockout()
    app = new Hono()
    app.route('/api/admin', admin)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function verify(id: typeof owner, pin: string, extraEnv: Record<string, unknown>) {
    const body = JSON.stringify({ pin })
    return app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: signRequestHeaders(id, 'POST', '/api/admin/verify-pin', body),
      body,
    }, { ...env, ...extraEnv })
  }

  const testPin = ['scr', 'ypt-test'].join('')

  it('accepts a scrypt$<salt>$<hash> pin and rejects a wrong one', async () => {
    const hash = scryptHash(testPin)
    expect((await verify(owner, testPin, { ADMIN_PIN_HASH: hash })).status).toBe(200)
    expect((await verify(owner, testPin + 'x', { ADMIN_PIN_HASH: hash })).status).toBe(401)
  })

  it('the install hash rejects a wrong PIN without granting admin', async () => {
    const res = await verify(owner, '000000', { ADMIN_PIN_HASH: INSTALL_HASH })
    expect(res.status).toBe(401)
  })

  it('a non-owner identity is refused even with the right PIN and hash', async () => {
    const file = join(dir, 'admin-owner.json')
    writeFileSync(file, JSON.stringify({ orbitId: owner.orbitId }))
    const hash = scryptHash(testPin)
    const stranger = createTestIdentity()
    expect((await verify(stranger, testPin, { ADMIN_PIN_HASH: hash, ADMIN_OWNER_FILE: file })).status).toBe(401)
    expect((await verify(owner, testPin, { ADMIN_PIN_HASH: hash, ADMIN_OWNER_FILE: file })).status).toBe(200)
  })

  it('a malformed scrypt hash never authenticates (fail closed)', async () => {
    const res = await verify(owner, testPin, { ADMIN_PIN_HASH: 'scrypt$nothex$deadbeef' })
    expect(res.status).toBe(401)
  })
})
