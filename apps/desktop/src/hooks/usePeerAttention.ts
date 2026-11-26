"use client";

import { projectPeerAttentionFor } from '../services/socialInteractionProjection'
import type { PeerAttentionEvent } from '../utils/notifications'
import { usePeerProjection } from './usePeerProjection'

/**
 * The peer notification lane: signed operations OTHER actors aimed at my
 * content or at me — a follow, a like, a comment, a reply, a report.
 *
 * A mesh has no admin and no central like/comment service: those events travel
 * as signed operations between the peers, so the only place they can be shown
 * is the author's own notification centre. This hook projects them from the
 * durable operation log (one `usePeerProjection` lifecycle for every peer
 * view) and re-reads on every log change and peer-online signal.
 */
export function usePeerAttention(selfId?: string | null): PeerAttentionEvent[] {
  return usePeerProjection<PeerAttentionEvent[]>(
    (entries) => (selfId ? projectPeerAttentionFor(entries, selfId) : []),
    selfId,
    [],
  )
}