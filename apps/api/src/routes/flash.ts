import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { encryptBlob } from '../crypto'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { FLASH_TTL_SECONDS, type FlashEvent } from '@orbit/shared'
import { isValidMediaMagicBytes, detectMediaMime } from './objects'
import { broadcastToRoom } from '../ws-bus'
import { addPoints } from '../game'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const flash = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()
flash.use('*', orbitAuth)

const FLASH_ITEM_ID = 'item-flash-drop'

/** Consume one flash from the user's inventory. Returns false if none left. */
async function consumeFlash(db: D1Turso, orbitId: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE UserInventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_id = ? AND quantity > 0")
    .bind(orbitId, FLASH_ITEM_ID)
    .run()
  return (res?.meta?.changes || 0) > 0
}

async function likeCount(db: D1Turso, objectId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM Likes WHERE object_id = ? AND decision = 'like'")
    .bind(objectId)
    .first<{ cnt: number }>()
  return Number(row?.cnt || 0)
}

async function loadUser(db: D1Turso, userId: string): Promise<{ display_name: string | null; pfp_url: string | null }> {
  const row = await db
    .prepare('SELECT display_name, pfp_url FROM Users WHERE id = ?')
    .bind(userId)
    .first<{ display_name: string | null; pfp_url: string | null }>()
  return { display_name: row?.display_name ?? null, pfp_url: row?.pfp_url ?? null }
}

// Upload a photo and fire a Flash Drop: consumes one inventory charge and
// broadcasts the image to every online user in the 'global' WS room.
flash.post('/', async (c) => {
  try {
    const orbitId = c.get('orbitId')

    const formData = await c.req.formData()
    const imageFile = formData.get('image') as File | null
    const linkUrl = (formData.get('url') as string | null)?.trim() || null

    if (!imageFile && !linkUrl) {
      return c.json({ error: 'Provide either an image file or a URL' }, 400)
    }
    if (imageFile && linkUrl) {
      return c.json({ error: 'Provide either an image file or a URL, not both' }, 400)
    }

    const consumed = await consumeFlash(c.env.DB, orbitId)
    if (!consumed) {
      return c.json({ error: 'No Flash Drop in inventory. Buy one in the Store first.' }, 409)
    }

    const objectId = crypto.randomUUID()
    let contentUrl: string
    let mimeType = 'image/jpeg'

    if (linkUrl) {
      const parsedUrl = new URL(linkUrl)
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || linkUrl.length > 2048) {
        return c.json({ error: 'Invalid URL format' }, 400)
      }
      const cleanUrl = linkUrl.split('?')[0].toLowerCase()
      const isVideo = cleanUrl.endsWith('.mp4') || cleanUrl.endsWith('.webm') || cleanUrl.endsWith('.mov') || cleanUrl.endsWith('.ogg')
      mimeType = isVideo ? (cleanUrl.endsWith('.webm') ? 'video/webm' : 'video/mp4') : 'text/url'
      contentUrl = linkUrl
    } else {
      const arrayBuffer = await imageFile!.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      if (bytes.length > 50 * 1024 * 1024) {
        return c.json({ error: 'File exceeds 50MB limit' }, 400)
      }
      if (!isValidMediaMagicBytes(bytes)) {
        return c.json({ error: 'Invalid media format (magic bytes check failed)' }, 400)
      }
      mimeType = detectMediaMime(bytes, imageFile?.type || imageFile?.name)
      if (bytes.length <= 128 * 1024) {
        contentUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
      } else {
        const encryptedBytes = encryptBlob(bytes)
        if (c.env.BUCKET) {
          await c.env.BUCKET.put(`objects/${objectId}`, encryptedBytes, {
            httpMetadata: { contentType: mimeType },
          })
        }
        contentUrl = `/api/objects/${objectId}`
      }
    }

    const expiresAt = new Date(Date.now() + FLASH_TTL_SECONDS * 1000).toISOString()
    await c.env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_story, is_flash, expires_at) VALUES (?, ?, ?, ?, ?, NULL, 1, 1, ?)'
    ).bind(objectId, orbitId, 0, mimeType, contentUrl, expiresAt).run()

    // Story bonus for the flash, like a story post.
    await addPoints(c.env.DB, orbitId, 10).catch(() => {})

    const user = await loadUser(c.env.DB, orbitId)
    const flashEvent: FlashEvent = {
      id: objectId,
      owner_id: orbitId,
      owner_name: user.display_name,
      pfp_url: user.pfp_url,
      content_url: contentUrl,
      mime_type: mimeType,
      likes_count: 0,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      liked_by_me: false,
    }

    broadcastToRoom('global', { type: 'flash', action: 'new', flash: flashEvent })

    return c.json({ ok: true, flash: flashEvent }, 201)
  } catch (err: any) {
    console.error('[flash.post] Error firing flash:', err?.stack || err?.message || err)
    return c.json({ error: err?.message || 'Failed to fire flash' }, 500)
  }
})

// Fetch a single flash event by object id (for late joiners / recovery).
flash.get('/:id', async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')
  try {
    const obj = await c.env.DB.prepare(
      'SELECT id, owner_id, content_url, mime_type, created_at, expires_at FROM Objects WHERE id = ? AND is_flash = 1 AND (expires_at IS NULL OR datetime(expires_at) > datetime(\'now\'))'
    ).bind(id).first<{ id: string; owner_id: string; content_url: string; mime_type: string; created_at: string; expires_at: string }>()
    if (!obj) return c.json({ error: 'Flash not found' }, 404)

    const user = await loadUser(c.env.DB, obj.owner_id)
    const myLike = await c.env.DB.prepare("SELECT 1 FROM Likes WHERE user_id = ? AND object_id = ? AND decision = 'like'").bind(orbitId, id).first()
    const flashEvent: FlashEvent = {
      id: obj.id,
      owner_id: obj.owner_id,
      owner_name: user.display_name,
      pfp_url: user.pfp_url,
      content_url: obj.content_url,
      mime_type: obj.mime_type,
      likes_count: await likeCount(c.env.DB, id),
      created_at: obj.created_at,
      expires_at: obj.expires_at,
      liked_by_me: Boolean(myLike),
    }
    return c.json({ flash: flashEvent })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to load flash' }, 500)
  }
})
