import type { ActiveCap, CapId, CustomSource, GalleryImage, OwnedTag, ViewMode } from './types'

export const SAVE_KEY = 'gmatch.save.v1'
export const SAVE_VERSION = 3
export const OFFLINE_RATE = 0.25
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
  /** Best heat-combo streak ever (achievement stat; 0 on legacy saves). */
  maxHeatStreak: number
  backgroundUrl: string | null
  viewMode: ViewMode
  /** Player's feed starter picks + extra excludes (setup screen / config tab). */
  setupComplete: boolean
  userExcludes: string[]
  /** Player-owned idle feed sources (custom URLs / local folders). */
  customSources: CustomSource[]
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
    maxHeatStreak: 0,
    backgroundUrl: null,
    viewMode: 'single',
    setupComplete: false,
    userExcludes: [],
    customSources: [],
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
    maxHeatStreak: num(d.maxHeatStreak, 0),
    backgroundUrl: typeof d.backgroundUrl === 'string' ? d.backgroundUrl : null,
    viewMode: (['single', 'grid', '1x1', '1x2', '2x2', '3x3'].includes(d.viewMode as string)
      ? d.viewMode
      : 'single') as ViewMode,
    setupComplete: d.setupComplete === true,
    userExcludes: arr<string>(d.userExcludes),
    customSources: sanitizeCustomSources((d as Partial<SaveData>).customSources),
    lastSeenAt: num(d.lastSeenAt, 0),
  }
}

/** Tolerant loader: keeps well-formed sources, drops anything else. */
function sanitizeCustomSources(v: unknown): CustomSource[] {
  if (!Array.isArray(v)) return []
  const out: CustomSource[] = []
  for (const s of v) {
    if (typeof s !== 'object' || s === null) continue
    const c = s as Partial<CustomSource>
    if (typeof c.id !== 'string' || !c.id) continue
    if (c.kind !== 'urls' && c.kind !== 'folder') continue
    out.push({
      id: c.id,
      label: typeof c.label === 'string' && c.label.trim() ? c.label.slice(0, 60) : 'Custom source',
      kind: c.kind,
      enabled: c.enabled !== false,
      urls: Array.isArray(c.urls) ? c.urls.filter((u): u is string => typeof u === 'string').slice(0, 500) : [],
      folderId: typeof c.folderId === 'string' ? c.folderId : null,
      folderPath: typeof c.folderPath === 'string' ? c.folderPath : null,
      addedAt: typeof c.addedAt === 'number' && Number.isFinite(c.addedAt) ? c.addedAt : 0,
    })
    if (out.length >= 20) break
  }
  return out
}

/**
 * Offline earnings = elapsed * g$/s * 25%, capped at 8h (SPEC §11).
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
