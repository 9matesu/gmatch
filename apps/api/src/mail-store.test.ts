import { describe, it, expect } from 'vitest'
import { createMailStore, putEnvelope, listEnvelopes, ackEnvelopes, sweepMail } from './mail-store'
import { generateIdentity, signMessage } from '@orbit/crypto'
import { deliveryToken, sessionDeliveryToken } from '@orbit/protocol'

const bob = generateIdentity()
const TOKEN = deliveryToken(bob.publicKeyHex)
const OTHER = 'b'.repeat(64)

function envelope(id: string, sealed = 'c2VjcmV0') {
  return { v: 2 as const, kind: 'mail', to: TOKEN, id, sealed }
}

function ack(identity = bob, ids: string[], token = TOKEN) {
  const msg = new TextEncoder().encode(`${token}|${ids.join(',')}`)
  return { ids, pubkey: identity.publicKeyHex, token, sig: Buffer.from(signMessage(msg, identity.privateKeyHex)).toString('hex') }
}

describe('blind mail store (courier-side, Session-swarm semantics)', () => {
  it('stores bytes VERBATIM — the courier never mutates or reads content', () => {
    const s = createMailStore()
    expect(putEnvelope(s, envelope('e1e1e1e1', 'VGhpcyBpcyB0aGUgYm9keQ=='), 1000)).toBe(true)
    const got = listEnvelopes(s, TOKEN, 1000)
    expect(got).toHaveLength(1)
    expect(got[0].sealed).toBe('VGhpcyBpcyB0aGUgYm9keQ==')
    expect(got[0].id).toBe('e1e1e1e1')
  })

  it('list by unknown token yields nothing and does not leak existence', () => {
    const s = createMailStore()
    putEnvelope(s, envelope('e1e1e1e1'), 1000)
    expect(listEnvelopes(s, OTHER, 1000)).toEqual([])
  })

  it('list is idempotent (no drain); ack removes only what the key-holder signed', () => {
    const s = createMailStore()
    putEnvelope(s, envelope('aaaa1111'), 1000)
    putEnvelope(s, envelope('bbbb2222'), 1000)
    expect(listEnvelopes(s, TOKEN, 1000)).toHaveLength(2)
    expect(listEnvelopes(s, TOKEN, 1000)).toHaveLength(2) // still there
    expect(ackEnvelopes(s, ack(bob, ['aaaa1111']))).toBe(true)
    expect(listEnvelopes(s, TOKEN, 1000).map(e => e.id)).toEqual(['bbbb2222'])
  })

  it('ack with a forged/mismatched signature deletes nothing (no DoS by token-guessers)', () => {
    const s = createMailStore()
    putEnvelope(s, envelope('aaaa1111'), 1000)
    const eve = generateIdentity()
    // eve knows the token (it is public) but cannot sign for it:
    expect(ackEnvelopes(s, { ids: ['aaaa1111'], pubkey: eve.publicKeyHex, sig: 'ab'.repeat(64) })).toBe(false)
    // eve signs for HER token, not bob's:
    const eveToken = deliveryToken(eve.publicKeyHex)
    const forged = new TextEncoder().encode(`${TOKEN}|aaaa1111`)
    expect(ackEnvelopes(s, { ids: ['aaaa1111'], pubkey: eve.publicKeyHex, sig: Buffer.from(signMessage(forged, eve.privateKeyHex)).toString('hex') })).toBe(false)
    void eveToken
    expect(listEnvelopes(s, TOKEN, 1000)).toHaveLength(1)
  })

  it('TTL: envelopes past exp (or default horizon) are dropped', () => {
    const s = createMailStore({ defaultTtlMs: 5000 })
    putEnvelope(s, envelope('5h0r75h0'), 1000) // default horizon: 1000+5000 = 6000
    putEnvelope(s, { ...envelope('10ng10ng'), exp: 50000 }, 1000)
    expect(listEnvelopes(s, TOKEN, 7000).map(e => e.id)).toEqual(['10ng10ng'])
  })

  it('sweep garbage-collects expired mail across tokens', () => {
    const s = createMailStore({ defaultTtlMs: 1000 })
    putEnvelope(s, envelope('90ne90ne'), 0)
    putEnvelope(s, { ...envelope('ke97ke97'), exp: 999999 }, 0)
    sweepMail(s, 5000)
    expect(listEnvelopes(s, TOKEN, 5000).map(e => e.id)).toEqual(['ke97ke97'])
  })

  it('per-token and global caps bound memory (flooding resistance)', () => {
    const s = createMailStore({ maxPerToken: 3 })
    for (let i = 0; i < 10; i++) putEnvelope(s, envelope(`x${i}x${i}x${i}x${i}`), 1000)
    expect(listEnvelopes(s, TOKEN, 1000)).toHaveLength(3)
    const s2 = createMailStore({ maxTotal: 3 })
    for (let i = 0; i < 6; i++) {
      putEnvelope(s2, { ...envelope(`g${i}g${i}g${i}g${i}`), to: (OTHER[0] + i.toString(16) + OTHER.slice(2)) }, 1000)
    }
    expect(s2.size()).toBeLessThanOrEqual(3)
  })

  it('duplicate id under the same token is deduped (retry-safe sends)', () => {
    const s = createMailStore()
    expect(putEnvelope(s, envelope('d1pd1pd1p'), 1000)).toBe(true)
    expect(putEnvelope(s, envelope('d1pd1pd1p'), 1000)).toBe(true)
    expect(listEnvelopes(s, TOKEN, 1000)).toHaveLength(1)
  })

  it('rejects malformed envelopes (shape only — no content inspection)', () => {
    const s = createMailStore()
    expect(putEnvelope(s, { ...envelope('b1db1db1d'), v: 1 as 2 }, 0)).toBe(false)
    expect(putEnvelope(s, { ...envelope('b2db2db2d'), to: 'nothex' }, 0)).toBe(false)
    expect(putEnvelope(s, { ...envelope('b3db3db3d'), sealed: '' }, 0)).toBe(false)
    expect(putEnvelope(s, { ...envelope('b4db4db4d'), sealed: 'x'.repeat(400_000) }, 0)).toBe(false)
    expect(s.size()).toBe(0)
  })

  // Wave 2 (C2): rotating session tokens drain with epoch proof.
  it('ack of a session token requires the epoch it was derived with', () => {
    const epoch = 'c'.repeat(32)
    const sessionTok = sessionDeliveryToken(bob.publicKeyHex, epoch)
    const s = createMailStore()
    putEnvelope(s, { ...envelope('s1ess1on'), to: sessionTok }, 1000)
    expect(listEnvelopes(s, sessionTok, 1000)).toHaveLength(1)
    // right sig but no epoch => token derivation fails
    expect(ackEnvelopes(s, { ...ack(bob, ['s1ess1on'], sessionTok) })).toBe(false)
    // epoch present => drains
    expect(ackEnvelopes(s, { ...ack(bob, ['s1ess1on'], sessionTok), epoch })).toBe(true)
    expect(listEnvelopes(s, sessionTok, 1000)).toHaveLength(0)
    // wrong epoch never works
    putEnvelope(s, { ...envelope('s2ess2on'), to: sessionTok }, 1000)
    expect(ackEnvelopes(s, { ...ack(bob, ['s2ess2on'], sessionTok), epoch: 'd'.repeat(32) })).toBe(false)
  })
})
