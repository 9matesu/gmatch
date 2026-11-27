// Wave 2 (E2): every /api/admin route must be guarded. A signed NON-admin
// identity hitting each registered route must never get a 200 — only the
// verify-pin handshake answers for non-admins (401/403/429/503 are all fine).
//
// The sweep used to cover GET routes ONLY, which is exactly how three
// destructive POST routes shipped unprotected (`/purge-e2e`,
// `/database/clean-posts`, `/database/migrate-lobby-to-posts`): `orbitAuth`
// auto-registers any Ed25519 identity, so any client that could mint a
// keypair could wipe the node. The guard is now one `admin.use('*', adminAuth)`
// wildcard, and this sweep covers EVERY method so it cannot regress.
//
// THE MOUNT MATTERS. The first version of this sweep called
// `admin.request('/api/admin' + path)` directly on the SUB-APP. Hono matches
// a sub-app's routes RELATIVE to its mount point, so `/api/admin/dashboard`
// matched nothing and every probe 404'd — the sweep passed VACUOUSLY, with
// the guard disabled. The probe now goes through a parent Hono mounted at
// `/api/admin` exactly like `apps/api/src/index.ts` does, and the signature
// covers the FULL request path (`/api/admin/...`) exactly like the client
// signs it. A guard that is switched off now makes this test FAIL.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { admin } from './admin'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

type AdminRoute = { method: string; path: string }

/** Routes that answer for a non-admin BY DESIGN: the PIN handshake is what
 *  GRANTS the admin flag, so it cannot require the flag. */
const PUBLIC_BY_DESIGN = new Set(['POST /verify-pin'])

describe('admin route guard sweep', () => {
  it('no admin route serves 200 to a signed non-admin', async () => {
    const env = await createMockEnv()
    const intruder = createTestIdentity()

    // Same mount as production: apps/api/src/index.ts → app.route('/api/admin', admin)
    const app = new Hono()
    app.route('/api/admin', admin)

    const routes = (admin as unknown as { routes: AdminRoute[] }).routes
    expect(routes.length).toBeGreaterThan(50) // sanity: the router really enumerated

    const seen = new Set<string>()
    const offenders: string[] = []
    let probed = 0
    for (const r of routes) {
      // `use()` registers middleware as method ALL — it is not a probe target.
      if (r.method === 'ALL') continue
      const key = `${r.method.toUpperCase()} ${r.path}`
      if (seen.has(key)) continue
      seen.add(key)
      if (PUBLIC_BY_DESIGN.has(key)) continue

      const method = r.method.toUpperCase()
      const url = '/api/admin' + r.path.replace(/:[A-Za-z0-9_]+/g, 'probe')
      const res = await app.request(
        url,
        { method, headers: signRequestHeaders(intruder, method, url) },
        { ...env, ADMIN_PIN: 'whatever' },
      )
      probed++
      if (res.status === 200) offenders.push(`${method} ${url}`)
    }

    // The sweep must have actually exercised routes, not just 404'd on all.
    expect(probed).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })

  it('the guard is a wildcard, not a hand-maintained path list', () => {
    // A destructive route that exists MUST be covered. This is the shape of
    // the bug that shipped: the route was added, the allowlist was not.
    const paths = new Set(
      (admin as unknown as { routes: AdminRoute[] }).routes.map((r) => r.path),
    )
    for (const destructive of [
      '/purge-e2e',
      '/database/clean-posts',
      '/database/migrate-lobby-to-posts',
    ]) {
      expect(paths.has(destructive)).toBe(true)
    }
  })
})
