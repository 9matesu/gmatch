import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import { encryptBlob, decryptBlob } from '../crypto'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import { isValidMediaMagicBytes, detectMediaMime } from './objects'
import { getCurrentRound, listGallery, startRound, addHostEntries, joinRound, advanceBabecock, inviteToRound, listMyInvites, declineInvite, type BabecockImageInput } from '../babecock'
import { broadcastToRoom } from '../ws-bus'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const babecock = new Hono<{ Bindings: Bindings, Variables: { orbitId: string, publicKeyHex: string } }>()

// Public entry content for <img> and <video> tags — MUST be before orbitAuth
babecock.get('/entries/:id/content', async (c) => {
  const id = c.req.param('id')
  if (!id) return c.json({ error: 'Entry not found' }, 404)
  if (!c.env.BUCKET) return c.json({ error: 'Storage not available' }, 503)

  let blob = await c.env.BUCKET.get(`babecock/${id}`)
  if (!blob) {
    blob = await c.env.BUCKET.get(`objects/${id}`)
  }
  if (!blob) {
    blob = await c.env.BUCKET.get(`lobby/${id}`)
  }
  if (!blob) return c.json({ error: 'Entry not found' }, 404)
  
  let rawBytes: Uint8Array
  const reader = blob.body?.getReader()
  if (reader) {
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const totalLength = chunks.reduce((acc, ch) => acc + ch.length, 0)
    rawBytes = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      rawBytes.set(chunk, offset)
      offset += chunk.length
    }
  } else {
    return c.json({ error: 'Entry empty' }, 404)
  }

  // Attempt decryption if encrypted
  let finalBytes: Uint8Array = rawBytes
  try {
    finalBytes = decryptBlob(rawBytes)
  } catch {
    finalBytes = rawBytes
  }

  const mime = detectMediaMime(finalBytes, undefined) || 'image/jpeg'
  return new Response(Buffer.from(finalBytes), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'Content-Length': String(finalBytes.length),
      'Access-Control-Allow-Origin': '*',
    },
  })
})

// Protected routes below
babecock.use('*', orbitAuth)

let lastBabecockAdvance = 0
const BABECOCK_ADVANCE_INTERVAL_MS = 2000

function advance(db: D1Turso) {
  const now = Date.now()
  if (now - lastBabecockAdvance >= BABECOCK_ADVANCE_INTERVAL_MS) {
    lastBabecockAdvance = now
    advanceBabecock(db, now).catch(() => {})
  }
}

