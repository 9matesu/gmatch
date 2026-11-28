import type { OrbitIdentity } from '@orbit/crypto'
import { signMessage, verifySignature, hexToBytes, bytesToHex } from '@orbit/crypto'
import { sha256Hex } from '@orbit/protocol'
import { type User, generateFallbackName } from '@orbit/shared'
import { getApiBaseUrl } from '../utils/api'
import { getCentralApiUrl } from '../utils/central'
import { normalizeNodeUrl } from '../utils/peerNodes'
import { resolveNodeAddress } from '../utils/serverAddress'
import { resolveObjectRefId, isRequestableObjectId } from '../utils/objectRef'
import { getSecureItem } from '../utils/secure-storage'

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
  /**
   * The avatar's CONTENT address (sha256 of the avatar bytes), when the local
   * client can prove one. A peer uses it to resolve the picture through the
   * SAME verified content-addressed ladder as a peer post (Avatar.tsx): local
   * bytes, then the swarm asking for that hash — never our node's pfp route,
   * which does not own a cross-node peer's picture, and never a provider
   * hotlink. Optional and SIGNED: a beacon without it still verifies against
   * the old payload (see beaconSignaturePayload).
   */
  pfpHash?: string
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
  /**
   * This build's version (e.g. "1.7.2"), signed like the other optional
   * fields. A peer can then say "older version" honestly instead of guessing
   * why a cross-node picture will not load. Absent = unknown, never a guess.
   */
  appVersion?: string
  timestamp: number
  sig?: string
}

const PRESENCE_TTL_MS = 90_000 // 90 seconds

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function beaconSignaturePayload(b: Omit<PresenceBeacon, 'sig'>): Uint8Array {
  let base = `presence-v1|${b.orbitId}|${b.publicKeyHex}|${b.timestamp}`
  // nodeUrl and pfpHash are signed ONLY when present: a beacon from a client
  // that does not know a field keeps verifying against the shorter payload, so
  // an older peer is still seen (it just has no address / avatar hash).
  if (b.nodeUrl) base += `|${b.nodeUrl}`
  if (b.pfpHash) base += `|${b.pfpHash}`
  // Appended LAST so a beacon from a client that does not know the field
  // still verifies against the shorter payload.
  if (b.appVersion) base += `|${b.appVersion}`
  return new TextEncoder().encode(base)
}

const SHA256_HEX = /^[0-9a-f]{64}$/i
const LEGACY_HEX = /^[0-9a-f]{40}$/i

/**
 * The avatar's content address when the ref ALREADY names one
 * (`urn:sha256:<hex>`, a bare 64/40-hex id, a magnet btih). A hash-bearing ref
 * is resolved by the verified ladder, so it is also what we can advertise.
 */
function avatarHashFromRef(pfpUrl: string | null | undefined): string | null {
  if (!pfpUrl) return null
  const id = resolveObjectRefId(pfpUrl)
  if (!id) return null
  const lower = id.toLowerCase()
  return SHA256_HEX.test(lower) || LEGACY_HEX.test(lower) ? lower : null
}

// A pfp_url is usually `/api/objects/<uuid>` after upload — the id only exists
// on the author's node, so a peer 404s. The bytes are held locally under that
// id (forgeMediaLocally / the media picker register both keys), so hash them
// once and cache by ref: the durable content hash is the address a peer can
// actually resolve. Bounded so a long session cannot grow it forever.
const avatarHashCache = new Map<string, string | null>()
const AVATAR_HASH_CACHE_MAX = 8

function cacheAvatarHash(pfpUrl: string, hash: string | null): void {
  if (avatarHashCache.size >= AVATAR_HASH_CACHE_MAX) {
    const oldest = avatarHashCache.keys().next().value
    if (oldest) avatarHashCache.delete(oldest)
  }
  avatarHashCache.set(pfpUrl, hash)
}

/**
 * ProfilePicModal saves a compact `data:image/jpeg;base64,…` thumb, which is
 * neither an object id nor a hash-bearing ref. Hash the bytes and seed them
 * under that address: without a seeder, a peer advertising the hash would be
 * unresolvable and the avatar would stay invisible.
 */
async function avatarHashFromDataUrl(pfpUrl: string): Promise<string | null> {
  if (!/^data:image\//i.test(pfpUrl)) return null
  if (avatarHashCache.has(pfpUrl)) return avatarHashCache.get(pfpUrl) ?? null
  const match = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(pfpUrl)
  if (!match) return null
  let bytes: Uint8Array
  try {
    bytes = match[2]
      ? Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]))
  } catch {
    return null
  }
  // A profile thumb is a few KB. Never let a hostile giant data URL become a
  // signed beacon field or a swarm object.
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) return null
  const hash = sha256Hex(bytes)
  cacheAvatarHash(pfpUrl, hash)
  try {
    const { registerLocalObject } = await import('../utils/p2pSwarm')
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    registerLocalObject(hash, new Blob([buffer], { type: match[1] || 'image/jpeg' }))
  } catch {
    /* seed best-effort: a hash without bytes still resolves to a real fallback */
  }
  return hash
}

