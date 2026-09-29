import { create } from 'zustand'
import { parseSeenMs } from '../utils/presence'

/**
 * THE presence store. One record per user, one derivation of "online", one
 * poll — for the whole app.
 *
 * Why this exists: presence used to be re-derived independently at every call
 * site. The chat list read a 30s dashboard snapshot, the profile modal read
 * whatever record the caller happened to hand it, the arena roster read a
 * directory row plus a queueStatus flag. Each site then had to grow its own
 * defensive merge, and the fix for "Online in the list, Offline in the profile"
 * was the same one-line rule re-implemented (and re-explained) five times.
 * Divergent inputs mean divergent answers, so the symptom kept coming back.
 *
 * With one store, every consumer asks the same question of the same record, so
 * they cannot disagree.
 *
 * SEMANTICS — snapshots are authoritative in ARRIVAL order, not timestamp
 * order. See the "later snapshot reporting a departure" test: keeping the
 * newest timestamp forever would pin a player online for the rest of the 60s
 * window, because the first sighting is newer than the departure the server
 * just reported. Presence still decays (isUserOnline's 60s rule); it just
 * decays from the most recent thing the server told us.
 */
export interface PresenceRecord {
  lastSeenMs: number
  /** Server's own opinion. Never authoritative on its own — see isOnline. */
  online: boolean
  displayName?: string
  pfpUrl?: string
}

export interface PresenceSubjectLike {
  id?: string
  last_seen?: string | null
  online?: boolean
  display_name?: string
  pfp_url?: string
}

export interface PresenceCounts {
  online: number
  active: number
}

interface PresenceState {
  records: Map<string, PresenceRecord>
  counts: PresenceCounts | null
  countsAt: number
  selfId: string | null
  setSelfId: (id: string | null) => void
  ingest: (users: readonly PresenceSubjectLike[], counts?: PresenceCounts | null) => void
  record: (id: string) => PresenceRecord | undefined
  isOnline: (id: string, referenceNow?: number) => boolean
}

/** Kept in sync with utils/presence.isUserOnline — the canonical 60s rule. */
const SEEN_FRESH_MS = 60_000

function onlineFromRecord(rec: PresenceRecord, now: number): boolean {
  if (rec.lastSeenMs <= 0) return rec.online
  const delta = now - rec.lastSeenMs
  return delta >= -15_000 && delta < SEEN_FRESH_MS
}

export const usePresence = create<PresenceState>((set, get) => ({
  records: new Map(),
  counts: null,
  countsAt: 0,
  selfId: null,

  setSelfId: (id) => set({ selfId: id }),

  ingest: (users, counts) =>
    set((state) => {
      const next = new Map(state.records)
      for (const u of users) {
        if (!u?.id) continue
        next.set(u.id, {
          lastSeenMs: parseSeenMs(u.last_seen),
          online: Boolean(u.online),
          displayName: u.display_name || undefined,
          pfpUrl: u.pfp_url || undefined,
        })
      }
      return {
        records: next,
        counts: counts === undefined ? state.counts : counts,
        countsAt: counts === undefined || counts === null ? 0 : Date.now(),
      }
    }),

  record: (id) => get().records.get(id),

  isOnline: (id, referenceNow = Date.now()) => {
    const s = get()
    if (s.selfId && id === s.selfId) return true
    const rec = s.records.get(id)
    return rec ? onlineFromRecord(rec, referenceNow) : false
  },
}))

/** Imperative ingest for non-React callers. */
export function ingestSnapshot(
  users: readonly PresenceSubjectLike[],
  counts?: PresenceCounts | null,
): void {
  usePresence.getState().ingest(users, counts)
}

export function __resetPresenceForTests(): void {
  usePresence.setState({
    records: new Map(),
    counts: null,
    countsAt: 0,
    selfId: null,
  })
}
