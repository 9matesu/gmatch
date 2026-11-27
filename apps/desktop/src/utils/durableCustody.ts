/**
 * Peer-confirmed durable custody, as the product states it.
 *
 * The swarm already proves how many DISTINCT identities hold an object's bytes
 * durably: the seeding node mints a challenge when it serves, the receiving
 * node returns a SIGNED receipt only after it can read the bytes back from its
 * own persistent store, and every accepted receipt is bound to that challenge
 * (utils/p2pSwarm.ts, `durableCustodyHolders`). The count therefore includes
 * this node, which holds the bytes it serves.
 *
 * The roadmap named the missing half plainly: "UI surfacing of
 * peer-confirmed durable". A count of one is not replication — it is this
 * device alone — so the surface stays silent until a receipt proves at least
 * one OTHER device holds the bytes. Nothing here infers custody from a HAVE,
 * a download in flight, or a peer being online; only a verified receipt counts.
 */

/** A tiny product label, or null when there is nothing to claim. */
export interface CustodyStatus {
  /** Distinct verified custody identities, INCLUDING this node. */
  holders: number
  /** Short label, or null when this node is the only holder. */
  label: string | null
}

/**
 * Turn a custody count into what the UI may say. `holders` counts this node, so
 * the threshold is 2: one peer's signed receipt, on top of our own copy.
 */
export function custodyStatus(holders: number): CustodyStatus {
  const count = Number.isFinite(holders) && holders > 0 ? Math.floor(holders) : 0
  return {
    holders: count,
    label: count >= 2 ? `Stored on ${count} devices` : null,
  }
}