async function avatarHashFromLocalObject(pfpUrl: string): Promise<string | null> {
  const id = resolveObjectRefId(pfpUrl)
  if (!id || !isRequestableObjectId(id)) return null
  if (avatarHashCache.has(pfpUrl)) return avatarHashCache.get(pfpUrl) ?? null
  let hash: string | null = null
  try {
    const { getLocalObject, sha256HexBlob } = await import('../utils/p2pSwarm')
    const blob = await getLocalObject(id)
    if (blob) hash = await sha256HexBlob(blob)
  } catch {
    hash = null
  }
  cacheAvatarHash(pfpUrl, hash)
  return hash
}

/** The pfp_url a peer's roster should carry: the content address when we have
 *  one (so Avatar resolves verified bytes), else the original ref. */
function avatarRefForHash(hash: string): string {
  return SHA256_HEX.test(hash) ? `urn:sha256:${hash.toLowerCase()}` : hash.toLowerCase()
}

/**
 * This build's version, read from the app's EXISTING Electron bridge. Browser
 * dev has no bridge: the beacon then honestly carries no version. Never a
 * hardcoded/fabricated number, and no new dependency.
 */
async function localAppVersion(): Promise<string | null> {
  try {
    const bridge = (globalThis as unknown as {
      window?: { gmatch?: { appVersion?: () => Promise<string> } }
    }).window?.gmatch
    const value = await bridge?.appVersion?.()
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : null
  } catch {
    return null
  }
}

/**
 * Broadcasts an ephemeral signed presence heartbeat to the courier presence token.
 */
export async function broadcastPresence(
  identity: OrbitIdentity,
  profile: { displayName?: string; pfpUrl?: string | null; pfpHash?: string | null },
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  const now = Date.now()
  // Where we live: the node we are connected to — its box is where a peer
  // drops the envelopes addressed to us. It has to be an address ANOTHER
  // machine can dial: the packaged app's own API base is `127.0.0.1` (a peer
  // would read that as its own loopback) and a browser build rides the dev
  // proxy with no address at all. The node reports the addresses it answers
  // on, so both cases resolve to a real one.
  const nodeUrl = await resolveNodeAddress(identity, fetchImpl)
  // The local display name is the freshest source: a node profile row can
  // lag a rename (or belong to an older session). Prefer it, then the
  // in-memory profile, then a neutral label — never a nameless beacon.
  let localName = ''
  try { localName = (localStorage.getItem('orbit_display_name') || '').trim() } catch { /* private mode */ }
  // useP2P publishes only a display name: the avatar is held in the
  // identity-scoped secure key, written by every pfp save path. Without this
  // read the beacon has no pfp ref at all and no hash can be derived.
  const pfpUrl = profile.pfpUrl || getSecureItem(`orbit_pfp_url:${identity.orbitId}`) || getSecureItem('orbit_pfp_url') || null
  const rawBeacon: Omit<PresenceBeacon, 'sig'> = {
    orbitId: identity.orbitId,
    displayName: localName || profile.displayName?.trim() || 'Player',
    pfpUrl,
    publicKeyHex: identity.publicKeyHex,
    encryptionPubHex: identity.encryptionPubHex || '',
    ...(nodeUrl ? { nodeUrl } : {}),
    timestamp: now,
  }

  // Advertise the avatar by its CONTENT when we can prove one: an explicit
  // hash, a hash-bearing ref, or the local bytes behind a node-local object id.
  // A peer then resolves the picture off the swarm instead of a pfp route that
  // 404s on its node. Best-effort: no provable hash simply omits the field.
  const pfpHash =
    (profile.pfpHash && profile.pfpHash.trim()) ||
    avatarHashFromRef(pfpUrl) ||
    (pfpUrl ? await avatarHashFromLocalObject(pfpUrl) : null) ||
    (pfpUrl ? await avatarHashFromDataUrl(pfpUrl) : null) ||
    null
  if (pfpHash) rawBeacon.pfpHash = pfpHash.toLowerCase()
  const appVersion = await localAppVersion()
  if (appVersion) rawBeacon.appVersion = appVersion

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

  // Publish to BOTH the node we are on and the free hosted rendezvous. Two
  // installs on different nodes (or two dev surfaces on different ports) then
  // share ONE presence mailbox, so each sees the other online instead of an
  // empty roster. The beacon is signed and bound to the node it names; the
  // Worker stores the envelope verbatim and cannot rewrite it.
  const own = getApiBaseUrl().replace(/\/+$/, '')
  const central = getCentralApiUrl().replace(/\/+$/, '')
  const bases = central && central !== own ? [getApiBaseUrl(), central] : [getApiBaseUrl()]
  let published = false
  for (const base of bases) {
    try {
      const res = await fetchImpl(`${base}/api/mail/${PRESENCE_TOKEN}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: envelope }),
      })
      if (res.ok) published = true
    } catch {
      /* one unreachable mailbox cannot block the other */
    }
  }
  return published
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
        // Cosmetic only: carried through the roster so the chat list can say
        // "older version" without touching media resolution. A malformed or
        // absent field stays absent — never a fabricated version.
        ...(typeof beacon.appVersion === 'string' && beacon.appVersion.length <= 32
          ? { appVersion: beacon.appVersion }
          : {}),
        // A hash-bearing avatar resolves through the verified content ladder on
        // the reader's side (Avatar.tsx); the node-local pfpUrl is the fallback
        // for a peer that advertised no hash.
        pfp_url: beacon.pfpHash ? avatarRefForHash(beacon.pfpHash) : (beacon.pfpUrl || undefined),
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
