import { describe, it, expect } from 'vitest'
import { deliveryToken, sessionDeliveryToken } from '@orbit/protocol'
import { generateIdentity } from '@orbit/crypto'
import { rotateEpoch, isEpoch, watchedTokens, peerAddressToken, type EpochState } from './handleRotation'

const PUB = generateIdentity().publicKeyHex

describe('handle rotation (wave 2 C2)', () => {
  it('session token is stable, differs per epoch, and != home token', () => {
    const a = sessionDeliveryToken(PUB, '1'.repeat(32))
    const b = sessionDeliveryToken(PUB, '1'.repeat(32))
    const c = sessionDeliveryToken(PUB, '2'.repeat(32))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(deliveryToken(PUB))
  })

  it('rotate keeps one boot of overlap', () => {
    const first = rotateEpoch(null)
    expect(isEpoch(first.cur)).toBe(true)
    const second = rotateEpoch(first)
    expect(second.prev).toBe(first.cur)
    expect(second.cur).not.toBe(first.cur)
  })

  it('watched tokens include home + cur + prev, no empties', () => {
    const st: EpochState = { cur: 'a'.repeat(32), prev: '' }
    const list = watchedTokens('home', st)
    expect(list).toEqual(['home', 'a'.repeat(32)])
  })

  it('peer addressing falls back to home without a valid epoch', () => {
    const home = (p: string) => deliveryToken(p)
    expect(peerAddressToken({ publicKeyHex: PUB, encryptionPubHex: '' }, home)).toBe(home(PUB))
    expect(peerAddressToken({ publicKeyHex: PUB, encryptionPubHex: '', epoch: 'nope' }, home)).toBe(home(PUB))
    expect(peerAddressToken({ publicKeyHex: PUB, encryptionPubHex: '', epoch: 'f'.repeat(32) }, home))
      .toBe(sessionDeliveryToken(PUB, 'f'.repeat(32)))
  })
})
