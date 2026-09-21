import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { encryptBlob, decryptBlob, createSignedObjectToken, verifySignedObjectToken } from '../crypto'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { purgeObjectLikes, addPoints } from '../game'
import { deleteExpiredContent } from '../cleanup'
import { PICTURE_TTL_SECONDS, STORY_TTL_SECONDS, checkBlacklistedTags } from '@orbit/shared'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { proxyAndStoreExternal } from '../proxy'
import { isPartyMediaObject } from '../watchparty'
import { stripImageMetadata } from '../metadata-strip'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

const objects = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string, isSignedToken?: boolean } }>()

export function isValidMediaMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false
  // JPEG: FF D8
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return true
  if (bytes.length < 4) return false
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true
  // GIF: GIF8 (47 49 46 38) or GIF7 (47 49 46 37)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && (bytes[3] === 0x38 || bytes[3] === 0x37)) return true
  // WEBP: RIFF....WEBP
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true
  // MP4 / QuickTime / AVIF / HEIC: bytes 4-8 are 'ftyp', 'moov', 'mdat', 'free', 'wide'
  if (bytes.length >= 8) {
    const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7])
    if (tag === 'ftyp' || tag === 'moov' || tag === 'mdat' || tag === 'free' || tag === 'wide') return true
  }
  // WebM / MKV: 1A 45 DF A3
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return true
  // OGG: OggS (4F 67 67 53)
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true
  // BMP: BM (42 4D)
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return true
  // TIFF: II*. (49 49 2A 00) or MM.* (4D 4D 00 2A)
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) ||
    (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A)) return true

  return false
}

export function detectMediaMime(bytes: Uint8Array, fallbackHint?: string | null): string {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 4 && bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'video/webm'
  if (bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'video/ogg'
  if (bytes.length >= 8) {
    const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7])
    if (tag === 'ftyp') {
      const sub = bytes.length >= 12 ? String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase() : ''
      if (sub.includes('avif') || sub.includes('avis')) return 'image/avif'
      if (sub.includes('heic') || sub.includes('mif1')) return 'image/heic'
      if (sub.includes('qt')) return 'video/quicktime'
      return 'video/mp4'
    }
    if (tag === 'moov' || tag === 'mdat' || tag === 'wide' || tag === 'free') return 'video/mp4'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) return 'image/bmp'
  if (fallbackHint) {
    const lower = fallbackHint.toLowerCase()
    if (lower.includes('mp4')) return 'video/mp4'
    if (lower.includes('webm')) return 'video/webm'
    if (lower.includes('ogg')) return 'video/ogg'
    if (lower.includes('mov') || lower.includes('quicktime')) return 'video/quicktime'
    if (lower.includes('png')) return 'image/png'
    if (lower.includes('gif')) return 'image/gif'
    if (lower.includes('webp')) return 'image/webp'
  }
  return 'image/jpeg'
}

/**
 * SHA-256 hex digest of raw bytes, used to dedup byte-identical uploads per owner.
 * Uses @noble/hashes (same as middleware/auth) — synchronous, no BufferSource typing churn.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(sha256(bytes))
}

/** Any object still alive (profile pics never expire, everything else has a future expires_at). */
const LIVE_OBJECT_FILTER = "(expires_at IS NULL OR datetime(expires_at) > datetime('now'))"

