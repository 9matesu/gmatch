import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import {
  addAnswer,
  addIce,
  createOffer,
  getAnswer,
  getIce,
  getOffer,
  getOfferPayload,
  pendingFor,
} from '../signal-store'

const signal = new Hono<{ Variables: { orbitId: string } }>()

function isParticipant(offer: { sender_id: string; receiver_id: string }, orbitId: string): boolean {
  return offer.sender_id === orbitId || offer.receiver_id === orbitId
}

/** Mirror of isRadminVpnAddress in apps/desktop/src/utils/ice-hygiene.ts. */
function isRadminVpnAddress(address: string): boolean {
  return /^26\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
}

/** Mirror of isGlobalIpv6 in apps/desktop/src/utils/ice-hygiene.ts (2000::/3). */
function isGlobalIpv6(address: string): boolean {
  const a = address.toLowerCase().split('%')[0]
  if (!a.includes(':') || a === '::1' || a === '::') return false
  if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return false
  return /^[23][0-9a-f]{3}:/.test(a)
}

/**
 * ICE hygiene (server-side gate, defense in depth): literal LAN IPv4/IPv6
 * `host` addresses stay blocked. mDNS (.local), Radmin VPN (26/8) and GLOBAL
 * IPv6 (2000::/3) hosts are real direct paths and pass, as do srflx/prflx
 * reflexive and TURN relay candidates. Mirrors apps/desktop/src/utils/ice-hygiene.ts
 * (trust-domain boundary — the vendored API stays dependency-only).
 */
export function candidateLeaksIp(candidate: unknown): boolean {
  try {
    const sdp = (candidate as { candidate?: unknown })?.candidate
    if (typeof sdp !== 'string' || sdp.length === 0) return false // end-of-candidates marker
    const parts = sdp.trim().split(/\s+/)
    const idx = parts.findIndex((x) => x.startsWith('candidate:'))
    if (idx < 0) return true // unparseable — fail closed
    const address = parts[idx + 4] ?? ''
    const typIdx = parts.indexOf('typ')
    const type = typIdx >= 0 ? parts[typIdx + 1] : ''
    if (type === 'relay') return false
    if (type === 'host') {
      if (address.endsWith('.local')) return false
      if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return !isRadminVpnAddress(address)
      if (address.includes(':')) return !isGlobalIpv6(address)
      return true
    }
    if (type === 'srflx' || type === 'prflx') return false // reflexive = NAT traversal
    return true
  } catch {
    return true
  }
}

function isValidAnswer(answer: unknown): boolean {
  return !!answer && typeof answer === 'object' && !!(answer as any).type && !!(answer as any).sdp
}

signal.post('/initiate', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { offer, receiver_id } = await c.req.json()

  if (!offer || !receiver_id) {
    return c.json({ error: 'Missing offer or receiver_id' }, 400)
  }

  const id = createOffer(orbitId, receiver_id, offer)
  console.log(`[signal] POST /initiate orbitId=${orbitId} receiver_id=${receiver_id} id=${id}`)
  return c.json({ id }, 201)
})

signal.get('/offer/:id', orbitAuth, async (c) => {
  const id = c.req.param('id') || ''
  const orbitId = c.get('orbitId')

  const offer = getOffer(id)
  if (!offer) {
    return c.json({ error: 'Offer not found' }, 404)
  }

  if (!isParticipant(offer, orbitId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({ sender_id: offer.sender_id, offer: getOfferPayload(id) })
})

signal.get('/pending', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  return c.json({ offers: pendingFor(orbitId) })
})

signal.post('/respond', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { offer_id, answer } = await c.req.json()

  if (!offer_id || !isValidAnswer(answer)) {
    return c.json({ error: 'Missing offer_id or valid answer' }, 400)
  }

  const offer = getOffer(offer_id)
  if (!offer) return c.json({ error: 'Offer not found' }, 404)

  if (!isParticipant(offer, orbitId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const result = addAnswer(offer_id, answer)
  if (result === 'already_answered') return c.json({ error: 'Already answered' }, 409)

  return c.json({ id: offer_id }, 201)
})

signal.get('/answer/:offerId', orbitAuth, async (c) => {
  const offerId = c.req.param('offerId') || ''
  const orbitId = c.get('orbitId')

  const offer = getOffer(offerId)
  if (!offer) return c.json({ error: 'Offer not found' }, 404)
  if (!isParticipant(offer, orbitId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // "Offer exists, peer has not answered yet" is a NORMAL polling state, not
  // a malformed answer. It must be distinguishable from "unknown offer" (404
  // `Offer not found`) and from a genuinely corrupt stored answer (400).
  // The initiator polls this route every second with its own 45s budget;
  // answering that with a 400 after a server-side wait made it abort the whole
  // connection as soon as a cross-NAT peer took more than a few seconds to
  // answer. The 404 `Answer not found` is the contract the client waits for.
  const answer = getAnswer(offerId)
  if (answer === null || answer === undefined) {
    return c.json({ error: 'Answer not found' }, 404)
  }

  const parsed = answer
  if (!parsed || typeof parsed !== 'object' || !(parsed as any).type) {
    console.error(`[signal] GET /answer/:offerId INVALID answer data for offerId=${offerId}:`, answer)
    return c.json({ error: 'Invalid answer data' }, 400)
  }

  return c.json({ answer: parsed })
})

signal.post('/ice', orbitAuth, async (c) => {
  const orbitId = c.get('orbitId')
  const { offer_id, candidate } = await c.req.json()

  if (!offer_id || !candidate) {
    return c.json({ error: 'Missing offer_id or candidate' }, 400)
  }

  const offer = getOffer(offer_id)
  if (!offer) return c.json({ error: 'Offer not found' }, 404)

  if (!isParticipant(offer, orbitId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (candidateLeaksIp(candidate)) {
    return c.json({ error: 'Candidate rejected: raw IP address (ICE hygiene)' }, 400)
  }

  const isSender = orbitId === offer.sender_id
  addIce(offer_id, candidate, isSender)

  return c.json({ id: offer_id }, 201)
})

signal.get('/ice/:offerId', orbitAuth, async (c) => {
  const offerId = c.req.param('offerId') || ''
  const orbitId = c.get('orbitId')

  const offer = getOffer(offerId)
  if (!offer) return c.json({ error: 'Offer not found' }, 404)

  if (!isParticipant(offer, orbitId)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const isSender = orbitId === offer.sender_id
  const wantSender = !isSender

  return c.json({ candidates: getIce(offerId, wantSender) })
})

export { signal }