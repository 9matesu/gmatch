import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import { BABECOCK_ROUND_SECONDS, BABECOCK_GALLERY_SECONDS, type BabecockRound, type BabecockEntry, type BabecockInvite, type BabecockInviteStatus } from '@orbit/shared'
import { broadcastToRoom } from './ws-bus'

export interface BabecockImageInput {
  contentUrl: string
  mimeType: string
}

/**
 * Babecock minigame core: one open round at a time where a host posts the OP
 * picture and others join with their own. Rounds run for up to BABECOCK_ROUND
 * _SECONDS, then close and surface in the gallery for BABECOCK_GALLERY_SECONDS.
 */

async function loadUsers(db: D1Turso, userIds: Set<string>): Promise<Map<string, { display_name: string | null; pfp_url: string | null }>> {
  const out = new Map<string, { display_name: string | null; pfp_url: string | null }>()
  if (userIds.size === 0) return out
  const placeholders = Array.from(userIds).map(() => '?').join(',')
  const rows = await db
    .prepare(`SELECT id, display_name, pfp_url FROM Users WHERE id IN (${placeholders})`)
    .bind(...Array.from(userIds))
    .all<{ id: string; display_name: string | null; pfp_url: string | null }>()
  for (const row of rows.results) {
    out.set(row.id, { display_name: row.display_name ?? null, pfp_url: row.pfp_url ?? null })
  }
  return out
}

async function loadEntries(db: D1Turso, roundId: string): Promise<BabecockEntry[]> {
  const rows = await db
    .prepare('SELECT id, round_id, user_id, content_url, mime_type, caption, created_at, grid_position FROM BabecockEntries WHERE round_id = ? ORDER BY COALESCE(grid_position, 2147483647) ASC, created_at ASC')
    .bind(roundId)
    .all<BabecockEntry & { created_at: string }>()
  return (rows.results || []).map((r) => ({
    id: r.id,
    round_id: r.round_id,
    user_id: r.user_id,
    content_url: r.content_url,
    mime_type: r.mime_type || 'image/jpeg',
    caption: r.caption ?? null,
    created_at: r.created_at,
    grid_position: r.grid_position ?? null,
  }))
}

export async function getCurrentRound(db: D1Turso, viewerId?: string): Promise<BabecockRound | null> {
  const row = await db
    .prepare("SELECT * FROM BabecockRounds WHERE status = 'open' ORDER BY created_at DESC LIMIT 1")
    .first<{ id: string; host_id: string; status: 'open'; phase_deadline: number; gallery_expires_at: string | null; created_at: string; grid_size: number }>()

  if (!row) return null
  const entries = await loadEntries(db, row.id)
  const userIds = new Set<string>([row.host_id, ...entries.map((e) => e.user_id)])
  const users = await loadUsers(db, userIds)

  let myEntry: string | null = null
  if (viewerId) {
    myEntry = entries.find((e) => e.user_id === viewerId)?.id || null
  }

  return {
    id: row.id,
    host_id: row.host_id,
    host_name: users.get(row.host_id)?.display_name ?? null,
    host_pfp_url: users.get(row.host_id)?.pfp_url ?? null,
    status: row.status,
    phase_deadline: Number(row.phase_deadline || 0),
    gallery_expires_at: row.gallery_expires_at ?? null,
    created_at: row.created_at,
    grid_size: Number(row.grid_size || 3),
    entries: entries.map((e) => ({
      ...e,
      display_name: users.get(e.user_id)?.display_name ?? null,
      pfp_url: users.get(e.user_id)?.pfp_url ?? null,
    })),
    my_entry: myEntry,
  }
}

/** Finished rounds still inside their 1-hour gallery window, newest first. */
export async function listGallery(db: D1Turso): Promise<BabecockRound[]> {
  const rows = await db
    .prepare("SELECT * FROM BabecockRounds WHERE status = 'closed' AND gallery_expires_at IS NOT NULL AND datetime(gallery_expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 20")
    .all<{ id: string; host_id: string; status: 'closed'; phase_deadline: number; gallery_expires_at: string | null; created_at: string; grid_size: number }>()

  const rounds: BabecockRound[] = []
  for (const row of rows.results) {
    const entries = await loadEntries(db, row.id)
    const userIds = new Set<string>([row.host_id, ...entries.map((e) => e.user_id)])
    const users = await loadUsers(db, userIds)
    rounds.push({
      id: row.id,
      host_id: row.host_id,
      host_name: users.get(row.host_id)?.display_name ?? null,
      host_pfp_url: users.get(row.host_id)?.pfp_url ?? null,
      status: row.status,
      phase_deadline: Number(row.phase_deadline || 0),
      gallery_expires_at: row.gallery_expires_at ?? null,
      created_at: row.created_at,
      grid_size: Number(row.grid_size || 3),
      entries: entries.map((e) => ({
        ...e,
        display_name: users.get(e.user_id)?.display_name ?? null,
        pfp_url: users.get(e.user_id)?.pfp_url ?? null,
      })),
      my_entry: null,
    })
  }
  return rounds
}