objects.post('/register', orbitAuth, async (c) => {
  try {
    const orbitId = c.get('orbitId')
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const objectId = (typeof body.id === 'string' && body.id.trim()) ? body.id.trim() : crypto.randomUUID()
    const contentHash = (typeof body.content_hash === 'string' && body.content_hash.trim().toLowerCase()) || null
    const magnetUri = (typeof body.magnet_uri === 'string' && body.magnet_uri.trim()) || null
    const sizeBytes = Number(body.size_bytes) || 0
    const mimeType = (typeof body.mime_type === 'string' && body.mime_type.trim()) || 'application/octet-stream'
    const caption = (typeof body.caption === 'string' && body.caption.trim()) || null
    const postCaption = (typeof body.post_caption === 'string' && body.post_caption.trim()) || null
    const location = (typeof body.location === 'string' && body.location.trim()) || null
    const postTags = (typeof body.tags === 'string' && body.tags.trim()) || null
    const isPublic = (body.is_public === 1 || body.is_public === true) ? 1 : 0
    const isStory = (body.is_story === 1 || body.is_story === true) ? 1 : 0
    const isAvatar = (body.is_avatar === 1 || body.is_avatar === true) ? 1 : 0
    const isChat = (body.is_chat === 1 || body.is_chat === true) ? 1 : 0
    const postGroup = (typeof body.post_group === 'string' && body.post_group.trim()) || null

    if (postTags) {
      const { hasBlacklisted, blockedTags } = checkBlacklistedTags(postTags.split(','))
      if (hasBlacklisted) {
        return c.json({ error: `The following tags are prohibited: ${blockedTags.join(', ')}` }, 400)
      }
    }

    const expiresAt = isStory ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : null
    const contentUrl = magnetUri || (contentHash ? `urn:sha256:${contentHash}` : `/api/objects/${objectId}`)
    const recipientsRaw = typeof body.recipients === 'string' ? body.recipients : null

    await c.env.DB.prepare(
      'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, post_caption, location, post_tags, is_story, expires_at, content_hash, post_group, is_chat, is_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      objectId, orbitId, sizeBytes, mimeType, contentUrl, caption, isPublic, postCaption, location, postTags, isStory, expiresAt, contentHash, postGroup, isChat, isAvatar
    ).run()

    if (recipientsRaw) {
      const ids = recipientsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (!ids.includes(orbitId)) ids.push(orbitId)
      for (const id of ids) {
        await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objectId, id).run().catch(() => { })
      }
    } else if (isPublic !== 1) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objectId, orbitId).run().catch(() => { })
    }

    if (isPublic === 1) {
      await c.env.DB.prepare('UPDATE Users SET posts_count = COALESCE(posts_count, 0) + 1 WHERE id = ?').bind(orbitId).run().catch(() => {})
      // Real-time push so connected clients prepend the new post to the feed.
      // Mirrors the multipart path: only the first-inserted row of a
      // post_group broadcasts (the feed groups the rest into its media).
      // Non-public rows (stories) match no broadcast row and stay silent.
      let isGroupPrimary = true
      if (postGroup) {
        const min = await c.env.DB.prepare('SELECT MIN(rowid) as first_row FROM Objects WHERE post_group = ?').bind(postGroup).first<{ first_row?: number | null }>().catch(() => null)
        const self = await c.env.DB.prepare('SELECT rowid FROM Objects WHERE id = ?').bind(objectId).first<{ rowid?: number | null }>().catch(() => null)
        isGroupPrimary = Boolean(min?.first_row && self?.rowid && min.first_row === self.rowid)
      }
      if (isGroupPrimary) {
        const { broadcastNewPost } = await import('./posts')
        await broadcastNewPost(c.env.DB, objectId).catch(() => { })
      }
    }

    return c.json({
      id: objectId,
      content_hash: contentHash,
      magnet_uri: magnetUri,
      content_url: contentUrl,
      size_bytes: sizeBytes,
      mime_type: mimeType,
      is_public: isPublic,
      is_avatar: isAvatar,
    }, 200)
  } catch (err) {
    console.error('Failed to register object metadata:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

objects.post('/', orbitAuth, async (c) => {
  try {
    const orbitId = c.get('orbitId')

    const formData = await c.req.formData()
    const imageFile = formData.get('image') as File | null
    const linkUrl = (formData.get('url') as string | null)?.trim() || null
    // Client-declared MIME (the share flow sends video/mp4 for video items).
    // Used only as a fallback hint for magic-byte detection — never trusted
    // over the actual bytes.
    const clientMimeRaw = (formData.get('mime_type') as string | null)?.trim().toLowerCase() || null
    const clientMimeHint = clientMimeRaw && /^[a-z]+\/[a-z0-9.+-]+$/.test(clientMimeRaw) ? clientMimeRaw : null
    const encrypted = formData.get('encrypted') === 'true'
    const caption = (formData.get('caption') as string | null)?.trim() || null
    const clientContentHash = (formData.get('content_hash') as string | null)?.trim().toLowerCase() || null

    const isStory = formData.get('is_story') === 'true' ? 1 : 0
    const isWallpaper = formData.get('is_wallpaper') === 'true' ? 1 : 0
    const isChat = (formData.get('is_chat') === 'true' || formData.get('is_chat') === '1') ? 1 : 0
    const isAvatar = (formData.get('is_avatar') === 'true' || formData.get('is_avatar') === '1') ? 1 : 0
    const isPublic = (formData.get('is_public') === 'true' || formData.get('is_public') === '1') ? 1 : 0
    const postCaption = (formData.get('post_caption') as string | null)?.trim() || null
    const location = (formData.get('location') as string | null)?.trim() || null
    const postTags = (formData.get('tags') as string | null)?.trim() || null
    const postGroup = (formData.get('post_group') as string | null)?.trim() || null
    if (postGroup && (postGroup.length > 80 || !/^[A-Za-z0-9_-]+$/.test(postGroup))) {
      return c.json({ error: 'Invalid post group' }, 400)
    }
    if (postTags) {
      const { hasBlacklisted, blockedTags } = checkBlacklistedTags(postTags.split(','))
      if (hasBlacklisted) {
        return c.json({ error: `The following tags are prohibited: ${blockedTags.join(', ')}` }, 400)
      }
    }
    const durationHoursRaw = formData.get('duration_hours') as string | null
    const durationMinutesRaw = formData.get('duration_minutes') as string | null
    let durationHours = durationHoursRaw ? Math.min(Math.max(1, parseInt(durationHoursRaw, 10)), 24) : 0

    // Cards last forever by default. Only stories get a short TTL (STORY_TTL),
    // and explicit user-chosen durations (timebombs / auto-delete) still apply.
    // Profile pictures and public feed posts persist indefinitely too.
    let expiresAt: string | null = null
    if (isStory === 1) {
      expiresAt = new Date(Date.now() + STORY_TTL_SECONDS * 1000).toISOString()
      durationHours = Math.max(1, Math.round(STORY_TTL_SECONDS / 3600))
    } else if (durationMinutesRaw) {
      const minutes = Math.min(Math.max(1, parseInt(durationMinutesRaw, 10)), PICTURE_TTL_SECONDS / 60)
      expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString()
      durationHours = Math.max(1, Math.round(minutes / 60))
    } else if (durationHours > 0) {
      expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
    } else {
      expiresAt = null
    }

    if (!imageFile && !linkUrl) {
      return c.json({ error: 'Provide either an image file or a URL' }, 400)
    }
    if (imageFile && linkUrl) {
      return c.json({ error: 'Provide either an image file or a URL, not both' }, 400)
    }

    const objectId = crypto.randomUUID()
    let imageSize = 0

    if (linkUrl) {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(linkUrl)
      } catch {
        return c.json({ error: 'Invalid URL format' }, 400)
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return c.json({ error: 'Invalid URL format' }, 400)
      }
      if (linkUrl.length > 2048) {
        return c.json({ error: 'URL exceeds 2048 characters' }, 400)
      }

      // External URLs are now always proxied+validated through our own
      // infrastructure: clients never touch the remote host, preventing IP
      // leakage and removing the external CDN tracking exposure. Extractors
      // for Twitter/X, Discord, Tenor, Giphy, Reddit, Instagram feed into
      // proxyAndStoreExternal. EXIF is stripped on the server side.
      const proxied = await proxyAndStoreExternal(linkUrl, c.env.BUCKET, 'objects', objectId)
      if (proxied) {
        imageSize = proxied.bytesStored
        const mime = isWallpaper ? 'image/wallpaper' : proxied.mimeType
        await c.env.DB.prepare(
          "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, post_caption, location, post_tags, is_story, expires_at, is_proxied, proxied_mime, post_group, is_chat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)"
        ).bind(
          objectId, orbitId, proxied.bytesStored, mime, proxied.storedUrl, caption, isPublic, postCaption, location, postTags, isStory, expiresAt, proxied.proxiedMime, postGroup, isChat
        ).run()
      } else {
        // Proxy failed — surface a clear 400 so the client knows the URL
        // couldn't be fetched/validated, instead of silently storing the
        // raw external link and risking an IP leak when served.
        return c.json({ error: 'Could not fetch or validate the URL' }, 400)
      }
    } else {
      // Image upload
      const arrayBuffer = await imageFile!.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      if (bytes.length > 50 * 1024 * 1024) {
        return c.json({ error: 'File exceeds 50MB limit' }, 400)
      }

      if (bytes.length > 128 * 1024) {
        return c.json({ error: 'Central server does not store media files. Register content metadata and seed via P2P.' }, 422)
      }

      if (!isValidMediaMagicBytes(bytes)) {
        return c.json({ error: 'Invalid media format (magic bytes check failed)' }, 400)
      }

      const detectedMime = detectMediaMime(bytes, clientMimeHint || imageFile?.type || imageFile?.name)
      // Wave 2 / F20: strip every metadata container (EXIF/GPS, XMP, ICC,
      // comments) BEFORE hashing/storing — tags live in the DB, never in the
      // file. Stripping before the hash keeps dedup on canonical bytes.
      const strippedBytes = stripImageMetadata(bytes, detectedMime)
      imageSize = strippedBytes.length

      // Content fingerprint for dedup: trust a client-computed SHA-256 when
      // provided, otherwise compute it server-side (over the stripped bytes)
      // so the guard always holds.
      const contentHash = clientContentHash && /^[0-9a-f]{64}$/.test(clientContentHash)
        ? clientContentHash
        : await sha256Hex(strippedBytes)

      // Handle byte-identical re-uploads: reuse existing object and attach any recipients
      if (contentHash && isStory === 0) {
        const dup = await c.env.DB.prepare(
          `SELECT id FROM Objects WHERE owner_id = ? AND content_hash = ? AND is_story = 0 AND is_public = ? AND is_avatar = ? AND ${LIVE_OBJECT_FILTER} LIMIT 1`
        ).bind(orbitId, contentHash, isPublic, isAvatar).first<{ id: string }>()
        if (dup) {
          const recipientsRaw = formData.get('recipients') as string | null
          let recipientsCount = 1
          if (isAvatar === 1) {
            recipientsCount = 0
          } else if (recipientsRaw) {
            const ids = recipientsRaw.split(',').map((s) => s.trim()).filter(Boolean)
            if (!ids.includes(orbitId)) ids.push(orbitId)
            recipientsCount = ids.length
            for (const id of ids) {
              await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(dup.id, id).run().catch(() => { })
            }
          }
          return c.json({
            id: dup.id,
            type: 'image',
            size: imageSize,
            reused: true,
            recipients: recipientsCount,
            is_story: 0,
            is_avatar: isAvatar,
            points_awarded: 0,
          }, 200)
        }
      }

      // Encrypt blob at rest before storing
      const encryptedBytes = encryptBlob(strippedBytes)
      const mimeType = isWallpaper ? 'image/wallpaper' : (encrypted ? 'application/octet-stream' : detectedMime)

      if (c.env.BUCKET) {
        await c.env.BUCKET.put(`objects/${objectId}`, encryptedBytes, {
          httpMetadata: { contentType: mimeType }
        })
      }

      const contentUrl = (strippedBytes.length <= 128 * 1024 && !encrypted)
        ? `data:${mimeType === 'image/wallpaper' ? 'image/jpeg' : mimeType};base64,${Buffer.from(strippedBytes).toString('base64')}`
        : `/api/objects/${objectId}`

      await c.env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, caption, is_public, post_caption, location, post_tags, is_story, expires_at, content_hash, post_group, is_chat, is_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        objectId, orbitId, strippedBytes.length, mimeType, contentUrl, caption, isPublic, postCaption, location, postTags, isStory, expiresAt, contentHash, postGroup, isChat, isAvatar
      ).run()
    }

    // Public posts increment the author's profile post counter (kept in sync
    // with the denormalized posts_count column added by migration 017).
    if (isPublic === 1) {
      await c.env.DB.prepare('UPDATE Users SET posts_count = COALESCE(posts_count, 0) + 1 WHERE id = ?').bind(orbitId).run().catch(() => { })
      // Real-time push so connected clients prepend the new post to the feed.
      // For multi-image posts (post_group set) only the first-inserted row is
      // broadcast — the feed groups the rest into that post's media array.
      let isGroupPrimary = true
      if (postGroup) {
        const min = await c.env.DB.prepare('SELECT MIN(rowid) as first_row FROM Objects WHERE post_group = ?').bind(postGroup).first<{ first_row?: number | null }>()
        const self = await c.env.DB.prepare('SELECT rowid FROM Objects WHERE id = ?').bind(objectId).first<{ rowid?: number | null }>()
        isGroupPrimary = Boolean(min?.first_row && self?.rowid && min.first_row === self.rowid)
      }
      if (isGroupPrimary) {
        const { broadcastNewPost } = await import('./posts')
        await broadcastNewPost(c.env.DB, objectId).catch(() => { })
      }
    }

    const recipientsRaw = formData.get('recipients') as string | null
    let recipientsCount = 1
    if (isAvatar === 1) {
      recipientsCount = 0
    } else if (recipientsRaw) {
      const ids = recipientsRaw.split(',').map(s => s.trim()).filter(Boolean)
      if (!ids.includes(orbitId)) ids.push(orbitId)
      recipientsCount = ids.length
      for (const id of ids) {
        await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objectId, id).run().catch(() => { })
      }
      try {
        const sender = await c.env.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(orbitId).first<{ display_name: string | null }>()
        const name = sender?.display_name?.trim() || 'Someone'
        const { createNotification } = await import('../notifications')
        const { broadcastToUser } = await import('../ws-bus')
        for (const recipientId of ids) {
          if (recipientId && recipientId !== orbitId) {
            const notif = await createNotification(c.env.DB, recipientId, 'card_received', `${name} sent you a card`, caption || null, { object_id: objectId, sender_id: orbitId })
            if (notif) broadcastToUser(recipientId, { type: 'notification', action: 'new', notification: notif })
          }
        }
      } catch {}
    } else {
      // Private by default: cards only reach others via explicit sharing or a
      // perfect-match reward — never broadcast to the whole network.
      await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objectId, orbitId).run().catch(() => { })
      const countRow = await c.env.DB.prepare('SELECT COUNT(*) as c FROM Recipients WHERE object_id = ?').bind(objectId).first<{ c: number }>()
      recipientsCount = countRow?.c || 1
    }

    // Story bonus is now a flat daily score award (stories all last 12h).
    let bonusPoints = 0
    if (isStory === 1) {
      bonusPoints = 10
      await addPoints(c.env.DB, orbitId, bonusPoints)
    }
    await c.env.DB.prepare('UPDATE Users SET objects_sent_count = COALESCE(objects_sent_count, 0) + 1 WHERE id = ?').bind(orbitId).run().catch(() => { })

    return c.json({
      id: objectId,
      type: linkUrl ? 'link' : 'image',
      size: imageSize,
      recipients: recipientsCount,
      is_story: isStory,
      is_avatar: isAvatar,
      points_awarded: bonusPoints
    }, 201)
  } catch (err: any) {
    console.error('[objects.post] Error creating object:', err?.stack || err?.message || err)
    return c.json({ error: err?.message || 'Failed to upload object' }, 500)
  }
})

