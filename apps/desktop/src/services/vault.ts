"use client";

import { useEffect, useState } from 'react'

const SETTINGS_KEY = 'goonmatch-settings'
const VAULT_STORAGE_KEY = 'gmatch_vault_v1'

function getStoredVault(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(VAULT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStoredVault(map: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(map))
  } catch {}
}

/** Renderer side of the opt-in local media vault (electron/vault.cjs).
 *  When the Electron bridge is absent, degrades to localStorage storage. */
export function vaultBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.gmatch?.vaultGet === 'function'
}

export function vaultOptIn(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as { localVault?: unknown }
    return parsed.localVault !== false
  } catch {
    return true
  }
}

function enabled(): boolean {
  return vaultOptIn()
}

// Session guard: pin() is idempotent per URL per session so backfills and
// re-renders can't stack pins (which would leak bytes past eviction).
const sessionPinned = new Set<string>()

// Failed pins are remembered for the session too: the App backfill effect
// re-runs on every feed update, and without this a URL the host refuses is
// re-fetched on every pass. A transient failure therefore does not retry until
// the next app launch — accepted, because the alternative is a fetch storm.
// ponytail: session-scoped negative cache; add a TTL if a flaky host matters.
const sessionFailed = new Set<string>()

const VIDEO_LOCAL_RE = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i

/**
 * Refs whose vault lookup has COMPLETED this session (hit or miss). The gallery
 * tile needs this to tell "still resolving" from "we looked and the bytes are
 * gone": without it, a keep that claims `persisted` but was evicted renders a
 * silent placeholder instead of a status the player can act on.
 */
const checkedVaultRefs = new Set<string>()

export function vaultLookupSettled(ref: string): boolean {
  return checkedVaultRefs.has(ref)
}

export function _resetVaultLookups(): void {
  checkedVaultRefs.clear()
}

/**
 * A stored row's bytes are playable in a <video> when the caller knows the
 * source is a video OR the vault row says the mime is `video/*`. Rows are named
 * by bare content hash, so the extension test alone used to miss every
 * extensionless video and hand `<video>` a raw `vault://` URL with no Range.
 */
function looksLikeVideo(sourceUrl: string, local: string, mime?: string | null): boolean {
  if (mime && mime.toLowerCase().startsWith('video/')) return true
  return VIDEO_LOCAL_RE.test(sourceUrl) || VIDEO_LOCAL_RE.test(local)
}

export async function vaultGet(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  if (vaultBridge()) {
    try {
      const res = await window.gmatch?.vaultGet?.(url)
      // The lookup completed (hit, absent or unreadable) — record that before
      // any early return so callers can report an honest status.
      checkedVaultRefs.add(url)
      if (res?.local) {
        if (looksLikeVideo(url, res.local, res.mime)) {
          const http = await vaultHttpUrl(res.local)
          if (http) return http
        }
        return res.local
      }
    } catch {
      /* fallback to local storage */
    }
  }
  const stored = getStoredVault()
  checkedVaultRefs.add(url)
  return stored[url] ?? null
}

/**
 * Honest lookup for callers that must tell "no local bytes" apart from "the
 * bytes are on disk but could not be read or decrypted". `vaultGet` collapses
 * both to null; the viewer must not claim a keepsake is gone when it is merely
 * unreadable. Never throws: a bridge failure is reported, not swallowed.
 */
export type VaultProbe =
  | { state: 'local'; local: string; mime?: string }
  | { state: 'absent' }
  | { state: 'unreadable'; reason: string }

