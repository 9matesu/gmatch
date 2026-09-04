import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import { purgeObjectLikes } from './game'
import { wipeUserContent } from './routes/users'

export type ReportTargetType =
  | 'post'
  | 'story'
  | 'lobby_image'
  | 'lobby_comment'
  | 'post_comment'
  | 'private_message'
  | 'lobby_chat'
  | 'match_chat'
  | 'group_message'
  | 'card'
  | 'user'

export const REPORT_TARGET_TYPES: ReportTargetType[] = [
  'post', 'story', 'lobby_image', 'lobby_comment', 'post_comment',
  'private_message', 'lobby_chat', 'match_chat', 'group_message', 'card', 'user',
]

// Max open reports a single user may spawn in 24h. Every report instant-hides
// its target, so the cap is the front line against griefing-by-reporting.
export const MAX_REPORTS_PER_USER_PER_DAY = 50

export class ReportError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

const OWNER_OF: Record<ReportTargetType, { table: string; col: string }> = {
  post: { table: 'Objects', col: 'owner_id' },
  story: { table: 'Objects', col: 'owner_id' },
  lobby_image: { table: 'LobbyImages', col: 'owner_id' },
  lobby_comment: { table: 'LobbyComments', col: 'user_id' },
  post_comment: { table: 'Comments', col: 'author_id' },
  private_message: { table: 'PrivateMessages', col: 'sender_id' },
  lobby_chat: { table: 'LobbyChat', col: 'sender_id' },
  match_chat: { table: 'MatchChat', col: 'sender_id' },
  group_message: { table: 'GroupMessages', col: 'sender_id' },
  // Ban targets the card's creator (the uploader), not whoever currently owns
  // it — cards move through the marketplace, the media origin does not.
  card: { table: 'Cards', col: 'creator_id' },
  user: { table: 'Users', col: 'id' },
}

export async function resolveTargetOwner(
  db: D1Turso,
  type: ReportTargetType,
  id: string,
): Promise<string | null> {
  const { table, col } = OWNER_OF[type]
  const row = await db
    .prepare(`SELECT ${col} AS owner FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ owner: string }>()
  return row?.owner ?? null
}

export async function hideContent(db: D1Turso, type: ReportTargetType, id: string): Promise<void> {
  if (type === 'card') {
    await db.prepare("UPDATE Cards SET moderation_state = 'hidden' WHERE id = ? AND moderation_state != 'hidden'").bind(id).run()
    return
  }
  if (type === 'user') {
    await db.batch([
      db.prepare('UPDATE Users SET hidden_at = CURRENT_TIMESTAMP WHERE id = ? AND hidden_at IS NULL').bind(id),
      db.prepare('UPDATE Objects SET hidden_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND hidden_at IS NULL').bind(id),
      db.prepare('UPDATE LobbyImages SET hidden_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND hidden_at IS NULL').bind(id),
      db.prepare('UPDATE LobbyComments SET hidden_at = CURRENT_TIMESTAMP WHERE user_id = ? AND hidden_at IS NULL').bind(id),
      db.prepare('UPDATE Comments SET hidden_at = CURRENT_TIMESTAMP WHERE author_id = ? AND hidden_at IS NULL').bind(id),
    ])
    return
  }
  const table = OWNER_OF[type].table
  await db
    .prepare(`UPDATE ${table} SET hidden_at = CURRENT_TIMESTAMP WHERE id = ? AND hidden_at IS NULL`)
    .bind(id)
    .run()
}

export async function unhideContent(db: D1Turso, type: ReportTargetType, id: string): Promise<void> {
  if (type === 'card') {
    await db.prepare("UPDATE Cards SET moderation_state = 'active' WHERE id = ? AND moderation_state = 'hidden'").bind(id).run()
    return
  }
  if (type === 'user') {
    await db.batch([
      db.prepare('UPDATE Users SET hidden_at = NULL WHERE id = ?').bind(id),
      db.prepare('UPDATE Objects SET hidden_at = NULL WHERE owner_id = ?').bind(id),
      db.prepare('UPDATE LobbyImages SET hidden_at = NULL WHERE owner_id = ?').bind(id),
      db.prepare('UPDATE LobbyComments SET hidden_at = NULL WHERE user_id = ?').bind(id),
      db.prepare('UPDATE Comments SET hidden_at = NULL WHERE author_id = ?').bind(id),
    ])
    return
  }
  const table = OWNER_OF[type].table
  await db.prepare(`UPDATE ${table} SET hidden_at = NULL WHERE id = ?`).bind(id).run()
}

export async function deleteContent(
  db: D1Turso,
  bucket: LocalBlobStore | undefined,
  type: ReportTargetType,
  id: string,
): Promise<void> {
  switch (type) {
    case 'post':
    case 'story': {
      if (bucket) await bucket.delete(`objects/${id}`).catch(() => {})
      await db.batch([
        db.prepare('DELETE FROM Favorites WHERE object_id = ?').bind(id),
        db.prepare('DELETE FROM Recipients WHERE object_id = ?').bind(id),
        db.prepare('DELETE FROM PostLikes WHERE object_id = ?').bind(id),
        db.prepare('DELETE FROM Saves WHERE object_id = ?').bind(id),
        db.prepare('DELETE FROM CommentLikes WHERE comment_id IN (SELECT id FROM Comments WHERE object_id = ?)').bind(id),
        db.prepare('DELETE FROM Comments WHERE object_id = ?').bind(id),
      ])
      await purgeObjectLikes(db, id)
      await db.prepare('DELETE FROM Objects WHERE id = ?').bind(id).run()
      return
    }
    case 'lobby_image': {
      if (bucket) await bucket.delete(`lobby/${id}`).catch(() => {})
      await db.batch([
        db.prepare('DELETE FROM LobbyComments WHERE image_id = ?').bind(id),
        db.prepare('DELETE FROM LobbyLikes WHERE image_id = ?').bind(id),
      ])
      await db.prepare('DELETE FROM LobbyImages WHERE id = ?').bind(id).run()
      return
    }
    case 'lobby_comment': {
      await db.prepare('DELETE FROM LobbyComments WHERE id = ?').bind(id).run()
      return
    }
    case 'post_comment': {
      await db.batch([
        db.prepare('DELETE FROM CommentLikes WHERE comment_id = ?').bind(id),
        db.prepare('DELETE FROM Comments WHERE id = ?').bind(id),
      ])
      return
    }
    case 'private_message': {
      await db.prepare('DELETE FROM PrivateMessages WHERE id = ?').bind(id).run()
      return
    }
    case 'lobby_chat': {
      await db.prepare('DELETE FROM LobbyChat WHERE id = ?').bind(id).run()
      return
    }
    case 'match_chat': {
      await db.prepare('DELETE FROM MatchChat WHERE id = ?').bind(id).run()
      return
    }
    case 'group_message': {
      await db.prepare('DELETE FROM GroupMessages WHERE id = ?').bind(id).run()
      return
    }
    case 'card': {
      // "Delete content" on a card = removed from circulation ("banned" state).
      // Hard-deleting the row would orphan CardHistory/economy ledger rows.
      await db.prepare("UPDATE Cards SET moderation_state = 'banned' WHERE id = ?").bind(id).run()
      return
    }
    case 'user': {
      await wipeUserContent(db, id, { BUCKET: bucket })
      return
    }
  }
}

export async function reportContent(
  db: D1Turso,
  reporterId: string,
  type: ReportTargetType,
  id: string,
  category: string | null,
  reason: string | null,
  evidenceObjectId?: string | null,
): Promise<{ reported: boolean; hidden: boolean }> {
  if (!REPORT_TARGET_TYPES.includes(type)) throw new ReportError('Unsupported target type', 400)
  if (!id) throw new ReportError('Missing target id', 400)

  const owner = await resolveTargetOwner(db, type, id)
  if (!owner) throw new ReportError('Content not found', 404)
  if (owner === reporterId) throw new ReportError('Cannot report your own content', 400)

  const cap = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ContentReports
       WHERE reporter_id = ? AND status = 'open' AND created_at >= datetime('now', '-1 day')`,
    )
    .bind(reporterId)
    .first<{ n: number }>()
  if (Number(cap?.n ?? 0) >= MAX_REPORTS_PER_USER_PER_DAY) {
    throw new ReportError('Too many reports. Try again later.', 429)
  }

  const reportId = crypto.randomUUID()
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO ContentReports
        (id, reporter_id, target_type, target_id, category, reason, object_id, status, hidden_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
    )
    .bind(reportId, reporterId, type, id, category || null, reason || null, evidenceObjectId || null)
    .run()

  const inserted = Boolean(res.meta?.changes)
  if (!inserted) return { reported: false, hidden: false }

  await hideContent(db, type, id)
  return { reported: true, hidden: true }
}