async function purgeDeadObject(db: any, bucket: any, id: string) {
  try {
    await db.prepare('DELETE FROM Objects WHERE id = ?').bind(id).run()
    await db.prepare('DELETE FROM Recipients WHERE object_id = ?').bind(id).run()
    await db.prepare('DELETE FROM Favorites WHERE object_id = ?').bind(id).run()
    await db.prepare('DELETE FROM Likes WHERE object_id = ?').bind(id).run()
    await db.prepare('DELETE FROM LobbyImages WHERE id = ? OR content_url LIKE ?').bind(id, `%${id}%`).run()
    await db.prepare('UPDATE GameMatches SET card_a = NULL WHERE card_a = ?').bind(id).run()
    await db.prepare('UPDATE GameMatches SET card_b = NULL WHERE card_b = ?').bind(id).run()
    await db.prepare('UPDATE TierMatches SET card_a = NULL WHERE card_a = ?').bind(id).run()
    await db.prepare('UPDATE TierMatches SET card_b = NULL WHERE card_b = ?').bind(id).run()
    if (bucket) {
      await bucket.delete(`objects/${id}`).catch(() => { })
    }
  } catch (err) {
    console.error(`[objects] Failed purging dead object ${id}:`, err)
  }
}

objects.get('/stories', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  try {
    // Automatically purge expired stories and their associated blobs
    await deleteExpiredContent(c.env.DB, c.env.BUCKET).catch(() => { })

    const { results } = await c.env.DB.prepare(`
      SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.created_at, o.expires_at, o.caption, o.content_url, o.gacha_downloads_count, u.display_name, u.pfp_url, u.public_key as sender_pubkey, u.encryption_pub_key as sender_enc_pubkey,
        EXISTS(SELECT 1 FROM StoryViews v WHERE v.object_id = o.id AND v.viewer_id = ?) AS viewed,
        CASE WHEN o.owner_id = ? THEN (SELECT COUNT(*) FROM StoryViews v2 WHERE v2.object_id = o.id) END AS view_count
      FROM Objects o
      LEFT JOIN Users u ON o.owner_id = u.id
      WHERE o.is_story = 1 AND o.hidden_at IS NULL AND (o.expires_at IS NULL OR datetime(o.expires_at) > datetime('now'))
      ORDER BY o.created_at DESC
      LIMIT 200
    `).bind(orbitId, orbitId).all()

    return c.json(results || [])
  } catch  {
    return c.json([])
  }
})

