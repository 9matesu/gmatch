"use client";

/**
 * Followers / following lists, merged local-first.
 *
 * A follow is a signed operation (SPEC §10e), so the operation log knows follows
 * and unfollows the node's `Followers` table never received: the node was
 * unreachable when the follow was made, or the unfollow stayed off-node and its
 * bookkeeping row lagged. The modal used to render the node's JSON verbatim, so
 * an off-node follow was invisible on the very profile that should show it and
 * a stale row could not be masked.
 *
 * Two pure rules, no React and no network:
 *  - `mergeFollowIds` keeps the node's order, and lets operations ADD what the
 *    node does not know and MASK what it still lists (a live follow beats a
 *    withdrawal — a re-follow creates a fresh add).
 *  - `mergeFollowRows` turns those ids into rows, borrowing the node row's own
 *    fields (score, matches, tags) and naming an operation-only id from the
 *    roster — never a truncated hash fragment.
 */

import { generateFallbackName } from '@orbit/shared'
import { isUsableName } from './displayName'

/** The ids an operation log contributes: what to add and what to mask. */
export interface FollowEdgeSets {
  added: ReadonlySet<string>
  removed: ReadonlySet<string>
}

/** A row as the node returns it (a `NetworkUser` from the API). */
export interface FollowListSourceRow {
  id: string
  display_name?: string | null
  pfp_url?: string | null
  online?: boolean
  matches_won?: number
  score?: number
  tags?: string[]
}

/** The live roster / identity list a name and avatar can be borrowed from. */
export interface FollowListRosterUser {
  id?: string
  orbitId?: string
  display_name?: string | null
  pfp_url?: string | null
  online?: boolean
  tags?: string[]
}

/** A row the modal renders: always named, always id-shaped. */
export interface FollowListRow {
  id: string
  display_name: string
  pfp_url: string | null
  online: boolean
  matches_won?: number
  score?: number
  tags?: string[]
}

/**
 * Merge the node's id list with the peer graph's edges.
 *
 * Order matters: mask what the operations withdrew FIRST, then union what they
 * added, so a live follow always outranks a stale removal. The node's own order
 * is preserved (it is the server's ranking) and operation-only ids append.
 */
export function mergeFollowIds(
  serverIds: readonly string[],
  edges: FollowEdgeSets,
): string[] {
  const merged = new Set(serverIds)
  for (const id of edges.removed) merged.delete(id)
  for (const id of edges.added) merged.add(id)
  return [...merged]
}

/**
 * Turn merged ids into renderable rows.
 *
 * A node row keeps everything the renderer already used (`matches_won`, `score`,
 * `tags`) and only has its identity fields normalised; an id that exists ONLY as
 * an operation gets a row borrowed from the roster, or the shared fallback name.
 */
export function mergeFollowRows(
  nodeRows: readonly FollowListSourceRow[],
  ids: readonly string[],
  roster: readonly FollowListRosterUser[] = [],
  profilePics: Readonly<Record<string, string>> = {},
): FollowListRow[] {
  const rowById = new Map<string, FollowListSourceRow>()
  for (const row of nodeRows) if (row?.id) rowById.set(row.id, row)

  const rosterById = new Map<string, FollowListRosterUser>()
  for (const user of roster) {
    const id = user.id || user.orbitId
    if (id) rosterById.set(id, user)
  }

  const out: FollowListRow[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = rowById.get(id)
    const known = rosterById.get(id)
    const resolved = [node?.display_name, known?.display_name].find(isUsableName)
    out.push({
      id,
      display_name: resolved ? resolved.trim() : generateFallbackName(id),
      pfp_url: node?.pfp_url || profilePics[id] || known?.pfp_url || null,
      online: Boolean(node?.online ?? known?.online ?? false),
      matches_won: node?.matches_won,
      score: node?.score,
      tags: node?.tags ?? known?.tags,
    })
  }
  return out
}