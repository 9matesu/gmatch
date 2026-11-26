"use client";

import { useEffect, useState } from 'react'
import {
  PEER_NOTIFICATIONS_CHANGED_EVENT,
  readPeerNotificationReads,
} from '../utils/peerNotifications'

/**
 * The durable read set for the peer notification lane, scoped to the identity.
 *
 * The set is read from localStorage, so it must be re-read when the player marks
 * a peer row read (`PEER_NOTIFICATIONS_CHANGED_EVENT`) and when the identity
 * changes. A `Set` is returned by identity (never mutated in place), so the
 * notification centre's memo sees a new reference on every real change.
 */
export function usePeerNotificationReads(orbitId?: string | null): ReadonlySet<string> {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(
    () => readPeerNotificationReads(orbitId),
  )

  useEffect(() => {
    setReadIds(readPeerNotificationReads(orbitId))
    if (!orbitId) return
    const refresh = () => setReadIds(readPeerNotificationReads(orbitId))
    window.addEventListener(PEER_NOTIFICATIONS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PEER_NOTIFICATIONS_CHANGED_EVENT, refresh)
  }, [orbitId])

  return readIds
}
