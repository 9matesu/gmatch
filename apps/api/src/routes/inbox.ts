import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { deleteExpiredContent } from '../cleanup'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

const inbox = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

inbox.get('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '200', 10) || 200, 1), 500)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

  try {
    await deleteExpiredContent(c.env.DB, c.env.BUCKET).catch(() => {})

    const countRow = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT o.id) as total
      FROM Objects o
      LEFT JOIN Recipients r ON o.id = r.object_id
      WHERE (o.owner_id = ? OR r.recipient_id = ?)
        AND o.is_story = 0
        AND o.is_public = 0
        AND (o.is_avatar = 0 OR o.is_avatar IS NULL)
        AND o.hidden_at IS NULL
        AND (o.expires_at IS NULL OR datetime(o.expires_at) > datetime('now'))
    `).bind(orbitId, orbitId).first<{ total: number }>()

    const { results } = await c.env.DB.prepare(`
      SELECT DISTINCT 
        o.id, 
        o.owner_id, 
        o.size_bytes, 
        o.mime_type, 
        o.created_at,
        o.expires_at,
        o.caption,
        o.content_url,
        o.is_story,
        o.is_public,
        u.public_key as sender_pubkey,
        u.encryption_pub_key as sender_enc_pubkey,
        u.display_name,
        CASE WHEN f.object_id IS NOT NULL THEN 1 ELSE 0 END as is_favorited,
        CASE WHEN o.owner_id != ? THEN 1 ELSE 0 END as is_received,
        (SELECT COUNT(*) FROM Likes l WHERE l.object_id = o.id AND l.decision = 'like') as likes_count
      FROM Objects o
      LEFT JOIN Recipients r ON o.id = r.object_id
      LEFT JOIN Users u ON o.owner_id = u.id
      LEFT JOIN Favorites f ON o.id = f.object_id AND f.user_id = ?
      WHERE (o.owner_id = ? OR r.recipient_id = ?)
        AND o.is_story = 0
        AND o.is_public = 0
        AND (o.is_avatar = 0 OR o.is_avatar IS NULL)
        AND o.hidden_at IS NULL
        AND (o.expires_at IS NULL OR datetime(o.expires_at) > datetime('now'))
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(orbitId, orbitId, orbitId, orbitId, limit, offset).all()

    c.header('X-Total-Count', String(countRow?.total || 0))
    return c.json(results || [])
  } catch (err) {
    console.warn('[inbox] Failed to fetch inbox items:', err)
    return c.json([])
  }
})

inbox.post('/:id/favorite', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const objectId = c.req.param('id')
  
  // Check if it's already favorited
  const existing = await c.env.DB.prepare('SELECT 1 FROM Favorites WHERE user_id = ? AND object_id = ?').bind(orbitId, objectId).first()
  
  if (existing) {
    await c.env.DB.prepare('DELETE FROM Favorites WHERE user_id = ? AND object_id = ?').bind(orbitId, objectId).run()
    return c.json({ favorited: false })
  } else {
    await c.env.DB.prepare('INSERT INTO Favorites (user_id, object_id) VALUES (?, ?)').bind(orbitId, objectId).run()
    return c.json({ favorited: true })
  }
})

// Remove a received object from the user's inbox without deleting the original
inbox.post('/:id/remove', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const objectId = c.req.param('id')
  
  await c.env.DB.prepare('DELETE FROM Recipients WHERE object_id = ? AND recipient_id = ?').bind(objectId, orbitId).run()
  return c.json({ success: true, removed: true })
})

export { inbox }