export async function vaultProbe(ref: string): Promise<VaultProbe> {
  if (!ref || !enabled()) return { state: 'absent' }
  if (vaultBridge()) {
    try {
      const res = await window.gmatch?.vaultGet?.(ref)
      if (!res) return { state: 'absent' }
      if (res.state === 'unreadable') return { state: 'unreadable', reason: String(res.reason || 'read') }
      if (res.local) return { state: 'local', local: res.local, mime: res.mime ? String(res.mime) : undefined }
      return { state: 'absent' }
    } catch {
      // The main process refused or the channel broke: that is NOT a confirmed
      // absence, so callers can show a diagnosable error instead of "gone".
      return { state: 'unreadable', reason: 'ipc' }
    }
  }
  const hit = getStoredVault()[ref]
  return hit ? { state: 'local', local: hit } : { state: 'absent' }
}

/** Get-or-fetch + pin. Fire-and-forget for keeps/cards; resolves vault:// or cached url. */
export async function vaultPin(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  if (sessionFailed.has(url)) return null
  try {
    if (sessionPinned.has(url)) return vaultGet(url)
    if (vaultBridge()) {
      const res = await window.gmatch?.vaultPin?.(url)
      if (res?.local) {
        sessionPinned.add(url)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orbit-vault-updated', { detail: { url, local: res.local } }))
        }
        return res.local
      }
      // Bridge refused (no bytes stored): negative-cache like a failure.
      sessionFailed.add(url)
      return null
    }
    // No bridge (browser dev): there is no durable byte store behind the
    // vault here, so pinning MUST NOT record url->url. That self-mapping used
    // to make remote URLs resolve as "local", sending new-window opens to the
    // provider. Return null: IndexedDB (registerLocalObject) is the dev bytes.
    return null
  } catch {
    sessionFailed.add(url)
    return null
  }
}

/**
 * Drop the session's negative pin cache for a url. The negative cache exists so
 * the background backfill cannot storm a host that refuses us; it must never
 * veto an explicit Retry from the gallery, which is the one place the player
 * asks for exactly that fetch.
 */
export function vaultForgetFailure(url: string): void {
  if (url) sessionFailed.delete(url)
}

export function vaultUnpin(url: string): void {
  if (!url || !enabled()) return
  sessionPinned.delete(url)
  if (vaultBridge()) {
    try {
      void window.gmatch?.vaultUnpin?.(url)
    } catch {
      /* best effort */
    }
  }
  const stored = getStoredVault()
  if (stored[url]) {
    delete stored[url]
    saveStoredVault(stored)
  }
}

export function vaultRemove(url: string): void {
  if (!url || !enabled()) return
  sessionPinned.delete(url)
  if (vaultBridge()) {
    try {
      void window.gmatch?.vaultRemove?.(url)
    } catch {
      /* best effort */
    }
  }
  const stored = getStoredVault()
  if (stored[url]) {
    delete stored[url]
    saveStoredVault(stored)
  }
}

export async function vaultStats(): Promise<{ files: number; bytes: number; quota: number } | null> {
  if (!enabled()) return null
  if (vaultBridge()) {
    try {
      return (await window.gmatch?.vaultStats?.()) ?? null
    } catch {
      /* fallback */
    }
  }
  const stored = getStoredVault()
  return { files: Object.keys(stored).length, bytes: 0, quota: 3 * 1024 * 1024 * 1024 }
}

export async function vaultClear(): Promise<void> {
  if (!vaultBridge()) return
  sessionPinned.clear()
  try {
    await window.gmatch?.vaultClear?.()
  } catch {
    /* best effort */
  }
}

/** Resolve to the local vault:// URL when opted in and bytes are stored,
 *  else the remote URL. Re-resolves when the toggle flips. */
export function useVaultUrl(url?: string | null): string {
  const [local, setLocal] = useState<string | null>(null)
  useEffect(() => {
    setLocal(null)
    if (!url || !vaultOptIn()) return
    let dead = false
    const resolve = () => {
      void vaultGet(url).then((l) => {
        if (!dead) setLocal(l)
      })
    }
    resolve()
    const onSettings = () => resolve()
    window.addEventListener('orbit-settings-updated', onSettings)
    return () => {
      dead = true
      window.removeEventListener('orbit-settings-updated', onSettings)
    }
  }, [url])
  return local ?? url ?? ''
}

