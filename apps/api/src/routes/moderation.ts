import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { EconomyService } from '../economy'
import { unhideContent, deleteContent, type ReportTargetType } from '../reports'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const moderation = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

moderation.use('*', orbitAuth)

async function canModerate(db: D1Turso, orbitId: string): Promise<boolean> {
  const user = await db
    .prepare('SELECT is_admin, is_moderator FROM Users WHERE id = ?')
    .bind(orbitId)
    .first<{ is_admin: number | null; is_moderator: number | null }>()
  return Number(user?.is_admin || 0) === 1 || Number(user?.is_moderator || 0) === 1
}

// Check current user's moderation privileges
moderation.get('/status', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')

  const user = await db
    .prepare('SELECT is_admin, is_moderator FROM Users WHERE id = ?')
    .bind(orbitId)
    .first<{ is_admin: number | null; is_moderator: number | null }>()

  const isAdmin = Number(user?.is_admin || 0) === 1
  const isModerator = Number(user?.is_moderator || 0) === 1
  const canModerate = isAdmin || isModerator

  return c.json({
    can_moderate: canModerate,
    is_moderator: isModerator,
    is_admin: isAdmin,
  })
})

// Real Community Moderation Queue (only accessible to flagged moderators/admins)
moderation.get('/queue', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')

  const user = await db
    .prepare('SELECT is_admin, is_moderator FROM Users WHERE id = ?')
    .bind(orbitId)
    .first<{ is_admin: number | null; is_moderator: number | null }>()

  const canModerate = Number(user?.is_admin || 0) === 1 || Number(user?.is_moderator || 0) === 1
  if (!canModerate) {
    return c.json({ error: 'Moderation privileges required' }, 403)
  }

  const reports = await db
    .prepare(`
      SELECT r.id as report_id, r.reporter_id, r.reason, r.category, r.created_at as reported_at,
             o.id as post_id, o.owner_id, o.content_url, COALESCE(o.post_caption, o.caption) as caption,
             o.like_count, o.comment_count, o.created_at as post_created_at,
             u.display_name as author_name, u.pfp_url as author_pfp
      FROM ContentReports r
      JOIN Objects o ON o.id = r.target_id
      LEFT JOIN Users u ON u.id = o.owner_id
      WHERE r.status = 'open' AND r.target_type IN ('post', 'story')
      ORDER BY r.created_at ASC
      LIMIT 20
    `)
    .all<any>()

  const items = (reports.results || []).map((row: any) => ({
    report_id: row.report_id,
    post_id: row.post_id,
    author_id: row.owner_id,
    author_name: row.author_name || 'Creator',
    author_avatar: row.author_pfp || null,
    url: row.content_url || `/api/objects/${row.post_id}`,
    caption: row.caption || '',
    reason: row.reason || row.category || 'Reported for review',
    category: row.category || 'community_report',
    reported_at: row.reported_at,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
  }))

  return c.json({ items })
})

