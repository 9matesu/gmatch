import type { D1Turso } from './db'
import { tierForMatches, tierColor, VOTE_POINTS, calculateDiscoveryReward, computeCardRarity, type CardVoteAction } from '@orbit/shared'
import { ScoreService } from './score'

/**
 * Pair-scoped match counts between two users, computed ONLY from non-story
 * objects (T-B5). matches = MIN(meLikesThem, theyLikeMe).
 */
export async function pairMatchCounts(
  db: D1Turso,
  me: string,
  other: string
): Promise<{ meLikesThem: number; theyLikeMe: number }> {
  const pairCounts = await db
    .prepare(`
      SELECT
        SUM(CASE WHEN l.user_id = ? AND o.owner_id = ? THEN 1 ELSE 0 END) AS me_likes_them,
        SUM(CASE WHEN l.user_id = ? AND o.owner_id = ? THEN 1 ELSE 0 END) AS they_like_me
      FROM Likes l
      JOIN Objects o ON o.id = l.object_id
      WHERE l.decision = 'like'
        AND o.is_story = 0
        AND ((l.user_id = ? AND o.owner_id = ?) OR (l.user_id = ? AND o.owner_id = ?))
    `)
    .bind(me, other, other, me, me, other, other, me)
    .first<{ me_likes_them: number; they_like_me: number }>()

  return {
    meLikesThem: Number(pairCounts?.me_likes_them || 0),
    theyLikeMe: Number(pairCounts?.they_like_me || 0),
  }
}

/**
 * Derive a user's matches_total as the SUM over all pairs of
 * MIN(meLikesThem, theyLikeMe), excluding story objects.
 * This is the single source of truth — the stored Users.matches_total
 * column is a materialized copy kept in sync by this function (F-B1/F-B3).
 */
export async function computeMatchesTotal(db: D1Turso, userId: string): Promise<number> {
  const res = await db
    .prepare(`
      WITH me_likes AS (
        SELECT o.owner_id AS other, COUNT(*) AS cnt
        FROM Likes l
        JOIN Objects o ON o.id = l.object_id
        WHERE l.user_id = ? AND l.decision = 'like' AND o.is_story = 0
        GROUP BY o.owner_id
      ),
      they_like AS (
        SELECT l.user_id AS other, COUNT(*) AS cnt
        FROM Likes l
        JOIN Objects o ON o.id = l.object_id
        WHERE o.owner_id = ? AND l.decision = 'like' AND o.is_story = 0
        GROUP BY l.user_id
      ),
      pairs AS (
        SELECT other FROM me_likes UNION SELECT other FROM they_like
      )
      SELECT COALESCE(SUM(
        CASE WHEN COALESCE(m.cnt, 0) < COALESCE(t.cnt, 0) THEN COALESCE(m.cnt, 0) ELSE COALESCE(t.cnt, 0) END
      ), 0) AS total
      FROM pairs p
      LEFT JOIN me_likes m ON m.other = p.other
      LEFT JOIN they_like t ON t.other = p.other
    `)
    .bind(userId, userId)
    .first<{ total: number }>()

  return Number(res?.total || 0)
}

/** Recompute + persist a user's matches_total column from derived value. */
export async function recomputeUserMatches(db: D1Turso, userId: string): Promise<number> {
  const total = await computeMatchesTotal(db, userId)
  await db.prepare('UPDATE Users SET matches_total = ? WHERE id = ?').bind(total, userId).run()
  return total
}

/**
 * Purge Likes referencing a deleted object and recompute the like/match
 * counters for every affected user (the owner + everyone who liked it) —
 * F-D1.
 */
export async function purgeObjectLikes(db: D1Turso, objectId: string): Promise<string[]> {
  const likers = await db
    .prepare('SELECT user_id FROM Likes WHERE object_id = ?')
    .bind(objectId)
    .all<{ user_id: string }>()

  const affected = new Set<string>()
  for (const row of likers.results) {
    if (row?.user_id) affected.add(row.user_id)
  }

  const obj = await db
    .prepare('SELECT owner_id FROM Objects WHERE id = ?')
    .bind(objectId)
    .first<{ owner_id: string }>()
  if (obj?.owner_id) affected.add(obj.owner_id)

  await db.prepare('DELETE FROM Likes WHERE object_id = ?').bind(objectId).run()

  for (const userId of affected) {
    await recomputeUserCounters(db, userId)
  }
  return Array.from(affected)
}

