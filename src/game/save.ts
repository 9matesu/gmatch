import type { ActiveCap, CapId, GalleryImage, OwnedTag } from './types'

export const SAVE_KEY = 'goongrid.save.v1'
export const SAVE_VERSION = 1
export const OFFLINE_RATE = 0.5
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000

export interface SaveData {
  version: number
  gp: number
  totalEarnedGP: number
  xp: number
  clickCount: number
  critCount: number
  shards: number
  prestigeCount: number
  tags: OwnedTag[]
  gallery: GalleryImage[]
  caps: ActiveCap[]
  capsUsed: CapId[]
  achievements: string[]
  collectedOfflineEarnings: boolean
  ageAccepted: boolean
  nsfwBlur: boolean
  lastSeenAt: number
}

export function defaultSave(now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    gp: 0,
    totalEarnedGP: 0,
    xp: 0,
    clickCount: 0,
    critCount: 0,
    shards: 0,
    prestigeCount: 0,
    tags: [],
    gallery: [],
    caps: [],
    capsUsed: [],
    achievements: [],
    collectedOfflineEarnings: false,
    ageAccepted: false,
    nsfwBlur: true,
    lastSeenAt: now,
  }
}

export function serialize(data: SaveData): string {
  return JSON.stringify({ ...data, version: SAVE_VERSION })
}

/** Returns null for missing/corrupt/wrong-version saves — caller falls back to defaults. */
export function deserialize(raw: string | null | undefined): SaveData | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const d = parsed as Partial<SaveData>
  if (d.version !== SAVE_VERSION) return null
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    version: SAVE_VERSION,
    gp: num(d.gp, 0),
    totalEarnedGP: num(d.totalEarnedGP, 0),
    xp: num(d.xp, 0),
    clickCount: num(d.clickCount, 0),
    critCount: num(d.critCount, 0),
    shards: num(d.shards, 0),
    prestigeCount: num(d.prestigeCount, 0),
    tags: arr<OwnedTag>(d.tags),
    gallery: arr<GalleryImage>(d.gallery),
    caps: arr<ActiveCap>(d.caps),
    capsUsed: arr<CapId>(d.capsUsed),
    achievements: arr<string>(d.achievements),
    collectedOfflineEarnings: d.collectedOfflineEarnings === true,
    ageAccepted: d.ageAccepted === true,
    nsfwBlur: d.nsfwBlur !== false,
    lastSeenAt: num(d.lastSeenAt, 0),
  }
}

/**
 * Offline earnings = elapsed * GP/s * 50%, capped at 8h (SPEC §11).
 * elapsedMs is clamped to [0, capMs].
 */
export function offlineEarnings(
  gps: number,
  elapsedMs: number,
  capMs = OFFLINE_CAP_MS,
  rate = OFFLINE_RATE,
): number {
  const capped = Math.min(Math.max(0, elapsedMs), capMs)
  return (capped / 1000) * Math.max(0, gps) * rate
}
