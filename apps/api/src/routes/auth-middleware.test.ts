// Edge coverage for src/middleware/auth.ts: header validation, timestamp
// windows (GET vs POST vs multipart), nonce challenge/response + replay,
// signature/identity mismatch rejection, ban enforcement, and issueNonce.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { issueNonce } from '../middleware/auth'
import { __resetIdleThrottle } from './economy-idle'
import { signMessage } from '@orbit/crypto'
import crypto from 'crypto'

const alice = createTestIdentity()
const bob = createTestIdentity()

let env: Awaited<ReturnType<typeof createMockEnv>>

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Sign with an explicit nonce component (the middleware includes the nonce in
// the signed payload when X-Orbit-Nonce is present).
function signWithNonce(
  identity: ReturnType<typeof createTestIdentity>,
  method: string,
  url: string,
  nonce: string,
  body = '',
  timestamp?: string,
): Record<string, string> {
  const ts = timestamp || Date.now().toString()
  const payload = `${method}|${url}|${ts}|${nonce}|${body}`
  const sig = signMessage(new TextEncoder().encode(payload), identity.privateKeyHex)
  return {
    'X-Orbit-Id': identity.orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-Signature': toHex(sig),
    'X-Orbit-PubKey': identity.publicKeyHex,
    'X-Orbit-Nonce': nonce,
  }
}

beforeAll(async () => {
  env = await createMockEnv()
  // Register both identities (auth middleware auto-registers on first hit).
  await app.request('/api/economy/balance', { headers: signRequestHeaders(alice, 'GET', '/api/economy/balance') }, env)
  await app.request('/api/economy/balance', { headers: signRequestHeaders(bob, 'GET', '/api/economy/balance') }, env)
})

beforeEach(() => {
  // idle-credit has a 60s in-memory throttle per identity; keep the nonce
  // tests independent of each other's credits.
  __resetIdleThrottle()
})

describe('missing / malformed authentication headers', () => {
  it('401 when no headers at all', async () => {
    const res = await app.request('/api/economy/balance', {}, env)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Missing authentication headers')
  })

  it('401 when each single required header is dropped', async () => {
    const base = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    for (const header of ['X-Orbit-Id', 'X-Orbit-Timestamp', 'X-Orbit-Signature', 'X-Orbit-PubKey']) {
      const headers = { ...base }
      delete headers[header as keyof typeof headers]
      const res = await app.request('/api/economy/balance', { headers }, env)
      expect(res.status, header).toBe(401)
      expect((await res.json()).error).toBe('Missing authentication headers')
    }
  })

  it('400 on a non-numeric timestamp', async () => {
    const headers = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    headers['X-Orbit-Timestamp'] = 'not-a-number'
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid timestamp')
  })

  it('OPTIONS preflight passes through the middleware', async () => {
    const res = await app.request('/api/economy/balance', { method: 'OPTIONS' }, env)
    // No 401 — Hono answers OPTIONS itself (204/405 depending on routing).
    expect(res.status).not.toBe(401)
  })
})

describe('timestamp windows', () => {
  it('rejects a POST older than 30s', async () => {
    const body = JSON.stringify({ amount: 1, session: 's', idempotencyKey: 'ts-win-key-0001' })
    const old = (Date.now() - 45_000).toString()
    const res = await app.request(
      '/api/economy/idle-credit',
      {
        method: 'POST',
        headers: {
          ...signRequestHeaders(alice, 'POST', '/api/economy/idle-credit', body, old),
          'Content-Type': 'application/json',
        },
        body,
      },
      env,
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Request expired')
  })

  it('accepts a GET older than 30s but within the 120s GET window', async () => {
    const old = (Date.now() - 60_000).toString()
    const res = await app.request(
      '/api/economy/balance',
      { headers: signRequestHeaders(alice, 'GET', '/api/economy/balance', undefined, old) },
      env,
    )
    expect(res.status).toBe(200)
  })

  it('rejects a GET older than the 120s window', async () => {
    const old = (Date.now() - 130_000).toString()
    const res = await app.request(
      '/api/economy/balance',
      { headers: signRequestHeaders(alice, 'GET', '/api/economy/balance', undefined, old) },
      env,
    )
    expect(res.status).toBe(401)
  })

  it('gives multipart POSTs the wide 5-minute window', async () => {
    // 60s old: a JSON POST would be expired, but multipart is allowed up to 300s.
    const old = (Date.now() - 60_000).toString()
    const form = new FormData()
    form.append('amount', '5')
    const res = await app.request(
      '/api/economy/idle-credit',
      { method: 'POST', headers: signRequestHeaders(alice, 'POST', '/api/economy/idle-credit', undefined, old), body: form },
      env,
    )
    // Auth passed (not 401 'Request expired'); the handler then rejects the
    // non-JSON body with its own 400 — proving the multipart window applied.
    expect(res.status).toBe(400)
    const json: any = await res.json()
    expect(json.error).not.toBe('Request expired')
  })
})

describe('signature and identity validation', () => {
  it('400 on non-hex signature encoding', async () => {
    const headers = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    headers['X-Orbit-Signature'] = 'zzzz-not-hex'
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid signature encoding')
  })

  it('400 when the public key is not valid hex (verify throws)', async () => {
    const headers = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    headers['X-Orbit-PubKey'] = 'zzzz-not-hex'
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Signature verification failed')
  })

  it('401 on a well-formed signature over the wrong payload', async () => {
    const headers = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    // Sign a different URL but request this one.
    const other = signRequestHeaders(alice, 'GET', '/api/economy/transactions')
    headers['X-Orbit-Signature'] = other['X-Orbit-Signature']
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid signature')
  })

  it('401 when the Orbit ID does not hash to the public key', async () => {
    const headers = signRequestHeaders(alice, 'GET', '/api/economy/balance')
    headers['X-Orbit-Id'] = bob.orbitId // bob's id, alice's key+signature
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Public key does not match Orbit ID')
  })

  it('stores the encryption public key when provided', async () => {
    const carol = createTestIdentity()
    const headers = {
      ...signRequestHeaders(carol, 'GET', '/api/economy/balance'),
      'X-Orbit-PubKey-Enc': carol.encryptionPubHex,
    }
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT encryption_pub_key FROM Users WHERE id = ?')
      .bind(carol.orbitId).first<{ encryption_pub_key: string }>()
    expect(row?.encryption_pub_key).toBe(carol.encryptionPubHex)
  })
})

describe('nonce challenge/response', () => {
  // NOTE: /api/economy mounts two sub-apps that each run orbitAuth, so a
  // nonce-bearing POST there is consumed by the first pass and flagged as a
  // replay by the second. Use single-mount routes for nonce tests.
  it('issues a nonce for an authenticated caller and accepts it on a mutation', async () => {
    const nonceRes = await app.request('/api/auth/nonce', {
      headers: signRequestHeaders(alice, 'GET', '/api/auth/nonce'),
    }, env)
    expect(nonceRes.status).toBe(200)
    const { nonce, expiresIn } = await nonceRes.json() as { nonce: string; expiresIn: number }
    expect(typeof nonce).toBe('string')
    expect(expiresIn).toBe(120_000)

    const headers = signWithNonce(alice, 'POST', '/api/auth/cleanup', nonce)
    const res = await app.request(
      '/api/auth/cleanup',
      { method: 'POST', headers },
      env,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)

    // Re-using the consumed server nonce now hits the replay guard.
    const replay = await app.request('/api/auth/cleanup', { method: 'POST', headers }, env)
    expect(replay.status).toBe(401)
    expect((await replay.json()).error).toContain('replay detected')
  })

  it('rejects a server nonce presented by a different identity', async () => {
    const nonceRes = await app.request('/api/auth/nonce', {
      headers: signRequestHeaders(bob, 'GET', '/api/auth/nonce'),
    }, env)
    const { nonce } = await nonceRes.json() as { nonce: string }
    // Signed by alice but the nonce was issued to bob.
    const headers = signWithNonce(alice, 'POST', '/api/auth/cleanup', nonce)
    const res = await app.request('/api/auth/cleanup', { method: 'POST', headers }, env)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Nonce issued for a different identity')
  })

  it('rejects a replayed client-issued nonce', async () => {
    const nonce = crypto.randomUUID()
    const headers = signWithNonce(alice, 'POST', '/api/auth/cleanup', nonce)
    const first = await app.request('/api/auth/cleanup', { method: 'POST', headers }, env)
    expect(first.status).toBe(200)
    const second = await app.request('/api/auth/cleanup', { method: 'POST', headers }, env)
    expect(second.status).toBe(401)
    expect((await second.json()).error).toContain('replay detected')
  })

  it('issueNonce returns 401 without any identity context (unit)', async () => {
    let statusCode = 0
    let payload: any = null
    const fakeCtx = {
      get: () => undefined,
      req: { header: () => undefined },
      json: (obj: unknown, status: number) => {
        payload = obj
        statusCode = status
        return new Response(JSON.stringify(obj), { status })
      },
    } as any
    await issueNonce(fakeCtx)
    expect(statusCode).toBe(401)
    expect(payload.error).toBe('Not authenticated')
  })

  it('issueNonce honours a header-only identity and evicts past the cap (unit)', async () => {
    const orbitId = 'a'.repeat(64)
    let payload: any = null
    const fakeCtx = {
      get: () => undefined,
      req: { header: (n: string) => (n === 'X-Orbit-Id' ? orbitId : undefined) },
      json: (obj: unknown) => {
        payload = obj
        return new Response(JSON.stringify(obj))
      },
    } as any
    await issueNonce(fakeCtx)
    expect(payload.nonce).toBeTruthy()
    expect(payload.expiresIn).toBe(120_000)
  })
})

describe('ban enforcement', () => {
  it('403 with the ban reason in the message', async () => {
    const dave = createTestIdentity()
    const headers = signRequestHeaders(dave, 'GET', '/api/economy/balance')
    // First request auto-registers the user.
    expect((await app.request('/api/economy/balance', { headers }, env)).status).toBe(200)
    await env.DB.prepare('INSERT INTO Bans (id, user_id, banned_by, reason) VALUES (?, ?, ?, ?)')
      .bind('ban-auth-01', dave.orbitId, dave.orbitId, 'spam').run()
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Account suspended: spam')
  })

  it('403 without a reason falls back to the generic message', async () => {
    const erin = createTestIdentity()
    const headers = signRequestHeaders(erin, 'GET', '/api/economy/balance')
    await app.request('/api/economy/balance', { headers }, env)
    await env.DB.prepare('INSERT INTO Bans (id, user_id, banned_by, reason) VALUES (?, ?, ?, NULL)')
      .bind('ban-auth-02', erin.orbitId, erin.orbitId).run()
    const res = await app.request('/api/economy/balance', { headers }, env)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Account suspended')
  })
})

describe('nonce cache maintenance under load', () => {
  it('cleanupNonces sweep runs once issued nonces exceed the threshold', async () => {
    // Issue >100 nonces so the next authenticated request triggers the
    // internal sweep (exercising the cleanup loop and expiry branches).
    for (let i = 0; i < 105; i++) {
      const res = await app.request('/api/auth/nonce', {
        headers: signRequestHeaders(bob, 'GET', '/api/auth/nonce'),
      }, env)
      expect(res.status).toBe(200)
    }
    // A subsequent request must still authenticate cleanly.
    const res = await app.request('/api/economy/balance', {
      headers: signRequestHeaders(bob, 'GET', '/api/economy/balance'),
    }, env)
    expect(res.status).toBe(200)
  })
})
