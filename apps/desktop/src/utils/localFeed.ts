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
 * The outbox commits locally before any network call, but until now it was
 * write-only: a reload while an entry was still `local`/`pending` showed
 * nothing, even though the row was safe on disk. That is the "my post
 * disappeared" symptom. These rows are the render source for that window; the
 * server row wins the moment it lands (App dedupes by id).
 *
 * The id here MUST be the objectId — the id the server row carries. It used to
 * be a synthetic `group_<uuid>`, which never matched, so the same post rendered
 * as two rows the moment the node echoed it back: the duplicate that appeared on
 * every reload.
 */
export function localFeedPosts(
  identity: { orbitId: string } | null,
  displayName: string,
): FeedPost[] {
  if (!identity) return []
  const entries = listOutbox()
  const out: FeedPost[] = []

  // A multi-image post has one outbox entry PER IMAGE but ONE server row (the
  // earliest row of its group). Emit only the first entry of each group, and
  // carry the siblings as that row's media, so the rebuilt tile keeps its
  // carousel instead of degrading to a single image.
  const groupMembers = new Map<string, string[]>()
  for (const entry of entries) {
    if (!entry.postGroup) continue
    const id = String((entry.registerBody as Record<string, unknown>)?.id || entry.objectId)
    if (!id) continue
    const list = groupMembers.get(entry.postGroup)
    if (list) {
      if (!list.includes(id)) list.push(id)
    } else {
      groupMembers.set(entry.postGroup, [id])
    }
  }

  const emittedGroups = new Set<string>()
  for (const entry of entries) {
    const body = (entry.registerBody || {}) as Record<string, unknown>
    const objectId = String(body.id || entry.objectId)
    if (!objectId) continue
    if (entry.postGroup) {
      if (emittedGroups.has(entry.postGroup)) continue
      emittedGroups.add(entry.postGroup)
    }

    const mime = String(body.mime_type || '')
    const url = `/api/objects/${objectId}`
    const caption = String(body.post_caption || body.caption || '')
    const when = entry.createdAt || entry.updatedAt || Date.now()

    const siblingIds = entry.postGroup ? (groupMembers.get(entry.postGroup) ?? []) : []
    const media = [objectId, ...siblingIds.filter((id) => id !== objectId)].map((id) => ({
      id,
      url: `/api/objects/${id}`,
      mime_type: mime || 'application/octet-stream',
    }))

    out.push({
      id: objectId,
      author_id: identity.orbitId,
      author_name: displayName || 'You',
      url,
      mime_type: mime || undefined,
      media,
      caption,
      tags: tagsOf(body.tags),
      created_at: new Date(when).toISOString(),
      like_count: 0,
      comment_count: 0,
      sync_state: entry.state as OutboxState,
    })
  }
  return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}