/**
 * Recompute a user's likes_given / likes_received / matches_total entirely
 * from the Likes table (single source of truth).
 */
export async function recomputeUserCounters(db: D1Turso, userId: string): Promise<void> {
  const given = await db
    .prepare("SELECT COUNT(*) AS cnt FROM Likes WHERE user_id = ? AND decision = 'like'")
    .bind(userId)
    .first<{ cnt: number }>()

  const received = await db
    .prepare(`
      SELECT COUNT(*) AS cnt
      FROM Likes l
      JOIN Objects o ON o.id = l.object_id
      WHERE o.owner_id = ? AND l.decision = 'like'
    `)
    .bind(userId)
    .first<{ cnt: number }>()

  const matches = await computeMatchesTotal(db, userId)

  await db.prepare('UPDATE Users SET likes_given = ?, likes_received = ?, matches_total = ? WHERE id = ?')
    .bind(Number(given?.cnt || 0), Number(received?.cnt || 0), matches, userId)
    .run()
}

export interface LikeDecisionError extends Error {
  status: number
}

export function likeDecisionError(message: string, status: number): LikeDecisionError {
  const err = new Error(message) as LikeDecisionError
  err.status = status
  return err
}

/** Credit daily points toward a user's live score (reset each UTC day). */
export async function addPoints(db: D1Turso, userId: string, points: number): Promise<void> {
  if (!userId || points <= 0) return
  await new ScoreService(db).award(userId, points)
}

export interface LikeDecisionResult {
  decision: string
  points_awarded: number
  matched: boolean
  matches: number
  tier: number
  tierColor: string
  card_score_delta?: number
}

/**
 * Shared core for recording a like/reject/boost decision on an object.
 * Mirrors the bookkeeping in routes/likes.ts and is reused by lobby rounds.
 * Assumes the caller has already validated access to the object.
 */
