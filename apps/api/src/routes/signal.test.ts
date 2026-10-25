import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { candidateLeaksIp } from './signal'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

// ───────────────────── WS-1: Signal endpoint tests ─────────────────────

describe('Signal API — initiate', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()

  beforeAll(async () => {
    env = await createMockEnv()
    // Register both users
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)
  })

  it('POST /api/signal/initiate creates an offer', async () => {
    const body = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    expect(res.status).toBe(201)
    const data: any = await res.json()
    expect(data.id).toBeDefined()
  })

  it('POST /api/signal/initiate returns 400 without offer', async () => {
    const body = JSON.stringify({ receiver_id: receiver.orbitId })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('POST /api/signal/initiate returns 400 without receiver_id', async () => {
    const body = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' } })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('Signal API — offer retrieval + pending', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()
  let offerId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)

    const body = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    const data: any = await res.json()
    offerId = data.id
  })

  it('GET /api/signal/offer/:id returns the offer', async () => {
    const res = await app.request(`/api/signal/offer/${offerId}`, {
      headers: authHeaders(receiver, 'GET', `/api/signal/offer/${offerId}`),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.sender_id).toBe(sender.orbitId)
    expect(data.offer.type).toBe('offer')
  })

  it('GET /api/signal/offer/:id returns 404 for unknown id', async () => {
    const res = await app.request('/api/signal/offer/nonexistent', {
      headers: authHeaders(receiver, 'GET', '/api/signal/offer/nonexistent'),
    }, env)
    expect(res.status).toBe(404)
  }, 10000)

  it('GET /api/signal/pending returns pending offers for receiver', async () => {
    const res = await app.request('/api/signal/pending', {
      headers: authHeaders(receiver, 'GET', '/api/signal/pending'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.offers.length).toBeGreaterThanOrEqual(1)
    expect(data.offers[0].sender_id).toBe(sender.orbitId)
  })

  it('GET /api/signal/pending returns empty for sender (no offers TO them)', async () => {
    const res = await app.request('/api/signal/pending', {
      headers: authHeaders(sender, 'GET', '/api/signal/pending'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.offers.length).toBe(0)
  })
})

describe('Signal API — respond (answer)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()
  let offerId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)

    const body = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    const data: any = await res.json()
    offerId = data.id
  })

  it('POST /api/signal/respond creates an answer', async () => {
    const body = JSON.stringify({ offer_id: offerId, answer: { type: 'answer', sdp: 'v=0...' } })
    const res = await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', body) },
      body,
    }, env)
    expect(res.status).toBe(201)
    const data: any = await res.json()
    expect(data.id).toBeDefined()
  })

  it('POST /api/signal/respond returns 409 for already answered offer', async () => {
    const body = JSON.stringify({ offer_id: offerId, answer: { type: 'answer', sdp: 'v=0...' } })
    const res = await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', body) },
      body,
    }, env)
    expect(res.status).toBe(409)
  })

  it('POST /api/signal/respond returns 404 for unknown offer_id', async () => {
    const body = JSON.stringify({ offer_id: 'nonexistent', answer: { type: 'answer', sdp: 'v=0...' } })
    const res = await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', body) },
      body,
    }, env)
    expect(res.status).toBe(404)
  })

  it('POST /api/signal/respond returns 400 without answer', async () => {
    const body = JSON.stringify({ offer_id: offerId })
    const res = await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('Signal API — answer retrieval', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()
  let offerId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)

    const offerBody = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const offerRes = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', offerBody) },
      body: offerBody,
    }, env)
    offerId = ((await offerRes.json()) as any).id

    const answerBody = JSON.stringify({ offer_id: offerId, answer: { type: 'answer', sdp: 'v=0...' } })
    await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', answerBody) },
      body: answerBody,
    }, env)
  })

  it('GET /api/signal/answer/:offerId returns the answer', async () => {
    const res = await app.request(`/api/signal/answer/${offerId}`, {
      headers: authHeaders(sender, 'GET', `/api/signal/answer/${offerId}`),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.answer.type).toBe('answer')
  })

  it('GET /api/signal/answer/:offerId returns 404 for unknown offer', async () => {
    const res = await app.request('/api/signal/answer/nonexistent', {
      headers: authHeaders(sender, 'GET', '/api/signal/answer/nonexistent'),
    }, env)
    expect(res.status).toBe(404)
  })

  it('answered offer no longer appears in pending', async () => {
    const res = await app.request('/api/signal/pending', {
      headers: authHeaders(receiver, 'GET', '/api/signal/pending'),
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    const found = data.offers.find((o: any) => o.id === offerId)
    expect(found).toBeUndefined()
  })
})

describe('Signal API — ICE candidates', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()
  let offerId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)

    const offerBody = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const offerRes = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', offerBody) },
      body: offerBody,
    }, env)
    offerId = ((await offerRes.json()) as any).id
  })

  it('POST /api/signal/ice from sender stores candidate with is_sender=1', async () => {
    const body = JSON.stringify({ offer_id: offerId, candidate: { candidate: 'candidate:1 1 udp 2122260223 me.local 54321 typ host', sdpMid: '0' } })
    const res = await app.request('/api/signal/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/ice', body) },
      body,
    }, env)
    expect(res.status).toBe(201)
  })

  it('POST /api/signal/ice from receiver stores candidate with is_sender=0', async () => {
    const body = JSON.stringify({ offer_id: offerId, candidate: { candidate: 'candidate:2 1 udp 2122260223 peer.local 54322 typ host', sdpMid: '0' } })
    const res = await app.request('/api/signal/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/ice', body) },
      body,
    }, env)
    expect(res.status).toBe(201)
  })

  it('GET /api/signal/ice/:offerId returns opposite party candidates', async () => {
    // Sender should see receiver's candidates
    const senderRes = await app.request(`/api/signal/ice/${offerId}`, {
      headers: authHeaders(sender, 'GET', `/api/signal/ice/${offerId}`),
    }, env)
    expect(senderRes.status).toBe(200)
    const senderData: any = await senderRes.json()
    expect(senderData.candidates.length).toBe(1)
    expect(senderData.candidates[0].candidate).toBe('candidate:2 1 udp 2122260223 peer.local 54322 typ host')

    // Receiver should see sender's candidates
    const receiverRes = await app.request(`/api/signal/ice/${offerId}`, {
      headers: authHeaders(receiver, 'GET', `/api/signal/ice/${offerId}`),
    }, env)
    expect(receiverRes.status).toBe(200)
    const receiverData: any = await receiverRes.json()
    expect(receiverData.candidates.length).toBe(1)
    expect(receiverData.candidates[0].candidate).toBe('candidate:1 1 udp 2122260223 me.local 54321 typ host')
  })

  it('POST /api/signal/ice returns 404 for unknown offer', async () => {
    const body = JSON.stringify({ offer_id: 'nonexistent', candidate: { candidate: 'a=candidate:3' } })
    const res = await app.request('/api/signal/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/ice', body) },
      body,
    }, env)
    expect(res.status).toBe(404)
  })

  it('POST /api/signal/ice returns 400 without candidate', async () => {
    const body = JSON.stringify({ offer_id: offerId })
    const res = await app.request('/api/signal/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/ice', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('GET /api/signal/ice/:offerId returns 404 for unknown offer', async () => {
    const res = await app.request('/api/signal/ice/nonexistent', {
      headers: authHeaders(sender, 'GET', '/api/signal/ice/nonexistent'),
    }, env)
    expect(res.status).toBe(404)
  })
})

// ───────────────────── WS-1: Signal authorization ─────────────────────

describe('Signal API — authorization (only participants)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const sender = createTestIdentity()
  const receiver = createTestIdentity()
  const bystander = createTestIdentity()
  let offerId: string

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(sender, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(receiver, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(bystander, 'GET', '/api/users') }, env)

    const body = JSON.stringify({ offer: { type: 'offer', sdp: 'v=0...' }, receiver_id: receiver.orbitId })
    const res = await app.request('/api/signal/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sender, 'POST', '/api/signal/initiate', body) },
      body,
    }, env)
    offerId = ((await res.json()) as any).id
  })

  it('bystander cannot read offer details', async () => {
    const res = await app.request(`/api/signal/offer/${offerId}`, {
      headers: authHeaders(bystander, 'GET', `/api/signal/offer/${offerId}`),
    }, env)
    expect(res.status).toBe(403)
  })

  it('bystander cannot respond to offer', async () => {
    const body = JSON.stringify({ offer_id: offerId, answer: { type: 'answer', sdp: 'v=0...' } })
    const res = await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bystander, 'POST', '/api/signal/respond', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })

  it('bystander cannot post ICE candidates', async () => {
    const body = JSON.stringify({ offer_id: offerId, candidate: { candidate: 'a=hack...' } })
    const res = await app.request('/api/signal/ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bystander, 'POST', '/api/signal/ice', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })

  it('bystander cannot read ICE candidates', async () => {
    const res = await app.request(`/api/signal/ice/${offerId}`, {
      headers: authHeaders(bystander, 'GET', `/api/signal/ice/${offerId}`),
    }, env)
    expect(res.status).toBe(403)
  })

  it('bystander cannot read answer', async () => {
    // First have the real receiver respond
    const answerBody = JSON.stringify({ offer_id: offerId, answer: { type: 'answer', sdp: 'v=0...' } })
    await app.request('/api/signal/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(receiver, 'POST', '/api/signal/respond', answerBody) },
      body: answerBody,
    }, env)

    const res = await app.request(`/api/signal/answer/${offerId}`, {
      headers: authHeaders(bystander, 'GET', `/api/signal/answer/${offerId}`),
    }, env)
    expect(res.status).toBe(403)
  })
})

describe('candidateLeaksIp (ICE hygiene gate)', () => {
  it('passes mDNS host, relay and srflx; drops literal-IP host + junk', () => {
    expect(candidateLeaksIp({ candidate: 'candidate:1 1 udp 100 me.local 54321 typ host' })).toBe(false)
    expect(candidateLeaksIp({ candidate: 'candidate:3 1 udp 150 198.51.100.9 50000 typ relay' })).toBe(false)
    expect(candidateLeaksIp({ candidate: 'candidate:2 1 udp 100 203.0.113.7 41234 typ srflx' })).toBe(false)
    expect(candidateLeaksIp({ candidate: 'candidate:1 1 udp 100 192.168.1.5 54321 typ host' })).toBe(true)
  })
  it('end-of-candidates marker passes; junk fails closed', () => {
    expect(candidateLeaksIp({ candidate: '' })).toBe(false)
    expect(candidateLeaksIp({})).toBe(false)
    expect(candidateLeaksIp({ candidate: 'garbage' })).toBe(true)
  })
})
