import type { D1Turso } from './db'
import { encryptText, decryptText } from './crypto'

/**
 * Private messages data layer. Bodies are stored encrypted at rest
 * (`enc:v1:` AES-256-GCM under STORAGE_ENCRYPTION_KEY) so a raw DB dump does
 * not expose plaintext, while the server can still decrypt them for delivery
 * and moderation — preserving the moderation-first model (moderators must be
 * able to read and act on these; see docs/SECURITY.md for the documented
 * departure from the E2EE match-card model). Ban scopes can turn off PM
 * send/receive without disabling the whole account (Bans.ban_scope_pm column
 * added by migration 009).
 *
 * Deletion model: a "soft delete" writes 'sender' or 'recipient' to
 * deleted_by; the row stays so the other party still sees it. Garbage
 * collection happens when both sides have soft-deleted, OR an admin hard
 * deletes via the D4 admin panel.
 */

export interface PrivateMessageRow {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  edited_at?: string | null
  deleted_by: string | null
  hidden_at: string | null
  reply_to: string | null
  attachment_id: string | null
  attachment_mime?: string | null
}

export interface PrivateMessageView {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  edited_at: string | null
  sender_name: string | null
  recipient_name: string | null
  reply_to: string | null
  attachment_id: string | null
  attachment_mime?: string | null
  read_by_recipient?: boolean
}

const MAX_BODY_LEN = 4000
const MAX_FETCH = 200

export function validatePmBody(body: unknown): string | null {
  if (typeof body !== 'string') return 'body must be a string'
  const trimmed = body.trim()
  if (!trimmed) return 'body must not be empty'
  if (trimmed.length > MAX_BODY_LEN) return `body exceeds ${MAX_BODY_LEN} chars`
  return null
}

/** Validate an attachment reference. The object must be live, not hidden, and
 *  either owned by the sender or a public object (so shared feed media and own
 *  cards can be sent, but someone else's private card cannot be forwarded). */