objects.post('/:id/claim-gacha', orbitAuth, async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')

  try {
    const obj = await c.env.DB.prepare('SELECT id, owner_id FROM Objects WHERE id = ?').bind(id).first<{ id: string; owner_id: string }>()
    if (!obj) return c.json({ error: 'Object not found' }, 404)
    if (obj.owner_id === orbitId) return c.json({ error: 'Cannot claim your own story' }, 400)

    const already = await c.env.DB.prepare('SELECT 1 FROM Recipients WHERE object_id = ? AND recipient_id = ?').bind(id, orbitId).first()
    if (already) {
      return c.json({ success: true, object_id: id, already_claimed: true })
    }

    // Increment gacha_downloads_count on object
    await c.env.DB.prepare('UPDATE Objects SET gacha_downloads_count = COALESCE(gacha_downloads_count, 0) + 1 WHERE id = ?').bind(id).run().catch(() => { })

    // Increment gacha_items_collected on caller user
    await c.env.DB.prepare('UPDATE Users SET gacha_items_collected = COALESCE(gacha_items_collected, 0) + 1 WHERE id = ?').bind(orbitId).run().catch(() => { })

    // Add recipient row so user can access object
    await c.env.DB.prepare('INSERT OR IGNORE INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(id, orbitId).run().catch(() => { })

    return c.json({ success: true, object_id: id, points_awarded: 0 })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to claim story' }, 500)
  }
})

