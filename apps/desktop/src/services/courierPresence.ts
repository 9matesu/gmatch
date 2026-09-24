import type { OrbitIdentity } from '@orbit/crypto'
import { signMessage, verifySignature, hexToBytes, bytesToHex } from '@orbit/crypto'
import { sha256Hex } from '@orbit/protocol'
import { type User, generateFallbackName } from '@orbit/shared'
import { getApiBaseUrl } from '../utils/api'

/**
 * Well-known 64-hex delivery token on the blind courier dedicated to
 * anonymous presence beacons. The server only sees an opaque 64-hex token;
 * it never inspects beacon payloads or tracks who connects.
 */
export const PRESENCE_TOKEN = sha256Hex(new TextEncoder().encode('orbit-global-presence-v1'))

export interface PresenceBeacon {
  orbitId: string
  displayName: string
  pfpUrl: string | null
  publicKeyHex: string
  encryptionPubHex?: string
  timestamp: number
  sig?: string
}

export const PRESENCE_TTL_MS = 90_000 // 90 seconds

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function beaconSignaturePayload(b: Omit<PresenceBeacon, 'sig'>): Uint8Array {
  return new TextEncoder().encode(`presence-v1|${b.orbitId}|${b.publicKeyHex}|${b.timestamp}`)
}

/**
 * Broadcasts an ephemeral signed presence heartbeat to the courier presence token.
 */
export async function broadcastPresence(
  identity: OrbitIdentity,
  profile: { displayName?: string; pfpUrl?: string | null },
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  const now = Date.now()
  const rawBeacon: Omit<PresenceBeacon, 'sig'> = {
    orbitId: identity.orbitId,
    displayName: profile.displayName || 'Player',
    pfpUrl: profile.pfpUrl || null,
    publicKeyHex: identity.publicKeyHex,
    encryptionPubHex: identity.encryptionPubHex || '',
    timestamp: now,
  }

  const sigBytes = signMessage(beaconSignaturePayload(rawBeacon), identity.privateKeyHex)
  const beacon: PresenceBeacon = {
    ...rawBeacon,
    sig: bytesToHex(sigBytes),
  }

  const envelope = {
    v: 2,
    kind: 'announce',
    to: PRESENCE_TOKEN,
    id: randomHex(16),
    sealed: btoa(unescape(encodeURIComponent(JSON.stringify(beacon)))),
    exp: now + PRESENCE_TTL_MS,
  }

  try {
    const url = `${getApiBaseUrl()}/api/mail/${PRESENCE_TOKEN}`
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: envelope }),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Fetches and verifies active presence beacons from the courier presence token,
 * returning a normalized User roster.
 */
export async function fetchPresenceRoster(
  selfId?: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<User[]> {
  try {
    const url = `${getApiBaseUrl()}/api/mail/${PRESENCE_TOKEN}`
    const res = await fetchImpl(url, { method: 'GET' })
    if (!res.ok) return []

    const data = await res.json().catch(() => null)
    if (!data || !Array.isArray(data.envelopes)) return []

    const now = Date.now()
    const activeMap = new Map<string, PresenceBeacon>()

    for (const env of data.envelopes) {
      if (!env || !env.sealed) continue
      try {
        const jsonStr = decodeURIComponent(escape(atob(env.sealed)))
        const beacon = JSON.parse(jsonStr) as PresenceBeacon
        if (!beacon || !beacon.orbitId || !beacon.publicKeyHex || !beacon.sig || !beacon.timestamp) continue

        // Check freshness: drop beacons older than TTL
        if (now - beacon.timestamp > PRESENCE_TTL_MS + 30_000) continue

        // Verify cryptographic signature against declared public key
        const expectedSigPayload = beaconSignaturePayload(beacon)
        if (!verifySignature(hexToBytes(beacon.sig), expectedSigPayload, beacon.publicKeyHex)) continue

        const existing = activeMap.get(beacon.orbitId)
        if (!existing || beacon.timestamp > existing.timestamp) {
          activeMap.set(beacon.orbitId, beacon)
        }
      } catch {
        /* skip invalid or tampered envelope */
      }
    }

    const users: User[] = []
    for (const beacon of activeMap.values()) {
      if (selfId && beacon.orbitId === selfId) continue
      users.push({
        id: beacon.orbitId,
        display_name: beacon.displayName?.trim() || generateFallbackName(beacon.orbitId),
        pfp_url: beacon.pfpUrl || undefined,
        publicKey: beacon.publicKeyHex,
        encryptionPubKey: beacon.encryptionPubHex || undefined,
        createdAt: new Date(beacon.timestamp).toISOString(),
        online: true,
        last_seen: new Date(beacon.timestamp).toISOString(),
      })
    }

    return users
  } catch {
    return []
  }
}
