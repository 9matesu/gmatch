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

/** Map an HTTP status from DELETE /api/posts/:id to the honest outcome. */
export function deleteOutcomeForStatus(status: number): DeleteOutcome {
  if (status === 404) return 'deleted' // already gone: goal state holds
  if (status === 503 || status === 408 || status === 425 || status === 429) return 'local'
  if (status >= 200 && status < 300) return 'deleted'
  return 'failed'
}