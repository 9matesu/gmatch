import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

type Bindings = { DB: D1Turso }

async function resolveAttachmentId(
  db: D1Turso,
  senderId: string,
  attachmentId: string,
): Promise<{ id: string } | { error: string; status?: number }> {
  const obj = await db.prepare(
    'SELECT id, owner_id, is_public, hidden_at, mime_type FROM Objects WHERE id = ?'
  ).bind(attachmentId).first<{ id: string; owner_id: string; is_public: number; hidden_at: string | null; mime_type: string }>()
  if (!obj) return { error: 'Attachment not found', status: 404 }
  if (obj.hidden_at) return { error: 'Attachment is unavailable', status: 400 }
  if (obj.owner_id !== senderId && obj.is_public !== 1) {
    return { error: 'Attachment is not shareable', status: 403 }
  }
  return { id: obj.id }
}

export const groups = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

groups.use('*', orbitAuth)

const MAX_BODY_LEN = 4000
const MAX_NAME_LEN = 60

async function isMember(db: D1Turso, groupId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM ChatGroupMembers WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first()
  return Boolean(row)
}

function validateBody(body: unknown): string | null {
  if (typeof body !== 'string') return 'body must be a string'
  const trimmed = body.trim()
  if (!trimmed) return 'body must not be empty'
  if (trimmed.length > MAX_BODY_LEN) return `body exceeds ${MAX_BODY_LEN} chars`
  return null
}

groups.get('/', async (c) => {
  const userId = c.get('orbitId')
  const { results } = await c.env.DB.prepare(`
    SELECT g.id, g.name, g.owner_id,
           (SELECT COUNT(*) FROM ChatGroupMembers m WHERE m.group_id = g.id) as member_count,
           (SELECT COUNT(*) FROM ChatGroupMembers m WHERE m.group_id = g.id AND m.user_id = ?) as is_member
    FROM ChatGroups g
    JOIN ChatGroupMembers me ON me.group_id = g.id AND me.user_id = ?
    ORDER BY g.updated_at DESC
  `).bind(userId, userId).all()
  return c.json({ groups: results || [] })
})

groups.post('/', async (c) => {
  const userId = c.get('orbitId')
  let name = ''
  let memberIds: string[] = []
  try {
    const body = await c.req.json()
    if (typeof body?.name === 'string') name = body.name.trim()
    if (Array.isArray(body?.member_ids)) memberIds = body.member_ids.map(String).filter(Boolean)
  } catch {}
  if (!name) return c.json({ error: 'name is required' }, 400)
  name = name.slice(0, MAX_NAME_LEN)

  const id = crypto.randomUUID()
  const members = Array.from(new Set([userId, ...memberIds])).slice(0, 50)
  await c.env.DB.atomicBatch([
    { sql: 'INSERT INTO ChatGroups (id, name, owner_id) VALUES (?, ?, ?)', args: [id, name, userId] },
    ...members.map((mid) => ({ sql: 'INSERT INTO ChatGroupMembers (group_id, user_id) VALUES (?, ?)', args: [id, mid] })),
  ])
  return c.json({ group: { id, name, owner_id: userId, member_count: members.length } }, 201)
})

groups.get('/:id/messages', async (c) => {
  const userId = c.get('orbitId')
  const groupId = c.req.param('id')
  if (!(await isMember(c.env.DB, groupId, userId))) return c.json({ error: 'Not a member' }, 403)
  // No LIMIT. Group history is permanent.
  //
  // This used to be `ORDER BY gm.created_at ASC LIMIT 200`, which was not
  // merely a truncation — combined with the ascending order it returned the
  // OLDEST 200 rows. Once a group passed 200 messages, reloading the
  // conversation showed the start of its history and silently dropped
  // everything after it, including messages sent seconds earlier. Live
  // messages still arrived over the socket, so the missing middle read as
  // "nothing happened today".
  const { results } = await c.env.DB.prepare(`
    SELECT gm.id, gm.group_id, gm.sender_id, gm.body, gm.reply_to, gm.attachment_id, gm.created_at, u.display_name as sender_name,
           o.content_url as attachment_url, o.mime_type as attachment_mime
    FROM GroupMessages gm
    LEFT JOIN Users u ON u.id = gm.sender_id
    LEFT JOIN Objects o ON o.id = gm.attachment_id
    WHERE gm.group_id = ? AND gm.hidden_at IS NULL
    ORDER BY gm.created_at ASC
  `).bind(groupId).all()
  return c.json(results || [])
})