type ResolveAction = 'delete' | 'ban' | 'deny'

export async function resolveReport(
  db: D1Turso,
  bucket: LocalBlobStore | undefined,
  reportId: string,
  adminId: string,
  action: ResolveAction,
): Promise<{ action: ResolveAction }> {
  const report = await db
    .prepare('SELECT id, target_type, target_id, status FROM ContentReports WHERE id = ?')
    .bind(reportId)
    .first<{ id: string; target_type: ReportTargetType; target_id: string; status: string }>()
  if (!report) throw new ReportError('Report not found', 404)
  if (report.status !== 'open') throw new ReportError('Report already resolved', 409)

  let status = 'resolved'
  if (action === 'deny') {
    await unhideContent(db, report.target_type, report.target_id)
    status = 'dismissed'
  } else if (action === 'delete') {
    await deleteContent(db, bucket, report.target_type, report.target_id)
  } else if (action === 'ban') {
    const ownerId = report.target_type === 'user'
      ? report.target_id
      : await resolveTargetOwner(db, report.target_type, report.target_id)
    if (ownerId) {
      const existing = await db.prepare('SELECT 1 FROM Bans WHERE user_id = ?').bind(ownerId).first()
      if (!existing) {
        await db.prepare('INSERT INTO Bans (id, user_id, banned_by, reason) VALUES (?, ?, ?, ?)')
          .bind(crypto.randomUUID(), ownerId, adminId, 'Banned from moderation report')
          .run()
      }
      await wipeUserContent(db, ownerId, { BUCKET: bucket })
    }
  } else {
    throw new ReportError('Invalid report action', 400)
  }

  const resolvedAt = new Date().toISOString()
  const actionNorm = action
  await db
    .prepare('UPDATE ContentReports SET status = ?, action = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .bind(status, actionNorm, adminId, resolvedAt, reportId)
    .run()

  return { action }
}