export async function resolveAttachmentId(
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

/** Send a PM. Returns the new row on success, or `{ error }` on failure. */
export async function sendPrivateMessage(
  db: D1Turso,
  senderId: string,
  recipientId: string,
  body: string,
  replyTo?: string | null,
  attachmentId?: string | null,
): Promise<PrivateMessageRow | { error: string; status?: number }> {
  if (senderId === recipientId) return { error: 'Cannot PM yourself', status: 400 }
  const trimmed = body.trim()
  const hasAttachment = Boolean(attachmentId && attachmentId.trim())
  if (!hasAttachment) {
    const err = validatePmBody(body)
    if (err) return { error: err, status: 400 }
  } else if (trimmed.length > MAX_BODY_LEN) {
    return { error: `body exceeds ${MAX_BODY_LEN} chars`, status: 400 }
  }

  // Validate attachment ownership/shareability before writing the row.
  let attachment: string | null = null
  if (hasAttachment) {
    const resolved = await resolveAttachmentId(db, senderId, attachmentId!.trim())
    if ('error' in resolved) return resolved
    attachment = resolved.id
    // Grant the recipient read access to the attachment object so their signed
    // fetch of /api/objects/:id (which checks Recipients for non-owners) can
    // actually load the media. Without this row only the sender (owner) could
    // view it and the recipient would see a broken image.
    await db.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)')
      .bind(attachment, recipientId).run().catch(() => { })
  }

  // Validate recipient exists
  const recip = await db.prepare('SELECT 1 FROM Users WHERE id = ?').bind(recipientId).first()
  if (!recip) return { error: 'Recipient not found', status: 404 }

  // Sender PM-ban scope check
  const senderBan = await db.prepare(
    'SELECT scope, ban_scope_pm FROM Bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(senderId).first<{ scope: string; ban_scope_pm: number }>()
  if (senderBan && (senderBan.scope === 'all' || senderBan.scope === 'pm' || senderBan.ban_scope_pm === 1)) {
    return { error: 'You are restricted from sending private messages', status: 403 }
  }

  // Recipient PM-ban scope check (recipients under a PM ban cannot receive)
  const recipBan = await db.prepare(
    'SELECT scope, ban_scope_pm FROM Bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(recipientId).first<{ scope: string; ban_scope_pm: number }>()
  if (recipBan && (recipBan.scope === 'all' || recipBan.scope === 'pm' || recipBan.ban_scope_pm === 1)) {
    return { error: 'Recipient cannot receive private messages', status: 403 }
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.prepare(
    'INSERT INTO PrivateMessages (id, sender_id, recipient_id, body, reply_to, attachment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, senderId, recipientId, encryptText(trimmed), replyTo || null, attachment, now).run()

  // Bump last_pm_at on both sides for the directory "wrote PMs recently" filter
  await db.batch([
    db.prepare('UPDATE Users SET last_pm_at = ? WHERE id = ?').bind(now, senderId),
    db.prepare('UPDATE Users SET last_pm_at = ? WHERE id = ?').bind(now, recipientId),
  ])

  let attachmentMime: string | null = null
  if (attachment) {
    const obj = await db.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind(attachment).first<{ mime_type: string | null }>()
    attachmentMime = obj?.mime_type || null
  }

  return {
    id,
    sender_id: senderId,
    recipient_id: recipientId,
    body: trimmed,
    created_at: now,
    deleted_by: null,
    hidden_at: null,
    reply_to: replyTo || null,
    attachment_id: attachment,
    attachment_mime: attachmentMime,
  }
}

/** List conversation-style PMs for a user. Includes both directions, with
 *  peer name lookup. Newest first, capped at MAX_FETCH. `peerId` filters to a
 *  single conversation thread.
 *
 *  Soft-delete semantics: a user does not see rows they've soft-deleted
 *  (deleted_by = their own side), but can still see rows the other side has
 *  soft-deleted. Admin moderation bypasses this filter (see admin route).
 *
 *  Note: SQLite treats `NOT (col = 'x')` as NULL (falsy) when col is NULL,
 *  so we use `COALESCE(col, '') != 'x'` to make sure NULL rows pass through.
 */
export async function listPrivateMessages(
  db: D1Turso,
  userId: string,
  peerId?: string,
  limit?: number,
): Promise<PrivateMessageView[]> {
  const cap = Math.min(Math.max(1, limit ?? MAX_FETCH), MAX_FETCH)
  const sql = peerId
    ? `SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at, pm.edited_at, pm.reply_to, pm.attachment_id,
              o.mime_type as attachment_mime,
              s.display_name as sender_name, r.display_name as recipient_name,
              CASE 
                WHEN pm.sender_id = ? THEN 
                  EXISTS(
                    SELECT 1 FROM PmReadReceipts rr 
                    WHERE rr.user_id = pm.recipient_id AND rr.peer_id = pm.sender_id 
                    AND datetime(rr.last_read_at) >= datetime(pm.created_at)
                  )
                ELSE 0
              END as read_by_recipient
        FROM PrivateMessages pm
        LEFT JOIN Objects o ON o.id = pm.attachment_id
        LEFT JOIN Users s ON s.id = pm.sender_id
        LEFT JOIN Users r ON r.id = pm.recipient_id
        WHERE (
          ((pm.sender_id = ? AND pm.recipient_id = ?) OR (pm.recipient_id = ? AND pm.sender_id = ?))
          AND NOT (pm.sender_id = ? AND COALESCE(pm.deleted_by, '') = 'sender')
          AND NOT (pm.recipient_id = ? AND COALESCE(pm.deleted_by, '') = 'recipient')
          AND pm.hidden_at IS NULL
        )
        ORDER BY pm.created_at DESC
        LIMIT ?`
    : `SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at, pm.edited_at, pm.reply_to, pm.attachment_id,
              o.mime_type as attachment_mime,
              s.display_name as sender_name, r.display_name as recipient_name,
              CASE 
                WHEN pm.sender_id = ? THEN 
                  EXISTS(
                    SELECT 1 FROM PmReadReceipts rr 
                    WHERE rr.user_id = pm.recipient_id AND rr.peer_id = pm.sender_id 
                    AND datetime(rr.last_read_at) >= datetime(pm.created_at)
                  )
                ELSE 0
              END as read_by_recipient
        FROM PrivateMessages pm
        LEFT JOIN Objects o ON o.id = pm.attachment_id
        LEFT JOIN Users s ON s.id = pm.sender_id
        LEFT JOIN Users r ON r.id = pm.recipient_id
        WHERE (
          (pm.sender_id = ? OR pm.recipient_id = ?)
          AND NOT (pm.sender_id = ? AND COALESCE(pm.deleted_by, '') = 'sender')
          AND NOT (pm.recipient_id = ? AND COALESCE(pm.deleted_by, '') = 'recipient')
          AND pm.hidden_at IS NULL
        )
        ORDER BY pm.created_at DESC
        LIMIT ?`
  const stmt = peerId
    ? db.prepare(sql).bind(userId, userId, peerId, userId, peerId, userId, userId, cap)
    : db.prepare(sql).bind(userId, userId, userId, userId, userId, cap)
  const { results } = await stmt.all()
  return (results || []).map((r: any) => ({ 
    ...r, 
    body: decryptText(r.body ?? ''),
    read_by_recipient: Boolean(r.read_by_recipient),
  })) as PrivateMessageView[]
}

/** Soft-delete a PM on behalf of one side. Removes the row entirely once both
 *  sides have soft-deleted, to keep the snapshot lean. */
export async function deletePrivateMessage(
  db: D1Turso,
  userId: string,
  pmId: string,
): Promise<{ ok: true } | { error: string; status?: number }> {
  const pm = await db.prepare('SELECT sender_id, recipient_id, deleted_by FROM PrivateMessages WHERE id = ?')
    .bind(pmId).first<{ sender_id: string; recipient_id: string; deleted_by: string | null }>()
  if (!pm) return { error: 'Message not found', status: 404 }
  if (pm.sender_id !== userId && pm.recipient_id !== userId) {
    return { error: 'Not authorized', status: 403 }
  }
  const mySide = pm.sender_id === userId ? 'sender' : 'recipient'
  // Already soft-deleted by us? idempotent OK
  if (pm.deleted_by === mySide || pm.deleted_by === 'both') return { ok: true }

  if (pm.deleted_by === null) {
    await db.prepare('UPDATE PrivateMessages SET deleted_by = ? WHERE id = ?').bind(mySide, pmId).run()
  } else {
    // Other side already soft-deleted; garbage-collect
    await db.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(pmId).run()
  }
  return { ok: true }
}

/** Snapshot of inbox counts for the directory-style UI header. */
export async function getUnreadPmCount(db: D1Turso, userId: string): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) as n FROM PrivateMessages pm
       WHERE pm.recipient_id = ?
         AND pm.hidden_at IS NULL
         AND COALESCE(pm.deleted_by, '') != 'recipient'
         AND pm.created_at > COALESCE(
           (SELECT r.last_read_at FROM PmReadReceipts r WHERE r.user_id = ? AND r.peer_id = pm.sender_id),
           '1970-01-01T00:00:00.000Z'
         )`
    ).bind(userId, userId).first<{ n: number }>()
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/** Mark a conversation as read up to now. */
export async function markPmRead(db: D1Turso, userId: string, peerId: string): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO PmReadReceipts (user_id, peer_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, peer_id) DO UPDATE SET last_read_at = excluded.last_read_at`
    ).bind(userId, peerId, new Date().toISOString()).run()
  } catch { }
}

