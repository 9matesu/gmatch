/**
 * Gossip envelopes (self-hosting relay, plan G1).
 *
 * Every user is a self-hosting db: public posts replicate node-to-node as
 * SIGNED envelopes through a blind relay. The relay (central or any host)
 * validates SHAPE + SIGNATURE only — it never needs to understand content.
 * Media bytes stay local-first on the poster's disk (P2P swarm); only the
 * public post metadata travels.
 *
 * Envelope identity: `id` is the origin Objects row id (uuid), so retries
 * and multi-path delivery dedupe naturally (INSERT OR IGNORE).
 *
 * Signature: Ed25519 over `gossip-v1|<author_id>|<stableStringify(payload)>`
 * with the author's Ed25519 key. Verifiers need only the enclosed
 * author_pubkey (relays) and additionally match it against the local Users
 * row when the author is known (home-node anti-impersonation).
 */

/** Signature domain separator — never sign anything else with this prefix. */
export const GOSSIP_SIG_PREFIX = 'gossip-v1'

/** Max envelope TTL the relay honors (days). */
export const MAX_GOSSIP_TTL_DAYS = 30

/** Max serialized payload chars (public post metadata is tiny). */
export const MAX_GOSSIP_PAYLOAD_CHARS = 8 * 1024

export interface GossipPostPayload {
  /** Origin Objects row id (uuid). Doubles as the envelope id. */
  id: string
  owner_id: string
  author_pubkey: string
  /** Display-name snapshot from the origin node (fallback-rendered). */
  author_name: string
  mime_type: string
  size_bytes: number
  /** magnet:, urn:sha256:, /api/objects/<id>, or legacy http(s). */
  content_url: string
  caption: string | null
  location: string | null
  post_tags: string | null
  post_group: string | null
  content_hash: string | null
  created_at: string
}

export interface GossipEnvelope {
  kind: 'post'
  id: string
  author_id: string
  payload: GossipPostPayload
  /** Ed25519 hex over the signing message. */
  sig: string
  /** Human label of the origin node (directory hint style, optional). */
  origin_node?: string
  /** Requested TTL in days (clamped server-side). */
  ttl_days?: number
}

/** Canonical JSON: object keys sorted recursively. Both signer and verifier
 *  must produce byte-identical input — never use plain JSON.stringify. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value)
    if (typeof s !== 'string') throw new Error('unstringifiable value')
    return s
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const parts: string[] = []
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k]
    if (v === undefined) continue
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** Exact bytes the author signs / verifiers check (UTF-8). */
export function gossipSigningMessage(payload: GossipPostPayload): Uint8Array {
  return new TextEncoder().encode(
    `${GOSSIP_SIG_PREFIX}|${payload.owner_id}|${stableStringify(payload)}`,
  )
}

const HEX64_RE = /^[0-9a-f]{64}$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 64) return false
  const t = Date.parse(v)
  return Number.isFinite(t)
}

/**
 * Shape-only validation (no crypto, no content inspection). Returns an error
 * string for the first defect, or null when well-formed. Used by the relay
 * on write AND by applying hosts before touching their db.
 */
export function gossipWellFormed(env: unknown): string | null {
  if (!env || typeof env !== 'object') return 'envelope must be an object'
  const e = env as Record<string, unknown>
  if (e.kind !== 'post') return 'kind must be "post"'
  if (typeof e.id !== 'string' || (!UUID_RE.test(e.id) && !/^[A-Za-z0-9_-]{8,80}$/.test(e.id))) {
    return 'id must be a uuid or 8-80 char token'
  }
  if (typeof e.author_id !== 'string' || e.author_id.length === 0 || e.author_id.length > 128) {
    return 'author_id invalid'
  }
  if (typeof e.sig !== 'string' || !/^[0-9a-f]{128}$/i.test(e.sig)) return 'sig must be 128-hex'
  if (e.origin_node !== undefined && (typeof e.origin_node !== 'string' || e.origin_node.length > 120)) {
    return 'origin_node too long'
  }
  if (e.ttl_days !== undefined && (typeof e.ttl_days !== 'number' || !(e.ttl_days > 0) || e.ttl_days > MAX_GOSSIP_TTL_DAYS)) {
    return `ttl_days must be within 1..${MAX_GOSSIP_TTL_DAYS}`
  }
  const p = e.payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return 'payload must be an object'
  if (stableStringify(p).length > MAX_GOSSIP_PAYLOAD_CHARS) return 'payload too large'
  if (p.id !== e.id) return 'payload.id must equal envelope id'
  if (p.owner_id !== e.author_id) return 'payload.owner_id must equal author_id'
  if (typeof p.author_pubkey !== 'string' || !HEX64_RE.test(p.author_pubkey)) return 'author_pubkey must be 64-hex'
  if (typeof p.author_name !== 'string' || p.author_name.length > 80) return 'author_name invalid'
  if (typeof p.mime_type !== 'string' || p.mime_type.length === 0 || p.mime_type.length > 100) {
    return 'mime_type invalid'
  }
  if (typeof p.size_bytes !== 'number' || !(p.size_bytes >= 0) || p.size_bytes > 50 * 1024 * 1024) {
    return 'size_bytes invalid'
  }
  if (typeof p.content_url !== 'string' || p.content_url.length === 0 || p.content_url.length > 2048) {
    return 'content_url invalid'
  }
  if (p.caption !== null && (typeof p.caption !== 'string' || p.caption.length > 1000)) return 'caption too long'
  if (p.location !== null && (typeof p.location !== 'string' || p.location.length > 120)) return 'location too long'
  if (p.post_tags !== null && (typeof p.post_tags !== 'string' || p.post_tags.length > 500)) return 'post_tags too long'
  if (p.post_group !== null && (typeof p.post_group !== 'string' || p.post_group.length > 80 || !/^[A-Za-z0-9_-]+$/.test(p.post_group))) {
    return 'post_group invalid'
  }
  if (p.content_hash !== null && (typeof p.content_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(p.content_hash))) {
    return 'content_hash must be 64-hex'
  }
  if (!isIsoDate(p.created_at)) return 'created_at must be ISO'
  return null
}
