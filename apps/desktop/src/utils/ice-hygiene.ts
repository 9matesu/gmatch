// P2P ICE hygiene (privacy gate): never let a raw IP leave the machine.
// - sanitizeCandidate drops every `host`/`srflx`/`prflx` candidate that
//   carries a literal IPv4/IPv6 and keeps only `.local` (mDNS) host
//   candidates; `relay` candidates carry the TURN server's address, not yours.
// - Without TURN configured, srflx is dropped too: a server-reflexive
//   candidate IS the machine's public IP as seen by the STUN server.
// - peerConnectionConfig() is the single source of truth for both the
//   file-transfer peer (webrtc.ts) and the payload relay (peer-relay.ts).

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

/** Literal IPv4 (dotted quad) or IPv6 (contains ':') — never `.local`. */
export function isLiteralIp(address: string): boolean {
  if (!address) return false
  if (address.endsWith('.local')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return true
  if (address.includes(':')) return true
  return false
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

/** True when the candidate must NOT be sent to the peer (raw IP leak). */
export function candidateLeaksIp(candidate: string): boolean {
  const parsed = parseCandidate(candidate)
  if (!parsed) return true // unknown shape — drop, fail closed
  if (parsed.type === 'host') return isLiteralIp(parsed.address)
  // srflx/prflx addresses ARE public IPs (as seen by the STUN peer) — always
  // a leak. With TURN configured, iceTransportPolicy:'relay' stops them from
  // ever being gathered; without TURN they must never reach the peer.
  if (parsed.type === 'srflx' || parsed.type === 'prflx') return true
  // 'relay' candidates carry the TURN server's address, not the user's.
  if (parsed.type === 'relay') return false
  return true
}

/**
 * Filter an outgoing candidate JSON (RTCIceCandidate-like). Returns null when
 * the candidate would leak an IP. Pure — no DOM required.
 */
export function sanitizeCandidate<T extends { candidate?: string }>(cand: T): T | null {
  if (!cand || typeof cand.candidate !== 'string' || cand.candidate.length === 0) return cand // end-of-candidates marker
  return candidateLeaksIp(cand.candidate) ? null : cand
}

/** TURN env lookup shared by both P2P stacks (renderer + dev tools). */
export function turnCredentials(env: Record<string, string | undefined> = {}): { url: string; username: string; credential: string } | null {
  const url = env.NEXT_PUBLIC_TURN_URL
  const username = env.NEXT_PUBLIC_TURN_USERNAME
  const credential = env.NEXT_PUBLIC_TURN_CREDENTIAL
  if (url && username && credential) return { url, username, credential }
  return null
}

/**
 * Packaged builds have no TURN env — without a relay fallback, cross-NAT
 * peers silently never connect (a dead end). Public community TURN as the
 * default relay candidate source; NEXT_PUBLIC_TURN_* env always wins.
 * NOTE: third-party, rate-limited — see SPEC §10c / plan risk #1.
 */
export function defaultTurn(): { url: string; username: string; credential: string } {
  return { url: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
}

/** TURN for a connection: explicit env first, public default otherwise. */
export function effectiveTurn(env: Record<string, string | undefined> = {}): { url: string; username: string; credential: string } {
  return turnCredentials(env) ?? defaultTurn()
}

/**
 * The config both P2P stacks use. Two modes (SPEC §10c semantics kept):
 * - explicit NEXT_PUBLIC_TURN_* env → relay-forced, zero IP exposure posture.
 * - otherwise → STUN + community default TURN as candidate sources WITHOUT
 *   forcing relay: same-LAN pairs connect directly and a community-relay
 *   outage cannot take all P2P down. Outgoing candidates are still
 *   sanitized (no literal IPs, no srflx onward), so the peer never learns
 *   anyone's public address either way.
 */
export function defaultIceConfig(env: Record<string, string | undefined> = {}): RTCConfiguration {
  const envTurn = turnCredentials(env)
  if (envTurn) return peerConnectionConfig(envTurn)
  return { ...peerConnectionConfig(null), iceServers: iceServersFor(defaultTurn()) }
}

/** ICE server list: STUN always; TURN only when configured. */
export function iceServersFor(turn: { url: string; username: string; credential: string } | null): RTCIceServer[] {
  const servers = [...STUN_SERVERS]
  if (turn) servers.push({ urls: turn.url, username: turn.username, credential: turn.credential })
  return servers
}

/**
 * The privacy gate for RTCPeerConnection: non-relay candidates are never
 * gathered (mDNS-only host candidates), and when TURN is configured the
 * connection is forced through it — no direct P2P, no IP exposure at all.
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
