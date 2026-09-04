import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createMockEnv } from '../test-utils'
import { saveBotConfig, getLandingSlideshowImages } from '../bot-image-api'

describe('Booru landing slideshow', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    // Disable the bot pipeline so the slideshow takes its offline fallback
    // path and never performs external network calls during tests.
    await saveBotConfig(env.DB, { enabled: false })
  })

  it('GET /api/booru/slideshow returns 200 with an images array (offline fallback)', async () => {
    const res = await app.request('/api/booru/slideshow?limit=5', {}, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { images: Array<{ url: string; caption?: string }> }
    expect(Array.isArray(body.images)).toBe(true)
    expect(body.images.length).toBeGreaterThan(0)
    expect(body.images.length).toBeLessThanOrEqual(5)
    for (const img of body.images) {
      expect(typeof img.url).toBe('string')
      expect(img.url.length).toBeGreaterThan(0)
    }
  })

  it('clamps the requested limit', async () => {
    const res = await app.request('/api/booru/slideshow?limit=999', {}, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { images: Array<{ url: string }> }
    expect(body.images.length).toBeLessThanOrEqual(20)
  })

  it('getLandingSlideshowImages returns offline placeholders when bot disabled', async () => {
    const images = await getLandingSlideshowImages(env.DB, 4)
    expect(images.length).toBeGreaterThan(0)
    expect(images.length).toBeLessThanOrEqual(4)
    for (const img of images) {
      expect(typeof img.url).toBe('string')
      expect(img.url.startsWith('data:image/svg+xml;base64,')).toBe(true)
      expect(typeof img.caption).toBe('string')
    }
  })
})
