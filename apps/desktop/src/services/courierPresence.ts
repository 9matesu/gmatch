import type { OrbitIdentity } from '@orbit/crypto'
import { signMessage, verifySignature, hexToBytes, bytesToHex } from '@orbit/crypto'
import { sha256Hex } from '@orbit/protocol'
import { type User, generateFallbackName } from '@orbit/shared'
import { getApiBaseUrl } from '../utils/api'
import { normalizeNodeUrl } from '../utils/peerNodes'

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
  /**
   * The node this peer is connected to (its courier/rendezvous). Signed with
   * the beacon, so a peer cannot be redirected to somebody else's node
   * without breaking the signature. Optional: a client that does not know the
   * field still verifies against the OLD payload (see
   * beaconSignaturePayload).
   */
  nodeUrl?: string
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
  const base = `presence-v1|${b.orbitId}|${b.publicKeyHex}|${b.timestamp}`
  // The node URL is signed ONLY when it is present: a beacon from a client
  // that does not know the field keeps verifying against the old payload, so
  // an older peer is still seen (it just has no address).
  return new TextEncoder().encode(b.nodeUrl ? `${base}|${b.nodeUrl}` : base)
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
    // Where we live: the node we are connected to. It is the mailbox that
    // holds a sealed envelope addressed to us.
    ...(normalizeNodeUrl(getApiBaseUrl()) ? { nodeUrl: normalizeNodeUrl(getApiBaseUrl())! } : {}),
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
  const { users } = await fetchPresenceRosterFrom(getApiBaseUrl(), selfId, fetchImpl)
  return users
}

/** A roster and the node each peer lives on. */
export interface PresenceRoster {
  users: User[]
  /** node URL per peer id — the node the peer's mailbox is on. */
  nodeById: Map<string, string>
}

/**
 * Read the presence mailbox of ANY node — ours, or a node a peer lives on.
 *
 * The presence token is a well-known public constant, so a node can read
 * another node's beacons without an account there. A beacon says which node
 * the peer is connected to, which is how a peer on another node becomes
 * reachable: the sealed envelope goes straight into that node's box.
 */
export async function fetchPresenceRosterFrom(
  base: string,
  selfId?: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PresenceRoster> {
  // An empty base is the browser dev proxy (same origin): it is a valid
  // mailbox. Anything else must be an http(s) node URL.
  const trimmed = base.trim()
  const nodeBase = trimmed === '' ? '' : normalizeNodeUrl(trimmed)
  if (nodeBase === null) return { users: [], nodeById: new Map() }
  try {
    const url = `${nodeBase}/api/mail/${PRESENCE_TOKEN}`
    const res = await fetchImpl(url, { method: 'GET' })
    if (!res.ok) return { users: [], nodeById: new Map() }

    const data = await res.json().catch(() => null)
    if (!data || !Array.isArray(data.envelopes)) return { users: [], nodeById: new Map() }

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
    const nodeById = new Map<string, string>()
    for (const beacon of activeMap.values()) {
      const peerNode = normalizeNodeUrl(beacon.nodeUrl)
      if (peerNode) nodeById.set(beacon.orbitId, peerNode)
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

    return { users, nodeById }
  } catch {
    return { users: [], nodeById: new Map() }
  }
}