// Review a reported item in the Real Moderation queue
moderation.post('/review', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')

  const user = await db
    .prepare('SELECT is_admin, is_moderator, score FROM Users WHERE id = ?')
    .bind(orbitId)
    .first<{ is_admin: number | null; is_moderator: number | null; score: number | null }>()

  const canModerate = Number(user?.is_admin || 0) === 1 || Number(user?.is_moderator || 0) === 1
  if (!canModerate) {
    return c.json({ error: 'Moderation privileges required' }, 403)
  }

  let body: any = {}
  try {
    body = await c.req.json()
  } catch {}

  const { report_id, post_id, action, reason } = body
  if (!post_id || !action) {
    return c.json({ error: 'Missing post_id or action' }, 400)
  }
  if (!['approve', 'dismiss', 'flag_sensitive', 'hide', 'delete'].includes(action)) {
    return c.json({ error: 'Invalid moderation action' }, 400)
  }
  if (report_id) {
    const report = await db.prepare('SELECT status, target_type FROM ContentReports WHERE id = ?').bind(report_id).first<{ status: string; target_type: string }>()
    if (!report) return c.json({ error: 'Report not found' }, 404)
    if (report.status !== 'open') return c.json({ error: 'Report already reviewed' }, 409)
  }

  const now = new Date().toISOString()

  if (action === 'flag_sensitive' || action === 'hide') {
    // Flag post as sensitive and keep it hidden from the timeline.
    await db
      .prepare(`
        UPDATE Objects
        SET is_sensitive = 1, hidden_at = ?, sensitive_reason = ?
        WHERE id = ?
      `)
      .bind(now, reason || 'Flagged as sensitive by community moderation', post_id)
      .run()

    if (report_id) {
      await db
        .prepare('UPDATE ContentReports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
        .bind('resolved', orbitId, now, report_id)
        .run()
    }
  } else if (action === 'approve' || action === 'dismiss') {
    // False positive: unhide the post, mark the report dismissed.
    if (report_id) {
      const rep = await db.prepare('SELECT target_type FROM ContentReports WHERE id = ?').bind(report_id).first<{ target_type: string }>()
      if (rep) await unhideContent(db, rep.target_type as ReportTargetType, post_id)
      await db
        .prepare('UPDATE ContentReports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
        .bind('dismissed', orbitId, now, report_id)
        .run()
    } else {
      await unhideContent(db, 'post', post_id)
    }
  } else if (action === 'delete') {
    // Hard delete
    if (report_id) {
      const rep = await db.prepare('SELECT target_type FROM ContentReports WHERE id = ?').bind(report_id).first<{ target_type: string }>()
      await deleteContent(db, c.env.BUCKET, (rep?.target_type as ReportTargetType) || 'post', post_id)
      await db.prepare('UPDATE ContentReports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').bind('resolved', orbitId, now, report_id).run()
    } else {
      await deleteContent(db, c.env.BUCKET, 'post', post_id)
    }
  }

  // Reward the moderator with Goon Coins (+25 g$) through the authoritative
  // economy. Idempotent per (report/post, moderator, action) so re-reviewing the
  // same item cannot farm coins.
  const rewardCoins = 25
  const economy = new EconomyService(db)
  const rewardKey = `moderation-review|${report_id || post_id}|${orbitId}|${action}`
  try {
    await economy.credit(orbitId, rewardCoins, { idempotencyKey: rewardKey, kind: 'reward', reference: post_id })
  } catch (err) {
    console.warn('[moderation] reward credit failed (non-fatal):', (err as Error)?.message || err)
  }

  const walletBalance = await economy.getBalance(orbitId)

  return c.json({
    ok: true,
    action,
    reward_coins: rewardCoins,
    new_score: walletBalance,
  })
})

// Simulated / Bot Moderation Reward: grant likes that can be sent to a chosen post
moderation.post('/simulated-reward', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')

  // This is a privileged moderation tool, not a self-serve reward. Require
  // moderator/admin, otherwise any user can manufacture likes/reputation.
  if (!(await canModerate(db, orbitId))) {
    return c.json({ error: 'Moderation privileges required' }, 403)
  }

  let body: any = {}
  try {
    body = await c.req.json()
  } catch {}

  const { target_post_id, likes_count = 1 } = body
  if (!target_post_id) {
    return c.json({ error: 'Missing target_post_id' }, 400)
  }

  const targetPost = await db.prepare('SELECT id FROM Objects WHERE id = ?').bind(target_post_id).first()
  if (!targetPost) return c.json({ error: 'Target post not found' }, 404)

  const countToAdd = Math.min(Math.max(1, parseInt(String(likes_count), 10) || 1), 10)
  const rewardDay = new Date().toISOString().slice(0, 10)
  await db.prepare('INSERT OR IGNORE INTO ModerationPatrolRewards (user_id, reward_day, awarded_likes) VALUES (?, ?, 0)')
    .bind(orbitId, rewardDay).run()
  const rewardUpdate = await db.prepare(`
    UPDATE ModerationPatrolRewards
    SET awarded_likes = awarded_likes + ?
    WHERE user_id = ? AND reward_day = ? AND awarded_likes + ? <= 10
  `).bind(countToAdd, orbitId, rewardDay, countToAdd).run()
  if (Number(rewardUpdate.meta?.changes || 0) !== 1) {
    return c.json({ error: 'Daily patrol reward limit reached' }, 429)
  }

  const post = await db
    .prepare('SELECT id, owner_id, like_count FROM Objects WHERE id = ?')
    .bind(target_post_id)
    .first<{ id: string; owner_id: string; like_count: number | null }>()

  if (!post) {
    return c.json({ error: 'Target post not found' }, 404)
  }

  // Increment like count on object and owner
  await db
    .prepare('UPDATE Objects SET like_count = COALESCE(like_count, 0) + ? WHERE id = ?')
    .bind(countToAdd, target_post_id)
    .run()

  if (post.owner_id) {
    await db
      .prepare('UPDATE Users SET likes_received = COALESCE(likes_received, 0) + ? WHERE id = ?')
      .bind(countToAdd, post.owner_id)
      .run()
  }

  // Also give caller some likes_given credit
  await db
    .prepare('UPDATE Users SET likes_given = COALESCE(likes_given, 0) + ? WHERE id = ?')
    .bind(countToAdd, orbitId)
    .run()

  const updatedPost = await db
    .prepare('SELECT like_count FROM Objects WHERE id = ?')
    .bind(target_post_id)
    .first<{ like_count: number | null }>()

  return c.json({
    ok: true,
    target_post_id,
    added_likes: countToAdd,
    new_like_count: Number(updatedPost?.like_count || 0),
    reward_day: rewardDay,
  })
})
