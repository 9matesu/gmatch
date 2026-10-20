import type { BooruRequest, BooruResponse } from '../services/booru'

/** Phases of the portable self-update state machine (main pushes update:status). */
export interface GmatchUpdateStatus {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'
  current?: string
  latest?: string
  version?: string
  percent?: number
  bytes?: number
  verified?: boolean | null
  error?: string
  manual?: boolean
}

/** The single source of truth for the preload bridge surface. */
export interface GmatchBridge {
  booruFetch?: (req: BooruRequest) => Promise<BooruResponse>
  cacheImage?: (url: string) => Promise<{ local: string | null }>
  cacheStats?: () => Promise<{ files: number; bytes: number }>
  clearCache?: () => Promise<{ files: number; bytes: number }>
  /** Drops memoized feed lists after tag-intent changes (bytes untouched). */
  clearFeedCache?: () => Promise<{ cleared: number }>
  evictImage?: (url: string) => Promise<{ ok: boolean }>
  /** Lookup only. `state` distinguishes a real miss from bytes that are on
   *  disk but could not be read or decrypted (`reason` says why). */
  vaultGet?: (url: string) => Promise<{
    local?: string | null
    state?: 'local' | 'absent' | 'unreadable'
    reason?: string
    /** Stored mime for the row (extensionless rows rely on this to pick the
     *  Range-capable stream instead of a raw vault:// URL). */
    mime?: string
  }>
  vaultPin?: (url: string) => Promise<{ local: string | null }>
  vaultUnpin?: (url: string) => Promise<{ ok: boolean }>
  vaultRemove?: (url: string) => Promise<{ ok: boolean }>
  vaultStats?: () => Promise<{ files: number; bytes: number; quota: number; dir: boolean }>
  vaultClear?: () => Promise<{ files: number; bytes: number; quota: number; dir: boolean }>
  /** localhost http URL for a stored vault:// URL (browser-openable), else null. */
  vaultHttpUrl?: (url: string) => Promise<{ local: string | null }>
  /** Streaming vault pin (large video): no per-file cap, quota-enforced. */
  vaultPinStream?: (url: string) => Promise<{
    ok: boolean; key?: string; mime?: string; bytes?: number; hash?: string; reason?: string;
  }>
  /** Write bytes the renderer already holds to the encrypted vault; the main
   *  process re-verifies the sha256 before filing them under `hash`. `alias`
   *  is an optional store key (source url / object id). Returns the ref. */
  vaultPutBytes?: (
    hash: string,
    mime: string,
    data: ArrayBuffer,
    alias?: string | null,
  ) => Promise<{ ok: boolean; ref?: string; file?: string; bytes?: number; reason?: string } | null>
  /** Distinct stored objects ({ ref, mime, bytes }) for swarm rehydration. */
  vaultList?: () => Promise<Array<{ ref: string; mime: string; bytes: number }>>
  onVaultPinProgress?: (cb: (p: { url: string; bytes: number; total: number }) => void) => () => void
  customPickFolder?: () => Promise<{ ok: boolean; id?: string; path?: string; error?: string }>
  customListFolder?: (id: string) => Promise<{ ok: boolean; files?: { name: string; url: string }[]; error?: string }>
  customRemoveFolder?: (id: string) => Promise<{ ok: boolean }>
  secureAvailable?: () => Promise<boolean>
  secureGet?: (key: string) => Promise<string | null>
  secureSet?: (key: string, value: string) => Promise<void>
  secureDelete?: (key: string) => Promise<void>
  serverState?: () => Promise<{ packaged: boolean; mode: 'host' | 'client'; url: string; lanUrls: string[]; adminPin?: string }>
  winMinimize?: () => void
  winToggleMaximize?: () => void
  winClose?: () => void
  winReload?: () => void
  appVersion?: () => Promise<string>
  openExternal?: (url: string) => Promise<void>
  serverSet?: (payload: { mode: 'host' | 'client'; url?: string }) => Promise<{ ok: boolean; error?: string }>
  serverRelaunch?: () => Promise<void>
  serverProbe?: (url: string) => Promise<{ ok: boolean; status?: number; error?: string }>
  updateCheck?: () => Promise<GmatchUpdateStatus>
  updateState?: () => Promise<GmatchUpdateStatus>
  updateInstall?: () => Promise<{ ok: boolean; error?: string }>
  onUpdateStatus?: (cb: (status: GmatchUpdateStatus) => void) => () => void
  /** `reason` distinguishes a missing desktop bridge from a non-Windows host. */
  wallpaperSetData?: (
    buf: ArrayBuffer,
    mime: string,
  ) => Promise<{ ok: boolean; hadPrevious?: boolean; reason?: 'unsupported-platform' | 'no-data' | 'set-failed' | 'error' }>
  wallpaperRestore?: () => Promise<{ ok: boolean; reason?: string }>
  wallpaperCleanupFiles?: () => Promise<{ ok: boolean }>
  grantCameraOnce?: () => Promise<{ ok: boolean }>
  blocklistGet?: () => Promise<{ current: BlocklistData; defaults: BlocklistData; isCustom?: boolean }>
  blocklistSet?: (data: BlocklistData | string) => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  blocklistReset?: () => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  /** Fire-and-forget renderer log line; main appends it to userData/main.log. */
  logError?: (scope: string, msg: string) => void
  /** Startup timeline milestone (main logs it with the boot phases). */
  bootMark?: (label: string) => void
  /** Opens the userData folder (main.log, saves) in the OS file manager. */
  openLogFolder?: () => Promise<string>
  // P2P mesh (Slice 3): sealed Envelope-v2 objects only. `transport` is the
  // observed multiaddr — direct (/tcp/, /webrtc-direct/) vs relayed
  // (/p2p-circuit/); the UI must label relayed links as relayed.
  p2pStatus?: () => Promise<P2pStatus>
  p2pPeers?: () => Promise<P2pPeer[]>
  p2pSend?: (payload: { peer: string; binding: unknown; envelope: unknown }) => Promise<{ ok: boolean; error?: string }>
  onP2pMessage?: (cb: (frame: P2pFrame) => void) => () => void
}

export interface P2pStatus {
  started: boolean
  peerId?: string
  addrs?: string[]
  peers?: P2pPeer[]
  error?: string
}

export interface P2pPeer {
  id: string
  addr: string | null
  relayed: boolean
}

export interface P2pFrame {
  binding: { orbitId: string; orbitPubkeyHex: string; peerId: string; sigHex: string }
  envelope: { v: 2; kind: string; to: string; id: string; sealed: string }
  peerId: string
  transport: string
}

export interface BlocklistData {
  _comment_hard?: string
  blocklist: string[]
  _comment_suggested?: string
  suggested: string[]
  _comment_noise?: string
  noise: string[]
  [key: string]: any
}

declare global {
  interface Window {
    gmatch?: GmatchBridge
  }
}
export {}
