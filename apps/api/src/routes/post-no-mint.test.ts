import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

// Source-of-truth guard: publishing posts (with or without media) must never
// change the Cards table. Only POST /api/cards mints a card. Proven by audit:
// routes/posts.ts, routes/objects.ts, routes/gossip.ts and lobby promotion
// write exclusively to Objects (+Recipients/Users), never to card tables.
describe('Posts never mint cards', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
  })

  async function cardCount() {
    const r = await env.DB.prepare('SELECT COUNT(*) as c FROM Cards').first<{ c: number }>()
    return r?.c ?? 0
  }

  async function upload(owner: any, isPublic: boolean) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(32).fill(0x41)])
    const form = new FormData()
    form.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'pic.jpg')
    form.append('is_public', isPublic ? '1' : '0')
    form.append('caption', 'a post')
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: signRequestHeaders(owner, 'POST', '/api/objects'),
      body: form,
    }, env)
    expect(res.status).toBe(201)
    return (await res.json()).id as string
  }

  it('register + public post + private media leave Cards at zero; only /api/cards mints', async () => {
    const owner = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(owner.orbitId, owner.publicKeyHex, 'O').run().catch(() => {})
    expect(await cardCount()).toBe(0)

    // 1. Metadata-only public register (post flow without bytes).
    const regBody = JSON.stringify({ id: 'post-meta-1', mime_type: 'image/jpeg', is_public: 1 })
    const regHeaders = signRequestHeaders(owner, 'POST', '/api/objects/register', regBody)
    regHeaders['Content-Type'] = 'application/json'
    const reg = await app.request('/api/objects/register', { method: 'POST', headers: regHeaders, body: regBody }, env)
    expect(reg.status).toBe(200)
    expect(await cardCount()).toBe(0)

    // 2. Public post with media.
    const publicMedia = await upload(owner, true)
    expect(await cardCount()).toBe(0)

    // 3. Private card-source media (still not a card).
    const privateMedia = await upload(owner, false)
    expect(await cardCount()).toBe(0)

    // 4. Minting from the private media works (the single authorized flow).
    const mintBody = JSON.stringify({ media_object_id: privateMedia, name: 'First Card' })
    const mintHeaders = signRequestHeaders(owner, 'POST', '/api/cards', mintBody)
    mintHeaders['Content-Type'] = 'application/json'
    const mint = await app.request('/api/cards', { method: 'POST', headers: mintHeaders, body: mintBody }, env)
    expect(mint.status).toBe(201)
    expect(await cardCount()).toBe(1)

    // 5. Minting from PUBLIC post media is rejected: posts are not card stock.
    const badBody = JSON.stringify({ media_object_id: publicMedia, name: 'Post Card' })
    const badHeaders = signRequestHeaders(owner, 'POST', '/api/cards', badBody)
    badHeaders['Content-Type'] = 'application/json'
    const bad = await app.request('/api/cards', { method: 'POST', headers: badHeaders, body: badBody }, env)
    expect(bad.status).toBe(400)
    expect(await cardCount()).toBe(1)
  })
})
