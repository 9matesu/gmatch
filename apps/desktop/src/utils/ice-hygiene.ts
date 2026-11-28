// P2P ICE hygiene: peers connect DIRECTLY, with the minimum address exposure
// that direct connections require. The NAT-T ladder, in the order ICE tries it:
//   1. STUN reflexive (srflx) — two free, stateless, no-account STUN hosts:
//      Google is the primary, Cloudflare the fallback. A network that cannot
//      resolve one logs one "Failed to resolve address ... (errorcode: -105)"
//      per peer; that noise is accepted and the other rungs still run.
//   2. host candidates — same LAN / mDNS `.local`; literal private IPv4 is
//      never signaled (the LAN stays private).
//   3. GLOBAL IPv6 (2000::/3) — a routable direct path, no relay needed.
//   4. Radmin VPN (26.0.0.0/8) — peers on the same virtual LAN connect direct.
//   5. the node's WS SWARM_FRAME relay — the fallback when no direct pair
//      forms (CGNAT / symmetric NAT). It is never labelled direct.
// There is NO baked public TURN: `openrelay.metered.ca` resolves to 192.0.2.1
// (TEST-NET) and the shared `openrelayproject` account was revoked globally.
// An explicit TURN (env / Settings) appends to STUN and forces the whole
// connection through it (zero exposure).
// - peerConnectionConfig() is the single source of truth for both the
//   file-transfer peer (webrtc.ts) and the mesh (courierSignaling.ts, mesh.ts).

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

/**
 * True for a literal IP that must NOT be signaled as a host candidate.
 * IPv4 literals and private/link-local IPv6 stay private; a GLOBAL IPv6
 * address (2000::/3) is a routable direct path and is allowed — that is the
 * decentralized CGNAT fix. A Radmin VPN IPv4 (26.0.0.0/8) is also allowed:
 * peers on the same Radmin VPN share one virtual LAN. `.local` mDNS hosts are
 * never literal.
 */
export function isLiteralIp(address: string): boolean {
  if (!address) return false
  if (address.endsWith('.local')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return !isRadminVpnAddress(address)
  if (address.includes(':')) return !isGlobalIpv6(address)
  return false
}

/** Radmin VPN assigns virtual addresses in 26.0.0.0/8 (always starts with 26). */
export function isRadminVpnAddress(address: string): boolean {
  return /^26\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
}

/** Global unicast IPv6 only (2000::/3); ULA, link-local and loopback stay hidden. */
export function isGlobalIpv6(address: string): boolean {
  const a = address.toLowerCase().split('%')[0]
  if (!a.includes(':') || a === '::1' || a === '::') return false
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return false
  return /^[23][0-9a-f]{3}:/.test(a)
}

/**
 * Parse an SDP candidate line ("candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host ...").
 * Address is token 4, `typ` value is the token after 'typ'. Returns null on junk.
 */
export function parseCandidate(candidate: string): { address: string; type: string } | null {
  if (typeof candidate !== 'string') return null
  const parts = candidate.trim().split(/\s+/)
  // Accept both "candidate:..." and "... candidate:..." prefixes.
  const idx = parts.findIndex((p) => p.startsWith('candidate:'))
  const offset = idx >= 0 ? idx : 0
  const first = parts[offset]
  if (!first || !first.startsWith('candidate:')) return null
  const address = parts[offset + 4]
  const typIdx = parts.indexOf('typ')
  const type = typIdx >= 0 ? parts[typIdx + 1] : ''
  if (!address || !type) return null
  return { address, type }
}

/** True when the candidate must NOT be sent to the peer. */
export function candidateLeaksIp(candidate: string): boolean {
  const parsed = parseCandidate(candidate)
  if (!parsed) return true // unknown shape — drop, fail closed
  if (parsed.type === 'host') return isLiteralIp(parsed.address)
  // srflx/prflx carry a reflexive address — no less exposure than a direct
  // connection would reveal, so never suppress one that ICE did gather.
  if (parsed.type === 'srflx' || parsed.type === 'prflx') return false
  // 'relay' candidates carry the TURN server's address, not the user's.
  if (parsed.type === 'relay') return false
  return true
}

/** True for a host candidate whose address is in the Radmin VPN range. */
export function isRadminHostCandidate(candidate: string): boolean {
  const parsed = parseCandidate(candidate)
  return !!parsed && parsed.type === 'host' && isRadminVpnAddress(parsed.address)
}

/**
 * Filter an outgoing candidate JSON (RTCIceCandidate-like). Returns null when
 * the candidate would leak an IP. Pure — no DOM required.
 */
export function sanitizeCandidate<T extends { candidate?: string }>(cand: T): T | null {
  if (!cand || typeof cand.candidate !== 'string' || cand.candidate.length === 0) return cand // end-of-candidates marker
  return candidateLeaksIp(cand.candidate) ? null : cand
}

/**
 * Vite only exposes VITE_-prefixed variables into the renderer bundle; the
 * NEXT_PUBLIC_TURN_* names are kept for Node/dev tools and for a runtime
 * `window.__ENV` injection. Accept both spellings so TURN is actually
 * configurable in a SHIPPED build — with no bridge or injection, reading only
 * process.env/window.__ENV left every P2P stack relay-less forever.
 */
export function normalizeTurnEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env }
  const aliases: Array<[string, string]> = [
    ['VITE_TURN_URL', 'NEXT_PUBLIC_TURN_URL'],
    ['VITE_TURN_USERNAME', 'NEXT_PUBLIC_TURN_USERNAME'],
    ['VITE_TURN_CREDENTIAL', 'NEXT_PUBLIC_TURN_CREDENTIAL'],
  ]
  for (const [viteKey, canonicalKey] of aliases) {
    if (!out[canonicalKey] && out[viteKey]) out[canonicalKey] = out[viteKey]
  }
  return out
}

