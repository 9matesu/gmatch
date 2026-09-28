import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import {
  listNotifications,
  unreadNotificationCount,
  unreadNotificationCountsByType,
  markNotificationsRead,
  listMyInvites,
  createMatchInvite,
  acceptMatchInvite,
  declineMatchInvite,
  expireStaleInvites,
} from '../notifications'
import { broadcastToUser } from '../ws-bus'
import { withMatchLock } from '../lobby'

type Bindings = {
  DB: D1Turso
}

export const notifications = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
export const matchInvites = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

notifications.use('*', orbitAuth)
matchInvites.use('*', orbitAuth)

// ---------------------------------------------------------------------------
// Notifications (header bell)
// ---------------------------------------------------------------------------

notifications.get('/', async (c) => {
  const userId = c.get('orbitId')
  const items = await listNotifications(c.env.DB, userId)
  const [unread, unreadByType] = await Promise.all([
    unreadNotificationCount(c.env.DB, userId),
    unreadNotificationCountsByType(c.env.DB, userId),
  ])
  // `unread_by_type` is additive: older clients keep reading `unread`.
  return c.json({ notifications: items, unread, unread_by_type: unreadByType })
})

notifications.get('/unread-count', async (c) => {
  const userId = c.get('orbitId')
  const [unread, unreadByType] = await Promise.all([
    unreadNotificationCount(c.env.DB, userId),
    unreadNotificationCountsByType(c.env.DB, userId),
  ])
  return c.json({ unread, unread_by_type: unreadByType })
})

// Mark notifications read. Body: `{ ids: string[] }` — omit ids (or send [])
// to mark all read.
notifications.post('/read', async (c) => {
  const userId = c.get('orbitId')
  let ids: string[] = []
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.ids)) ids = body.ids.map(String).filter(Boolean)
  } catch {}
  await markNotificationsRead(c.env.DB, userId, ids)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Match invites (challenge a specific player to a 1v1)
// ---------------------------------------------------------------------------

// My invites — invitee's inbox (the bell surfaces open ones with Accept/Decline).
matchInvites.get('/', async (c) => {
  const userId = c.get('orbitId')
  await expireStaleInvites(c.env.DB)
  const invites = await listMyInvites(c.env.DB, userId)
  return c.json({ invites })
})

// Challenge a specific online player.
matchInvites.post('/', async (c) => {
  const inviterId = c.get('orbitId')
  let inviteeId = ''
  try {
    const body = await c.req.json()
    if (typeof body?.invitee_id === 'string') inviteeId = body.invitee_id.trim()
  } catch {}
  const result = await createMatchInvite(c.env.DB, inviterId, inviteeId)
  if ('error' in result) {
    return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  // Real-time push: the invitee's bell updates instantly.
  broadcastToUser(inviteeId, { type: 'notification', action: 'new', invite: result })
  return c.json({ invite: result }, 201)
})

matchInvites.post('/:id/accept', async (c) => {
  const inviteeId = c.get('orbitId')
  const inviteId = c.req.param('id') || ''
  const result = await withMatchLock(() => acceptMatchInvite(c.env.DB, inviteId, inviteeId))
  if ('error' in result) {
    return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  const { broadcastToRoom } = await import('../ws-bus')
  broadcastToRoom('lobby', { type: 'lobby', action: 'updated' })
  return c.json({ ok: true, match_id: result.id })
})

matchInvites.post('/:id/decline', async (c) => {
  const inviteeId = c.get('orbitId')
  const inviteId = c.req.param('id') || ''
  const result = await declineMatchInvite(c.env.DB, inviteId, inviteeId)
  if ('error' in result) {
    return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  }
  return c.json({ ok: true })
})
