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

/** Per-provider feed search metrics (from electron/feedMetrics.cjs). */
export interface FeedProviderMetrics {
  attempts: number
  oks: number
  empties: number
  timeouts: number
  errors: number
  medianMs: number | null
}

/** Aggregate feed search metrics (from electron/feedMetrics.cjs). */
export interface FeedMetricsSummary {
  rounds: number
  totalLatencyMs: number | null
  firstResultMs: number | null
  resultCount: number | null
  cacheHitRate: number | null
  fallbacks: number
  providers: Record<string, FeedProviderMetrics>
}

/** One picture in the encrypted picture cache (the clicker's cache). */
export interface CachedPicture {
  /** The remote url the picture came from. */
  url: string
  /** The local (gmcache://) url that serves the bytes from disk. */
  local: string
  mime: string
  bytes: number
  /** When it was cached (ms). Newest first. */
  ts: number
}

/** The single source of truth for the preload bridge surface. */
export interface GmatchBridge {
  /** process.platform from the preload, for platform-specific copy only. */
  platform?: string
  booruFetch?: (req: BooruRequest) => Promise<BooruResponse>
  /** Read-only feed search metrics (observability). Never a UI surface. */
  booruTimings?: () => Promise<FeedMetricsSummary>
  /** mediaq setup suite (one-shot). The app is unchanged offline when mediaq is absent. */
  mediaqStatus?: () => Promise<{ installed: boolean; running: boolean; base: string; hasUv?: boolean; error?: string }>
  mediaqInstall?: () => Promise<{ ok: boolean; bin?: string; running?: boolean; error?: string; cancelled?: boolean }>
  mediaqCancel?: () => Promise<{ ok: boolean }>
  mediaqStart?: () => Promise<{ ok: boolean; base?: string; error?: string }>
  mediaqStop?: () => Promise<{ ok: boolean; running: boolean; stopped?: boolean; error?: string }>
  mediaqRestart?: () => Promise<{ ok: boolean; base?: string; error?: string }>
  onMediaqProgress?: (cb: (p: { phase: string; message: string; percent?: number }) => void) => () => void
  cacheImage?: (url: string) => Promise<{ local: string | null }>
  cacheStats?: () => Promise<{ files: number; bytes: number }>
  /** What the device holds, newest first: the clicker's picture cache. */
  cacheList?: () => Promise<{ items: CachedPicture[] }>
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
  serverState?: () => Promise<{ packaged: boolean; mode: 'host' | 'client'; url: string; worldId?: string; lanUrls: string[]; nodeOwnerId?: string | null; pausedUrl?: string; pausedReason?: 'legacy' | 'unreachable' }>
  radminStatus?: () => Promise<{ installed: boolean; ip: string | null }>
  radminJoin?: (name: string, password: string) => Promise<{ status: 'joined' | 'failed'; ip?: string; reason?: string }>
  /** Bind this install's first identity as owner; sticky across account switches. */
  claimAdminOwner?: (orbitId: string) => Promise<{ ok: boolean; orbitId?: string; error?: string } | null>
  winMinimize?: () => void
  winToggleMaximize?: () => void
  winClose?: () => void
  notifySync?: (payload: { count: number; title?: string; body?: string; hideContent?: boolean }) => void
  notifyRead?: () => void
  onNotifyOpened?: (cb: () => void) => () => void
  winReload?: () => void
  appVersion?: () => Promise<string>
  openExternal?: (url: string) => Promise<void>
  serverSet?: (payload: { mode: 'host' | 'client'; url?: string }) => Promise<{ ok: boolean; error?: string }>
  /** Persist the active world id (per-world client namespace). Best effort. */
  serverSetWorld?: (worldId: string) => Promise<{ ok: boolean; error?: string }>
  serverRelaunch?: () => Promise<void>
  /** Manual sidecar restart: stop the old child, free :8790, respawn and health-probe. */
  restartSidecar?: () => Promise<{ ok: boolean; error?: string }>
  serverProbe?: (url: string) => Promise<{ ok: boolean; status?: number; error?: string }>
  updateCheck?: () => Promise<GmatchUpdateStatus>
  updateState?: () => Promise<GmatchUpdateStatus>
  updateInstall?: () => Promise<{ ok: boolean; error?: string }>
  onUpdateStatus?: (cb: (status: GmatchUpdateStatus) => void) => () => void
  /** `reason` distinguishes a missing desktop bridge from a non-Windows host. */
  wallpaperSetData?: (
    buf: ArrayBuffer,
    mime: string,
  ) => Promise<{ ok: boolean; hadPrevious?: boolean; reason?: 'unsupported-platform' | 'no-data' | 'set-failed' | 'no-powershell' | 'restore-failed' | 'error' }>
  wallpaperRestore?: () => Promise<{ ok: boolean; reason?: string }>
  wallpaperCleanupFiles?: () => Promise<{ ok: boolean }>
  /** Cross-platform desktop wallpaper (Windows registry/TranscodedWallpaper,
   *  Linux gsettings/KDE). The source is a local path, file:// URI, or bytes.
   *  Unsupported desktops resolve to a reason instead of rejecting. */
  setWallpaper?: (source: string | { data: ArrayBuffer; mime?: string }) => Promise<{
    ok: boolean
    backend?: 'windows' | 'gnome' | 'kde'
    path?: string
    uri?: string
    reason?: 'unsupported-desktop' | 'invalid-source' | 'remote-source' | 'no-data' | 'invalid-size' | 'invalid-mime' | 'no-powershell' | 'no-tool' | 'timeout' | 'set-failed' | 'write-failed' | 'restore-failed' | 'error'
  }>
  grantCameraOnce?: () => Promise<{ ok: boolean }>
  /** Native OS toast (main-process Electron Notification). Best-effort: the
   *  in-app overlay always renders even when this is absent or fails. */
  nativeNotify?: (title: string, body: string) => Promise<{ ok: boolean; reason?: string }>
  /** Dedicated player window for popup_video (sandboxed, muted, auto-close).
   *  Resolves when the window closes (ok) or fails to open (!ok). */
  domVideoOpen?: (url: string, durationMs?: number) => Promise<{ ok: boolean; reason?: string }>
  blocklistGet?: () => Promise<{ current: BlocklistData; defaults: BlocklistData; isCustom?: boolean }>
  blocklistSet?: (data: BlocklistData | string) => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  /** Ban terms for good. Main merges them into the authoritative list and
   *  returns it, so the renderer never clobbers a newer list. */
  blocklistBan?: (terms: string[] | string) => Promise<{ ok: boolean; data?: BlocklistData; added?: string[]; error?: string }>
  blocklistReset?: () => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  /** Fire-and-forget renderer log line; main appends it to userData/main.log. */
  logError?: (scope: string, msg: string) => void
  /** Startup timeline milestone (main logs it with the boot phases). */
  bootMark?: (label: string) => void
  /** Opens the userData folder (main.log, saves) in the OS file manager. */
  openLogFolder?: () => Promise<string>
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
