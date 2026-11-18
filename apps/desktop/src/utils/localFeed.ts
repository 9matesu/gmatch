import { listOutbox, type OutboxState } from '../services/postOutbox'
import type { FeedPost } from '../components/feed/GMatchFeed'

function tagsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  if (typeof raw === 'string') return raw.split(/[,\s]+/).filter(Boolean)
  return []
}

/**
 * My posts that the node has not echoed back yet, rebuilt from the DURABLE
 * outbox.
 *
 * The outbox already commits locally before any network call, but until now it
 * was write-only: a reload while an entry was still `local`/`pending` showed
 * nothing, even though the row was safe on disk. That is the "my post
 * disappeared" symptom. These rows are the render source for that window; the
 * server row wins the moment it lands (App dedupes by id).
 */
export function localFeedPosts(
  identity: { orbitId: string } | null,
  displayName: string,
): FeedPost[] {
  if (!identity) return []
  const out: FeedPost[] = []
  for (const entry of listOutbox()) {
    const body = entry.registerBody || {}
    const objectId = String((body as Record<string, unknown>).id || entry.objectId)
    if (!objectId) continue
    const url = `/api/objects/${objectId}`
    const mime = String((body as Record<string, unknown>).mime_type || '')
    const caption = String(
      (body as Record<string, unknown>).post_caption || (body as Record<string, unknown>).caption || '',
    )
    const when = entry.createdAt || entry.updatedAt || Date.now()
    out.push({
      id: String(entry.postGroup || objectId),
      author_id: identity.orbitId,
      author_name: displayName || 'You',
      url,
      mime_type: mime || undefined,
      media: [{ id: objectId, url, mime_type: mime || 'application/octet-stream' }],
      caption,
      tags: tagsOf((body as Record<string, unknown>).tags),
      created_at: new Date(when).toISOString(),
      like_count: 0,
      comment_count: 0,
      sync_state: entry.state as OutboxState,
    })
  }
  return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}