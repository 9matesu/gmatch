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

/**
 * ICE hygiene (server-side gate, defense in depth): literal IPv4/IPv6 `host`
 * addresses leak the LAN — those stay blocked. mDNS host candidates (.local),
 * `srflx`/`prflx` reflexive candidates (the NAT traversal) and TURN relay
 * candidates pass. Mirrors apps/desktop/src/utils/ice-hygiene.ts (trust-domain
 * boundary — the vendored API stays dependency-only, so the rule is duplicated).
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
    if (type === 'host') return !address.endsWith('.local')
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

  let answer: unknown = null
  for (let attempt = 0; attempt < 20; attempt++) {
    answer = getAnswer(offerId)
    if (answer !== null && answer !== undefined) break
    await new Promise((r) => setTimeout(r, 250))
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