export async function applyLikeDecision(
  db: D1Turso,
  userId: string,
  objectId: string,
  decision: string
): Promise<LikeDecisionResult> {
  const obj = await db
    .prepare('SELECT id, owner_id, is_story, gacha_downloads_count FROM Objects WHERE id = ?')
    .bind(objectId)
    .first<{ id: string; owner_id: string; is_story: number; gacha_downloads_count?: number }>()

  if (!obj) throw likeDecisionError('Object not found', 404)
  if (obj.owner_id === userId) throw likeDecisionError('Cannot decide on your own image', 400)

  const existing = await db
    .prepare('SELECT decision FROM Likes WHERE user_id = ? AND object_id = ?')
    .bind(userId, objectId)
    .first<{ decision: string }>()

  const previousDecision = existing?.decision || null

  const before = await pairMatchCounts(db, userId, obj.owner_id)

  const likeId = crypto.randomUUID()
  await db
    .prepare(`
      INSERT INTO Likes (id, user_id, object_id, decision, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, object_id) DO UPDATE SET
        decision = excluded.decision,
        created_at = CURRENT_TIMESTAMP
    `)
    .bind(likeId, userId, objectId, decision)
    .run()

  // Score deltas for card social valuation — single source of truth in
  // @orbit/shared card-valuation (BOOST = +25, LIKE = +10, REJECT = -5).
  const delta = VOTE_POINTS[decision as CardVoteAction] ?? (decision === 'like' ? VOTE_POINTS.like : decision === 'boost' ? VOTE_POINTS.boost : VOTE_POINTS.reject)

  // Atomically update the card's persistent reputation score
  await db
    .prepare('UPDATE Objects SET gacha_downloads_count = MAX(0, COALESCE(gacha_downloads_count, 0) + ?) WHERE id = ?')
    .bind(delta, objectId)
    .run()

  // Keep the canonical card's value in lockstep with its media object score so
  // valuation persists across the whole card lifecycle (collection, deck, match,
  // marketplace, history) instead of drifting from the object's reputation.
  await db
    .prepare("UPDATE Cards SET value = MAX(0, COALESCE(value, 0) + ?), updated_at = ? WHERE media_object_id = ?")
    .bind(delta, new Date().toISOString(), objectId)
    .run()

  const isPositive = decision === 'like' || decision === 'boost'
  const wasPositive = previousDecision === 'like' || previousDecision === 'boost'

  if (isPositive && !wasPositive) {
    await db.batch([
      db.prepare('UPDATE Users SET likes_given = COALESCE(likes_given, 0) + 1 WHERE id = ?').bind(userId),
      db.prepare('UPDATE Users SET likes_received = COALESCE(likes_received, 0) + 1 WHERE id = ?').bind(obj.owner_id),
      db.prepare("UPDATE Cards SET like_count = like_count + 1, updated_at = ? WHERE media_object_id = ?").bind(new Date().toISOString(), objectId),
    ])

    // Wave 3: the bell needs the like, not just the counters. Fires ONLY on the
    // not-yet-positive -> positive transition, so re-liking or rejecting a
    // previously-liked object can't spam the owner. Best-effort: a bell failure
    // must never roll back a like that already landed (counters are committed).
    try {
      const { createNotification } = await import('./notifications')
      const { broadcastToUser } = await import('./ws-bus')
      const liker = await db
        .prepare('SELECT display_name FROM Users WHERE id = ?')
        .bind(userId)
        .first<{ display_name: string | null }>()
      const likerName = liker?.display_name?.trim() || 'Someone'
      const notif = await createNotification(
        db,
        obj.owner_id,
        'like',
        `${likerName} liked your post`,
        null,
        { object_id: objectId, liker_id: userId, actor_id: userId, actor_name: likerName },
      )
      // Push like every other notification writer does. Without this the bell
      // only filled on the next reload.
      if (notif) broadcastToUser(obj.owner_id, { type: 'notification', action: 'new', notification: notif })
    } catch { /* bell is best-effort */ }
  } else if (!isPositive && wasPositive) {
    await db.batch([
      db.prepare('UPDATE Users SET likes_given = MAX(0, COALESCE(likes_given, 0) - 1) WHERE id = ?').bind(userId),
      db.prepare('UPDATE Users SET likes_received = MAX(0, COALESCE(likes_received, 0) - 1) WHERE id = ?').bind(obj.owner_id),
      db.prepare("UPDATE Cards SET like_count = MAX(0, like_count - 1), updated_at = ? WHERE media_object_id = ?").bind(new Date().toISOString(), objectId),
    ])
  }

  // Discovery Influence rewards from the shared valuation economy:
  // Boost grants +80% of the delta as influence, like +30%, reject 0.
  let influenceReward = 0
  if (decision === 'boost' || decision === 'like') {
    influenceReward = calculateDiscoveryReward(delta, decision as CardVoteAction)
    if (influenceReward > 0) await addPoints(db, userId, influenceReward)

    // Reward creators when their content receives positive engagement. This
    // keeps passive creators in the reputation economy without rewarding
    // rejects/passes.
    const creatorReward = decision === 'boost' ? 5 : 2
    await addPoints(db, obj.owner_id, creatorReward)
  }

  const after = await pairMatchCounts(db, userId, obj.owner_id)
  const matchesCount = Math.min(after.meLikesThem, after.theyLikeMe)
  const matched = isPositive && matchesCount > Math.min(before.meLikesThem, before.theyLikeMe)

  await Promise.all([
    recomputeUserMatches(db, userId),
    recomputeUserMatches(db, obj.owner_id),
  ])

  const tier = tierForMatches(matchesCount)

  return {
    decision,
    points_awarded: influenceReward,
    matched,
    matches: matchesCount,
    tier,
    tierColor: tierColor(tier),
    card_score_delta: delta,
  }
}

