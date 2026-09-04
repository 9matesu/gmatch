import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { isValidMediaMagicBytes, detectMediaMime } from './objects'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import type { TestIdentity } from '../test-utils'

describe('Media Magic Bytes & Video Uploads', () => {
  it('detects JPEG magic bytes and MIME', () => {
    const jpgBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46])
    expect(isValidMediaMagicBytes(jpgBytes)).toBe(true)
    expect(detectMediaMime(jpgBytes)).toBe('image/jpeg')
  })

  it('detects PNG magic bytes and MIME', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    expect(isValidMediaMagicBytes(pngBytes)).toBe(true)
    expect(detectMediaMime(pngBytes)).toBe('image/png')
  })

  it('detects WebM / MKV video magic bytes and MIME', () => {
    const webmBytes = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81])
    expect(isValidMediaMagicBytes(webmBytes)).toBe(true)
    expect(detectMediaMime(webmBytes)).toBe('video/webm')
  })

  it('detects MP4 ISO BMFF video magic bytes and MIME', () => {
    // 00 00 00 18 'ftyp' 'mp42' ...
    const mp4Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x6D, 0x70, 0x34, 0x32
    ])
    expect(isValidMediaMagicBytes(mp4Bytes)).toBe(true)
    expect(detectMediaMime(mp4Bytes)).toBe('video/mp4')
  })

  it('detects OGG video magic bytes and MIME', () => {
    const oggBytes = new Uint8Array([0x4F, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00])
    expect(isValidMediaMagicBytes(oggBytes)).toBe(true)
    expect(detectMediaMime(oggBytes)).toBe('video/ogg')
  })

  it('rejects random non-media bytes', () => {
    const junkBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(isValidMediaMagicBytes(junkBytes)).toBe(false)
  })
})

describe('Lobby & Object Video Upload Routes', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  let user: TestIdentity

  beforeEach(async () => {
    env = await createMockEnv()
    user = createTestIdentity('video-user')
    await app.request('/api/users', { headers: signRequestHeaders(user, 'GET', '/api/users') }, env)
  })

  it('allows posting direct video URLs to lobby images', async () => {
    const videoUrl = 'https://example.com/clips/highlight.mp4'
    const mp4Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x6D, 0x70, 0x34, 0x32,
      0x00, 0x00, 0x00, 0x00,
    ])
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any) => {
      return new Response(mp4Bytes, {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    }) as any
    try {
      const formData = new FormData()
      formData.append('url', videoUrl)
      formData.append('caption', 'Awesome clip')

      const res = await app.request(
        '/api/lobby/images',
        {
          method: 'POST',
          headers: signRequestHeaders(user, 'POST', '/api/lobby/images'),
          body: formData,
        },
        env
      )

      expect(res.status).toBe(201)
      const json = await res.json() as any
      // The proxy stores the fetched bytes either inline (small payloads) or
      // spilled to BUCKET referencing a /content endpoint. In both cases the
      // raw external URL is no longer exposed to clients (it would leak IPs).
      expect(json.content_url).toMatch(/^(data:video\/mp4;base64,|\/api\/lobby\/images\/)/)
      expect(json.caption).toBe('Awesome clip')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('allows uploading MP4 video file to lobby board', async () => {
    const mp4Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x6D, 0x70, 0x34, 0x32,
      0x00, 0x00, 0x00, 0x00
    ])
    const videoBlob = new Blob([mp4Bytes], { type: 'video/mp4' })
    const formData = new FormData()
    formData.append('image', videoBlob, 'action.mp4')
    formData.append('caption', 'MP4 upload')

    const res = await app.request(
      '/api/lobby/images',
      {
        method: 'POST',
        headers: signRequestHeaders(user, 'POST', '/api/lobby/images'),
        body: formData,
      },
      env
    )

    expect(res.status).toBe(201)
    const json = await res.json() as any
    expect(json.content_url).toMatch(/^data:video\/mp4;base64,/)
    expect(json.caption).toBe('MP4 upload')
  })

  it('allows creating object card with video URL', async () => {
    const videoUrl = 'https://example.com/stream.webm'
    const webmBytes = new Uint8Array([
      0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81,
      0x00, 0x00, 0x00, 0x00,
    ])
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any) => {
      return new Response(webmBytes, {
        status: 200,
        headers: { 'content-type': 'video/webm' },
      })
    }) as any
    try {
      const formData = new FormData()
      formData.append('url', videoUrl)
      formData.append('caption', 'WebM Stream')

      const res = await app.request(
        '/api/objects',
        {
          method: 'POST',
          headers: signRequestHeaders(user, 'POST', '/api/objects'),
          body: formData,
        },
        env
      )

      expect(res.status).toBe(201)
      const json = await res.json() as any
      expect(json.id).toBeDefined()

      const obj = await env.DB.prepare('SELECT * FROM Objects WHERE id = ?').bind(json.id).first<{ mime_type: string; content_url: string }>()
      expect(obj?.mime_type).toBe('video/webm')
      // External URL is now proxied through our server; the stored content_url
      // is either an inline data: URL (small) or our /content endpoint ref.
      expect(obj?.content_url).toMatch(/^(data:video\/webm;base64,|\/api\/objects\/)/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
