"use client";

import { useEffect, useState } from 'react'
import { DURABLE_REPLICATION_EVENT, durableCustodyHolders } from '../utils/p2pSwarm'

/**
 * Distinct devices proven to hold an object's bytes durably, INCLUDING this
 * node (see `custodyStatus` for what may be claimed). 0 when there is no id.
 *
 * The count lives in a plain in-memory map inside the swarm's receipt roles, so
 * it must be read — and re-read when a new attestation lands
 * (`DURABLE_REPLICATION_EVENT`, emitted by `onRecord`). Without that listener a
 * surface would freeze on its mount-time value and a peer's confirmation would
 * never appear.
 */
export function useDurableCustody(id?: string | null): number {
  const [holders, setHolders] = useState(() => (id ? durableCustodyHolders(id) : 0))

  useEffect(() => {
    if (!id) {
      setHolders(0)
      return
    }
    setHolders(durableCustodyHolders(id))
    const onChange = (event: Event) => {
      const changed = (event as CustomEvent<{ id?: string }>).detail?.id
      // A receipt for another object does not touch this one.
      if (changed && changed !== id) return
      setHolders(durableCustodyHolders(id))
    }
    window.addEventListener(DURABLE_REPLICATION_EVENT, onChange)
    return () => window.removeEventListener(DURABLE_REPLICATION_EVENT, onChange)
  }, [id])

  return holders
}
