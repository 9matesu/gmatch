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

export async function vaultGet(url: string): Promise<string | null> {
  if (!url || !enabled()) return null
  if (vaultBridge()) {
    try {
      const res = await window.gmatch?.vaultGet?.(url)
      if (res?.local) return res.local
    } catch {
      /* fallback to local storage */
    }
  }
  const stored = getStoredVault()
  return stored[url] ?? null
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
    }
    // Browser fallback / localStorage: persist pinned URL directly
    const stored = getStoredVault()
    stored[url] = url
    saveStoredVault(stored)
    sessionPinned.add(url)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orbit-vault-updated', { detail: { url, local: url } }))
    }
    return url
  } catch {
    sessionFailed.add(url)
    return null
  }
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