export async function startRound(
  db: D1Turso,
  hostId: string,
  image: BabecockImageInput | BabecockImageInput[] | string,
  legacyMimeType?: string,
): Promise<BabecockRound> {
  const existing = await db.prepare("SELECT id FROM BabecockRounds WHERE status = 'open' LIMIT 1").first<{ id: string }>()
  if (existing) {
    const err = new Error('A Babecock round is already running. Join it instead.')
    ;(err as any).status = 409
    throw err
  }

  const images: BabecockImageInput[] = typeof image === 'string'
    ? [{ contentUrl: image, mimeType: legacyMimeType || 'image/jpeg' }]
    : (Array.isArray(image) ? image : [image])
  if (images.length === 0) throw Object.assign(new Error('At least one image is required'), { status: 400 })
  const roundId = crypto.randomUUID()
  const deadline = Date.now() + BABECOCK_ROUND_SECONDS * 1000
  const gridSize = Math.max(3, Math.ceil(Math.sqrt(images.length)))
  await db.batch([
    db.prepare('INSERT INTO BabecockRounds (id, host_id, status, phase_deadline, grid_size) VALUES (?, ?, \'open\', ?, ?)').bind(roundId, hostId, deadline, gridSize),
    ...images.map((entry, index) => db.prepare('INSERT INTO BabecockEntries (id, round_id, user_id, content_url, mime_type, grid_position) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), roundId, hostId, entry.contentUrl, entry.mimeType, index)),
  ])

  broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
  return (await getCurrentRound(db, hostId)) as BabecockRound
}

export async function addHostEntries(
  db: D1Turso,
  roundId: string,
  hostId: string,
  images: BabecockImageInput[],
): Promise<BabecockRound> {
  if (images.length === 0) throw Object.assign(new Error('At least one image is required'), { status: 400 })
  const round = await db.prepare("SELECT id, host_id, phase_deadline FROM BabecockRounds WHERE id = ? AND status = 'open'").bind(roundId).first<{ id: string; host_id: string; phase_deadline: number }>()
  if (!round) throw Object.assign(new Error('This Babecock round is no longer open'), { status: 404 })
  if (round.host_id !== hostId) throw Object.assign(new Error('Only the round owner can add images'), { status: 403 })
  if (Date.now() > Number(round.phase_deadline || 0)) throw Object.assign(new Error('This Babecock round already finished'), { status: 409 })

  const existing = await db.prepare('SELECT COUNT(*) AS count FROM BabecockEntries WHERE round_id = ?').bind(roundId).first<{ count: number }>()
  const startPosition = Number(existing?.count || 0)
  const total = startPosition + images.length
  const gridSize = Math.max(3, Math.ceil(Math.sqrt(total)))
  await db.batch([
    db.prepare('UPDATE BabecockRounds SET grid_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(gridSize, roundId),
    ...images.map((entry, index) => db.prepare('INSERT INTO BabecockEntries (id, round_id, user_id, content_url, mime_type, grid_position) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), roundId, hostId, entry.contentUrl, entry.mimeType, startPosition + index)),
  ])
  broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
  return (await getCurrentRound(db, hostId)) as BabecockRound
}

export async function joinRound(db: D1Turso, roundId: string, userId: string, contentUrl: string, mimeType: string): Promise<BabecockRound> {
  const round = await db.prepare("SELECT id, phase_deadline FROM BabecockRounds WHERE id = ? AND status = 'open'").bind(roundId).first<{ id: string; phase_deadline: number }>()
  if (!round) {
    const err = new Error('This Babecock round is no longer open')
    ;(err as any).status = 404
    throw err
  }
  if (Date.now() > Number(round.phase_deadline || 0)) {
    const err = new Error('This Babecock round already finished')
    ;(err as any).status = 409
    throw err
  }
  if (round.id && (await db.prepare('SELECT 1 FROM BabecockEntries WHERE round_id = ? AND user_id = ?').bind(roundId, userId).first())) {
    const err = new Error('You already joined this round')
    ;(err as any).status = 409
    throw err
  }

  const entryId = crypto.randomUUID()
  const position = await db.prepare('SELECT COUNT(*) AS count FROM BabecockEntries WHERE round_id = ?').bind(roundId).first<{ count: number }>()
  await db.prepare('INSERT INTO BabecockEntries (id, round_id, user_id, content_url, mime_type, grid_position) VALUES (?, ?, ?, ?, ?, ?)').bind(entryId, roundId, userId, contentUrl, mimeType, Number(position?.count || 0)).run()

  // If this joiner had an open invite for the round, flip it to `accepted`
  // so the host sees who showed up.
  await markInviteAccepted(db, roundId, userId)

  broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
  return (await getCurrentRound(db, userId)) as BabecockRound
}

/**
 * Drive round lifecycle on the 1s match tick: close rounds past their
 * deadline and park them in the gallery for the 1-hour window.
 */
export async function advanceBabecock(db: D1Turso, now: number = Date.now()): Promise<void> {
  const open = await db
    .prepare("SELECT id FROM BabecockRounds WHERE status = 'open' AND phase_deadline <= ?")
    .bind(now)
    .all<{ id: string }>()
  if (open.results && open.results.length > 0) {
    const galleryExpires = new Date(now + BABECOCK_GALLERY_SECONDS * 1000).toISOString()
    for (const row of open.results) {
      await db.prepare("UPDATE BabecockRounds SET status = 'closed', gallery_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").bind(galleryExpires, row.id).run()
    }
    broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
    // Mark any open invites for these rounds as `expired` — the recipient
    // inbox should stop offering a one-click Join for a closed round.
    await expireInvitesForClosedRounds(db)
  }
}

/** Purge closed rounds whose gallery window lapsed, plus their entries. */
export async function purgeExpiredBabecock(db: D1Turso, bucket?: LocalBlobStore): Promise<void> {
  const expired = await db
    .prepare("SELECT id FROM BabecockRounds WHERE status = 'closed' AND gallery_expires_at IS NOT NULL AND datetime(gallery_expires_at) <= datetime('now')")
    .all<{ id: string }>()

  if (!expired.results || expired.results.length === 0) return

  for (const row of expired.results) {
    const entries = await db.prepare('SELECT id, content_url FROM BabecockEntries WHERE round_id = ?').bind(row.id).all<{ id: string; content_url: string }>()
    for (const entry of entries.results) {
      const match = entry.content_url?.match(/^\/api\/babecock\/entries\/([^/]+)\/content$/)
      if (match && bucket) {
        await bucket.delete(`babecock/${match[1]}`).catch(() => {})
      }
    }
    await db.prepare('DELETE FROM BabecockEntries WHERE round_id = ?').bind(row.id).run()
    await db.prepare('DELETE FROM BabecockRounds WHERE id = ?').bind(row.id).run()
    // Cascade-clear any lingering invite rows; their parent round is gone.
    await db.prepare('DELETE FROM BabecockInvites WHERE round_id = ?').bind(row.id).run()
  }
}

/**
 * Mark every still-open invite for rounds that have advanced/closed as
 * `expired`. Called from the advance tick alongside the round close so the
 * recipient UI sees "expired" instead of dangling "open" invites for rounds
 * that no longer exist.
 */
export async function expireInvitesForClosedRounds(db: D1Turso): Promise<void> {
  await db
    .prepare(
      `UPDATE BabecockInvites
         SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'open'
         AND round_id NOT IN (SELECT id FROM BabecockRounds WHERE status = 'open')`
    )
    .run()
}

/**
 * Host pings a specific user to draw their attention to the currently-open
 * Babecock round. Round is still globally joinable; the invite just surfaces a
 * one-click "Join" affordance to the recipient.
 */
export async function inviteToRound(
  db: D1Turso,
  roundId: string,
  hostId: string,
  inviteeId: string
): Promise<BabecockInvite> {
  if (inviteeId === hostId) {
    const err = new Error('You cannot invite yourself')
    ;(err as any).status = 400
    throw err
  }

  const round = await db
    .prepare("SELECT id, host_id FROM BabecockRounds WHERE id = ? AND status = 'open'")
    .bind(roundId)
    .first<{ id: string; host_id: string }>()
  if (!round) {
    const err = new Error('This Babecock round is no longer open')
    ;(err as any).status = 404
    throw err
  }
  if (round.host_id !== hostId) {
    const err = new Error('Only the round host can invite')
    ;(err as any).status = 403
    throw err
  }

  // Idempotent on (round_id, invitee_id): if an existing open/accepted invite
  // is on file, re-surface it rather than failing — host may have lost the
  // share link and clicked invite again. A declined invite can be revived.
  const existing = await db
    .prepare('SELECT id, status FROM BabecockInvites WHERE round_id = ? AND invitee_id = ?')
    .bind(roundId, inviteeId)
    .first<{ id: string; status: string }>()
  if (existing) {
    if (existing.status === 'accepted') {
      const err = new Error('That player already accepted')
      ;(err as any).status = 409
      throw err
    }
    if (existing.status === 'open') {
      // Re-use the existing open invite — refresh updated_at so the recipient
      // inbox re-bumps it to the top.
      await db.prepare('UPDATE BabecockInvites SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existing.id).run()
    } else {
      // declined/expired — re-open so the host can ping again.
      await db
        .prepare("UPDATE BabecockInvites SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(existing.id)
        .run()
    }
    return (await loadInvite(db, existing.id))!
  }

  const inviteId = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO BabecockInvites (id, round_id, host_id, invitee_id, status) VALUES (?, ?, ?, ?, \'open\')'
    )
    .bind(inviteId, roundId, hostId, inviteeId)
    .run()

  broadcastToRoom('lobby', { type: 'babecock', action: 'refresh' })
  return (await loadInvite(db, inviteId))!
}

async function loadInvite(db: D1Turso, inviteId: string): Promise<BabecockInvite | null> {
  const row = await db
    .prepare(
      `SELECT bi.id, bi.round_id, bi.host_id, bi.invitee_id, bi.status, bi.created_at,
              u.display_name AS host_name, u.pfp_url AS host_pfp_url
         FROM BabecockInvites bi
         JOIN Users u ON u.id = bi.host_id
        WHERE bi.id = ?`
    )
    .bind(inviteId)
    .first<{ id: string; round_id: string; host_id: string; invitee_id: string; status: string; created_at: string; host_name: string | null; host_pfp_url: string | null }>()
  if (!row) return null
  return {
    id: row.id,
    round_id: row.round_id,
    host_id: row.host_id,
    host_name: row.host_name,
    host_pfp_url: row.host_pfp_url,
    invitee_id: row.invitee_id,
    status: row.status as BabecockInviteStatus,
    created_at: row.created_at,
  }
}

/**
 * Pending/recent Babecock invites for the viewer (newest first). Recipient
 * inbox uses this to surface "X invited you to join" notifications with a
 * one-click join button.
 */
export async function listMyInvites(db: D1Turso, inviteeId: string): Promise<BabecockInvite[]> {
  const rows = await db
    .prepare(
      `SELECT bi.id, bi.round_id, bi.host_id, bi.invitee_id, bi.status, bi.created_at,
              u.display_name AS host_name, u.pfp_url AS host_pfp_url
         FROM BabecockInvites bi
         JOIN Users u ON u.id = bi.host_id
        WHERE bi.invitee_id = ?
          AND bi.status IN ('open', 'accepted')
        ORDER BY bi.created_at DESC LIMIT 50`
    )
    .bind(inviteeId)
    .all<{ id: string; round_id: string; host_id: string; invitee_id: string; status: string; created_at: string; host_name: string | null; host_pfp_url: string | null }>()
  return (rows.results || []).map((r) => ({
    id: r.id,
    round_id: r.round_id,
    host_id: r.host_id,
    host_name: r.host_name,
    host_pfp_url: r.host_pfp_url,
    invitee_id: r.invitee_id,
    status: r.status as BabecockInviteStatus,
    created_at: r.created_at,
  }))
}

/** Recipient explicitly dismisses an open invite. */
export async function declineInvite(
  db: D1Turso,
  inviteId: string,
  inviteeId: string
): Promise<void> {
  const invite = await db
    .prepare('SELECT id, invitee_id, status FROM BabecockInvites WHERE id = ?')
    .bind(inviteId)
    .first<{ id: string; invitee_id: string; status: string }>()
  if (!invite) {
    const err = new Error('Invite not found')
    ;(err as any).status = 404
    throw err
  }
  if (invite.invitee_id !== inviteeId) {
    const err = new Error('Not your invite')
    ;(err as any).status = 403
    throw err
  }
  if (invite.status !== 'open') return
  await db
    .prepare("UPDATE BabecockInvites SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(inviteId)
    .run()
}

/**
 * Internal hook from `joinRound`: when an invited user joins the round, flip
 * their pending invite (if any) to `accepted` so the host sees who showed up.
 */
async function markInviteAccepted(db: D1Turso, roundId: string, inviteeId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE BabecockInvites
          SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
        WHERE round_id = ? AND invitee_id = ? AND status = 'open'`
    )
    .bind(roundId, inviteeId)
    .run()
}
