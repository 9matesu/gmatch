import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { purgeObjectLikes } from '../game'
import { reportContent, ReportError } from '../reports'
import { promoteLobbyImageToPost } from '../lobby'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const posts = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

posts.use('*', orbitAuth)

// Backfill this user's old lobby uploads into permanent owner posts. New
// uploads are promoted at creation time; this endpoint handles pre-existing rows.
posts.post('/migrate-lobby', async (c) => {
  const orbitId = c.get('orbitId')
  const rows = await c.env.DB.prepare(`
    SELECT id, owner_id, content_url, mime_type, caption, tags, likes_count, created_at
    FROM LobbyImages WHERE owner_id = ? AND content_url IS NOT NULL AND content_url != ''
  `).bind(orbitId).all<any>()
  let migrated = 0
  for (const image of rows.results || []) {
    if (await promoteLobbyImageToPost(c.env.DB, c.env.BUCKET, image)) migrated += 1
  }
  return c.json({ migrated, candidates: rows.results?.length || 0 })
})

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 30)
    .slice(0, 10)
}

async function postRow(db: D1Turso, orbitId: string, id: string): Promise<any> {
  return db
    .prepare(`
      SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.created_at, o.content_url,
             COALESCE(o.post_caption, o.caption) as caption, o.location, o.post_tags,
             o.like_count, o.comment_count, o.share_count, o.is_story, o.hidden_at, o.post_group,
             COALESCE(o.is_archived, 0) as is_archived,
             u.display_name as author_name, u.pfp_url as author_pfp,
             (SELECT COUNT(*) FROM PostLikes pl WHERE pl.object_id = o.id AND pl.user_id = ?) as is_liked,
             (SELECT COUNT(*) FROM Saves s WHERE s.object_id = o.id AND s.user_id = ?) as is_saved,
             (SELECT COUNT(*) FROM Followers f WHERE f.follower_id = ? AND f.followee_id = o.owner_id AND f.accepted = 1) as is_following
      FROM Objects o
      LEFT JOIN Users u ON u.id = o.owner_id
      WHERE o.id = ? AND o.is_public = 1 AND o.hidden_at IS NULL
        AND (o.owner_id = ? OR COALESCE(o.is_archived, 0) = 0)
    `)
    .bind(orbitId, orbitId, orbitId, id, orbitId)
    .first<any>()
}

function serializePost(row: any): any {
  return {
    id: row.id,
    author_id: row.owner_id,
    author_name: row.author_name?.trim() || 'Unknown User',
    author_avatar: row.author_pfp || null,
    url: row.content_url || `/api/objects/${row.id}`,
    mime_type: row.mime_type || 'image/jpeg',
    media: Array.isArray(row.media) && row.media.length > 0 ? row.media : undefined,
    caption: row.caption || null,
    location: row.location || null,
    tags: parseTags(row.post_tags),
    created_at: row.created_at,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    share_count: Number(row.share_count || 0),
    is_archived: Number(row.is_archived || 0),
    is_story: Number(row.is_story || 0),
    is_liked: Number(row.is_liked || 0) > 0,
    is_saved: Number(row.is_saved || 0) > 0,
    is_following: Number(row.is_following || 0) > 0,
  }
}

// Real-time push: broadcast a freshly-created public post to every connected
// feed client so the timeline updates without a reload.
export async function broadcastNewPost(db: D1Turso, objectId: string): Promise<void> {
  try {
    const row = await db.prepare(`
      SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.created_at, o.content_url,
             COALESCE(o.post_caption, o.caption) as caption, o.location, o.post_tags,
             o.like_count, o.comment_count, o.share_count, o.is_story,
             u.display_name as author_name, u.pfp_url as author_pfp
      FROM Objects o
      LEFT JOIN Users u ON u.id = o.owner_id
      WHERE o.id = ? AND o.is_public = 1
    `).bind(objectId).first<any>()
    if (!row) return
    const { broadcastToRoom } = await import('../ws-bus')
    broadcastToRoom('lobby', { type: 'feed', action: 'new', post: serializePost({ ...row, is_liked: 0, is_saved: 0, is_following: 0 }) })
  } catch (err) {
    console.warn('[posts] broadcastNewPost failed:', err)
  }
}

