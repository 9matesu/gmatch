import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { EconomyService } from '../economy'
import { getCashoutRateBps } from '../cards'
import { badRequest, toDomainError } from '../common/errors'

type Bindings = { DB: D1Turso }

export const economy = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

economy.use('*', orbitAuth)

economy.onError((err, c) => {
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

economy.get('/balance', async (c) => {
  const service = new EconomyService(c.env.DB)
  const balance = await service.getBalance(c.get('orbitId'))
  return c.json({ balance })
})

// Current cashout inflation rate (bps) for the store dashboard. Public to any
// authenticated user; the rate is set exclusively by admins.
economy.get('/cashout-rate', async (c) => {
  const rateBps = await getCashoutRateBps(c.env.DB)
  return c.json({ rateBps })
})

economy.get('/transactions', async (c) => {
  const service = new EconomyService(c.env.DB)
  const limit = Number(c.req.query('limit') || '50')
  const offset = Number(c.req.query('offset') || '0')
  const transactions = await service.listTransactions(c.get('orbitId'), limit, offset)
  return c.json({ transactions })
})

// Transfer g$ to another user. Idempotent via Idempotency-Key.
economy.post('/transfer', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const toUserId = String(body?.to_user_id || '').trim()
  const amount = Number(body?.amount)
  const key = idempotencyKey(c, body)

  const service = new EconomyService(c.env.DB)
  const result = await service.transfer(c.get('orbitId'), toUserId, amount, {
    idempotencyKey: key,
    kind: 'transfer',
    reference: body?.reference || null,
  })
  return c.json(result)
})
