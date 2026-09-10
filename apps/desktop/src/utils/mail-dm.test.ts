// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { seal1to1, deliveryToken } from '@orbit/protocol'
import { DmStore, DmManager, encodeDmBody, encodeAckBody, decodeBody, type DmMessage } from './mail-dm'

// jsdom in this repo does not expose localStorage; stub it like the other
// persistence tests (onboardingState.test.ts pattern).
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage

const alice = generateIdentity()
const bob = generateIdentity()

function fakeMail() {
  const sent: Array<{ body: string; recipient: { publicKeyHex: string; encryptionPubHex: string } }> = []
  return {
    sent,
    send: vi.fn(async (body: string, _kind: string, recipient: { publicKeyHex: string; encryptionPubHex: string }) => {
      sent.push({ body, recipient })
      return { v: 2 as const, kind: 'mail' as const, to: deliveryToken(recipient.publicKeyHex), id: 'env-' + sent.length, sealed: 'x', fromEph: alice.encryptionPubHex }
    }),
  }
}

function managerFor(identity: typeof alice) {
  localStorage.clear()
  const store = new DmStore(identity)
  const mail = fakeMail()
  const changed = vi.fn()
  const mgr = new DmManager({ mail: mail as any, store, identity, onThreadChanged: changed })
  return { mgr, mail, store, changed }
}

describe('mail DM layer (courier-only, local source of truth)', () => {
  beforeEach(() => localStorage.clear())

  it('encode/decode round-trips dm + ack bodies', () => {
    const msg: DmMessage = { id: 'm1', peerId: 'p', own: true, text: 'hey', ts: 123, status: 'sending' }
    expect(decodeBody(encodeDmBody(msg))).toEqual({ t: 'dm', id: 'm1', text: 'hey', ts: 123 })
    expect(decodeBody(encodeAckBody('m1'))).toEqual({ t: 'dm_ack', id: 'm1' })
    expect(decodeBody('{"t":"signal","id":"x"}')).toBeNull()
    expect(decodeBody('not json')).toBeNull()
  })

  it('send() appends optimistically, seals to the known peer key, marks sent', async () => {
    const { mgr, mail, store, changed } = managerFor(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    const msg = await mgr.send(bob.orbitId, 'secret hello')
    expect(msg.status).toBe('sent')
    expect(store.thread(bob.orbitId)).toHaveLength(1)
    expect(changed).toHaveBeenCalled()
    expect(mail.sent).toHaveLength(1)
    // The seal happens INSIDE MailClient.send; the DM layer hands it the
    // structured body to seal (wire-confidentiality is asserted in
    // mail-client.test.ts). Here: correct recipient + correct payload shape.
    expect(decodeBody(mail.sent[0].body)).toEqual({ t: 'dm', id: msg.id, text: 'secret hello', ts: msg.ts })
    expect(mail.sent[0].recipient.publicKeyHex).toBe(bob.publicKeyHex)
  })

  it('send() without a known peer key fails LOUDLY (held locally, no silent loss)', async () => {
    const { mgr, store } = managerFor(alice)
    const msg = await mgr.send(bob.orbitId, 'into the void')
    expect(msg.status).toBe('failed')
    expect(store.thread(bob.orbitId)[0].status).toBe('failed')
  })

  it('handleOpened(dm) appends the inbound, then returns a sealed ack to the sender', async () => {
    const { mgr, mail, store } = managerFor(bob)
    // Alice actually seals a DM to bob through the protocol; bob opens it:
    const dmBody = encodeDmBody({ id: 'in-1', peerId: bob.orbitId, own: true, text: 'from alice', ts: 42, status: 'sent' })
    const env = seal1to1(dmBody, 'mail', alice, bob)
    const { open1to1 } = await import('@orbit/protocol')
    const opened = open1to1(env, bob.encryptionPrivHex)
    mgr.handleOpened(opened, env)

    expect(store.thread(alice.orbitId)).toHaveLength(1)
    expect(store.thread(alice.orbitId)[0].text).toBe('from alice')
    expect(store.thread(alice.orbitId)[0].status).toBe('delivered')
    // ACK sent back sealed-to-alice via her fromEph on the envelope:
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].recipient.publicKeyHex).toBe(alice.publicKeyHex)
    expect(mail.sent[0].recipient.encryptionPubHex).toBe(alice.encryptionPubHex)
    expect(decodeBody(mail.sent[0].body)).toEqual({ t: 'dm_ack', id: 'in-1' })
    // TOFU: peer keys cached for reply
    expect(store.peerKeys(alice.orbitId)?.encryptionPubHex).toBe(alice.encryptionPubHex)
  })

  it('duplicate inbound ids are ignored (no double bubbles)', () => {
    const { mgr, store, mail } = managerFor(bob)
    const env = { v: 2 as const, kind: 'mail' as const, to: 'x', id: 'e1', sealed: 's', fromEph: alice.encryptionPubHex }
    const opened = { kind: 'mail', id: 'e1', to: 'x', body: JSON.stringify({ t: 'dm', id: 'dup-1', text: 'hi', ts: 1 }), senderPubHex: alice.publicKeyHex, senderOrbitId: alice.orbitId }
    mgr.handleOpened(opened as any, env as any)
    mgr.handleOpened(opened as any, env as any)
    expect(store.thread(alice.orbitId)).toHaveLength(1)
    expect(mail.sent).toHaveLength(1) // ack once
  })

  it('handleOpened(dm_ack) marks the own message delivered', () => {
    const { mgr, store } = managerFor(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    const msg = { id: 'out-9', peerId: bob.orbitId, own: true, text: 'ping', ts: 5, status: 'sent' as const }
    store.appendLocal(msg)
    const env = { v: 2 as const, kind: 'mail' as const, to: 'x', id: 'e9', sealed: 's', fromEph: bob.encryptionPubHex }
    const opened = { kind: 'mail', id: 'e9', to: 'x', body: encodeAckBody('out-9'), senderPubHex: bob.publicKeyHex, senderOrbitId: bob.orbitId }
    mgr.handleOpened(opened as any, env as any)
    expect(store.thread(bob.orbitId).find(m => m.id === 'out-9')?.status).toBe('delivered')
  })

  it('non-dm bodies (signal/announce envelopes) are ignored', () => {
    const { mgr, store } = managerFor(bob)
    const env = { v: 2 as const, kind: 'signal' as const, to: 'x', id: 'e1', sealed: 's' }
    const opened = { kind: 'signal', id: 'e1', to: 'x', body: JSON.stringify({ type: 'offer' }), senderPubHex: alice.publicKeyHex, senderOrbitId: alice.orbitId }
    mgr.handleOpened(opened as any, env as any)
    expect(Object.keys(store.threads())).toHaveLength(0)
  })

  it('thread history persists in localStorage and caps at 500', () => {
    const store = new DmStore(alice)
    for (let i = 0; i < 520; i++) store.appendLocal({ id: `m${i}`, peerId: 'p', own: true, text: 'x', ts: i, status: 'sent' })
    const t = store.thread('p')
    expect(t).toHaveLength(500)
    expect(t[0].id).toBe('m20') // oldest dropped, newest kept
    // survives reload (fresh instance reading the same localStorage):
    expect(new DmStore(alice).thread('p')).toHaveLength(500)
  })
})