/** Persist an uploaded image and return its public content URL + mime. */
async function storeImages(c: any): Promise<BabecockImageInput[]> {
  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch (err: any) {
    throw Object.assign(new Error('Failed to parse upload form data: ' + (err?.message || err)), { status: 400 })
  }
  const imageFiles = formData.getAll('image').filter((value): value is File => value instanceof File)

  // Check for URL field
  const linkUrl = (formData.get('url') as string | null)?.trim() || null
  if (imageFiles.length === 0 && linkUrl) {
    const { proxyAndStoreExternal } = await import('../proxy')
    const id = crypto.randomUUID()
    const proxied = await proxyAndStoreExternal(linkUrl, c.env.BUCKET, 'babecock', id)
    if (proxied) {
      return [{ contentUrl: proxied.storedUrl, mimeType: proxied.mimeType }]
    }
    throw Object.assign(new Error('Could not fetch that link — the image may be blocked, invalid, or too large'), { status: 400 })
  }

  if (imageFiles.length === 0) return []
  if (imageFiles.length > 100) throw Object.assign(new Error('You can upload at most 100 images'), { status: 400 })

  const stored: BabecockImageInput[] = []
  for (const imageFile of imageFiles) {
    const arrayBuffer = await imageFile.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    if (bytes.length === 0) throw Object.assign(new Error('Uploaded file is empty'), { status: 400 })
    if (bytes.length > 50 * 1024 * 1024) throw Object.assign(new Error('File exceeds 50MB limit'), { status: 400 })
    if (!isValidMediaMagicBytes(bytes)) throw Object.assign(new Error('Invalid media format (magic bytes check failed)'), { status: 400 })
    const mimeType = detectMediaMime(bytes, imageFile.type || imageFile.name)
    if (!mimeType.startsWith('image/')) throw Object.assign(new Error('Babecock accepts images only'), { status: 400 })
    if (c.env.BUCKET) {
      const id = crypto.randomUUID()
      const encryptedBytes = encryptBlob(bytes)
      await c.env.BUCKET.put(`babecock/${id}`, encryptedBytes, { httpMetadata: { contentType: mimeType } })
      stored.push({ contentUrl: `/api/babecock/entries/${id}/content`, mimeType })
    } else {
      stored.push({ contentUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`, mimeType })
    }
  }
  return stored
}

babecock.get('/current', async (c) => {
  advance(c.env.DB)
  const viewer = c.get('orbitId')
  const round = await getCurrentRound(c.env.DB, viewer)
  return c.json({ round })
})

babecock.get('/gallery', async (c) => {
  advance(c.env.DB)
  const rounds = await listGallery(c.env.DB)
  return c.json({ rounds })
})

babecock.post('/round/:id/reorder', async (c) => {
  const roundId = c.req.param('id')
  const hostId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({})) as { placements?: Array<{ entry_id?: string; grid_position?: number }>; grid_size?: number }
  const placements = Array.isArray(body.placements)
    ? body.placements.filter((placement): placement is { entry_id: string; grid_position: number } => typeof placement?.entry_id === 'string' && Number.isInteger(placement!.grid_position) && placement!.grid_position! >= 0)
    : []
  const round = await c.env.DB.prepare("SELECT host_id, status, grid_size FROM BabecockRounds WHERE id = ?").bind(roundId).first<{ host_id: string; status: string; grid_size: number }>()
  if (!round || round.host_id !== hostId) return c.json({ error: 'Only the host can arrange this round' }, 403)
  if (round.status !== 'open') return c.json({ error: 'Round is no longer editable' }, 409)
  const rows = await c.env.DB.prepare('SELECT id FROM BabecockEntries WHERE round_id = ?').bind(roundId).all<{ id: string }>()
  const current = new Set(rows.results.map((row) => row.id))
  if (placements.length !== current.size || placements.some(({ entry_id }) => !current.has(entry_id)) || new Set(placements.map(({ entry_id }) => entry_id)).size !== placements.length || new Set(placements.map(({ grid_position }) => grid_position)).size !== placements.length) {
    return c.json({ error: 'Placement must contain every round entry exactly once' }, 400)
  }
  const maxPosition = Math.max(...placements.map(({ grid_position }) => grid_position), 0)
  const requestedGrid = Number.isInteger(body.grid_size) && Number(body.grid_size) > 0 ? Number(body.grid_size) : Number(round.grid_size || 3)
  const gridSize = Math.max(3, requestedGrid, Math.ceil(Math.sqrt(maxPosition + 1)))
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE BabecockRounds SET grid_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(gridSize, roundId),
    ...placements.map(({ entry_id, grid_position }) => c.env.DB.prepare('UPDATE BabecockEntries SET grid_position = ? WHERE id = ? AND round_id = ?').bind(grid_position, entry_id, roundId)),
  ])
  broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
  return c.json({ ok: true, grid_size: gridSize, placements })
})

babecock.post('/start', async (c) => {
  const hostId = c.get('orbitId')
  try {
    const stored = await storeImages(c)
    if (stored.length === 0) return c.json({ error: 'Provide at least one image to start a Babecock round' }, 400)
    const round = await startRound(c.env.DB, hostId, stored)
    return c.json({ round }, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to start round' }, err?.status || 400)
  }
})

babecock.post('/round/:id/entries', async (c) => {
  try {
    const stored = await storeImages(c)
    if (stored.length === 0) return c.json({ error: 'Provide at least one image' }, 400)
    const round = await addHostEntries(c.env.DB, c.req.param('id'), c.get('orbitId'), stored)
    return c.json({ round }, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to add images' }, err?.status || 400)
  }
})

babecock.get('/invites', async (c) => {
  const viewerId = c.get('orbitId')
  const invites = await listMyInvites(c.env.DB, viewerId)
  return c.json({ invites })
})

babecock.post('/invites/:id/decline', async (c) => {
  const viewerId = c.get('orbitId')
  const inviteId = c.req.param('id')
  try {
    await declineInvite(c.env.DB, inviteId, viewerId)
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to decline invite' }, err?.status || 400)
  }
})

babecock.post('/:id/invite', async (c) => {
  const hostId = c.get('orbitId')
  const roundId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { invitee_id?: string }
  const inviteeId = body.invitee_id?.trim()
  if (!inviteeId) return c.json({ error: 'invitee_id is required' }, 400)
  try {
    const invite = await inviteToRound(c.env.DB, roundId, hostId, inviteeId)
    try {
      const { createNotification } = await import('../notifications')
      const { broadcastToUser } = await import('../ws-bus')
      const notif = await createNotification(
        c.env.DB,
        inviteeId,
        'babecock_invite',
        'Babecock invitation',
        `${invite.host_name || 'Someone'} invited you to join their Babecock round`,
        { invite_id: invite.id, round_id: roundId, host_id: hostId }
      )
      if (notif) broadcastToUser(inviteeId, { type: 'notification', action: 'new', notification: notif })
    } catch (err) {
      console.warn('[babecock] invite notification failed:', err)
    }
    return c.json({ invite }, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to send invite' }, err?.status || 400)
  }
})

babecock.post('/:id/join', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('orbitId')
  try {
    const stored = await storeImages(c)
    if (stored.length === 0) return c.json({ error: 'Provide an image to join' }, 400)
    if (stored.length > 1) return c.json({ error: 'Joiners can submit one image per round' }, 400)
    const round = await joinRound(c.env.DB, id, userId, stored[0].contentUrl, stored[0].mimeType)
    return c.json({ round })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to join round' }, err?.status || 400)
  }
})

export { lastBabecockAdvance }
