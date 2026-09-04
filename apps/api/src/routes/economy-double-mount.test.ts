// Regression: /api/economy hosts TWO sub-apps (economy + economyIdle), each
// mounting orbitAuth. Before the idempotency guard, a POST with a client
// nonce was authenticated twice: the first pass consumed the nonce, the
// second rejected it as replay -> 401 "Nonce already used". The live Electron
// sidecar hit exactly this on every idle-credit (walletBridge sync).
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { economy } from './economy'
import { economyIdle, __resetIdleThrottle } from './economy-idle'
import { createMockEnv, createTestIdentity } from '../test-utils'
import { signMessage } from '@orbit/crypto'
import { bytesToHex } from '@noble/hashes/utils'

const who = createTestIdentity()

function signedHeaders(method: string, pathname: string, body: string, nonce: string) {
  const ts = Date.now().toString()
  const payload = `${method}|${pathname}|${ts}|${nonce}|${body}`
  const sig = signMessage(new TextEncoder().encode(payload), who.privateKeyHex)
  return {
    'Content-Type': 'application/json',
    'X-Orbit-Id': who.orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-Signature': bytesToHex(sig),
    'X-Orbit-PubKey': who.publicKeyHex,
    'X-Orbit-Nonce': nonce,
  }
}

describe('double-mounted orbitAuth (production wiring)', () => {
  let app: Hono
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeEach(async () => {
    __resetIdleThrottle()
    env = await createMockEnv()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.env = env as any
      await next()
    })
    // EXACTLY the production mount order (index.ts:162-163)
    app.route('/api/economy', economy)
    app.route('/api/economy', economyIdle)
  })

  it('POST idle-credit with a client nonce passes both middleware passes', async () => {
    const body = JSON.stringify({ amount: 500, session: who.orbitId })
    const nonce = `regression-nonce-${Date.now()}`
    const res = await app.request('/api/economy/idle-credit', {
      method: 'POST',
      headers: {
        ...signedHeaders('POST', '/api/economy/idle-credit', body, nonce),
        'Idempotency-Key': 'dbl-mount-key-1',
      },
      body,
    })
    const j = await res.json() as any
    expect(res.status).toBe(200)
    expect(j.balance).toBe(500)
  })

  it('a replayed nonce is STILL rejected (guard does not weaken replay protection)', async () => {
    const body = JSON.stringify({ amount: 10, session: who.orbitId })
    const nonce = `replay-nonce-${Date.now()}`
    const first = await app.request('/api/economy/idle-credit', {
      method: 'POST',
      headers: { ...signedHeaders('POST', '/api/economy/idle-credit', body, nonce), 'Idempotency-Key': 'dbl-replay-key-1' },
      body,
    })
    expect(first.status).toBe(200)
    // same nonce, fresh timestamp+signature, different idem key -> replay
    const res = await app.request('/api/economy/idle-credit', {
      method: 'POST',
      headers: { ...signedHeaders('POST', '/api/economy/idle-credit', body, nonce), 'Idempotency-Key': 'dbl-replay-key-2' },
      body,
    })
    expect(res.status).toBe(401)
    const j = await res.json() as any
    expect(j.error).toMatch(/replay/i)
  })
})
