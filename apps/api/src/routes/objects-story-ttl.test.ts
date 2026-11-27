import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// A URL story must proxy+store without touching the network in a unit test.
// Mock the proxy module the route imports; everything else is the real path.
vi.mock('../proxy', () => ({
  proxyAndStoreExternal: vi.fn(async () => ({
    storedUrl: '/api/objects/proxied-story',
    mimeType: 'image/jpeg',
    isVideo: false,
    bytesStored: 12,
    isProxied: 1 as const,
    proxiedMime: 'image/jpeg' as const,
  })),
  classifyAndResolve: vi.fn(async () => null),
  isPrivateTarget: vi.fn(async () => false),
  pageTitleFor: vi.fn(() => null),
}))

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
])

const DAY_MS = 24 * 60 * 60 * 1000

describe('story TTL is 24h (multipart is_story)', () => {
  let env: any
  const author = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(author.orbitId, author.publicKeyHex, 'Author').run().catch(() => {})
  })

  it('stamps a posted story with expires_at about 24h ahead', async () => {
    const form = new FormData()
    form.append('image', new Blob([PNG], { type: 'image/png' }), 'pic.png')
    form.append('is_story', '1')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: signRequestHeaders(author, 'POST', '/api/objects'),
      body: form,
    }, env)
    expect(res.status).toBe(201)

    const row = await env.DB.prepare('SELECT is_story, expires_at FROM Objects WHERE owner_id = ?')
      .bind(author.orbitId).first<{ is_story: number; expires_at: string }>()
    expect(row!.is_story).toBe(1)
    const delta = new Date(row!.expires_at).getTime() - Date.now()
    // Allow a small delta for test execution time.
    expect(delta).toBeGreaterThan(DAY_MS - 5 * 60 * 1000)
    expect(delta).toBeLessThan(DAY_MS + 5 * 60 * 1000)
  })
})

describe('a URL item flagged as a story is a story', () => {
  let env: any
  const author = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(author.orbitId, author.publicKeyHex, 'Author').run().catch(() => {})
  })

  it('lists a URL story in GET /api/objects/stories with expires_at set', async () => {
    const form = new FormData()
    form.append('url', 'https://example.com/pic.jpg')
    form.append('is_story', '1')

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: signRequestHeaders(author, 'POST', '/api/objects'),
      body: form,
    }, env)
    expect(res.status).toBe(201)
    const created = await res.json() as { id: string; is_story: number }
    expect(created.is_story).toBe(1)

    const storiesRes = await app.request('/api/objects/stories', {
      method: 'GET',
      headers: signRequestHeaders(author, 'GET', '/api/objects/stories'),
    }, env)
    expect(storiesRes.status).toBe(200)
    const stories = await storiesRes.json() as Array<{ id: string; expires_at: string }>
    const mine = stories.find((s) => s.id === created.id)
    expect(mine).toBeTruthy()
    expect(mine!.expires_at).toBeTruthy()
    const delta = new Date(mine!.expires_at).getTime() - Date.now()
    expect(delta).toBeGreaterThan(DAY_MS - 5 * 60 * 1000)
    expect(delta).toBeLessThan(DAY_MS + 5 * 60 * 1000)
  })
})