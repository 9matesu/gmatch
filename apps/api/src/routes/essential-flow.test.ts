// Essential-flow contract (fix/resilience wave): signup -> avatar bytes ->
// profile PATCH carrying an unknown field (version skew) -> anonymous pfp
// render -> watchparty room -> private media read. If any essential module
// breaks with a future version, THIS fails before users do. Happy path
// only; unit tests own the error branches.
import { describe, it, expect, vi } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import { __resetParties } from '../watchparty'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// Minimal mp4: ftyp box + payload (magic-byte detector accepts 'ftyp' at 4).
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200)])

describe('essential flow', () => {
  it('signup -> pfp -> skew patch -> pfp render -> watchparty -> media read', async () => {
    const env = await createMockEnv()
    __resetParties()
    const id = createTestIdentity()

    // 1. first authed call provisions the row (no display_name yet)
    const me0 = await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
    expect(me0.status).toBe(200)

    // 2. avatar bytes via multipart
    const form = new FormData()
    form.append('image', new File([Buffer.from(PNG_B64, 'base64')], 'a.png', { type: 'image/png' }))
    form.append('is_avatar', '1')
    const up = await app.request('/api/objects', { method: 'POST', body: form, headers: signRequestHeaders(id, 'POST', '/api/objects') }, env)
    expect([200, 201]).toContain(up.status)
    const { id: objId } = await up.json() as { id: string }

    // 3. pfp + name + an UNKNOWN field (a newer client) -> 200, not 400
    const body = JSON.stringify({ pfp_url: `/api/objects/${objId}`, display_name: 'Essential Flow', favorite_color: 'chartreuse' })
    const patch = await app.request('/api/users/profile', {
      method: 'PATCH', body,
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(id, 'PATCH', '/api/users/profile', body) },
    }, env)
    expect(patch.status).toBe(200)

    // 4. object readable by its owner; pfp renderable anonymously (img tag)
    const obj = await app.request(`/api/objects/${objId}`, { headers: signRequestHeaders(id, 'GET', `/api/objects/${objId}`) }, env)
    expect(obj.status).toBe(200)
    const pfp = await app.request(`/api/users/${id.orbitId}/pfp`, {}, env)
    expect(pfp.status).toBe(200)

    // 5. watchparty room (proxy fetch stubbed to a small stored mp4)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })))
    const wpBody = JSON.stringify({ url: 'https://example.com/v.mp4', name: 'Flow' })
    const wp = await app.request('/api/watchparty', {
      method: 'POST', body: wpBody,
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(id, 'POST', '/api/watchparty', wpBody) },
    }, env)
    expect(wp.status).toBe(201)
    const wpJson: any = await wp.json()
    expect(wpJson.party.url.startsWith('/api/objects/')).toBe(true)
    vi.unstubAllGlobals()

    // 6. the stored party media streams (private object, capability check)
    const media = await app.request(wpJson.party.url, {}, env)
    expect([200, 206]).toContain(media.status)
  })
})