/** Recent peer threads for the "PMs sidebar" view — one row per peer.
 *  Returns the latest message in each conversation along with the peer's
 *  display name (lookup optional; the client can hydrate from its User
 *  list). Newest first, capped at 40 threads. */
export interface PmThreadRow {
  peer_id: string
  peer_name: string | null
  last_id: string
  last_body: string
  last_sender_id: string
  last_created_at: string
  unread_count: number
}
export async function listPmThreads(db: D1Turso, userId: string): Promise<PmThreadRow[]> {
  try {
    const { results } = await db.prepare(
      `SELECT
         t.peer_id as peer_id,
         peer.display_name as peer_name,
         last.id   as last_id,
         last.body as last_body,
         last.sender_id as last_sender_id,
         last.created_at as last_created_at,
         (SELECT COUNT(*) FROM PrivateMessages u
           WHERE u.recipient_id = ? AND u.sender_id = t.peer_id
             AND u.hidden_at IS NULL
             AND COALESCE(u.deleted_by, '') != 'recipient'
             AND u.created_at > COALESCE(
               (SELECT r.last_read_at FROM PmReadReceipts r WHERE r.user_id = ? AND r.peer_id = t.peer_id),
               '1970-01-01T00:00:00.000Z'
             )) as unread_count
       FROM (
         SELECT
           CASE WHEN pm.sender_id = ? THEN pm.recipient_id ELSE pm.sender_id END as peer_id,
           MAX(pm.created_at) as last_at
         FROM PrivateMessages pm
         WHERE (pm.sender_id = ? OR pm.recipient_id = ?)
           AND NOT (pm.sender_id = ?     AND COALESCE(pm.deleted_by, '') = 'sender')
           AND NOT (pm.recipient_id = ?  AND COALESCE(pm.deleted_by, '') = 'recipient')
         GROUP BY peer_id
         ORDER BY last_at DESC
         LIMIT 40
       ) as t
       LEFT JOIN PrivateMessages as last
         ON last.created_at = t.last_at
         AND (last.sender_id = t.peer_id OR last.recipient_id = t.peer_id)
         AND (last.sender_id = ? OR last.recipient_id = ?)
       LEFT JOIN Users as peer ON peer.id = t.peer_id
       ORDER BY last_created_at DESC`
    ).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId).all()
    return (results || []).map((r: any) => ({
      ...r,
      unread_count: Number(r.unread_count || 0),
      last_body: decryptText(r.last_body ?? ''),
    })) as PmThreadRow[]
  } catch {
    return []
  }
}

