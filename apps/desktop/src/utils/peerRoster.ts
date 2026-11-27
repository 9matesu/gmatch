import type { User } from '@orbit/shared'
import { areUsersStructurallyEqual } from './compare'
import { getActiveWorldId, namespaceStorageKey } from './serverWorlds'

/**
 * The peer roster — ONE owner for "who is online".
 *
 * Before this module the roster was a `Map` inside `useP2P` plus a
 * `updatePeersList` closure trapped INSIDE the WebSocket effect. That
 * trapped closure was the reason the tracker-mesh path could not write to the
 * roster: a mesh peer that completed the signed HELLO handshake had bytes
 * flowing over its DataChannel, but no way to become visible.
 *
 * There are FOUR discovery stacks and they all land here now:
 *
 *   1. the node roster      (`GET /api/users/online`, cross-node presence)
 *   2. the swarm PRESENCE frame (relay socket / local tab / direct mesh)
 *   3. the PROFILE frame     (a peer we already know, refreshed)
 *   4. the tracker mesh      (HELLO handshake → `onPeer`)
 *
 * One map, one merge rule, one change event. A peer is described the same
 * way whoever found it.
 */

/**
 * Peers absent from the server roster for longer than this are marked
 * offline. The roster ticks every 60s and swarm PRESENCE broadcasts every
 * 60s, so a genuinely-active peer always has a sighting inside this window;
 * anything older is a leaver, not a missed tick. Pure — unit-tested.
 */
export const STALE_PEER_MS = 90_000

/** A peer unseen for longer than this is a ghost and is dropped. */
export const PEER_GHOST_MS = 24 * 60 * 60 * 1000

/** Where the known-peer list is persisted between sessions. */
export const KNOWN_PEERS_KEY = 'orbit_p2p_known_peers'

/** The persisted key for the ACTIVE world (default world keeps the global key):
 *  a roster learned on one server must not haunt another. */
export function knownPeersStorageKey(): string {
  return namespaceStorageKey(KNOWN_PEERS_KEY, getActiveWorldId())
}

/** How many peers are persisted. Online first, then the rest. */
export const MAX_KNOWN_PEERS = 30

function seenMs(v?: string | null): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * ONE merge rule for every discovery stack.
 *
 * An EMPTY incoming field never erases what we already know: a roster row
 * with no display name must not blank a name we learned from a presence
 * beacon, and a swarm announce with no avatar must not drop the one the
 * server gave us. A field that carries a value always wins.
 */