/** Runtime TURN the user saved in Settings (localStorage). Env stays
 *  authoritative; this is the fallback so a CGNAT pair can add a relay without
 *  a rebuild. A stored relay forces the zero-exposure relay posture, same as
 *  env. */
function storedTurn(): { url: string; username: string; credential: string } | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem('gmatch.turn.v1')
    if (!raw) return null
    const p = JSON.parse(raw) as { url?: unknown; username?: unknown; credential?: unknown }
    const url = typeof p.url === 'string' ? p.url.trim() : ''
    const username = typeof p.username === 'string' ? p.username : ''
    const credential = typeof p.credential === 'string' ? p.credential : ''
    return url && username && credential ? { url, username, credential } : null
  } catch {
    return null
  }
}

/** TURN env lookup shared by both P2P stacks (renderer + dev tools). */
export function turnCredentials(env: Record<string, string | undefined> = {}): { url: string; username: string; credential: string } | null {
  const e = normalizeTurnEnv(env)
  const url = e.NEXT_PUBLIC_TURN_URL
  const username = e.NEXT_PUBLIC_TURN_USERNAME
  const credential = e.NEXT_PUBLIC_TURN_CREDENTIAL
  if (url && username && credential) return { url, username, credential }
  return storedTurn()
}

/**
 * The config both P2P stacks use. Two modes:
 * - explicit NEXT_PUBLIC_TURN_* env or Settings TURN → STUN + TURN, with the
 *   relay-forced, zero-IP-exposure posture.
 * - otherwise → the two STUN hosts only: srflx plus host candidates (mDNS, global
 *   IPv6, Radmin) are the direct paths and the node's SWARM_FRAME relay is the
 *   fallback. Literal private LAN IPs are never signaled — the mDNS host gate
 *   stays on either way.
 */
export function defaultIceConfig(env: Record<string, string | undefined> = {}): RTCConfiguration {
  return peerConnectionConfig(turnCredentials(env))
}

/** ICE server list: Google + Cloudflare STUN, plus TURN when explicitly configured. */
export function iceServersFor(turn: { url: string; username: string; credential: string } | null): RTCIceServer[] {
  const servers = [...STUN_SERVERS]
  if (turn) servers.push({ urls: turn.url, username: turn.username, credential: turn.credential })
  return servers
}

/**
 * The config for RTCPeerConnection: literal LAN IPs are never signaled
 * (mDNS-only host candidates), and when TURN is configured the connection is
 * forced through it — no direct P2P, no IP exposure at all.
 */
export function peerConnectionConfig(turn: { url: string; username: string; credential: string } | null): RTCConfiguration {
  return {
    iceServers: iceServersFor(turn),
    iceCandidatePoolSize: 0,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    ...(turn ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
  }
}
