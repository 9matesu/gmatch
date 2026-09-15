// POST /api/watchparty: url -> proxy/parse -> stored Object -> in-memory party.
// proxyAndStoreExternal is mocked (unit under test is the route wiring, the
// proxy's own behavior has proxy.test.ts).
import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../proxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../proxy')>()
  return {
    ...actual,
    proxyAndStoreExternal: vi.fn(async (url: string) => {
      if (url.includes('junk')) return null
      return {
        storedUrl: `/api/objects/${url.length}`,
        mimeType: 'video/mp4',
        isVideo: true,
        bytesStored: 1234,
        isProxied: 1 as const,
        proxiedMime: 'video/mp4',
      }
    }),
  }
})

import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { __resetParties } from '../watchparty'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let id: TestIdentity

function auth(method: string, url: string, body?: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(id, method, url, body) }
}

beforeAll(async () => {
  env = await createMockEnv()
  id = createTestIdentity()
  await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
})

describe('POST /api/watchparty', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/watchparty', { method: 'POST' }, env)
    expect(res.status).toBe(401)
  })

  it('creates a party from a video URL', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/page', name: 'Night' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    expect(json.party.id).toBeTruthy()
    expect(json.party.url.startsWith('/api/objects/')).toBe(true)

    const get = await app.request(`/api/watchparty/${json.party.id}`, { headers: auth('GET', `/api/watchparty/${json.party.id}`) }, env)
    expect(get.status).toBe(200)
    const snap: any = await get.json()
    expect(snap.name).toBe('Night')
    expect(snap.frame.action).toBe('pause')
  })

  it('rejects unparseable URLs with 422', async () => {
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/junk-page' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as any).error).toContain('playable video')
  })

  it('rejects garbage schemes', async () => {
    const body = JSON.stringify({ url: 'javascript:alert(1)' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
  })
})
