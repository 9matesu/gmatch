export type Rarity = 'Common' | 'Copper' | 'Silver' | 'Gold' | 'Diamond'

export type CapId = 'blue' | 'filter' | 'hypno' | 'melt'

export interface OwnedTag {
  name: string
  level: number
  base: number
  income: number
  weight: number
  /**
   * Feed selection: selected pills drive the round-robin picture pool.
   * Undefined = legacy default (owned tags feed, market offers don't).
   * Income always counts owned levels — selection only steers pictures.
   */
  selected?: boolean
}

export interface GalleryImage {
  id: string
  url: string
  tags: string[]
  rarityBase: number
  clicks: number
  rarity: Rarity
  /** Phase 5 local-first: whether the keep's bytes are cached locally.
   *  'pending' while the fetch/store runs, 'local' only after the stored
   *  object is read back and verified, 'failed' when caching did not happen
   *  (the source url is kept for a retry). Absent on legacy keepsakes. */
  localStatus?: 'pending' | 'local' | 'failed'
  /** Content hash of the cached bytes (verification + swarm alias). */
  localHash?: string
  boughtAt?: number
  /** 'video' for mp4/webm posts (redgifs), so cells render <video>. */
  kind?: 'image' | 'video'
  /** Still preview for video items (redgifs poster). */
  preview?: string
}

export interface ActiveCap {
  capId: CapId
  expiresAt: number
}

export interface BooruPost {
  id: string
  url: string
  tags: string[]
  rating?: string
  /** Still/poster preview for video posts (redgifs poster). */
  preview?: string
  /** 'video' for mp4/webm/gif posts, else image. Inferred from URL when absent. */
  kind?: 'image' | 'video'
  /** True when reshown from no-repeat memory after pool exhaustion. */
  repeat?: boolean
}

/** Single/grid view for the feed stage (supports 1x1, 1x2, 2x2, 3x3). */
export type ViewMode = 'single' | 'grid' | '1x1' | '1x2' | '2x2' | '3x3'

/** Dynamic novelty drop earned upon defeating a foe (non-blocking). */
export interface KoDrop {
  id: string
  foeTitle: string
  suggestedTag?: string
  suggestedAntiTag?: string
  timestamp: number
}

/**
 * Player-owned idle-clicker image source. `urls` = pasted direct media
 * links (used as-is — only add sources you trust); `folder` = a
 * dialog-picked local directory served by the main process over
 * idle-file:// (grant id + display path persisted, never file content).
 */
export interface CustomSource {
  id: string
  label: string
  kind: 'urls' | 'folder'
  enabled: boolean
  urls: string[]
  folderId: string | null
  folderPath: string | null
  addedAt: number
}

/** One 3x3 grid square: its own foe with its own HP. */
export interface GridCell {
  post: BooruPost
  hp: number
  maxHp: number
  clicks: number
}