// Public feed. Supports ?following=1 (only authors the caller follows),
// ?author_id=... (a single user's public profile posts),
// ?q= search over captions + tags, ?sort=latest|trending (default latest),
// ?tag= single tag filter, and ?limit/?offset pagination.
posts.get('/', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const following = c.req.query('following') === '1'
  const authorId = (c.req.query('author_id') || '').trim()
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const sort = c.req.query('sort') || 'latest'
  const tagFilter = (c.req.query('tag') || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, '')
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

  const where: string[] = ['o.is_public = 1', 'o.hidden_at IS NULL', '(o.owner_id = ? OR COALESCE(o.is_archived, 0) = 0)']
  const args: any[] = [orbitId, orbitId, orbitId]

  if (following) {
    where.push('EXISTS (SELECT 1 FROM Followers f WHERE f.follower_id = ? AND f.followee_id = o.owner_id AND f.accepted = 1)')
    args.push(orbitId)
  }
  if (authorId) {
    where.push('o.owner_id = ?')
    args.push(authorId)
  }
  if (q) {
    where.push('(LOWER(COALESCE(o.post_caption, o.caption)) LIKE ? OR LOWER(COALESCE(o.post_tags, \'\')) LIKE ?)')
    args.push(`%${q}%`, `%${q}%`)
  }
  if (tagFilter) {
    where.push(`LOWER(COALESCE(o.post_tags, '')) LIKE ?`)
    args.push(`%${tagFilter}%`)
  }

  // Latest is strictly chronological. Trending is a transparent, deterministic
  // score that combines engagement with a linear 24h-half-life recency decay so
  // old posts cannot permanently dominate the feed. Ties break on recency.
  const orderBy = sort === 'trending'
    ? `ORDER BY (
         (o.like_count + o.comment_count * 2 + o.share_count * 3)
         / (1.0 + (julianday('now') - julianday(o.created_at)) * 24.0 / 24.0)
       ) DESC, o.created_at DESC`
    : 'ORDER BY o.created_at DESC'

  const rows = await db.prepare(`
    SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.created_at, o.content_url,
           COALESCE(o.post_caption, o.caption) as caption, o.location, o.post_tags,
           o.like_count, o.comment_count, o.share_count, o.is_story, o.hidden_at, o.post_group,
           COALESCE(o.is_archived, 0) as is_archived,
           u.display_name as author_name, u.pfp_url as author_pfp,
           (SELECT COUNT(*) FROM PostLikes pl WHERE pl.object_id = o.id AND pl.user_id = ?) as is_liked,
           (SELECT COUNT(*) FROM Saves s WHERE s.object_id = o.id AND s.user_id = ?) as is_saved
    FROM Objects o
    LEFT JOIN Users u ON u.id = o.owner_id
    WHERE ${where.join(' AND ')}
    ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...args, limit, offset).all<any>()

  // Coalesce multi-image posts: rows sharing a post_group become one post whose
  // `media` array carries every image in the group. The first-seen row in the
  // page is the primary (drives likes/comments/id); later group members are
  // skipped so they don't produce duplicate feed entries.
  const primaries: any[] = []
  const seenGroups = new Set<string>()
  for (const row of rows.results || []) {
    const group = row.post_group || null
    if (group && seenGroups.has(group)) continue
    if (group) seenGroups.add(group)
    primaries.push(row)
  }

  for (const row of primaries) {
    if (!row.post_group) continue
    const siblings = await db.prepare(`
      SELECT id, mime_type, content_url FROM Objects
      WHERE post_group = ? AND is_public = 1 AND hidden_at IS NULL
      ORDER BY rowid ASC
    `).bind(row.post_group).all<any>()
    row.media = (siblings.results || []).map((s: any) => ({
      id: s.id,
      url: s.content_url || `/api/objects/${s.id}`,
      mime_type: s.mime_type || 'image/jpeg',
    }))
  }

  return c.json({ posts: primaries.map(serializePost) })
})

// Single post with its comments inline.
posts.get('/:id', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const row = await postRow(db, orbitId, id)
  if (!row) return c.json({ error: 'Post not found' }, 404)

  if (row.post_group) {
    const siblings = await db.prepare(`
      SELECT id, mime_type, content_url FROM Objects
      WHERE post_group = ? AND is_public = 1 AND hidden_at IS NULL
      ORDER BY rowid ASC
    `).bind(row.post_group).all<any>()
    row.media = (siblings.results || []).map((s: any) => ({
      id: s.id,
      url: s.content_url || `/api/objects/${s.id}`,
      mime_type: s.mime_type || 'image/jpeg',
    }))
  }

  const comments = await db.prepare(`
    SELECT c.id, c.author_id, c.body, c.like_count, c.created_at,
           u.display_name as author_name, u.pfp_url as author_pfp,
           (SELECT COUNT(*) FROM CommentLikes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) as is_liked
    FROM Comments c
    LEFT JOIN Users u ON u.id = c.author_id
    WHERE c.object_id = ? AND c.hidden_at IS NULL
    ORDER BY c.created_at ASC
  `).bind(orbitId, id).all<any>()

  return c.json({
    ...serializePost(row),
    comments: (comments.results || []).map((c: any) => ({
      id: c.id,
      author_id: c.author_id,
      author_name: c.author_name?.trim() || 'Unknown User',
      author_avatar: c.author_pfp || null,
      text: c.body,
      like_count: Number(c.like_count || 0),
      is_liked: Number(c.is_liked || 0) > 0,
      created_at: c.created_at,
    })),
  })
})

// Like a post (idempotent)
posts.post('/:id/like', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const obj = await db.prepare('SELECT id FROM Objects WHERE id = ? AND is_public = 1 AND hidden_at IS NULL').bind(id).first()
  if (!obj) return c.json({ error: 'Post not found' }, 404)

  const res = await db.prepare('INSERT OR IGNORE INTO PostLikes (object_id, user_id) VALUES (?, ?)').bind(id, orbitId).run()
  if (Number(res.meta?.changes || 0) > 0) {
    await db.prepare('UPDATE Objects SET like_count = like_count + 1 WHERE id = ?').bind(id).run()

    try {
      const postOwner = (obj as any).owner_id
      if (postOwner && postOwner !== orbitId) {
        const liker = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
        const name = liker?.display_name?.trim() || 'Someone'
        const { createNotification } = await import('../notifications')
        const { broadcastToUser } = await import('../ws-bus')
        const notif = await createNotification(db, postOwner, 'like', `${name} liked your post`, null, { post_id: id, liker_id: orbitId })
        if (notif) broadcastToUser(postOwner, { type: 'notification', action: 'new', notification: notif })
      }
    } catch {}
  }
  const row = await db.prepare('SELECT like_count FROM Objects WHERE id = ?').bind(id).first<{ like_count: number }>()
  return c.json({ liked: true, like_count: Number(row?.like_count || 0) })
})

// Unlike a post (idempotent)
posts.delete('/:id/like', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const res = await db.prepare('DELETE FROM PostLikes WHERE object_id = ? AND user_id = ?').bind(id, orbitId).run()
  if (Number(res.meta?.changes || 0) > 0) {
    await db.prepare('UPDATE Objects SET like_count = MAX(like_count - 1, 0) WHERE id = ?').bind(id).run()
  }
  const row = await db.prepare('SELECT like_count FROM Objects WHERE id = ?').bind(id).first<{ like_count: number }>()
  return c.json({ liked: false, like_count: Number(row?.like_count || 0) })
})

// Save (bookmark) a post
posts.post('/:id/save', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const obj = await db.prepare('SELECT id FROM Objects WHERE id = ? AND is_public = 1 AND hidden_at IS NULL').bind(id).first()
  if (!obj) return c.json({ error: 'Post not found' }, 404)

  await db.prepare('INSERT OR IGNORE INTO Saves (user_id, object_id) VALUES (?, ?)').bind(orbitId, id).run()
  return c.json({ saved: true })
})

// Unsave a post
posts.delete('/:id/save', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  await db.prepare('DELETE FROM Saves WHERE user_id = ? AND object_id = ?').bind(orbitId, id).run()
  return c.json({ saved: false })
})

// List comments for a post
posts.get('/:id/comments', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const obj = await db.prepare('SELECT id FROM Objects WHERE id = ? AND is_public = 1 AND hidden_at IS NULL').bind(id).first()
  if (!obj) return c.json({ error: 'Post not found' }, 404)

  const rows = await db.prepare(`
    SELECT c.id, c.author_id, c.body, c.like_count, c.created_at,
           u.display_name as author_name, u.pfp_url as author_pfp,
           (SELECT COUNT(*) FROM CommentLikes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) as is_liked
    FROM Comments c
    LEFT JOIN Users u ON u.id = c.author_id
    WHERE c.object_id = ? AND c.hidden_at IS NULL
    ORDER BY c.created_at ASC
  `).bind(orbitId, id).all<any>()

  return c.json((rows.results || []).map((c: any) => ({
    id: c.id,
    author_id: c.author_id,
      author_name: c.author_name?.trim() || 'Unknown User',
    author_avatar: c.author_pfp || null,
    text: c.body,
    like_count: Number(c.like_count || 0),
    is_liked: Number(c.is_liked || 0) > 0,
    created_at: c.created_at,
  })))
})

// Add a comment
posts.post('/:id/comments', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  let body = ''
  try {
    const json = await c.req.json()
    if (typeof json?.body === 'string') body = json.body
    else if (typeof json?.text === 'string') body = json.text
  } catch {}
  const clean = body.trim().slice(0, 500)
  if (!clean) return c.json({ error: 'Comment body is required' }, 400)

  const obj = await db.prepare('SELECT id FROM Objects WHERE id = ? AND is_public = 1 AND hidden_at IS NULL').bind(id).first()
  if (!obj) return c.json({ error: 'Post not found' }, 404)

  const commentId = crypto.randomUUID()
  await db.prepare('INSERT INTO Comments (id, object_id, author_id, body) VALUES (?, ?, ?, ?)').bind(commentId, id, orbitId, clean).run()
  await db.prepare('UPDATE Objects SET comment_count = comment_count + 1 WHERE id = ?').bind(id).run()

  try {
    const postOwner = (obj as any).owner_id
    if (postOwner && postOwner !== orbitId) {
      const commenter = await db.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
      const name = commenter?.display_name?.trim() || 'Someone'
      const { createNotification } = await import('../notifications')
      const { broadcastToUser } = await import('../ws-bus')
      const notif = await createNotification(db, postOwner, 'comment', `${name} commented: "${clean.slice(0, 60)}"`, null, { post_id: id, comment_id: commentId })
      if (notif) broadcastToUser(postOwner, { type: 'notification', action: 'new', notification: notif })
    }
  } catch {}

  return c.json({ id: commentId, ok: true }, 201)
})

// Like a comment (idempotent)
posts.post('/:id/comments/:commentId/like', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const commentId = c.req.param('commentId')

  const comment = await db.prepare('SELECT id FROM Comments WHERE id = ? AND hidden_at IS NULL').bind(commentId).first()
  if (!comment) return c.json({ error: 'Comment not found' }, 404)

  const res = await db.prepare('INSERT OR IGNORE INTO CommentLikes (comment_id, user_id) VALUES (?, ?)').bind(commentId, orbitId).run()
  if (Number(res.meta?.changes || 0) > 0) {
    await db.prepare('UPDATE Comments SET like_count = like_count + 1 WHERE id = ?').bind(commentId).run()
  }
  const row = await db.prepare('SELECT like_count FROM Comments WHERE id = ?').bind(commentId).first<{ like_count: number }>()
  return c.json({ liked: true, like_count: Number(row?.like_count || 0) })
})

// Delete a comment (author or post owner)
posts.delete('/:id/comments/:commentId', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')
  const commentId = c.req.param('commentId')

  const comment = await db.prepare('SELECT author_id FROM Comments WHERE id = ?').bind(commentId).first<{ author_id: string }>()
  if (!comment) return c.json({ error: 'Comment not found' }, 404)
  if (comment.author_id !== orbitId) {
    const obj = await db.prepare('SELECT owner_id FROM Objects WHERE id = ?').bind(id).first<{ owner_id: string }>()
    if (!obj || obj.owner_id !== orbitId) return c.json({ error: 'Forbidden' }, 403)
  }

  await db.prepare('DELETE FROM Comments WHERE id = ?').bind(commentId).run()
  await db.prepare('DELETE FROM CommentLikes WHERE comment_id = ?').bind(commentId).run()
  return c.json({ ok: true })
})

// Report a post. Hides instantly, queues it for admin review.
posts.post('/:id/report', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const obj = await db.prepare('SELECT id FROM Objects WHERE id = ? AND is_public = 1').bind(id).first()
  if (!obj) return c.json({ error: 'Post not found' }, 404)

  let category = 'inappropriate'
  let reason: string | null = null
  try {
    const json = await c.req.json()
    if (typeof json?.category === 'string' && json.category) category = json.category
    if (typeof json?.reason === 'string') reason = json.reason
  } catch {}

  try {
    const result = await reportContent(db, orbitId, 'post', id, category, reason)
    return c.json({ ok: true, ...result }, 201)
  } catch (err) {
    if (err instanceof ReportError) return c.json({ error: err.message }, err.status as any)
    throw err
  }
})

// Delete a post (owner only)
posts.delete('/:id', async (c) => {
  const db = c.env.DB
  const orbitId = c.get('orbitId')
  const id = c.req.param('id')

  const obj = await db.prepare('SELECT owner_id, mime_type, is_public FROM Objects WHERE id = ?').bind(id).first<{ owner_id: string; mime_type: string; is_public: number }>()
  if (!obj) return c.json({ error: 'Post not found' }, 404)
  if (obj.owner_id !== orbitId) return c.json({ error: 'Forbidden' }, 403)

  if (obj.mime_type !== 'text/url' && c.env.BUCKET) {
    try {
      await c.env.BUCKET.delete(`objects/${id}`)
    } catch {}
  }

  await db.prepare('DELETE FROM Favorites WHERE object_id = ?').bind(id).run()
  await db.prepare('DELETE FROM Recipients WHERE object_id = ?').bind(id).run()
  await db.prepare('DELETE FROM PostLikes WHERE object_id = ?').bind(id).run()
  await db.prepare('DELETE FROM Saves WHERE object_id = ?').bind(id).run()
  await db.prepare('DELETE FROM CommentLikes WHERE comment_id IN (SELECT id FROM Comments WHERE object_id = ?)').bind(id).run()
  await db.prepare('DELETE FROM Comments WHERE object_id = ?').bind(id).run()
  await purgeObjectLikes(db, id)
  await db.prepare('DELETE FROM Objects WHERE id = ?').bind(id).run()

  if (obj.is_public === 1) {
    await db.prepare('UPDATE Users SET posts_count = MAX(COALESCE(posts_count, 0) - 1, 0) WHERE id = ?').bind(orbitId).run().catch(() => {})
  }

  return c.json({ success: true })
})
