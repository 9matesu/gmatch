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
  evictImage?: (url: string) => Promise<{ ok: boolean }>
  vaultGet?: (url: string) => Promise<{ local: string | null }>
  vaultPin?: (url: string) => Promise<{ local: string | null }>
  vaultUnpin?: (url: string) => Promise<{ ok: boolean }>
  vaultRemove?: (url: string) => Promise<{ ok: boolean }>
  vaultStats?: () => Promise<{ files: number; bytes: number; quota: number; dir: boolean }>
  vaultClear?: () => Promise<{ files: number; bytes: number; quota: number; dir: boolean }>
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
  updateCheck?: () => Promise<GmatchUpdateStatus>
  updateState?: () => Promise<GmatchUpdateStatus>
  updateInstall?: () => Promise<{ ok: boolean; error?: string }>
  onUpdateStatus?: (cb: (status: GmatchUpdateStatus) => void) => () => void
  wallpaperSetData?: (buf: ArrayBuffer, mime: string) => Promise<{ ok: boolean; hadPrevious?: boolean }>
  wallpaperRestore?: () => Promise<{ ok: boolean }>
  wallpaperCleanupFiles?: () => Promise<{ ok: boolean }>
  grantCameraOnce?: () => Promise<{ ok: boolean }>
  blocklistGet?: () => Promise<{ current: BlocklistData; defaults: BlocklistData; isCustom?: boolean }>
  blocklistSet?: (data: BlocklistData | string) => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  blocklistReset?: () => Promise<{ ok: boolean; data?: BlocklistData; error?: string }>
  /** Fire-and-forget renderer log line; main appends it to userData/main.log. */
  logError?: (scope: string, msg: string) => void
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
