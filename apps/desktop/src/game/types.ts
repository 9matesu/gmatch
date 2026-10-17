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
  /** sha256 dos bytes locais. E' ao mesmo tempo a identidade e a referencia
   *  do keep: vault://f/<localRef>, object_id do enxame, chave de lookup no
   *  vault. Um keep "saved" APONTA para bytes no disco; nunca ha um
   *  segundo campo a dizer a mesma coisa. Ausente = so temos o URL remoto. */
  localRef?: string
  /** Estado de escrita do keep. 'downloading' enquanto a captura de bytes
   *  corre, 'persisted' so depois do fetch+store+read-back+hash verificado,
   *  'failed' quando a captura nao aconteceu (o source url e' mantido para
   *  retry). Ausente em keeps de legado (nao verificados). */
  saveState?: 'downloading' | 'persisted' | 'failed'
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
