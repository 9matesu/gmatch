import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { DeckService, DEFAULT_CARD_DUEL_RULES } from '../decks'
import { toDomainError } from '../common/errors'

type Bindings = { DB: D1Turso }

export const decks = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

decks.use('*', orbitAuth)

decks.onError((err, c) => {
  const d = toDomainError(err)
  return c.json({ error: d.message }, d.status as any)
})

decks.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const service = new DeckService(c.env.DB)
  const deck = await service.createDeck(c.get('orbitId'), String(body?.name || '').trim(), String(body?.game_id || 'card-duel'))
  return c.json({ deck }, 201)
})

decks.get('/', async (c) => {
  const service = new DeckService(c.env.DB)
  const deckList = await service.getDecksForUser(c.get('orbitId'))
  return c.json({ decks: deckList })
})

decks.get('/:id', async (c) => {
  const service = new DeckService(c.env.DB)
  const deck = await service.getDeck(c.req.param('id'), c.get('orbitId'))
  if (!deck) return c.json({ error: 'Deck not found' }, 404)
  return c.json({ deck })
})

decks.patch('/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const service = new DeckService(c.env.DB)
  const deck = await service.renameDeck(c.get('orbitId'), c.req.param('id'), String(body?.name || '').trim())
  return c.json({ deck })
})

decks.delete('/:id', async (c) => {
  const service = new DeckService(c.env.DB)
  await service.deleteDeck(c.get('orbitId'), c.req.param('id'))
  return c.json({ ok: true })
})

decks.post('/:id/cards', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const service = new DeckService(c.env.DB)
  const deck = await service.addCard(c.get('orbitId'), c.req.param('id'), String(body?.card_id || '').trim(), DEFAULT_CARD_DUEL_RULES)
  return c.json({ deck })
})

decks.delete('/:id/cards/:cardId', async (c) => {
  const service = new DeckService(c.env.DB)
  const deck = await service.removeCard(c.get('orbitId'), c.req.param('id'), c.req.param('cardId'))
  return c.json({ deck })
})

decks.post('/:id/validate', async (c) => {
  const service = new DeckService(c.env.DB)
  // Ownership check: getDeck returns null for foreign decks (same filter as GET /:id).
  const owned = await service.getDeck(c.req.param('id'), c.get('orbitId'))
  if (!owned) return c.json({ error: 'Deck not found' }, 404)
  const result = await service.validateDeck(c.req.param('id'), DEFAULT_CARD_DUEL_RULES)
  return c.json(result)
})