// Record that the caller watched a story. Idempotent (PK on object+viewer), so
// the client can fire it on every story open without a dedupe round-trip.
objects.post('/:id/view', orbitAuth, async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')
  const obj = await c.env.DB.prepare('SELECT id FROM Objects WHERE id = ? AND is_story = 1').bind(id).first()
  if (!obj) return c.json({ error: 'Story not found' }, 404)
  await c.env.DB.prepare('INSERT OR IGNORE INTO StoryViews (object_id, viewer_id) VALUES (?, ?)').bind(id, orbitId).run()
  return c.json({ success: true })
})

objects.get('/:id/signed-url', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const orbitId = c.get('orbitId')

  const row = await c.env.DB.prepare(
    'SELECT o.id, o.owner_id, o.is_story, o.is_public FROM Objects o WHERE o.id = ?'
  ).bind(id).first<{ id: string; owner_id: string; is_story: number; is_public: number }>()
  if (!row) return c.json({ error: 'Object not found' }, 404)

  if (row.owner_id !== orbitId && !row.is_story && row.is_public !== 1) {
    const recipient = await c.env.DB.prepare(
      'SELECT 1 FROM Recipients WHERE object_id = ? AND recipient_id = ? LIMIT 1'
    ).bind(id, orbitId).first()
    if (!recipient) {
      const isCard = await c.env.DB.prepare(
        "SELECT 1 FROM Cards WHERE media_object_id = ? AND moderation_state = 'active' LIMIT 1"
      ).bind(id).first().catch(() => null)
      if (!isCard) {
        return c.json({ error: 'Object not found' }, 404)
      }
    }
  }

  const { sig, exp, jti } = createSignedObjectToken(id)
  return c.json({ object_id: id, sig, exp, jti, url: `/api/objects/${id}?sig=${sig}&exp=${exp}&jti=${jti}` })
})

