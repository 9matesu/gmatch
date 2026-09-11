import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import {
  sendPrivateMessage,
  listPrivateMessages,
  deletePrivateMessage,
  getUnreadPmCount,
  listPmThreads,
  markPmRead,
  validatePmBody,
  deletePrivateMessageForEveryone,
  editPrivateMessage,
  deletePmThread,
  getPmHistory,
} from '../pm'
import { broadcastToUser } from '../ws-bus'
import { reportContent, ReportError } from '../reports'

type Bindings = {
  DB: D1Turso
}

export const pm = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

pm.use('*', orbitAuth)

// Send a private message
pm.post('/', async (c) => {
  const senderId = c.get('orbitId')
  let recipientId = ''
  let body = ''
  let replyTo: string | null = null
  let attachmentId: string | null = null
  try {
    const json = await c.req.json()
    if (typeof json?.recipient_id === 'string') recipientId = json.recipient_id.trim()
    if (typeof json?.body === 'string') body = json.body
    if (typeof json?.reply_to === 'string' && json.reply_to.trim()) replyTo = json.reply_to.trim()
    if (typeof json?.attachment_id === 'string' && json.attachment_id.trim()) attachmentId = json.attachment_id.trim()
  } catch {}
  if (!recipientId) return c.json({ error: 'recipient_id is required' }, 400)
  if (!attachmentId) {
    const validErr = validatePmBody(body)
    if (validErr) return c.json({ error: validErr }, 400)
  }

  const result = await sendPrivateMessage(c.env.DB, senderId, recipientId, body, replyTo, attachmentId)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)

  // Real-time push: the recipient's open WS connection (authenticated swarm
  // socket) immediately refreshes its PM inbox/threads without waiting for the
  // next poll. The sender already receives the message from the POST response.
  if (!('error' in result) && result.recipient_id) {
    broadcastToUser(result.recipient_id, { type: 'pm', action: 'new', message: result })
  }
  // Persistent notification for the header bell (survives reload; pruned by
  // the 48h maintenance sweep). Runs after the WS push so both channels fire.
  if (!('error' in result) && result.recipient_id) {
    try {
      const { createNotification } = await import('../notifications')
      const { broadcastToUser: pushUser } = await import('../ws-bus')
      const senderRow = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(result.sender_id).first<{ display_name: string | null }>()
      const notif = await createNotification(
        c.env.DB,
        result.recipient_id,
        'pm',
        'New private message',
        `${senderRow?.display_name?.trim() || 'Someone'} sent you a message`,
        { pm_id: result.id, sender_id: result.sender_id }
      )
      if (notif) pushUser(result.recipient_id, { type: 'notification', action: 'new', notification: notif })
    } catch (err) {
      console.warn('[pm] notification push failed:', err)
    }
  }
  return c.json({ ok: true, message: result })
})

// Send a private message (story-reply alias — maps receiver_id/content to the
// canonical recipient_id/body shape used by POST /)
pm.post('/send', async (c) => {
  const senderId = c.get('orbitId')
  let recipientId = ''
  let body = ''
  let replyTo: string | null = null
  let attachmentId: string | null = null
  try {
    const json = await c.req.json()
    if (typeof json?.recipient_id === 'string') recipientId = json.recipient_id.trim()
    else if (typeof json?.receiver_id === 'string') recipientId = json.receiver_id.trim()
    if (typeof json?.body === 'string') body = json.body
    else if (typeof json?.content === 'string') body = json.content
    if (typeof json?.reply_to === 'string' && json.reply_to.trim()) replyTo = json.reply_to.trim()
    if (typeof json?.attachment_id === 'string' && json.attachment_id.trim()) attachmentId = json.attachment_id.trim()
  } catch {}
  if (!recipientId) return c.json({ error: 'recipient_id is required' }, 400)
  if (!attachmentId) {
    const validErr = validatePmBody(body)
    if (validErr) return c.json({ error: validErr }, 400)
  }

  const result = await sendPrivateMessage(c.env.DB, senderId, recipientId, body, replyTo, attachmentId)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)

  if (!('error' in result) && result.recipient_id) {
    broadcastToUser(result.recipient_id, { type: 'pm', action: 'new', message: result })
  }
  if (!('error' in result) && result.recipient_id) {
    try {
      const { createNotification } = await import('../notifications')
      const { broadcastToUser: pushUser } = await import('../ws-bus')
      const senderRow = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(result.sender_id).first<{ display_name: string | null }>()
      const notif = await createNotification(
        c.env.DB,
        result.recipient_id,
        'pm',
        'New private message',
        `${senderRow?.display_name?.trim() || 'Someone'} sent you a message`,
        { pm_id: result.id, sender_id: result.sender_id }
      )
      if (notif) pushUser(result.recipient_id, { type: 'notification', action: 'new', notification: notif })
    } catch (err) {
      console.warn('[pm] notification push failed:', err)
    }
  }
  return c.json({ ok: true, message: result })
})

// List user's private messages (optionally scoped to a peer conversation)
pm.get('/', async (c) => {
  const userId = c.get('orbitId')
  const peerId = c.req.query('peer') || undefined
  const limitStr = c.req.query('limit')
  const limit = limitStr ? parseInt(limitStr, 10) : undefined
  const messages = await listPrivateMessages(c.env.DB, userId, peerId, limit)
  return c.json(messages)
})

