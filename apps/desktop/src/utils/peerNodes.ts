/**
 * Where the peers live (roadmap L4/L6, cross-node peers).
 *
 * Every client is connected to ONE node. That node is the peer's courier and
 * rendezvous: its mailbox holds the sealed envelopes addressed to that peer,
 * and its presence mailbox holds that peer's beacon.
 *
 * A peer on ANOTHER node is reachable when we know that node's address: the
 * beacon carries it (signed), and the mail client then drops the sealed
 * envelope straight into that node's box instead of our own. The node stays
 * blind in every case — it only ever moves ciphertext it cannot open.
 *
 * State is tiny and bounded (a peer id -> node URL map, and the set of nodes
 * we know), persisted in localStorage: it is a hint, not authority, and losing
 * it costs one rediscovery.
 */

const PEER_NODES_KEY = 'gmatch.peer_nodes_v1'
const KNOWN_NODES_KEY = 'gmatch.known_nodes_v1'

const MAX_PEER_NODES = 200
const MAX_KNOWN_NODES = 50

function readJson<T>(key: string): T | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* private mode / quota: the map is a hint */ }
}

/** Normalize a node URL: no trailing slash, http(s) only. */
export function normalizeNodeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed.replace(/\/+$/, '')
}

/**
 * True when a node URL points at an address only dialable on its OWN network:
 * loopback, link-local, RFC1918 (10/8, 172.16/12, 192.168/16) or CGNAT
 * (100.64/10). A peer's beacon names the node IT can reach; on another network
 * such an address is undialable — a sealed mail PUT there just times out.
 * A DNS name or a public literal is dialable. Malformed input fails closed.
 */
export function isPrivateNodeUrl(url: string | null | undefined): boolean {
  const clean = normalizeNodeUrl(url)
  if (!clean) return true
  try {
    const host = new URL(clean).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!host || host === 'localhost') return true
    if (host === '::1' || host.startsWith('127.') || host.startsWith('169.254.') || host.startsWith('fe80')) return true
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
    if (!m) return false // a DNS name resolves wherever the sender is
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  } catch {
    return true
  }
}

/** The node a peer is connected to. Null when we do not know (yet). */
export function peerNodeFor(orbitId: string): string | null {
  if (!orbitId) return null
  const map = readJson<Record<string, string>>(PEER_NODES_KEY)
  const found = map?.[orbitId]
  return found ? normalizeNodeUrl(found) : null
}

/**
 * Remember where a peer lives. A beacon is signed by the peer, so the URL it
 * carries is the peer's own claim — but a claim is still a claim: it decides
 * WHERE a sealed envelope is dropped, never WHAT it contains.
 */
export function rememberPeerNode(orbitId: string, nodeUrl: string | null | undefined): void {
  if (!orbitId) return
  const url = normalizeNodeUrl(nodeUrl)
  const map = readJson<Record<string, string>>(PEER_NODES_KEY) ?? {}
  if (!url) {
    if (!(orbitId in map)) return
    delete map[orbitId]
  } else {
    if (map[orbitId] === url) return
    map[orbitId] = url
  }
  const entries = Object.entries(map)
  // Bounded: drop the oldest half when the cap is hit (insertion order).
  const trimmed = entries.length > MAX_PEER_NODES ? entries.slice(entries.length - MAX_PEER_NODES) : entries
  writeJson(PEER_NODES_KEY, Object.fromEntries(trimmed))
  rememberKnownNode(url)
}

/** Nodes we know about (our own + the ones a beacon or the directory named). */
export function knownNodes(): string[] {
  const list = readJson<string[]>(KNOWN_NODES_KEY) ?? []
  return list.map((url) => normalizeNodeUrl(url)).filter((url): url is string => !!url)
}

/** Remember a node address (ours, a friend's, or one a beacon named). */
export function rememberKnownNode(nodeUrl: string | null | undefined): void {
  const url = normalizeNodeUrl(nodeUrl)
  if (!url) return
  const list = knownNodes()
  if (list.includes(url)) return
  list.push(url)
  writeJson(KNOWN_NODES_KEY, list.slice(-MAX_KNOWN_NODES))
}

/**
 * Remember a node from a DIRECTORY hint: "host:port" or a full URL. The
 * directory lists nodes as bare addresses, the beacons carry full URLs.
 */
export function rememberKnownNodeHint(hint: string | null | undefined): void {
  if (!hint) return
  const trimmed = hint.trim()
  if (!trimmed) return
  rememberKnownNode(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
}

/** test seam */
export function _resetPeerNodes(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(PEER_NODES_KEY)
    localStorage.removeItem(KNOWN_NODES_KEY)
  } catch { /* ignore */ }
}