objects.get('/:id', async (c, next) => {
  const id = c.req.param('id') || ''
  const sig = c.req.query('sig')
  const expStr = c.req.query('exp')
  const jti = c.req.query('jti')
  const exp = expStr ? parseInt(expStr, 10) : 0

  if (sig || expStr) {
    if (!sig || !exp || !verifySignedObjectToken(id, sig, exp, jti || '')) {
      return c.json({ error: 'Invalid or expired signature' }, 401)
    }
    c.set('isSignedToken', true)
    return next()
  }

  // Soft auth: check if auth headers are present and valid, otherwise allow handler to serve public content
  const orbitIdHeader = c.req.header('X-Orbit-Id')
  if (orbitIdHeader) {
    return orbitAuth(c, next)
  }

  return next()
}, async (c) => {
  const id = c.req.param('id') || ''
  const isSignedToken = c.get('isSignedToken') === true
  const orbitId = c.get('orbitId')
  const raw = c.req.query('raw') === 'true'

  if (id && id.startsWith('p2p-obj-')) {
    return c.json({ error: 'P2P object is stored client-side in browser IndexedDB' }, 404)
  }

  let row: { id: string; owner_id: string; size_bytes: number; mime_type: string; content_url: string | null; created_at: string; is_story: number; is_public: number; is_avatar: number; hidden_at: string | null; content_hash: string | null } | null = null
  try {
    row = await c.env.DB.prepare(
      'SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.content_url, o.created_at, o.is_story, o.is_public, o.is_avatar, o.hidden_at, o.content_hash FROM Objects o WHERE o.id = ?'
    ).bind(id).first()
  } catch (err) {
    console.error(`Failed to load object ${id}:`, err)
    return c.json({ error: 'Database temporarily unavailable' }, 503)
  }

  if (!row) return c.json({ error: 'Object not found' }, 404)

  // Reported content is hidden for everyone until an admin resolves the report.
  if (row.hidden_at) return c.json({ error: 'Object not found' }, 404)

  // Authorization: only *** owner, explicit recipients, valid signed tokens,
  // admins, or duel match spectators (for revealed match cards) may read an object.
  // Public posts (is_public=1), stories (is_story=1), active Cards, and avatars (is_avatar=1)
  // are intentionally readable by any viewer — stories are surfaced in the tray,
  // public posts in the feed, and avatars across arena, chat, and profiles.
  if (!isSignedToken && (!orbitId || row.owner_id !== orbitId) && row.is_public !== 1 && row.is_story !== 1 && row.is_avatar !== 1
      // Watch Party media: private object, readable by anyone holding the party
      // URL (it only travels inside the authenticated party WS room).
      && !isPartyMediaObject(`/api/objects/${id}`)) {
    const isMatchOrCard = await c.env.DB.prepare(`
      SELECT 1 FROM Cards WHERE media_object_id = ? AND moderation_state = 'active'
      UNION
      SELECT 1 FROM GameMatches WHERE (card_a = ? OR card_b = ?)
      UNION
      SELECT 1 FROM MatchCards WHERE id = ?
      UNION
      SELECT 1 FROM RoomDuelPairs WHERE (card_a = ? OR card_b = ?)
      UNION
      SELECT 1 FROM TierMatches WHERE (card_a = ? OR card_b = ? OR last_card_a = ? OR last_card_b = ?)
      LIMIT 1
    `).bind(id, id, id, id, id, id, id, id, id, id).first().catch(() => null)

    if (!isMatchOrCard) {
      // Avatars are public: an object referenced by some user's pfp_url is
      // renderable by anyone (the same exposure a data: avatar always had).
      const isAvatar = row.is_avatar === 1 || await c.env.DB.prepare(
        "SELECT 1 FROM Users WHERE (pfp_url = ? OR pfp_url LIKE '%/api/objects/' || ?) AND hidden_at IS NULL LIMIT 1",
      ).bind(`/api/objects/${id}`, id).first().catch(() => null)
      if (!isAvatar) {
        if (!orbitId) {
          return c.json({ error: 'Object not found' }, 404)
        }
        const recipient = await c.env.DB.prepare(
          'SELECT 1 FROM Recipients WHERE object_id = ? AND recipient_id = ? LIMIT 1'
        ).bind(id, orbitId).first()
        if (!recipient) {
          return c.json({ error: 'Object not found' }, 404)
        }
      }
    }
  }

  // Link-type objects return JSON
  if (row.mime_type === 'text/url') {
    return c.json({ type: 'link', id: row.id, url: row.content_url, created_at: row.created_at }, 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
    })
  }

  // Zero-media (register-only) rows: bytes live on the P2P swarm, never on the
  // server. Return a descriptor the client resolves from its local store /
  // swarm peers. NEVER fall through to BUCKET purge — there is no blob to
  // miss, and deleting the metadata row would destroy the only record.
  if (row.content_url && (row.content_url.startsWith('magnet:') || row.content_url.startsWith('urn:sha256:'))) {
    return c.json({
      type: 'p2p',
      id: row.id,
      content_url: row.content_url,
      content_hash: row.content_hash,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    }, 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
    })
  }

  // Encrypted-at-rest uploads store mime_type='application/octet-stream', so
  // blanket-defaulting to image/jpeg served a VIDEO as image/jpeg: the client
  // then rendered <img> over video bytes and the feed showed no preview. Keep
  // the row value when it is real, otherwise detect from the actual bytes.
  const rowMime = row.mime_type && row.mime_type !== 'application/octet-stream' ? row.mime_type : null
  const mimeType = rowMime || 'image/jpeg'

  // Decode base64 data URL if content_url is stored inline
  if (row.content_url && row.content_url.startsWith('data:')) {
    try {
      const commaIdx = row.content_url.indexOf(',')
      const base64Str = commaIdx >= 0 ? row.content_url.slice(commaIdx + 1) : row.content_url
      const bytes = Buffer.from(base64Str, 'base64')
      const headers = new Headers()
      headers.set('Content-Type', rowMime || detectMediaMime(bytes))
      headers.set('Content-Length', String(bytes.length))
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Cache-Control', 'no-store')
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Access-Control-Allow-Credentials', 'true')
      const inlineRange = /^bytes=(\d*)-(\d*)$/.exec((c.req.header('Range') || '').trim())
      if (inlineRange) {
        const total = bytes.length
        let start = inlineRange[1] ? parseInt(inlineRange[1], 10) : 0
        let end = inlineRange[2] ? parseInt(inlineRange[2], 10) : total - 1
        if (!Number.isFinite(start) || start >= total) start = 0
        end = Math.min(end, total - 1)
        if (start <= end) {
          const slice = bytes.subarray(start, end + 1)
          const rh = new Headers(headers)
          rh.set('Content-Length', String(slice.length))
          rh.set('Content-Range', `bytes ${start}-${end}/${total}`)
          return new Response(slice, { status: 206, headers: rh })
        }
      }
      return new Response(bytes, { headers })
    } catch (err) {
      console.error(`Failed to decode base64 data for object ${id}:`, err)
    }
  }

  // External URL — proxy through our infrastructure to avoid leaking
  // client IP and to support CORS. Legacy objects are proxied on-demand.
  if (row.content_url && (row.content_url.startsWith('http://') || row.content_url.startsWith('https://'))) {
    try {
      const proxyRes = await fetch(row.content_url, {
        method: 'GET',
        headers: {
          'User-Agent': 'OrbitImageProxy/1.0',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (!proxyRes.ok || !proxyRes.body) {
        return c.json({ error: 'Failed to proxy legacy image' }, 502)
      }
      const contentType = proxyRes.headers.get('content-type') || mimeType
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      headers.set('Cache-Control', 'no-store')
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Access-Control-Allow-Credentials', 'true')
      return new Response(proxyRes.body, { headers })
    } catch (err) {
      console.error(`Failed to proxy legacy image ${id}:`, err)
      return c.json({ error: 'Failed to proxy legacy image' }, 502)
    }
  }

  // Image objects from Vercel Blob / BUCKET
  if (!c.env.BUCKET) return c.json({ error: 'Storage not available' }, 503)

  let encryptedData: Uint8Array = new Uint8Array(0)
  try {
    const blob = await c.env.BUCKET.get(`objects/${id}`)
    if (!blob) {
      // Missing blob: delete dead content from DB so it stops throwing 404s
      await purgeDeadObject(c.env.DB, c.env.BUCKET, id)
      return c.json({ error: 'Object not found', purged: true }, 404)
    }

    const reader = blob.body?.getReader()
    if (!reader) {
      await purgeDeadObject(c.env.DB, c.env.BUCKET, id)
      return c.json({ error: 'Failed to read blob', purged: true }, 404)
    }

    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
    encryptedData = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      encryptedData.set(chunk, offset)
      offset += chunk.length
    }
  } catch (err) {
    console.error(`Failed to read blob for object ${id}:`, err)
    return c.json({ error: 'Failed to read object data' }, 500)
  }

  // When raw=true, return encrypted bytes as-is (for raw preview)
  if (raw) {
    const rawHeaders = new Headers()
    rawHeaders.set('Content-Type', 'image/jpeg')
    rawHeaders.set('Content-Length', String(encryptedData.length))
    rawHeaders.set('Access-Control-Allow-Origin', '*')
    rawHeaders.set('Access-Control-Allow-Credentials', 'true')
    return new Response(Buffer.from(encryptedData), { headers: rawHeaders })
  }

  // Decrypt blob at rest
  let plaintext: Uint8Array = new Uint8Array(0)
  try {
    plaintext = decryptBlob(encryptedData)
  } catch (err) {
    console.error(`Failed to decrypt blob for object ${id}:`, err)
    return c.json({ error: 'Failed to decrypt object data' }, 500)
  }

  const headers = new Headers()
  headers.set('Content-Type', rowMime || detectMediaMime(plaintext))
  headers.set('Content-Length', String(plaintext.length))
  headers.set('etag', `"${id}"`)
  // CORS headers for cross-origin image loading
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'no-store')

  // Range support: <video> seeking issues `Range: bytes=x-` / `x-y` and the
  // element refuses to stream from a server that always answers 200 with the
  // whole file. Blobs are encrypted at rest, so we decrypt fully then slice.
  // ponytail: per-request full decrypt; cache decrypted bytes if seeking
  // latency ever shows up.
  const rangeHeader = c.req.header('Range')
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (m) {
      const total = plaintext.length
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : total - 1
      if (!Number.isFinite(start) || start >= total) start = 0
      end = Math.min(end, total - 1)
      if (start <= end) {
        const slice = plaintext.subarray(start, end + 1)
        const rh = new Headers(headers)
        rh.set('Content-Length', String(slice.length))
        rh.set('Content-Range', `bytes ${start}-${end}/${total}`)
        return new Response(Buffer.from(slice), { status: 206, headers: rh })
      }
    }
  }

  return new Response(Buffer.from(plaintext), { headers })
})