/**
 * Batch lookup for lists (gallery tiles): url -> vault:// for stored bytes.
 * Grows only; stale keys are harmless because every entry is URL-keyed and
 * vaultGet itself no-ops when the vault is off.
 * Mount-once + settings-event dep list: the joined key string is stable.
 */
export function useVaultUrls(urls: Array<string | null | undefined>): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({})
  const key = urls.filter(Boolean).join('|')
  useEffect(() => {
    if (!key || !vaultOptIn()) return
    let dead = false
    const resolve = () => {
      void Promise.all(
        key.split('|').map(async (u) => [u, await vaultGet(u)] as const),
      ).then((pairs) => {
        if (!dead) {
          setMap((prev) => {
            const next = { ...prev }
            for (const [u, l] of pairs) if (l) next[u] = l
            return next
          })
        }
      })
    }
    resolve()
    const onVaultUpdate = (e: Event) => {
      const custom = e as CustomEvent<{ url?: string; local?: string }>
      if (custom.detail?.url && custom.detail?.local && key.includes(custom.detail.url)) {
        setMap((prev) => ({ ...prev, [custom.detail!.url!]: custom.detail!.local! }))
      } else {
        resolve()
      }
    }
    window.addEventListener('orbit-settings-updated', resolve)
    window.addEventListener('orbit-vault-updated', onVaultUpdate)
    return () => {
      dead = true
      window.removeEventListener('orbit-settings-updated', resolve)
      window.removeEventListener('orbit-vault-updated', onVaultUpdate)
    }
  }, [key])
  return map
}

/**
 * Batch lookup for renderers: vault:// URL -> browser-playable localhost
 * http URL (the Electron vault server speaks Range, so <video> seeks work;
 * raw vault:// depends on the custom-scheme handler and never works in a
 * browser tab). Non-vault URLs are never included — callers fall back to the
 * original URL when there is no mapping. Re-resolves on vault updates so a
 * tile recovers if its bytes arrive after first paint.
 */
export function useVaultHttpUrls(urls: Array<string | null | undefined>): Record<string, string> {
  const key = urls.filter((u): u is string => !!u && u.startsWith('vault://')).join('|')
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key || !enabled()) return
    let dead = false
    const resolve = () => {
      void Promise.all(
        key.split('|').map(async (u) => [u, await vaultHttpUrl(u)] as const),
      ).then((pairs) => {
        if (!dead) {
          setMap((prev) => {
            const next = { ...prev }
            for (const [u, l] of pairs) if (l) next[u] = l
            return next
          })
        }
      })
    }
    resolve()
    const onVaultUpdate = (e: Event) => {
      const custom = e as CustomEvent<{ url?: string; local?: string }>
      if (custom.detail?.url && key.includes(custom.detail.url)) {
        setMap((prev) => {
          const next = { ...prev }
          delete next[custom.detail!.url!]
          return next
        })
      }
      resolve()
    }
    window.addEventListener('orbit-settings-updated', resolve)
    window.addEventListener('orbit-vault-updated', onVaultUpdate)
    return () => {
      dead = true
      window.removeEventListener('orbit-settings-updated', resolve)
      window.removeEventListener('orbit-vault-updated', onVaultUpdate)
    }
  }, [key])
  return map
}

/** Browser-openable localhost URL for a stored URL, else null. */
export async function vaultHttpUrl(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  if (vaultBridge()) {
    try {
      const res = await window.gmatch?.vaultHttpUrl?.(url)
      if (res?.local) return res.local
    } catch {
      /* fallback */
    }
  }
  const stored = getStoredVault()
  if (stored[url] && !stored[url].startsWith('vault://')) return stored[url]
  return null
}

/** Test seam: clear both session guards. */
export function _resetSessionGuards(): void {
  sessionPinned.clear()
  sessionFailed.clear()
}
