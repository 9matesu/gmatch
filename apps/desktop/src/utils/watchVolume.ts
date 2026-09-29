/**
 * Per-room player volume, remembered locally.
 *
 * Volume is deliberately NOT room state: the server's PartyFrame has no volume
 * field, so it can never be synced, and the only thing the user sees is the
 * slider in WatchPartyTimeline — which was a mirror of the last *command*
 * rather than a read of the element. Any remount (every queue change rebuilt
 * the <video> with a new key, so position/volume/mute/buffer all reset) left
 * the slider showing one value while the element played at another.
 *
 * So: volume belongs to the viewer, is keyed by room, and is re-applied to the
 * element whenever it is (re)created. Never broadcast.
 */

const KEY = 'gmatch_watch_volumes_v1'

export interface RoomVolume {
  volume: number
  muted: boolean
}

function readAll(): Record<string, RoomVolume> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RoomVolume>) : {}
  } catch {
    return {}
  }
}

const clamp = (v: unknown, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** Remembered volume for a room, or the default when never set. */
export function getRoomVolume(roomId: string | null | undefined): RoomVolume {
  if (!roomId) return { volume: 1, muted: false }
  const hit = readAll()[roomId]
  if (!hit) return { volume: 1, muted: false }
  return { volume: clamp(hit.volume, 1), muted: Boolean(hit.muted) }
}

export function setRoomVolume(roomId: string | null | undefined, next: Partial<RoomVolume>): void {
  if (!roomId || typeof localStorage === 'undefined') return
  const all = readAll()
  const cur = getRoomVolume(roomId)
  all[roomId] = {
    volume: clamp(next.volume ?? cur.volume, cur.volume),
    muted: next.muted === undefined ? cur.muted : Boolean(next.muted),
  }
  try {
    // Cap the map so a long-lived install cannot grow this without bound.
    const ids = Object.keys(all)
    if (ids.length > 40) for (const id of ids.slice(0, ids.length - 40)) delete all[id]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* private mode / quota: volume simply will not persist */
  }
}

/** Read the element's live volume, tolerating the unready states. */
export function readElementVolume(el: HTMLVideoElement | null | undefined): RoomVolume | null {
  if (!el) return null
  return { volume: clamp(el.volume, 1), muted: Boolean(el.muted) }
}

/** Apply a remembered volume to an element. */
export function applyRoomVolume(el: HTMLVideoElement | null | undefined, v: RoomVolume): void {
  if (!el) return
  el.volume = v.volume
  el.muted = v.muted
}
