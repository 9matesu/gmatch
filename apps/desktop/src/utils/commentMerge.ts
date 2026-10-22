import type { PostComment } from '../components/feed/GMatchFeed'

/**
 * Node rows and peer-operation rows describe the same comment thread: a node
 * row comes from `/api/posts/:id/comments`, a peer row from a signed
 * `comment.create` operation in the local durable log.
 *
 * Merge by id — the node row wins (it carries the display name and the
 * avatar), the peer row fills in what the node never saw. Order is the node's
 * order first, then the peer rows; a peer comment never reorders a node one.
 */
export function mergeCommentRows(
  nodeRows: readonly PostComment[],
  peerRows: readonly PostComment[],
): PostComment[] {
  if (peerRows.length === 0) return [...nodeRows]
  const seen = new Set(nodeRows.map((row) => row.id))
  const extra = peerRows.filter((row) => !seen.has(row.id))
  if (extra.length === 0) return [...nodeRows]
  return [...nodeRows, ...extra]
}