objects.delete('/:id', orbitAuth, async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')

  const obj = await c.env.DB.prepare('SELECT owner_id, mime_type FROM Objects WHERE id = ?').bind(id).first<{ owner_id: string; mime_type: string }>()
  if (!obj) return c.json({ error: 'Not found' }, 404)
  if (obj.owner_id !== orbitId) return c.json({ error: 'Forbidden' }, 403)

  if (obj.mime_type !== 'text/url' && c.env.BUCKET) {
    try {
      await c.env.BUCKET.delete(`objects/${id}`)
    } catch (err) {
      console.error(`[objects] Failed to delete blob for object ${id}:`, err)
    }
  }

  await c.env.DB.prepare('DELETE FROM Favorites WHERE object_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM Recipients WHERE object_id = ?').bind(id).run()
  await purgeObjectLikes(c.env.DB, id!)
  await c.env.DB.prepare('DELETE FROM Objects WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// Toggle the author's own post archive state. Archived posts stay in the
// author's feed (client filters them) and drop out of everyone else's.
objects.post('/:id/archive', orbitAuth, async (c) => {
  const id = c.req.param('id')
  const orbitId = c.get('orbitId')
  const obj = await c.env.DB.prepare('SELECT owner_id FROM Objects WHERE id = ?').bind(id).first<{ owner_id: string }>()
  if (!obj) return c.json({ error: 'Not found' }, 404)
  if (obj.owner_id !== orbitId) return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare('UPDATE Objects SET is_archived = 1 - COALESCE(is_archived, 0) WHERE id = ?').bind(id).run()
  const row = await c.env.DB.prepare('SELECT is_archived FROM Objects WHERE id = ?').bind(id).first<{ is_archived: number }>()
  return c.json({ id, is_archived: Number(row?.is_archived || 0) })
})

export { objects }
