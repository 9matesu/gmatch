import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

type Bindings = {
  DB: D1Turso
}

const friends = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

// Send a friend request
friends.post('/requests', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { receiverId } = await c.req.json()

  if (orbitId === receiverId) return c.json({ error: 'Cannot friend yourself' }, 400)

  // Check if user exists
  const user = await c.env.DB.prepare('SELECT id FROM Users WHERE id = ?').bind(receiverId).first()
  if (!user) return c.json({ error: 'User not found' }, 404)

  // Check if already friends
  const existing = await c.env.DB.prepare('SELECT 1 FROM Friends WHERE user_id = ? AND friend_id = ?').bind(orbitId, receiverId).first()
  if (existing) return c.json({ error: 'Already connected' }, 409)

  // Check if already has a pending request
  const pending = await c.env.DB.prepare('SELECT 1 FROM FriendRequests WHERE sender_id = ? AND receiver_id = ? AND status = ?').bind(orbitId, receiverId, 'pending').first()
  if (pending) return c.json({ error: 'Request already sent' }, 409)

  // Create a pending friend request
  const requestId = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO FriendRequests (id, sender_id, receiver_id, status) VALUES (?, ?, ?, ?)'
  ).bind(requestId, orbitId, receiverId, 'pending').run()

  return c.json({ success: true, requestId })
})

// Accept a friend request
friends.post('/requests/:id/accept', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const requestId = c.req.param('id')

  const req = await c.env.DB.prepare('SELECT sender_id FROM FriendRequests WHERE id = ? AND receiver_id = ? AND status = ?').bind(requestId, orbitId, 'pending').first<{sender_id: string}>()
  if (!req) return c.json({ error: 'Request not found' }, 404)

  // Create friend link (bidirectional)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE FriendRequests SET status = ? WHERE id = ?').bind('accepted', requestId),
    c.env.DB.prepare('INSERT OR IGNORE INTO Friends (user_id, friend_id) VALUES (?, ?)').bind(orbitId, req.sender_id),
    c.env.DB.prepare('INSERT OR IGNORE INTO Friends (user_id, friend_id) VALUES (?, ?)').bind(req.sender_id, orbitId)
  ])

  return c.json({ success: true })
})

// Reject a friend request
friends.post('/requests/:id/reject', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const requestId = c.req.param('id')

  const req = await c.env.DB.prepare('SELECT sender_id FROM FriendRequests WHERE id = ? AND receiver_id = ? AND status = ?').bind(requestId, orbitId, 'pending').first<{sender_id: string}>()
  if (!req) return c.json({ error: 'Request not found' }, 404)

  await c.env.DB.prepare('UPDATE FriendRequests SET status = ? WHERE id = ?').bind('rejected', requestId).run()

  return c.json({ success: true })
})

// Remove a friend (bidirectional)
friends.post('/remove', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { friendId } = await c.req.json()

  if (!friendId) return c.json({ error: 'Missing friendId' }, 400)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM Friends WHERE user_id = ? AND friend_id = ?').bind(orbitId, friendId),
    c.env.DB.prepare('DELETE FROM Friends WHERE user_id = ? AND friend_id = ?').bind(friendId, orbitId),
  ])

  return c.json({ success: true })
})

// List pending friend requests
friends.get('/requests', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT fr.id, fr.sender_id, fr.status, fr.created_at, u.display_name as sender_name
      FROM FriendRequests fr
      LEFT JOIN Users u ON fr.sender_id = u.id
      WHERE fr.receiver_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).bind(orbitId).all()

    return c.json(results || [])
  } catch (err) {
    console.warn('[friends] Failed to fetch requests:', err)
    return c.json([])
  }
})

// List friends (including their public keys for E2EE)
friends.get('/', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT Users.id, Users.public_key, Users.encryption_pub_key, Users.display_name, Users.tags
      FROM Friends 
      JOIN Users ON Friends.friend_id = Users.id 
      WHERE Friends.user_id = ?
    `).bind(orbitId).all<any>()

    const out = (results || []).map((r: any) => {
      let tags: string[] = []
      if (r.tags) {
        try {
          tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : (Array.isArray(r.tags) ? r.tags : [])
        } catch {}
      }
      return {
        id: r.id,
        public_key: r.public_key,
        encryption_pub_key: r.encryption_pub_key,
        display_name: r.display_name || undefined,
        tags,
      }
    })

    return c.json(out)
  } catch (err) {
    console.warn('[friends] Failed to fetch friends list:', err)
    return c.json([])
  }
})

export { friends }
