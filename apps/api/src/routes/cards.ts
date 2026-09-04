import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { CardService } from '../cards'
import { badRequest, toDomainError } from '../common/errors'
import type { CardRarity } from '@orbit/shared'

type Bindings = { DB: D1Turso }

export const cards = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

cards.use('*', orbitAuth)

cards.onError((err, c) => {
  const d = toDomainError(err)
  return c.json({ error: d.message }, d.status as any)
})

function idempotencyKey(c: { req: { header(n: string): string | undefined } }, body: any): string {
  const key = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || (body?.idempotency_key as string | undefined)
  if (!key || key.length < 8 || key.length > 128) {
    throw badRequest('idempotencyKey must be 8-128 characters (Idempotency-Key header or idempotency_key body)')
  }
  return key
}

// Create a card from a media object the caller owns.
cards.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const service = new CardService(c.env.DB)
  const card = await service.createCard({
    creatorId: c.get('orbitId'),
    mediaObjectId: String(body?.media_object_id || '').trim(),
    name: body?.name || null,
    tags: body?.tags,
    description: body?.description || null,
    frame: body?.frame,
    accentColor: body?.accent_color,
    rarity: body?.rarity as CardRarity | undefined,
  })
  return c.json({ card }, 201)
})

// List the caller's card collection.
cards.get('/', async (c) => {
  const service = new CardService(c.env.DB)
  const collection = await service.getCollection(c.get('orbitId'))
  return c.json({ cards: collection })
})

// Browse open marketplace listings (active cards only).
cards.get('/market', async (c) => {
  const service = new CardService(c.env.DB)
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const listings = await service.listMarket({ limit, offset })
  return c.json({ listings })
})

cards.get('/:id/history', async (c) => {
  const service = new CardService(c.env.DB)
  const history = await service.getHistory(c.req.param('id'), c.get('orbitId'))
  return c.json({ history })
})

cards.get('/:id', async (c) => {
  const service = new CardService(c.env.DB)
  const card = await service.getCard(c.req.param('id'), c.get('orbitId'))
  if (!card) return c.json({ error: 'Card not found' }, 404)
  return c.json({ card })
})

cards.post('/:id/list', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const price = Number(body?.price)
  const service = new CardService(c.env.DB)
  const card = await service.listForSale(c.get('orbitId'), c.req.param('id'), price)
  return c.json({ card })
})

cards.post('/:id/cancel', async (c) => {
  const service = new CardService(c.env.DB)
  await service.cancelListing(c.get('orbitId'), c.req.param('id'))
  return c.json({ ok: true })
})

cards.post('/:id/buy', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const key = idempotencyKey(c, body)
  const service = new CardService(c.env.DB)
  const result = await service.buyCard(c.get('orbitId'), c.req.param('id'), key)
  return c.json(result)
})

cards.post('/:id/transfer', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const toUserId = String(body?.to_user_id || '').trim()
  const service = new CardService(c.env.DB)
  const card = await service.transferOwnership(c.get('orbitId'), toUserId, c.req.param('id'))
  return c.json({ card })
})

// Cash out a card for g$ at the admin-controlled inflation rate. Idempotent.
cards.post('/:id/cashout', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const key = idempotencyKey(c, body)
  const service = new CardService(c.env.DB)
  const result = await service.cashOutCard(c.get('orbitId'), c.req.param('id'), key)
  return c.json(result)
})
