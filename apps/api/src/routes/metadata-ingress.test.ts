import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import type { TestIdentity } from '../test-utils'

// Wave 2 / F20: every image entering the app must be metadata-stripped —
// the multipart upload path used to store raw bytes (GPS leak class).

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0))
}

function jpegWithExif(): Uint8Array {
  const seg = (m: number, p: number[]): number[] => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p]
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe1, [...ascii('Exif\0\0'), 0x4d, 0x4d, 0x00, 0x2a]), // EXIF (GPS lives here)
    ...seg(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x03]),
    0xff, 0xda, 0x00, 0x06, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x02, 0x03,
    0xff, 0xd9,
  ])
}

describe('metadata ingress strip (upload + pfp)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let user: TestIdentity

  beforeEach(async () => {
    env = await createMockEnv()
    user = createTestIdentity('strip-user')
    await app.request('/api/users', { headers: signRequestHeaders(user, 'GET', '/api/users') }, env)
  })

  it('POST /api/objects multipart strips EXIF before storing', async () => {
    const bytes = jpegWithExif()
    const formData = new FormData()
    formData.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg')
    formData.append('is_public', '1')
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: signRequestHeaders(user, 'POST', '/api/objects'),
      body: formData,
    }, env)
    expect(res.status).toBe(201)
    const json = await res.json() as { id: string }

    const served = await app.request(`/api/objects/${json.id}`, {}, env)
    expect(served.status).toBe(200)
    const out = new Uint8Array(await served.arrayBuffer())
    const s = Buffer.from(out).toString('latin1')
    expect(s).not.toContain('Exif')
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
    expect(out[out.length - 1]).toBe(0xd9)
  })

  it('PATCH /api/users/profile strips EXIF from data: pfp', async () => {
    const b64 = Buffer.from(jpegWithExif()).toString('base64')
    const body = JSON.stringify({ display_name: 'Stripper', pfp_url: `data:image/jpeg;base64,${b64}` })
    const res = await app.request('/api/users/profile', {
      method: 'PATCH',
      headers: { ...signRequestHeaders(user, 'PATCH', '/api/users/profile', body), 'content-type': 'application/json' },
      body,
    }, env)
    expect(res.status).toBe(200)

    const pfp = await app.request(`/api/users/${user.orbitId}/pfp`, {}, env)
    expect(pfp.status).toBe(200)
    const out = new Uint8Array(await pfp.arrayBuffer())
    expect(Buffer.from(out).toString('latin1')).not.toContain('Exif')
  })

  it('PATCH profile rejects unreachable http pfp instead of storing raw URL', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('unreachable') }) as typeof fetch
    try {
      const res = await app.request('/api/users/profile', {
        method: 'PATCH',
        headers: { ...signRequestHeaders(user, 'PATCH', '/api/users/profile', JSON.stringify({ pfp_url: 'https://evil.invalid/me.jpg' })), 'content-type': 'application/json' },
        body: JSON.stringify({ pfp_url: 'https://evil.invalid/me.jpg' }),
      }, env)
      expect(res.status).toBe(400)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
