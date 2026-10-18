/**
 * Secure renderer storage (security plan B.3 / F3).
 *
 * In Electron, the keys in SECURE_KEYS (identity private keys, admin
 * identity, courier DM threads, PFP data-URLs) must NOT live in localStorage
 * — that is plaintext leveldb on disk. Instead they are proxied through the
 * preload bridge to the main-process secureStore (Electron safeStorage /
 * DPAPI under the user's logon).
 *
 * The renderer needs SYNC reads (existing code shape), so this module keeps a
 * RAM mirror: initSecureStorage() (awaited once at boot, before App renders)
 * migrates any legacy plaintext out of localStorage, loads the KV into the
 * mirror, and from then on getSecureItem() is sync-RAM while set/remove are
 * sync-RAM + async write-through (flushed on beforeunload + on the debounced
 * side of the main process).
 *
 * Browser/dev mode (no bridge): every function falls through to localStorage
 * unchanged.
 */

/** Exact keys + scoped prefixes (key = `prefix:<id>`) that must stay DPAPI-side. */
export const SECURE_KEYS = [
  'orbit_identity',
  'orbit_admin_identity',
  'orbit_mail_threads_v1',
  'orbit_rooms_v1',
  'orbit_room_messages_v1',
  'goonmatch_pfps',
  // The self pfp URL is read by myProfile init and written by every pfp
  // save path — it must ride the same DPAPI mirror as goonmatch_pfps.
  // Previously it stayed plaintext localStorage while profilePics went
  // secure, so the two caches diverged after every restart ("pfp won't hold").
  'orbit_pfp_url',
  'gmatch.server.join', // one-shot join password handoff (plan T5) — never plaintext
  'gmatch.server.host', // one-shot create-server claim (name + join password) — never plaintext
] as const

export type SecureKey = (typeof SECURE_KEYS)[number]

function isSecureKey(key: string): boolean {
  return (SECURE_KEYS as readonly string[]).includes(key)
    // scoped variants: `orbit_mail_threads_v1:<orbitId>`
    || SECURE_KEYS.some((k) => key.startsWith(`${k}:`))
}

interface SecureBridge {
  secureAvailable: () => Promise<boolean>
  secureGet: (key: string) => Promise<string | null>
  secureSet: (key: string, value: string) => Promise<void>
  secureDelete: (key: string) => Promise<void>
}

function bridge(): SecureBridge | null {
  try {
    const g = (typeof window !== 'undefined'
      ? (window as unknown as { gmatch?: Partial<SecureBridge> }).gmatch
      : undefined)
    if (g && g.secureGet && g.secureSet && g.secureDelete && g.secureAvailable) {
      return g as SecureBridge
    }
    return null
  } catch {
    return null
  }
}

/** Secure-mode RAM mirror: key -> value (null = absent). */
const mirror = new Map<string, string | null>()
let secureMode = false
let encryptionAvailable: boolean | null = null
let initPromise: Promise<void> | null = null

/**
 * Whether the main-process store can actually ENCRYPT (Electron
 * safeStorage/DPAPI). `false` means the KV is holding plaintext envelopes —
 * the settings security warning reads this. Never a reason to read
 * localStorage instead of the KV (see doInit).
 */
export function secureEncryptionAvailable(): boolean | null {
  return encryptionAvailable
}

/**
 * One-time boot migration+load (Electron): plaintext in localStorage moves
 * into the DPAPI KV and is purged; the KV then populates the sync mirror.
 * Await this BEFORE first render. Safe to call twice (idempotent).
 */
export function initSecureStorage(): Promise<void> {
  if (!initPromise) initPromise = doInit()
  return initPromise
}

