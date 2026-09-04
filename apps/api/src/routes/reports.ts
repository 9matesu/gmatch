import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { reportContent, ReportError, type ReportTargetType } from '../reports'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const reportRouter = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

reportRouter.use('*', orbitAuth)

// Unified report endpoint. Reporting instantly hides the target for everyone
// and drops it into the admin moderation queue.
reportRouter.post('/', async (c) => {
  const reporterId = c.get('orbitId')
  let type = ''
  let id = ''
  let category: string | null = null
  let reason: string | null = null
  let objectId: string | null = null
  try {
    const body = await c.req.json()
    if (typeof body?.target_type === 'string') type = body.target_type.trim()
    if (typeof body?.target_id === 'string') id = body.target_id.trim()
    if (typeof body?.category === 'string') category = body.category.slice(0, 50) || null
    if (typeof body?.reason === 'string') reason = body.reason.slice(0, 500) || null
    if (typeof body?.object_id === 'string') objectId = body.object_id.slice(0, 64) || null
  } catch { }

  try {
    const result = await reportContent(c.env.DB, reporterId, type as ReportTargetType, id, category, reason, objectId)
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})