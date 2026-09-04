import type { ActiveCap, CapId, GalleryImage, OwnedTag, ViewMode } from './types'

export const SAVE_KEY = 'goongrid.save.v1'
export const SAVE_VERSION = 3
export const OFFLINE_RATE = 0.5
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000

export interface SaveData {
  version: number
  gc: number
  /** Whole g$ already flushed to the server ledger (plan D4). */
  credited: number
  /** Whole g$ already mirrored as spend on the server ledger (plan D4). */
  debited: number
  totalEarnedGc: number
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
  defeated: number
  backgroundUrl: string | null
  viewMode: ViewMode
  /** Player's feed starter picks + extra excludes (setup screen / config tab). */
  setupComplete: boolean
  userExcludes: string[]
  lastSeenAt: number
}

export function defaultSave(now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    gc: 0,
    credited: 0,
    debited: 0,
    totalEarnedGc: 0,
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
    defeated: 0,
    backgroundUrl: null,
    viewMode: 'single',
    setupComplete: false,
    userExcludes: [],
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
  const d = parsed as Partial<SaveData> & { gp?: unknown; totalEarnedGP?: unknown }
  if (d.version !== SAVE_VERSION) return null
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    version: SAVE_VERSION,
    // 1:1 GP→g$ rename (plan D4): old saves carry `gp`/`totalEarnedGP`.
    gc: num(d.gc, num(d.gp, 0)),
    credited: num(d.credited, 0),
    debited: num(d.debited, 0),
    totalEarnedGc: num(d.totalEarnedGc, num(d.totalEarnedGP, 0)),
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
    defeated: num(d.defeated, 0),
    backgroundUrl: typeof d.backgroundUrl === 'string' ? d.backgroundUrl : null,
    viewMode: d.viewMode === 'grid' ? 'grid' : 'single',
    setupComplete: d.setupComplete === true,
    userExcludes: arr<string>(d.userExcludes),
    lastSeenAt: num(d.lastSeenAt, 0),
  }
}

/**
 * Offline earnings = elapsed * g$/s * 50%, capped at 8h (SPEC §11).
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