async function doInit(): Promise<void> {
  const b = bridge()
  if (!b) return // browser/dev: pure localStorage mode
  let available = false
  try {
    available = await b.secureAvailable()
  } catch {
    available = false
  }
  // The KV is used whenever the bridge exists — even when safeStorage reports
  // encryption unavailable. Flapping availability used to strand the player:
  // the boot where encryption WAS available migrated `orbit_identity` into the
  // KV and purged the plaintext copy, then the next boot saw `available=false`
  // and read localStorage, which no longer held anything → a permanent,
  // unexplained logout. The main store still answers while unencrypted (plain
  // envelopes), so read through it and surface the degradation instead.
  encryptionAvailable = available
  secureMode = true
  for (const key of SECURE_KEYS) {
    let kvVal: string | null = null
    try {
      kvVal = await b.secureGet(key)
    } catch {
      kvVal = null
    }
    let legacy: string | null = null
    try {
      legacy = localStorage.getItem(key)
    } catch {
      legacy = null
    }
    if (kvVal !== null) {
      // KV is authoritative; purge any stale plaintext copy.
      mirror.set(key, kvVal)
      try {
        if (legacy !== null) localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    } else if (legacy !== null) {
      // First run after upgrade: migrate plaintext -> KV, then purge.
      mirror.set(key, legacy)
      try {
        await b.secureSet(key, legacy)
        localStorage.removeItem(key)
      } catch {
        /* KV write failed: mirror still serves the session; retried next boot */
      }
    }
  }
  // Scoped variants (e.g. `orbit_mail_threads_v1:<orbitId>`): migrate any
  // matching plaintext keys found in localStorage.
  try {
    const existing: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isSecureKey(k) && !SECURE_KEYS.includes(k as SecureKey)) existing.push(k)
    }
    for (const key of existing) {
      let kvVal: string | null = null
      try { kvVal = await b.secureGet(key) } catch { kvVal = null }
      if (kvVal !== null) {
        mirror.set(key, kvVal)
        try { localStorage.removeItem(key) } catch { /* ignore */ }
        continue
      }
      const legacy = localStorage.getItem(key)
      if (legacy === null) continue
      mirror.set(key, legacy)
      try {
        await b.secureSet(key, legacy)
        localStorage.removeItem(key)
      } catch { /* retried next boot */ }
    }
  } catch { /* localStorage unavailable */ }
  // Flush pending write-throughs if the window closes before the debounce.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      void flushWrites()
    })
  }
}

const pending = new Map<string, string | null>() // key -> value|null (delete)
function queueWrite(key: string, value: string | null): void {
  pending.set(key, value)
  // Fire-and-forget; drain() preserves ordering per key (last wins).
  void drain()
}

let draining = false
async function drain(): Promise<void> {
  if (draining) return
  draining = true
  const b = bridge()
  try {
    while (b && pending.size) {
      const [key, value] = pending.entries().next().value as [string, string | null]
      pending.delete(key)
      try {
        if (value === null) await b.secureDelete(key)
        else await b.secureSet(key, value)
      } catch {
        /* KV error: drop the write; RAM mirror stays correct for the session */
      }
    }
  } finally {
    draining = false
  }
}

/** Await all queued writes (used by tests + beforeunload). */
export async function flushWrites(): Promise<void> {
  while (pending.size) await drain()
}

/** Sync read: mirror in secure mode, localStorage otherwise. */
export function getSecureItem(key: string): string | null {
  if (secureMode && isSecureKey(key)) {
    const v = mirror.get(key)
    return v === undefined ? null : v
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setSecureItem(key: string, value: string): void {
  if (secureMode && isSecureKey(key)) {
    mirror.set(key, value)
    queueWrite(key, value)
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota — same semantics as before */
  }
}

/**
 * Remove every secure entry whose key equals a SECURE_KEYS base or a scoped
 * variant of one (`base:<id>`) — used by account deletion so scoped threads /
 * rooms / wallpaper prefs can never survive a purge.
 */
export function removeAllScopedSecureItems(): void {
  const doomed: string[] = []
  for (const key of mirror.keys()) {
    if (isSecureKey(key)) doomed.push(key)
  }
  for (const key of doomed) {
    mirror.set(key, null)
    queueWrite(key, null)
  }
}

export function removeSecureItem(key: string): void {
  if (secureMode && isSecureKey(key)) {
    mirror.set(key, null)
    queueWrite(key, null)
    return
  }
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** --- test seams --- */
export const _test = {
  reset: () => {
    mirror.clear()
    pending.clear()
    secureMode = false
    encryptionAvailable = null
    initPromise = null
  },
}
