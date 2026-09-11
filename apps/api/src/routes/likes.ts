import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { tierForMatches, tierColor, tierLabel } from '@orbit/shared'
import { computeMatchesTotal, applyLikeDecision } from '../game'
import { broadcastToRoom } from '../ws-bus'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const likes = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

likes.use('*', orbitAuth)

likes.post('/:objectId', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const objectId = c.req.param('objectId')

  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const decision = body.decision
  if (!['like', 'reject', 'pass'].includes(decision)) {
    return c.json({ error: "Invalid decision. Must be 'like', 'reject', or 'pass'." }, 400)
  }

  // 1. Load object
  const obj = await db
    .prepare('SELECT id, owner_id, is_story, is_flash, hidden_at FROM Objects WHERE id = ?')
    .bind(objectId)
    .first<{ id: string; owner_id: string; is_story: number; is_flash: number; hidden_at: string | null }>()

  if (!obj || obj.hidden_at) {
    return c.json({ error: 'Object not found' }, 404)
  }

  if (obj.owner_id === orbitId) {
    return c.json({ error: 'Cannot decide on your own image' }, 400)
  }

  // 2. Access check: caller must be recipient, owner (checked above), or it's a story
  const recipientCheck = await db
    .prepare(`
      SELECT 1 FROM Objects o
      LEFT JOIN Recipients r ON o.id = r.object_id
      WHERE o.id = ? AND (r.recipient_id = ? OR o.is_story = 1)
    `)
    .bind(objectId, orbitId)
    .first()

  if (!recipientCheck) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // 3-8. Record decision + bookkeeping via shared core
  try {
    const result = await applyLikeDecision(db, orbitId, objectId, decision)
    if (obj.is_flash === 1) {
      const likeRow = await db
        .prepare("SELECT COUNT(*) AS cnt FROM Likes WHERE object_id = ? AND decision = 'like'")
        .bind(objectId)
        .first<{ cnt: number }>()
      broadcastToRoom('global', {
        type: 'flash',
        action: 'like',
        object_id: objectId,
        likes_count: Number(likeRow?.cnt || 0),
        liker_id: orbitId,
        decision,
      })
    }
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to record decision' }, err?.status || 500)
  }
})

likes.get('/', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')

  // Query caller stats (gacha_downloads_received derived from Objects, matching users.ts)
  const me = await db
    .prepare(`
      SELECT likes_given, likes_received, objects_sent_count, gacha_items_collected,
             COALESCE(score, 0) as score,
             (SELECT COALESCE(SUM(gacha_downloads_count), 0) FROM Objects WHERE owner_id = u.id) as gacha_downloads_received
      FROM Users u WHERE id = ?
    `)
    .bind(orbitId)
    .first<any>()

  const likesGiven = Number(me?.likes_given || 0)
  const likesReceived = Number(me?.likes_received || 0)
  const sentCount = Number(me?.objects_sent_count || 0)
  const gachaDl = Number(me?.gacha_downloads_received || 0)
  const gachaItems = Number(me?.gacha_items_collected || 0)

  // matches_total is derived: SUM over matched pairs of MIN(meLikesThem, theyLikeMe)
  const matchesTotal = await computeMatchesTotal(db, orbitId)

  const score = me?.score != null ? Number(me.score) : (sentCount * 10) + (gachaDl * 15) + (gachaItems * 5) + (likesReceived * 25) + (likesGiven * 20) + (matchesTotal * 100)

  // Query pairwise relationships
  const rows = await db
    .prepare(`
      SELECT
        CASE WHEN l.user_id = ? THEN o.owner_id ELSE l.user_id END AS other_id,
        SUM(CASE WHEN l.user_id = ? AND o.owner_id != ? THEN 1 ELSE 0 END) AS me_likes_them,
        SUM(CASE WHEN l.user_id != ? AND o.owner_id = ? THEN 1 ELSE 0 END) AS they_like_me,
        MAX(l.created_at) AS last_match_at
      FROM Likes l
      JOIN Objects o ON o.id = l.object_id
      WHERE l.decision = 'like'
        AND o.is_story = 0
        AND (l.user_id = ? OR o.owner_id = ?)
      GROUP BY other_id
    `)
    .bind(orbitId, orbitId, orbitId, orbitId, orbitId, orbitId, orbitId)
    .all<any>()

  const relationships: any[] = []

  for (const row of rows.results) {
    const otherId = row.other_id
    if (!otherId || otherId === orbitId) continue

    const meLikesThem = Number(row.me_likes_them || 0)
    const theyLikeMe = Number(row.they_like_me || 0)
    const mCount = Math.min(meLikesThem, theyLikeMe)

    if (mCount <= 0) continue

    const targetUser = await db
      .prepare(`
        SELECT id, public_key, display_name, tags, last_seen, objects_sent_count, gacha_items_collected,
               likes_given, likes_received, matches_total, COALESCE(score, 0) as score,
               (SELECT COALESCE(SUM(gacha_downloads_count), 0) FROM Objects WHERE owner_id = u.id) as gacha_downloads_received
        FROM Users u WHERE id = ?
      `)
      .bind(otherId)
      .first<any>()

    if (!targetUser) continue

    const uScore = targetUser.score != null
      ? Number(targetUser.score)
      : (Number(targetUser.objects_sent_count || 0) * 10) +
        (Number(targetUser.gacha_downloads_received || 0) * 15) +
        (Number(targetUser.gacha_items_collected || 0) * 5) +
        (Number(targetUser.likes_received || 0) * 25) +
        (Number(targetUser.likes_given || 0) * 20) +
        (Number(targetUser.matches_total || 0) * 100)

    const isOnline = targetUser.last_seen
      ? (Date.now() - new Date(targetUser.last_seen).getTime() < 5 * 60 * 1000)
      : false

    const tTier = tierForMatches(mCount)
    relationships.push({
      user: {
        id: targetUser.id,
        publicKey: targetUser.public_key,
        display_name: targetUser.display_name,
        tags: (() => {
          if (!targetUser.tags) return []
          try {
            const p = JSON.parse(targetUser.tags)
            return Array.isArray(p) ? p.map(String) : []
          } catch {
            return typeof targetUser.tags === 'string' ? targetUser.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : []
          }
        })(),
        last_seen: targetUser.last_seen,
        online: isOnline,
        score: uScore,
      },
      matches: mCount,
      tier: tTier,
      tierColor: tierColor(tTier),
      tierLabel: tierLabel(tTier),
      last_match_at: row.last_match_at,
    })
  }

  relationships.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier
    if (b.matches !== a.matches) return b.matches - a.matches
    const dateA = a.last_match_at ? new Date(a.last_match_at).getTime() : 0
    const dateB = b.last_match_at ? new Date(b.last_match_at).getTime() : 0
    if (dateB !== dateA) return dateB - dateA
    return (a.user.display_name || '').localeCompare(b.user.display_name || '')
  })

  return c.json({
    relationships,
    stats: {
      likes_given: likesGiven,
      likes_received: likesReceived,
      matches_total: matchesTotal,
      score,
    },
  })
})
