// Wave 2 (E2): every /api/admin route must be guarded. A signed NON-admin
// identity hitting each registered route must never get a 200 — only the
// verify-pin handshake answers for non-admins (401/403/429/503 are all fine).
import { describe, it, expect } from 'vitest'
import { admin } from './admin'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

describe('admin route guard sweep', () => {
  it('no admin route serves 200 to a signed non-admin', async () => {
    const env = await createMockEnv()
    const intruder = createTestIdentity()
    // Hono sub-app routes: [['GET','/dashboard',...], ...]
    const paths = new Set<string>()
    for (const r of (admin as unknown as { routes: Array<{ method: string; path: string }> }).routes) {
      if (r.method === 'GET') paths.add(r.path)
    }
    expect(paths.size).toBeGreaterThan(10) // sanity: the router really enumerated
    const offenders: string[] = []
    for (const path of paths) {
      const url = '/api/admin' + path.replace(/:[A-Za-z0-9_]+/g, 'probe')
      const res = await admin.request(
        url,
        { headers: signRequestHeaders(intruder, 'GET', url) },
        { ...env, ADMIN_PIN: 'whatever' },
      )
      if (res.status === 200) offenders.push(url)
    }
    expect(offenders).toEqual([])
  })
})