pm.get('/unread-count', async (c) => {
  const userId = c.get('orbitId')
  const count = await getUnreadPmCount(c.env.DB, userId)
  return c.json({ count })
})

// Mark a conversation read (called when the user opens a peer's thread).
pm.post('/read', async (c) => {
  const userId = c.get('orbitId')
  let peerId = ''
  try {
    const body = await c.req.json()
    if (typeof body?.peer_id === 'string') peerId = body.peer_id.trim()
  } catch {}
  if (!peerId) return c.json({ error: 'peer_id is required' }, 400)
  await markPmRead(c.env.DB, userId, peerId)
  return c.json({ ok: true })
})

pm.get('/threads', async (c) => {
  const userId = c.get('orbitId')
  const threads = await listPmThreads(c.env.DB, userId)
  return c.json(threads)
})

pm.delete('/:id', async (c) => {
  const userId = c.get('orbitId')
  const id = c.req.param('id')
  const result = await deletePrivateMessage(c.env.DB, userId, id)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  return c.json({ ok: true })
})

// Delete for everyone (sender only, 10 min window). Falls back to soft-delete if outside window.
pm.delete('/:id/everyone', async (c) => {
  const userId = c.get('orbitId')
  const id = c.req.param('id')
  const result = await deletePrivateMessageForEveryone(c.env.DB, userId, id)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  // Notify recipient if deleted for everyone so their UI updates
  if (result.deletedForEveryone) {
    try {
      const pm = await c.env.DB.prepare('SELECT recipient_id FROM PrivateMessages WHERE id = ?').bind(id).first<{ recipient_id: string }>()
      if (pm) broadcastToUser(pm.recipient_id, { type: 'pm', action: 'deleted_everyone', messageId: id })
    } catch {}
  }
  return c.json({ ok: true, deletedForEveryone: result.deletedForEveryone })
})

// Edit message (sender only, 15 min window)
pm.patch('/:id', async (c) => {
  const userId = c.get('orbitId')
  const id = c.req.param('id')
  let newBody = ''
  try {
    const json = await c.req.json()
    if (typeof json?.body === 'string') newBody = json.body
  } catch {}
  const result = await editPrivateMessage(c.env.DB, userId, id, newBody)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  // Push update to both sender and recipient
  try {
    const pm = await c.env.DB.prepare('SELECT recipient_id FROM PrivateMessages WHERE id = ?').bind(id).first<{ recipient_id: string }>()
    if (pm) {
      broadcastToUser(userId, { type: 'pm', action: 'edited', message: result })
      broadcastToUser(pm.recipient_id, { type: 'pm', action: 'edited', message: result })
    }
  } catch {}
  return c.json({ ok: true, message: result })
})

// Delete entire conversation thread for current user
pm.delete('/threads/:peerId', async (c) => {
  const userId = c.get('orbitId')
  const peerId = c.req.param('peerId')
  const result = await deletePmThread(c.env.DB, userId, peerId)
  if ('error' in result) return c.json({ error: result.error }, (result.status ?? 400) as ContentfulStatusCode)
  return c.json({ ok: true, count: result.count })
})

// Paginated PM history for cross-device sync
pm.get('/history/:peerId', async (c) => {
  const userId = c.get('orbitId')
  const peerId = c.req.param('peerId')
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10), 1), 100)
  const before = c.req.query('before') || undefined
  const result = await getPmHistory(c.env.DB, { userId, peerId, limit, before })
  return c.json(result)
})

// Report a specific private message. Hides it instantly, queues the sender.
pm.post('/:id/report', async (c) => {
  const userId = c.get('orbitId')
  const id = c.req.param('id')
  let reason = ''
  try {
    const body = await c.req.json()
    if (typeof body?.reason === 'string') reason = body.reason.trim().slice(0, 300)
  } catch {}
  const pm = await c.env.DB.prepare('SELECT sender_id, recipient_id FROM PrivateMessages WHERE id = ?').bind(id).first<{ sender_id: string; recipient_id: string }>()
  if (!pm) return c.json({ error: 'Message not found' }, 404)
  if (pm.sender_id !== userId && pm.recipient_id !== userId) return c.json({ error: 'Not authorized' }, 403)

  try {
    const result = await reportContent(c.env.DB, userId, 'private_message', id, 'dm_message', reason || 'Inappropriate message')
    return c.json({ ok: true, ...result }, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})

// Report another user (hides their profile + content instantly until resolved).
pm.post('/report-user', async (c) => {
  const userId = c.get('orbitId')
  let reportedId = ''
  let reason = ''
  try {
    const body = await c.req.json()
    if (typeof body?.user_id === 'string') reportedId = body.user_id.trim()
    if (typeof body?.reason === 'string') reason = body.reason.trim().slice(0, 300)
  } catch {}
  if (!reportedId) return c.json({ error: 'user_id is required' }, 400)
  if (reportedId === userId) return c.json({ error: 'Cannot report yourself' }, 400)

  try {
    const result = await reportContent(c.env.DB, userId, 'user', reportedId, 'dm_user', reason || 'Reported user')
    return c.json({ ok: true, ...result }, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})