const DELETE_FOR_EVERYONE_WINDOW_MS = 10 * 60 * 1000
const EDIT_WINDOW_MS = 15 * 60 * 1000

/** Hard-delete a PM for both sides (sender only, within 10 min window).
 *  If outside window, falls back to soft-delete for sender only. */
export async function deletePrivateMessageForEveryone(
  db: D1Turso,
  userId: string,
  pmId: string,
): Promise<{ ok: true; deletedForEveryone: boolean } | { error: string; status?: number }> {
  const pm = await db.prepare('SELECT sender_id, recipient_id, created_at, deleted_by FROM PrivateMessages WHERE id = ?')
    .bind(pmId).first<{ sender_id: string; recipient_id: string; created_at: string; deleted_by: string | null }>()
  if (!pm) return { error: 'Message not found', status: 404 }
  if (pm.sender_id !== userId) {
    return { error: 'Only the sender can delete for everyone', status: 403 }
  }

  const createdAt = new Date(pm.created_at).getTime()
  const now = Date.now()
  const withinWindow = now - createdAt <= DELETE_FOR_EVERYONE_WINDOW_MS

  if (withinWindow) {
    // Hard delete - remove row entirely for both parties
    await db.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(pmId).run()
    return { ok: true, deletedForEveryone: true }
  } else {
    // Outside window: soft delete for sender only (existing behavior)
    const mySide = 'sender'
    if (pm.deleted_by === mySide || pm.deleted_by === 'both') return { ok: true, deletedForEveryone: false }
    if (pm.deleted_by === null) {
      await db.prepare('UPDATE PrivateMessages SET deleted_by = ? WHERE id = ?').bind(mySide, pmId).run()
    } else {
      await db.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(pmId).run()
    }
    return { ok: true, deletedForEveryone: false }
  }
}

/** Edit a PM body (sender only, within 15 min window). */
export async function editPrivateMessage(
  db: D1Turso,
  userId: string,
  pmId: string,
  newBody: string,
): Promise<PrivateMessageRow | { error: string; status?: number }> {
  const pm = await db.prepare('SELECT sender_id, recipient_id, created_at, body, reply_to, attachment_id FROM PrivateMessages WHERE id = ?')
    .bind(pmId).first<{ sender_id: string; recipient_id: string; created_at: string; body: string; reply_to: string | null; attachment_id: string | null }>()
  if (!pm) return { error: 'Message not found', status: 404 }
  if (pm.sender_id !== userId) {
    return { error: 'Only the sender can edit this message', status: 403 }
  }

  const createdAt = new Date(pm.created_at).getTime()
  const now = Date.now()
  if (now - createdAt > EDIT_WINDOW_MS) {
    return { error: 'Edit window expired (15 minutes)', status: 400 }
  }

  const trimmed = newBody.trim()
  if (!trimmed) return { error: 'body must not be empty', status: 400 }
  if (trimmed.length > MAX_BODY_LEN) return { error: `body exceeds ${MAX_BODY_LEN} chars`, status: 400 }

  const editedAt = new Date().toISOString()
  await db.prepare(
    'UPDATE PrivateMessages SET body = ?, edited_at = ? WHERE id = ?'
  ).bind(encryptText(trimmed), editedAt, pmId).run()

  let attachmentMime: string | null = null
  if (pm.attachment_id) {
    const obj = await db.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind(pm.attachment_id).first<{ mime_type: string | null }>()
    attachmentMime = obj?.mime_type || null
  }

  return {
    id: pmId,
    sender_id: pm.sender_id,
    recipient_id: pm.recipient_id,
    body: trimmed,
    created_at: pm.created_at,
    edited_at: editedAt,
    deleted_by: null,
    hidden_at: null,
    reply_to: pm.reply_to,
    attachment_id: pm.attachment_id,
    attachment_mime: attachmentMime,
  }
}

