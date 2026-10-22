import { describe, expect, it } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import {
  createSwarmDek,
  createSwarmOffer,
  decryptSwarmChunk,
  encryptSwarmChunk,
  openSwarmKey,
  sealSwarmKey,
  swarmChunkAad,
} from './swarm-chunk'

const CTX = {
  objectId: 'a'.repeat(64),
  index: 2,
  total: 7,
  transferId: 'b'.repeat(32),
  senderOrbitId: 'c'.repeat(64),
  receiverOfferPub: 'd'.repeat(64),
}

describe('swarm chunk encryption (swarm-v1)', () => {
  it('round-trips a chunk through the transfer DEK', () => {
    const dek = createSwarmDek()
    const plaintext = new TextEncoder().encode('image-bytes-⌘')
    const { nonce, ciphertext } = encryptSwarmChunk(dek, plaintext, CTX)
    expect(ciphertext).not.toEqual(plaintext)
    const back = decryptSwarmChunk(dek, nonce, ciphertext, CTX)
    expect(back).toEqual(plaintext)
  })

  it('ciphertext carries no plaintext and differs for fresh nonces', () => {
    const dek = createSwarmDek()
    const plaintext = new Uint8Array(64).fill(7)
    const a = encryptSwarmChunk(dek, plaintext, CTX)
    const b = encryptSwarmChunk(dek, plaintext, CTX)
    expect(Array.from(a.nonce)).not.toEqual(Array.from(b.nonce))
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext))
    // both still decrypt to the same bytes
    expect(decryptSwarmChunk(dek, a.nonce, a.ciphertext, CTX)).toEqual(plaintext)
    expect(decryptSwarmChunk(dek, b.nonce, b.ciphertext, CTX)).toEqual(plaintext)
  })

  it('rejects a tampered ciphertext', () => {
    const dek = createSwarmDek()
    const { nonce, ciphertext } = encryptSwarmChunk(dek, new Uint8Array(32), CTX)
    const flipped = new Uint8Array(ciphertext)
    flipped[0] ^= 1
    expect(() => decryptSwarmChunk(dek, nonce, flipped, CTX)).toThrow()
  })

  it('rejects the wrong key', () => {
    const { nonce, ciphertext } = encryptSwarmChunk(createSwarmDek(), new Uint8Array(32), CTX)
    expect(() => decryptSwarmChunk(createSwarmDek(), nonce, ciphertext, CTX)).toThrow()
  })

  it('rejects a chunk moved to another position of the object', () => {
    const dek = createSwarmDek()
    const { nonce, ciphertext } = encryptSwarmChunk(dek, new Uint8Array(32), CTX)
    expect(() => decryptSwarmChunk(dek, nonce, ciphertext, { ...CTX, index: 3 })).toThrow()
  })

  it('rejects a chunk moved to another object', () => {
    const dek = createSwarmDek()
    const { nonce, ciphertext } = encryptSwarmChunk(dek, new Uint8Array(32), CTX)
    expect(() =>
      decryptSwarmChunk(dek, nonce, ciphertext, { ...CTX, objectId: 'e'.repeat(64) }),
    ).toThrow()
  })

  it('rejects a chunk replayed to another transfer', () => {
    const dek = createSwarmDek()
    const { nonce, ciphertext } = encryptSwarmChunk(dek, new Uint8Array(32), CTX)
    expect(() =>
      decryptSwarmChunk(dek, nonce, ciphertext, { ...CTX, transferId: 'f'.repeat(32) }),
    ).toThrow()
  })

  it('rejects a chunk delivered to a different receiver', () => {
    const dek = createSwarmDek()
    const { nonce, ciphertext } = encryptSwarmChunk(dek, new Uint8Array(32), CTX)
    expect(() =>
      decryptSwarmChunk(dek, nonce, ciphertext, { ...CTX, receiverOfferPub: 'e'.repeat(64) }),
    ).toThrow()
  })

  it('binds the AAD to every context field', () => {
    const one = swarmChunkAad(CTX)
    expect(one.length).toBeGreaterThan(0)
    for (const key of ['objectId', 'transferId', 'senderOrbitId', 'receiverOfferPub'] as const) {
      const other = swarmChunkAad({ ...CTX, [key]: '1'.repeat(CTX[key].length) })
      expect(Array.from(other)).not.toEqual(Array.from(one))
    }
    expect(Array.from(swarmChunkAad({ ...CTX, index: CTX.index + 1 }))).not.toEqual(Array.from(one))
    expect(Array.from(swarmChunkAad({ ...CTX, total: CTX.total + 1 }))).not.toEqual(Array.from(one))
  })
})

describe('swarm transfer key (sealed DEK)', () => {
  it('a requester opens the DEK; a third party cannot', () => {
    const offer = createSwarmOffer()
    const dek = createSwarmDek()
    const wrapped = sealSwarmKey(dek, offer.publicKeyHex)
    expect(openSwarmKey(wrapped, offer.privateKeyHex)).toEqual(dek)

    const outsider = generateIdentity()
    expect(() => openSwarmKey(wrapped, outsider.encryptionPrivHex)).toThrow()
  })

  it('rejects tampering with the wrapped key', () => {
    const offer = createSwarmOffer()
    const wrapped = sealSwarmKey(createSwarmDek(), offer.publicKeyHex)
    const flipped = new Uint8Array(wrapped)
    flipped[wrapped.length - 1] ^= 1
    expect(() => openSwarmKey(flipped, offer.privateKeyHex)).toThrow()
  })

  it('the wrapped key leaks nothing about the DEK between transfers', () => {
    const offer = createSwarmOffer()
    const a = sealSwarmKey(createSwarmDek(), offer.publicKeyHex)
    const b = sealSwarmKey(createSwarmDek(), offer.publicKeyHex)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})
