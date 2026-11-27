"use client";

import { OPERATION_LOG_CHANGED_EVENT, type SocialOperationLog } from './socialOperationLog'
import { broadcastPendingOperations } from './socialOpTransport'

/**
 * Commit-triggered operation broadcast (roadmap L4, the delivery half).
 *
 * The transport only ever waved on BOOT and on PEER_ONLINE, so an operation
 * appended while a peer was ALREADY online was never handed to the network: a
 * post made in front of your friend simply never reached them until one of the
 * two reconnected. The durable log already announces every write
 * (`OPERATION_LOG_CHANGED_EVENT`, also raised for another window's write), so
 * the missing piece was a listener that sends the new entry immediately.
 *
 * Two deliberate properties:
 * - **Coalesced.** A burst (a post, then its first like) schedules ONE wave
 *   after `delayMs`, not one wave per write.
 * - **Unsent only.** The wave selects `committed` entries, never `sending`
 *   ones: broadcasting advances an entry and writes, which announces another
 *   change, so a wider selection would re-send on its own announcement forever
 *   (see `listUnsentOperations`).
 *
 * Honest scope: this is "handed to the network", not "delivered". Delivery
 * still requires a peer's `SWARM_OP_ACK`, which advances the entry to
 * `delivered` through the existing ack path.
 */

export interface OperationBroadcastOptions {
  log: SocialOperationLog
  /** The transport: hands one signed operation to the swarm. */
  sendOperation: (operation: Record<string, unknown>) => void
  /** Event target carrying the log-change signal (window in the app). */
  target?: EventTarget | null
  /** Coalescing window for a burst of writes. */
  delayMs?: number
  /** Injectable timer, so a test never waits on wall-clock time. */
  schedule?: (run: () => void, delayMs: number) => () => void
}

/** One coalesced wave, delayed enough for a burst to collapse into it. */
export const BROADCAST_COALESCE_MS = 150

function defaultSchedule(run: () => void, delayMs: number): () => void {
  const handle = setTimeout(run, delayMs)
  return () => clearTimeout(handle)
}

/**
 * Subscribe to the log's change signal and broadcast newly appended
 * operations. Returns the teardown (a hook calls it on unmount).
 */
export function wireOperationBroadcast(options: OperationBroadcastOptions): () => void {
  const target = options.target === undefined
    ? (typeof window !== 'undefined' ? window : null)
    : options.target
  if (!target) return () => {}

  const delayMs = options.delayMs ?? BROADCAST_COALESCE_MS
  const schedule = options.schedule ?? defaultSchedule
  let cancelScheduled: (() => void) | null = null
  let disposed = false

  const flush = () => {
    cancelScheduled = null
    if (disposed) return
    // A rejection here is a transport hiccup, not a lost operation: the entry
    // stays `committed` and the next boot/peer-online wave retries it.
    void broadcastPendingOperations(
      options.log,
      options.sendOperation,
      { onlyUnsent: true },
    ).catch(() => {})
  }

  const onChange = () => {
    if (disposed || cancelScheduled) return
    cancelScheduled = schedule(flush, delayMs)
  }

  target.addEventListener(OPERATION_LOG_CHANGED_EVENT, onChange)

  return () => {
    disposed = true
    target.removeEventListener(OPERATION_LOG_CHANGED_EVENT, onChange)
    if (cancelScheduled) cancelScheduled()
    cancelScheduled = null
  }
}