/** Soft-delete all messages in a conversation thread for the current user.
 *  Marks all messages where user is sender or recipient as deleted_by their side. */
export async function deletePmThread(
  db: D1Turso,
  userId: string,
  peerId: string,
): Promise<{ ok: true; count: number } | { error: string; status?: number }> {
  // Verify peer exists
  const peer = await db.prepare('SELECT 1 FROM Users WHERE id = ?').bind(peerId).first()
  if (!peer) return { error: 'Peer not found', status: 404 }

  // Get all message IDs in this thread where user is a participant
  const messages = await db.prepare(
    `SELECT id, sender_id, recipient_id, deleted_by
     FROM PrivateMessages
     WHERE ((sender_id = ? AND recipient_id = ?) OR (recipient_id = ? AND sender_id = ?))
       AND hidden_at IS NULL`
  ).bind(userId, peerId, userId, peerId).all<{ id: string; sender_id: string; recipient_id: string; deleted_by: string | null }>()

  let count = 0
  for (const pm of messages.results || []) {
    const mySide = pm.sender_id === userId ? 'sender' : 'recipient'
    if (pm.deleted_by === mySide || pm.deleted_by === 'both') continue
    if (pm.deleted_by === null) {
      await db.prepare('UPDATE PrivateMessages SET deleted_by = ? WHERE id = ?').bind(mySide, pm.id).run()
    } else {
      await db.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(pm.id).run()
    }
    count++
  }
  return { ok: true, count }
}

/** Paginated PM history for cross-device sync.
 *  Returns messages newest-first with optional cursor (before timestamp). */
export interface PmHistoryParams {
  userId: string
  peerId: string
  limit?: number
  before?: string // ISO timestamp
}
export interface PmHistoryResult {
  messages: PrivateMessageView[]
  hasMore: boolean
  nextCursor: string | null
}
export async function getPmHistory(
  db: D1Turso,
  params: PmHistoryParams,
): Promise<PmHistoryResult> {
  const { userId, peerId, limit = 50, before } = params
  const cap = Math.min(Math.max(1, limit), 100)

  let sql = `
    SELECT pm.id, pm.sender_id, pm.recipient_id, pm.body, pm.created_at, pm.edited_at, pm.reply_to, pm.attachment_id,
           o.mime_type as attachment_mime,
           s.display_name as sender_name, r.display_name as recipient_name,
           CASE 
             WHEN pm.sender_id = ? THEN 
               EXISTS(
                 SELECT 1 FROM PmReadReceipts rr 
                 WHERE rr.user_id = pm.recipient_id AND rr.peer_id = pm.sender_id 
                 AND datetime(rr.last_read_at) >= datetime(pm.created_at)
               )
             ELSE 0
           END as read_by_recipient
    FROM PrivateMessages pm
    LEFT JOIN Objects o ON o.id = pm.attachment_id
    LEFT JOIN Users s ON s.id = pm.sender_id
    LEFT JOIN Users r ON r.id = pm.recipient_id
    WHERE (
      ((pm.sender_id = ? AND pm.recipient_id = ?) OR (pm.recipient_id = ? AND pm.sender_id = ?))
      AND NOT (pm.sender_id = ? AND COALESCE(pm.deleted_by, '') = 'sender')
      AND NOT (pm.recipient_id = ? AND COALESCE(pm.deleted_by, '') = 'recipient')
      AND pm.hidden_at IS NULL
  `
  const args: any[] = [userId, userId, peerId, userId, peerId, userId, userId]

  if (before) {
    sql += ' AND pm.created_at < ?'
    args.push(before)
  }

  sql += ' ORDER BY pm.created_at DESC LIMIT ?'
  args.push(cap + 1) // fetch one extra to detect hasMore

  const stmt = db.prepare(sql)
  const { results } = await stmt.bind(...args).all()
  const rows = results || []
  const hasMore = rows.length > cap
  const messages = rows.slice(0, cap).map((r: any) => ({
    ...r,
    body: decryptText(r.body ?? ''),
    read_by_recipient: Boolean(r.read_by_recipient),
  })) as PrivateMessageView[]

  const nextCursor = hasMore ? messages[messages.length - 1].created_at : null
  return { messages, hasMore, nextCursor }
}