groups.post('/:id/messages', async (c) => {
  const userId = c.get('orbitId')
  const groupId = c.req.param('id')
  if (!(await isMember(c.env.DB, groupId, userId))) return c.json({ error: 'Not a member' }, 403)

  let body = ''
  let replyTo: string | null = null
  let attachmentId: string | null = null
  try {
    const json = await c.req.json()
    if (typeof json?.body === 'string') body = json.body
    if (typeof json?.reply_to === 'string' && json.reply_to.trim()) replyTo = json.reply_to.trim()
    if (typeof json?.attachment_id === 'string' && json.attachment_id.trim()) attachmentId = json.attachment_id.trim()
  } catch {}
  const err = validateBody(body)
  if (err && !attachmentId) return c.json({ error: err }, 400)

  // Validate attachment if provided
  if (attachmentId) {
    const resolved = await resolveAttachmentId(c.env.DB, userId, attachmentId)
    if ('error' in resolved) return c.json({ error: resolved.error }, (resolved.status ?? 400) as ContentfulStatusCode)
    attachmentId = resolved.id
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO GroupMessages (id, group_id, sender_id, body, reply_to, attachment_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, groupId, userId, body.trim(), replyTo, attachmentId).run()
  await c.env.DB.prepare('UPDATE ChatGroups SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(groupId).run()

  // Grant all group members read access to the attachment
  if (attachmentId) {
    const members = await c.env.DB.prepare('SELECT user_id FROM ChatGroupMembers WHERE group_id = ?').bind(groupId).all<{ user_id: string }>()
    for (const m of members.results || []) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(attachmentId, m.user_id).run().catch(() => { })
    }
  }

  const sender = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(userId).first<{ display_name: string | null }>()
  let attachmentMime: string | null = null
  if (attachmentId) {
    const obj = await c.env.DB.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind(attachmentId).first<{ mime_type: string | null }>()
    attachmentMime = obj?.mime_type || null
  }
  const msg = { id, group_id: groupId, sender_id: userId, sender_name: sender?.display_name?.trim() || 'Unknown User', body: body.trim(), reply_to: replyTo, attachment_id: attachmentId, attachment_mime: attachmentMime, created_at: new Date().toISOString() }

  // Push to every member's open socket so their group thread refreshes.
  try {
    const members = await c.env.DB.prepare('SELECT user_id FROM ChatGroupMembers WHERE group_id = ?').bind(groupId).all<{ user_id: string }>()
    const { broadcastToUser } = await import('../ws-bus')
    for (const m of members.results || []) {
      if (m.user_id !== userId) broadcastToUser(m.user_id, { type: 'group', action: 'new', message: msg })
    }
  } catch { }

  return c.json({ message: msg })
})

groups.get('/:id/members', async (c) => {
  const userId = c.get('orbitId')
  const groupId = c.req.param('id')
  if (!(await isMember(c.env.DB, groupId, userId))) return c.json({ error: 'Not a member' }, 403)
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.display_name, CASE WHEN g.owner_id = u.id THEN 1 ELSE 0 END as is_owner
    FROM ChatGroupMembers m
    JOIN Users u ON u.id = m.user_id
    JOIN ChatGroups g ON g.id = m.group_id
    WHERE m.group_id = ?
    ORDER BY is_owner DESC, u.display_name ASC
    LIMIT 50
  `).bind(groupId).all<{ id: string; display_name: string | null; is_owner: number }>()
  return c.json({ members: (results || []).map((r) => ({ ...r, display_name: r.display_name?.trim() || 'Unknown User' })) })
})

groups.post('/:id/members', async (c) => {
  const userId = c.get('orbitId')
  const groupId = c.req.param('id')
  const group = await c.env.DB.prepare('SELECT owner_id FROM ChatGroups WHERE id = ?').bind(groupId).first<{ owner_id: string }>()
  if (!group) return c.json({ error: 'Group not found' }, 404)
  if (group.owner_id !== userId) return c.json({ error: 'Only the owner can add members' }, 403)

  let memberIds: string[] = []
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.member_ids)) memberIds = body.member_ids.map(String).filter(Boolean)
  } catch {}
  for (const mid of memberIds.slice(0, 50)) {
    await c.env.DB.prepare('INSERT INTO ChatGroupMembers (group_id, user_id) VALUES (?, ?) ON CONFLICT(group_id, user_id) DO NOTHING').bind(groupId, mid).run()
  }
  return c.json({ ok: true })
})

groups.post('/:id/leave', async (c) => {
  const userId = c.get('orbitId')
  const groupId = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM ChatGroupMembers WHERE group_id = ? AND user_id = ?').bind(groupId, userId).run()
  return c.json({ ok: true })
})
