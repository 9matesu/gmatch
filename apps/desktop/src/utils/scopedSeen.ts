"use client";

/**
 * Identity-scoped local storage for courier chat state.
 *
 * `dmSeen` / `roomSeen` / `lastDmPeer` are per-device conversation state, but
 * they used to live under one unscoped localStorage key. Two accounts on the
 * same install therefore shared read stamps and the "last conversation"
 * pointer: account B inherited account A's read watermarks (its threads showed
 * up already-read) and reopened A's conversation on boot. Threads themselves
 * are already identity-scoped (`orbit_mail_threads_v1:<orbitId>`), so the
 * stamps had to follow.
 *
 * Legacy values are migrated once, into the first identity that boots; the
 * unscoped key is then removed so the leak cannot repeat.
 *
 * Pure apart from localStorage — unit-tested in `scopedSeen.test.ts`.
 */

export function scopedStorageKey(base: string, scope?: string | null): string {
  return scope ? `${base}:${scope}` : base
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode / quota: memory state stays correct for the session */
  }
}

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * Read a scoped JSON blob. When the scoped key is absent and an unscoped
 * legacy value exists, adopt it into the scoped key (one-time migration).
 */
export function readScopedJson<T>(base: string, scope: string | null | undefined, fallback: T): T {
  const key = scopedStorageKey(base, scope)
  const own = readRaw(key)
  if (own !== null) {
    try {
      return JSON.parse(own) as T
    } catch {
      return fallback
    }
  }
  if (!scope) return fallback
  const legacy = readRaw(base)
  if (legacy === null) return fallback
  let parsed: T
  try {
    parsed = JSON.parse(legacy) as T
  } catch {
    return fallback
  }
  writeRaw(key, legacy)
  removeRaw(base)
  return parsed
}

export function writeScopedJson(base: string, scope: string | null | undefined, value: unknown): void {
  writeRaw(scopedStorageKey(base, scope), JSON.stringify(value))
}

/** Sanitize a stamp map: numeric, finite, positive timestamps only. */
export function sanitizeSeen(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [id, ts] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    const n = typeof ts === 'number' ? ts : Number(ts)
    if (Number.isFinite(n) && n > 0) out[id] = n
  }
  return out
}

/** Per-identity seen stamps: `{ conversationId: seen-at ms }`. */
export function loadSeen(base: string, scope: string | null | undefined): Record<string, number> {
  return sanitizeSeen(readScopedJson<unknown>(base, scope, {}))
}

export function saveSeen(
  base: string,
  scope: string | null | undefined,
  value: Record<string, number>,
): void {
  writeScopedJson(base, scope, value)
}
