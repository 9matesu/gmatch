// Direct unit coverage for src/middleware/auth.ts internals that HTTP-level
// tests cannot reach: nonce cache eviction (seen + issued caps), expired
// server-issued nonce, cleanupNonces sweeps, and the OPTIONS passthrough.
// orbitAuth is driven with minimal fake Hono contexts — signatures are
// deliberately invalid because the nonce bookkeeping happens BEFORE signature
// verification, so the observable status code proves which branch ran.
import { describe, it, expect } from 'vitest'
import { orbitAuth, issueNonce } from '../middleware/auth'

function fakeCtx(opts: {
  method?: string
  url?: string
  headers?: Record<string, string>
}): any {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.headers || {})) lower[k.toLowerCase()] = v
  const vars: Record<string, unknown> = {}
  return {
    req: {
      method: opts.method || 'POST',
      url: opts.url || 'http://localhost/ping',
      header: (n: string) => lower[n.toLowerCase()],
      raw: { clone: () => ({ text: async () => '' }) },
    },
    env: {},
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => {
      vars[k] = v
    },
    json: (obj: unknown, status: number) => new Response(JSON.stringify(obj), { status }),
  }
}

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)

function authHeadersFor(orbitId: string, ts: string, nonce?: string): Record<string, string> {
  const h: Record<string, string> = {
    'X-Orbit-Id': orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-Signature': 'zz-not-hex', // fails AFTER the nonce block
    'X-Orbit-PubKey': 'ff'.repeat(32),
  }
  if (nonce) h['X-Orbit-Nonce'] = nonce
  return h
}

describe('orbitAuth OPTIONS passthrough', () => {
  it('calls next() for OPTIONS without any headers', async () => {
    let called = false
    await orbitAuth(fakeCtx({ method: 'OPTIONS' }), async () => {
      called = true
    })
    expect(called).toBe(true)
  })
})

describe('cleanupNonces sweeps', () => {
  it('drops seen client nonces older than the 60s TTL', async () => {
    const realNow = Date.now
    try {
      // Record nonce X at t0.
      Date.now = () => realNow()
      const x = `nonce-x-${Math.random()}`
      const r1 = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, Date.now().toString(), x) }),
        async () => {},
      )
      expect(r1!.status).toBe(400) // reached signature stage -> nonce recorded

      // At t0+61s a fresh request triggers cleanup, evicting X.
      Date.now = () => realNow() + 61_000
      const y = `nonce-y-${Math.random()}`
      const r2 = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, Date.now().toString(), y) }),
        async () => {},
      )
      expect(r2!.status).toBe(400)

      // X is no longer treated as a replay: it reaches the signature check
      // (400) instead of the replay guard (401).
      const r3 = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, Date.now().toString(), x) }),
        async () => {},
      )
      expect(r3!.status).toBe(400)
    } finally {
      Date.now = realNow
    }
  })

  it('drops issued nonces past their expiry during cleanup', async () => {
    const realNow = Date.now
    try {
      Date.now = () => realNow()
      let issued: any
      await issueNonce(fakeCtx({ headers: { 'X-Orbit-Id': ID_A } }))
      // issueNonce returns a Response; re-run capturing the payload.
      const res = await issueNonce(fakeCtx({ headers: { 'X-Orbit-Id': ID_A } }))
      issued = await res.json()
      expect(issued.nonce).toBeTruthy()

      // Jump past the 120s issue TTL; the next nonce-bearing request runs
      // cleanupNonces, which must delete the expired issued entries.
      Date.now = () => realNow() + 121_000
      const z = `nonce-z-${Math.random()}`
      const r = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, Date.now().toString(), z) }),
        async () => {},
      )
      expect(r!.status).toBe(400)
    } finally {
      Date.now = realNow
    }
  })
})

describe('server-issued nonce expiry', () => {
  it('401s when a server nonce is presented exactly at its expiry boundary', async () => {
    // cleanupNonces() deletes with `now > expiresAt` (strict), while the
    // per-request guard checks `expiresAt <= now`. The guard is therefore only
    // reachable at the exact boundary tick — freeze the clock there.
    const realNow = Date.now
    try {
      const t0 = realNow()
      Date.now = () => t0
      const res = await issueNonce(fakeCtx({ headers: { 'X-Orbit-Id': ID_A } }))
      const { nonce } = await res.json()

      Date.now = () => t0 + 120_000 // === expiresAt: kept by cleanup, caught by guard
      const r = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, String(t0 + 120_000), nonce) }),
        async () => {},
      )
      expect(r!.status).toBe(401)
      const body = await r!.json()
      expect(body.error).toContain('Nonce expired')
    } finally {
      Date.now = realNow
    }
  })
})

describe('issued nonce cache eviction at MAX_NONCES', () => {
  it('evicts the oldest issued nonce past 10k and re-treats it as client-issued', async () => {
    const ctx = fakeCtx({ headers: { 'X-Orbit-Id': ID_A } })
    const first = await issueNonce(ctx)
    const { nonce: firstNonce } = await first.json()

    // Fill the issued cache past its 10,000 cap (each issue evicts oldest).
    for (let i = 0; i < 10_001; i++) {
      await issueNonce(ctx)
    }

    // firstNonce was evicted: presenting it under a DIFFERENT identity must
    // not hit the 'issued for a different identity' guard (401) — it falls
    // through to the client-nonce path and dies at signature validation (400).
    const r = await orbitAuth(
      fakeCtx({ headers: authHeadersFor(ID_B, Date.now().toString(), firstNonce) }),
      async () => {},
    )
    expect(r!.status).toBe(400)
  })
})

describe('seen nonce cache eviction at MAX_NONCES', () => {
  it('evicts the oldest seen nonce past 10k so it is no longer a replay', { timeout: 60_000 }, async () => {
    const realNow = Date.now
    try {
      // Freeze the clock so the 60s TTL sweep never interferes with the fill.
      const frozen = realNow()
      Date.now = () => frozen
      const firstNonce = `seen-first-${Math.random()}`
      const r0 = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, String(frozen), firstNonce) }),
        async () => {},
      )
      expect(r0!.status).toBe(400)

      // Immediate replay: guard fires with 401.
      const replay = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, String(frozen), firstNonce) }),
        async () => {},
      )
      expect(replay!.status).toBe(401)

      // Fill to the 10k cap with distinct nonces (each fails at signature,
      // after being recorded in seenNonces).
      for (let i = 0; i < 10_000; i++) {
        await orbitAuth(
          fakeCtx({ headers: authHeadersFor(ID_A, String(frozen), `fill-${i}-${Math.random()}`) }),
          async () => {},
        )
      }

      // firstNonce has been evicted: replaying it now passes the replay guard
      // and fails later at signature validation instead.
      const after = await orbitAuth(
        fakeCtx({ headers: authHeadersFor(ID_A, String(frozen), firstNonce) }),
        async () => {},
      )
      expect(after!.status).toBe(400)
    } finally {
      Date.now = realNow
    }
  })
})

describe('issueNonce authenticated context', () => {
  it('prefers c.get(orbitId) over the header', async () => {
    const ctx = fakeCtx({ headers: {} })
    ctx.set('orbitId', ID_A)
    const res = await issueNonce(ctx)
    const json = await res.json()
    expect(json.nonce).toBeTruthy()
    expect(json.expiresIn).toBe(120_000)
  })
})
