// P2P ICE hygiene: peers connect DIRECTLY, with the minimum address exposure
// that direct connections require.
// - STUN (Cloudflare, stateless UDP, no account) tells a peer its own
//   public reflexive address so peers on different NATs can hole-punch.
//   ONE server, on purpose: Chromium logs a socket_manager error for every
//   STUN host whose DNS it cannot resolve, and offline / behind a filtering
//   resolver that is one line per server per peer. Four providers meant eight
//   "Failed to resolve address for stun..." lines on every launch; one means
//   two. The WS-relay swarm is the documented fallback when no direct channel
//   forms, so losing a redundant STUN costs a little direct-path reach, never
//   connectivity.
// - sanitizeCandidate drops every literal-IP `host` candidate — the LAN
//   address never leaves the machine (mDNS `.local` hosts only). `srflx`
//   candidates ARE exchanged: without them cross-NAT peers can never meet,
//   and a reflexive address is exactly what any direct connection reveals.
// - `relay` candidates carry the TURN server's address, not yours; with TURN
//   configured the whole connection is forced through it (zero exposure).
// - peerConnectionConfig() is the single source of truth for both the
//   file-transfer peer (webrtc.ts) and the payload relay (removed).

export const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

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

/** True when the candidate must NOT be sent to the peer. */
export function candidateLeaksIp(candidate: string): boolean {
  const parsed = parseCandidate(candidate)
  if (!parsed) return true // unknown shape — drop, fail closed
  if (parsed.type === 'host') return isLiteralIp(parsed.address)
  // srflx/prflx ARE the NAT traversal: the reflexive address (learned from
  // the STUN server) is what lets peers on different NATs connect directly.
  if (parsed.type === 'srflx' || parsed.type === 'prflx') return false
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

/**
 * Vite only exposes VITE_-prefixed variables into the renderer bundle; the
 * NEXT_PUBLIC_TURN_* names are kept for Node/dev tools and for a runtime
 * `window.__ENV` injection. Accept both spellings so TURN is actually
 * configurable in a SHIPPED build — with no bridge or injection, reading only
 * process.env/window.__ENV left every P2P stack STUN-only forever.
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

/** TURN env lookup shared by both P2P stacks (renderer + dev tools). */
export function turnCredentials(env: Record<string, string | undefined> = {}): { url: string; username: string; credential: string } | null {
  const e = normalizeTurnEnv(env)
  const url = e.NEXT_PUBLIC_TURN_URL
  const username = e.NEXT_PUBLIC_TURN_USERNAME
  const credential = e.NEXT_PUBLIC_TURN_CREDENTIAL
  if (url && username && credential) return { url, username, credential }
  return null
}

/**
 * TURN is opt-in (user setup): NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL.
 * No community relay creds are baked into the bundle — the old defaultTurn()
 * shipped a hardcoded third-party OpenRelay credential the user never chose
 * (and that could not be removed by config). Returns null when nothing is
 * configured; the caller then uses STUN-only.
 */
export function effectiveTurn(env: Record<string, string | undefined> = {}): { url: string; username: string; credential: string } | null {
  return turnCredentials(env)
}

/**
 * The config both P2P stacks use. Two modes (SPEC §10c semantics):
 * - explicit NEXT_PUBLIC_TURN_* env → relay-forced, zero IP exposure posture.
 * - otherwise → STUN (Cloudflare): LAN pairs meet via mDNS hosts, cross-NAT
 *   pairs hole-punch through the exchanged reflexive candidates; symmetric-
 *   NAT pairs (STUN can't traverse) fall back to the WS-relay swarm. Literal
 *   LAN IPs are never signaled — the mDNS host gate stays on either way.
 */
export function defaultIceConfig(env: Record<string, string | undefined> = {}): RTCConfiguration {
  const envTurn = turnCredentials(env)
  if (envTurn) return peerConnectionConfig(envTurn)
  return peerConnectionConfig(null)
}

/** ICE server list: STUN always; TURN only when configured. */
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
