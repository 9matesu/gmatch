import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

type Bindings = {
  DB: D1Turso
}

const recommendations = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

recommendations.use('*', orbitAuth)

// User submits a recommendation/feedback/bug report
recommendations.post('/', async (c) => {
  const orbitId = c.get('orbitId')
  let category = 'Feature'
  let content = ''

  try {
    const body = await c.req.json()
    if (body?.category && ['Feature', 'UI', 'Idea', 'Bug'].includes(body.category)) {
      category = body.category
    }
    if (body?.content) {
      content = String(body.content).substring(0, 2000).trim()
    }
  } catch {}

  if (!content) {
    return c.json({ error: 'Content is required' }, 400)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(`
    INSERT INTO Recommendations (id, user_id, category, content, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).bind(id, orbitId, category, content).run()

  return c.json({ success: true, id })
})

export { recommendations }
