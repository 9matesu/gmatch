import { describe, it, expect } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import {
  seal1to1,
  open1to1,
  sealGroup,
  openGroup,
  type EnvelopeKind,
} from './envelope'
import { deliveryToken } from './mail'

// ---- small local base64 (browser-safe; mirrors apps/desktop usage) ----
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function randomDek(): Uint8Array {
  const d = new Uint8Array(32)
  crypto.getRandomValues(d)
  return d
}

describe('sealed envelope v2 (blind-courier protocol)', () => {
  it('1:1 round-trip: recipient opens, learns sender pubkey + orbitId', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const env = seal1to1('hello bob', 'mail', alice, bob)

    // Wire shape: the courier sees ONLY routing metadata — never content.
    expect(env.v).toBe(2)
    expect(env.kind).toBe('mail')
    expect(env.to).toMatch(/^[0-9a-f]{64}$/)
    expect(env.sealed).not.toContain('hello')

    const opened = open1to1(env, bob.encryptionPrivHex)
    expect(opened.body).toBe('hello bob')
    expect(opened.senderPubHex).toBe(alice.publicKeyHex)
    expect(opened.senderOrbitId).toBe(alice.orbitId)
    expect(opened.id).toBe(env.id)
  })

  it('the courier / a third party without the recipient key cannot read', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const eve = generateIdentity()
    const env = seal1to1('secret', 'mail', alice, bob)
    expect(() => open1to1(env, eve.encryptionPrivHex)).toThrow()
  })

  it('tampered sealed bytes fail the AEAD tag', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const env = seal1to1('integrity', 'mail', alice, bob)
    const raw = base64ToBytes(env.sealed)
    raw[raw.length - 1] ^= 0x01
    expect(() => open1to1({ ...env, sealed: bytesToBase64(raw) }, bob.encryptionPrivHex)).toThrow()
  })

  it('rebinding attacks fail: flipping kind or to is covered by the signature', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const env = seal1to1('bound', 'mail', alice, bob)
    expect(() =>
      open1to1({ ...env, kind: 'report' as EnvelopeKind }, bob.encryptionPrivHex),
    ).toThrow(/signature/i)
    const other = generateIdentity()
    expect(() =>
      open1to1({ ...env, to: deliveryToken(other.publicKeyHex) }, bob.encryptionPrivHex),
    ).toThrow(/signature/i)
  })

  it('unknown version is rejected', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const env = seal1to1('v3?', 'mail', alice, bob)
    expect(() => open1to1({ ...env, v: 99 as 2 }, bob.encryptionPrivHex)).toThrow(/version/i)
  })

  it('ids are unique per envelope', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    expect(seal1to1('x', 'mail', alice, bob).id).not.toBe(
      seal1to1('x', 'mail', alice, bob).id,
    )
  })

  it('group (room) round-trip with a shared DEK', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const dek = randomDek()
    const env = sealGroup('room broadcast', 'announce', alice, 'room-42', dek)

    expect(env.sealed).not.toContain('broadcast')
    const fromAlice = openGroup(env, dek)
    expect(fromAlice.body).toBe('room broadcast')
    expect(fromAlice.senderOrbitId).toBe(alice.orbitId)

    const bobOpen = openGroup(sealGroup('yo', 'mail', bob, 'room-42', dek), dek)
    expect(bobOpen.senderOrbitId).toBe(bob.orbitId)

    // Non-holder cannot read; a different room id breaks the binding sig.
    expect(() => openGroup(env, randomDek())).toThrow()
    expect(() => openGroup({ ...env, to: 'other-room' }, dek)).toThrow(/signature/i)
  })

  it('binary-safe bodies round-trip', () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const bin = new Uint8Array([0, 255, 128, 1, 7])
    const env = seal1to1(bytesToBase64(bin), 'signal', alice, bob)
    const opened = open1to1(env, bob.encryptionPrivHex)
    expect(Array.from(base64ToBytes(opened.body))).toEqual(Array.from(bin))
    expect(opened.kind).toBe('signal')
  })
})
