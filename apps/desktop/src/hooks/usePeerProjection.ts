"use client";

import { useEffect, useState } from 'react'
import {
  OPERATION_LOG_CHANGED_EVENT,
  sharedSocialOperationLog,
  type LoggedOperation,
} from '../services/socialOperationLog'
import { PEER_ONLINE_EVENT } from '../utils/p2pSwarm'
import { PEER_SAVES_CHANGED_EVENT } from '../utils/peerSaves'

/**
 * The read side of the peer operation log: re-read the whole log whenever it
 * changes OR a peer comes online, and keep the result in state.
 *
 * usePeerFeedPosts, usePeerCommentsByPost and usePeerReports each carried their
 * own copy of this lifecycle (alive flag, two listeners, matching cleanup) —
 * identical apart from the projection call. One hook keeps the freshness rule
 * (and the cancellation) in a single place; a new peer projection reuses it.
 *
 * `read` receives the full operation log and returns the projected view. The
 * result is only applied while the effect is alive, so a late IndexedDB reply
 * can never overwrite a newer one or a stale selfId.
 */
export function usePeerProjection<T>(
  read: (entries: readonly LoggedOperation[]) => T,
  selfId: string | null | undefined,
  /**
   * The value held while there is no identity. Required on purpose: it used to
   * default to `undefined as T`, which type-checks for ANY T while lying about
   * the type — a caller that forgot it would get `undefined` back and only find
   * out at runtime. Making it a required argument turns that omission into a
   * compile error.
   */
  empty: T,
): T {
  const [value, setValue] = useState<T>(empty)

  useEffect(() => {
    // No identity means no peer data at all: skip the log read entirely and
    // hold the empty value instead of flashing a projection built for nobody.
    if (!selfId) {
      setValue(empty)
      return
    }
    let alive = true
    const refresh = () => {
      void sharedSocialOperationLog()
        .listAllOperations()
        .then((entries) => {
          if (alive) setValue(read(entries))
        })
        .catch(() => { /* IndexedDB unavailable: no peer rows */ })
    }
    refresh()
    window.addEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
    window.addEventListener(PEER_ONLINE_EVENT, refresh)
    // A local bookmark is part of the projection (a peer row's `is_saved`), so
    // saving must refresh it without a reload.
    window.addEventListener(PEER_SAVES_CHANGED_EVENT, refresh)
    return () => {
      alive = false
      window.removeEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
      window.removeEventListener(PEER_ONLINE_EVENT, refresh)
      window.removeEventListener(PEER_SAVES_CHANGED_EVENT, refresh)
    }
    // `read` is pure and derived from the projection args; the identity is the
    // only thing that changes the answer, so it is the only dependency.
  }, [selfId])

  return value
}