import { Hono } from 'hono'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { getLandingSlideshowImages, getLandingSlideshowModels } from '../bot-image-api'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const booru = new Hono<{ Bindings: Bindings }>()

// Public landing-page slideshow feed. No auth (mirrors lobby /public-tags) so
// the pre-login landing page can pull booru images. Returns only image URLs +
// captions — never secrets or user data.
booru.get('/slideshow', async (c) => {
  const rawLimit = Number(c.req.query('limit') || 8)
  const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 8
  try {
    const [images, models] = await Promise.all([
      getLandingSlideshowImages(c.env.DB, limit),
      getLandingSlideshowModels(c.env.DB),
    ])
    return c.json({ images, models })
  } catch (err) {
    console.error('[booru] slideshow failed:', (err as Error)?.message || err)
    return c.json({ images: [], models: [] })
  }
})
