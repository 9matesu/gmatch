/**
 * Delete outcome: a post can be node-backed, local-only/P2P, or already gone.
 * Pure decision, exported so the 503/timeout rule is unit-tested without
 * rendering the app.
 *
 * Rule: a transport-level failure (503/408/425/429 — timeout / offline / busy
 * node) is NOT a reason to keep a "invalid" local post forever. There is no
 * server row to delete for a local/P2P post, so a failed transport means the
 * goal state (not on the node) already holds: apply the local tombstone.
 * A definitive refusal (4xx other than 404/408/425/429) from a node-backed post
 * is a real failure and must NOT be hidden.
 */
export type DeleteOutcome = 'deleted' | 'local' | 'failed'

export interface DeleteContext {
  /**
   * The post is served by this node (it appears in a node snapshot). A
   * transport failure then means "unknown", not "it was local": treating it as
   * removed made the tile vanish and reappear on the next refresh.
   */
  nodeBacked?: boolean
}

/** Map an HTTP status from DELETE /api/posts/:id to the honest outcome. */
export function deleteOutcomeForStatus(status: number, context: DeleteContext = {}): DeleteOutcome {
  if (status === 404) return 'deleted' // already gone: goal state holds
  if (status >= 200 && status < 300) return 'deleted'
  if (status === 503 || status === 408 || status === 425 || status === 429) {
    return context.nodeBacked ? 'failed' : 'local'
  }
  return 'failed'
}