export function mergePeerFields(known: User, incoming: Partial<User>): User {
  const merged: User = { ...known }
  for (const key of Object.keys(incoming) as (keyof User)[]) {
    const value = incoming[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    ;(merged as unknown as Record<string, unknown>)[key] = value
  }
  return merged
}

/**
 * Merge the server's online roster (GET /api/users/online — online peers
 * ONLY) into the client peer map:
 * - roster members are marked online with a fresh sighting (profile fields
 *   refreshed), whether previously known or not;
 * - known peers ABSENT from the roster decay to offline once their last
 *   sighting (swarm or roster) goes stale, so leavers stop haunting the UI.
 * Peers with no timestamp at all are left untouched (nothing to judge by).
 * Pure — unit-tested.
 */
export function mergeRoster(
  peerMap: Map<string, User>,
  roster: User[],
  selfId: string,
): boolean {
  let changed = false
  const now = Date.now()
  const seen = new Set<string>()
  for (const u of roster) {
    if (!u || !u.id || u.id === selfId) continue
    seen.add(u.id)
    const known = peerMap.get(u.id)
    const sighting = u.last_seen || new Date(now).toISOString()
    if (!known) {
      peerMap.set(u.id, { ...u, online: true, last_seen: sighting })
      changed = true
      continue
    }
    const merged: User = {
      ...known,
      display_name: u.display_name || known.display_name,
      pfp_url: u.pfp_url ?? known.pfp_url,
      score: u.score ?? known.score,
      tags: u.tags && u.tags.length > 0 ? u.tags : known.tags,
      // The keys are what a direct connect needs. A peer we knew from a
      // presence beacon can arrive here with its keys attached, and a peer
      // whose keys move must never keep the stale ones.
      publicKey: u.publicKey ?? known.publicKey,
      encryptionPubKey: u.encryptionPubKey ?? known.encryptionPubKey,
      online: true,
      last_seen: sighting,
    }
    if (JSON.stringify(merged) !== JSON.stringify(known)) {
      peerMap.set(u.id, merged)
      changed = true
    }
  }
  // Downgrade leavers: known-online but absent from the roster with a stale
  // sighting. last_seen is preserved so the UI can still show "x ago".
  for (const [id, p] of peerMap) {
    if (!p || id === selfId || seen.has(id)) continue
    if (!p.online) continue
    const last = seenMs(p.last_seen)
    if (last > 0 && now - last >= STALE_PEER_MS) {
      peerMap.set(id, { ...p, online: false })
      changed = true
    }
  }
  return changed
}

/**
 * The same 24h window the storage hydration uses: entries unseen for longer
 * are ghosts and are dropped (plan B1). Pure so it is unit-testable.
 */
export function pruneStalePeers(map: Map<string, User>, now = Date.now()): number {
  const cutoff = now - PEER_GHOST_MS
  let dropped = 0
  for (const [id, p] of map) {
    const t = p.last_seen ? new Date(p.last_seen).getTime() : 0
    // A peer with no timestamp at all cannot be aged; keep it (hydration
    // already drops timestamp-less ancient ghosts at boot).
    if (t > 0 && t < cutoff) {
      map.delete(id)
      dropped++
    }
  }
  return dropped
}

export interface PeerUpsertResult {
  /** The projected roster changed. */
  changed: boolean
  /** The peer was not online before and is now. */
  becameOnline: boolean
}

/**
 * The roster store. One map, one merge rule, one change event.
 *
 * `persistKey: null` disables persistence (tests, ephemeral sessions).
 */
export class PeerRoster {
  private readonly map = new Map<string, User>()
  private readonly listeners = new Set<(peers: User[]) => void>()
  private snapshot: User[] = []

  constructor(private readonly persistKey: string | null = knownPeersStorageKey()) {}

  /** Subscribe to roster changes. Fires immediately with the current list. */
  subscribe(cb: (peers: User[]) => void): () => void {
    this.listeners.add(cb)
    cb(this.snapshot)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** The current roster (stable identity until the next change). */
  list(): User[] {
    return this.snapshot
  }

  get(id: string): User | undefined {
    return this.map.get(id)
  }

  entries(): IterableIterator<[string, User]> {
    return this.map.entries()
  }

  /** The live map, read-only: for consumers that resolve a name by id. */
  asMap(): ReadonlyMap<string, User> {
    return this.map
  }

  /**
   * THE entry point: every discovery stack writes here — the node roster, a
   * swarm presence frame, a profile frame and a tracker-mesh HELLO all land
   * in the same map through the same merge rule.
   *
   * A call IS a sighting: the peer is here NOW. The incoming record's own
   * `online`/`last_seen` describe the record (a persisted row, a peer's
   * clock), not this sighting, so they are not inherited. `opts.seenAt` is
   * the one way to say "this sighting happened at".
   */
  upsert(incoming: User, opts: { online?: boolean; seenAt?: string } = {}): PeerUpsertResult {
    const id = incoming?.id
    if (!id) return { changed: false, becameOnline: false }
    const known = this.map.get(id)
    const online = opts.online ?? true
    const lastSeen = opts.seenAt ?? new Date().toISOString()
    const next: User = known ? mergePeerFields(known, incoming) : { ...incoming }
    next.id = id
    next.online = online
    next.last_seen = lastSeen
    const wasOnline = known?.online === true
    // The keys are part of the peer's identity: a change to them must show
    // up even though the display fields did not move.
    const keysChanged =
      !!known && (known.publicKey !== next.publicKey || known.encryptionPubKey !== next.encryptionPubKey)
    if (known && !keysChanged && areUsersStructurallyEqual([known], [next])) {
      return { changed: false, becameOnline: false }
    }
    this.map.set(id, next)
    // The key fields are NOT part of the structural compare, so a sighting
    // that only brings the keys would otherwise never reach storage.
    this.emit(keysChanged)
    return { changed: true, becameOnline: online && !wasOnline }
  }

  /**
   * Merge the node's online roster. Returns the peers that just came
   * ONLINE (the caller wakes failed media tiles for those).
   */
  mergeServerRoster(users: User[], selfId: string): User[] {
    const wasOnline = new Set<string>()
    for (const [id, p] of this.map) if (p.online) wasOnline.add(id)
    const changed = mergeRoster(this.map, users, selfId)
    const newlyOnline: User[] = []
    for (const u of users) {
      if (!u?.id || u.id === selfId) continue
      if (!wasOnline.has(u.id)) newlyOnline.push(u)
    }
    if (changed) this.emit(true)
    return newlyOnline
  }

  /** Mark one peer offline (its channel went away). */
  markOffline(id: string): boolean {
    const known = this.map.get(id)
    if (!known || known.online === false) return false
    this.map.set(id, { ...known, online: false })
    this.emit()
    return true
  }

  /**
   * Mark everyone unconfirmed-offline. Used on a world switch: the roster
   * belonged to the previous server, and the new world's roster re-confirms
   * who is actually there. Memory is preserved.
   */
  markAllOffline(): boolean {
    let changed = false
    for (const [id, p] of this.map) {
      if (!p.online) continue
      this.map.set(id, { ...p, online: false })
      changed = true
    }
    if (changed) this.emit()
    return changed
  }

  /**
   * Load persisted peers as OFFLINE — the roster / presence confirms them
   * fresh. Peers we already know are NOT overwritten: a world switch must
   * not replace a live online peer with its stale persisted copy.
   */
  hydrate(saved: unknown, now = Date.now()): number {
    if (!Array.isArray(saved)) return 0
    const cutoff = now - PEER_GHOST_MS
    let loaded = 0
    for (const p of saved as User[]) {
      if (!p || typeof p !== 'object' || !p.id) continue
      if (this.map.has(p.id)) continue
      const t = p.last_seen ? new Date(p.last_seen).getTime() : 0
      if (t > 0 && t < cutoff) continue
      this.map.set(p.id, { ...p, online: false })
      loaded++
    }
    if (loaded > 0) {
      this.snapshot = [...this.map.values()]
      for (const cb of this.listeners) cb(this.snapshot)
    }
    return loaded
  }

  /** Drop the ghosts (peers unseen for over 24h). */
  prune(now = Date.now()): number {
    const dropped = pruneStalePeers(this.map, now)
    if (dropped > 0) this.emit()
    return dropped
  }

  /**
   * Publish the roster.
   *
   * `forcePersist` writes the snapshot to storage even when the structural
   * compare says "nothing the UI cares about changed" — used when a field the
   * compare does not cover (the peer's keys) moved.
   */
  private emit(forcePersist = false): void {
    const next = [...this.map.values()]
    const changed = !areUsersStructurallyEqual(this.snapshot, next)
    this.snapshot = next
    if (changed || forcePersist) this.persist()
    for (const cb of this.listeners) cb(next)
  }

  private persist(): void {
    if (!this.persistKey) return
    try {
      // Online peers first: a late joiner must still be persisted, not pushed
      // out of the window by long-lived entries.
      const online = this.snapshot.filter((p) => p.online)
      const rest = this.snapshot.filter((p) => !p.online)
      localStorage.setItem(this.persistKey, JSON.stringify([...online, ...rest].slice(0, MAX_KNOWN_PEERS)))
    } catch {
      /* storage unavailable (tests / private mode) */
    }
  }
}
