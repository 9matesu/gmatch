// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { seal1to1, open1to1, deliveryToken } from '@orbit/protocol'
import {
  DmStore,
  DmManager,
  MAX_DM_TEXT,
  clampDmText,
  decodeBody,
  encodeAckBody,
  encodeDeleteBody,
  encodeDmBody,
  encodeEditBody,
  encodeReactBody,
  encodeReadBody,
  encodeTypingBody,
  type DmMessage,
} from './mail-dm'

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

  it('seals the sender name into the body so the peer needs no roster lookup', () => {
    // A DM thread can be read on a device that has never seen the peer, and
    // /api/users is a capped page — the name has to travel with the message or
    // the recipient renders "Unknown User".
    const msg: DmMessage = { id: 'm1', peerId: 'p', own: true, text: 'hey', ts: 1, status: 'sending', senderName: 'Kenny' }
    expect(decodeBody(encodeDmBody(msg))).toEqual({ t: 'dm', id: 'm1', text: 'hey', ts: 1, n: 'Kenny' })
  })

  it('trims the name and omits an empty one', () => {
    const padded: DmMessage = { id: 'm', peerId: 'p', own: true, text: 't', ts: 1, status: 'sending', senderName: '  Kenny  ' }
    expect(decodeBody(encodeDmBody(padded))).toMatchObject({ n: 'Kenny' })
    // Absent rather than '': the reader then resolves from its own roster
    // instead of overriding a name it already had.
    for (const senderName of ['', '   ', undefined]) {
      const m: DmMessage = { id: 'm', peerId: 'p', own: true, text: 't', ts: 1, status: 'sending', senderName }
      expect(decodeBody(encodeDmBody(m))).not.toHaveProperty('n')
    }
  })

  it('the inbound DM keeps the sender name from the sealed body', async () => {
    const { mgr, store } = managerFor(bob)
    const dmBody = encodeDmBody({
      id: 'in-1', peerId: bob.orbitId, own: true, text: 'hi', ts: 42, status: 'sent', senderName: 'Alice',
    })
    const env = seal1to1(dmBody, 'mail', alice, bob)
    const { open1to1 } = await import('@orbit/protocol')
    mgr.handleOpened(open1to1(env, bob.encryptionPrivHex), env)
    expect(store.thread(alice.orbitId)[0].senderName).toBe('Alice')
  })

  it('a DM from an older client (no name) decodes and is stored unchanged', async () => {
    // Backwards compatibility: pre-change bodies carry no `n`, and the reader
    // falls back to its roster exactly as before.
    const { mgr, store } = managerFor(bob)
    const dmBody = encodeDmBody({ id: 'in-2', peerId: bob.orbitId, own: true, text: 'old', ts: 7, status: 'sent' })
    const env = seal1to1(dmBody, 'mail', alice, bob)
    const { open1to1 } = await import('@orbit/protocol')
    mgr.handleOpened(open1to1(env, bob.encryptionPrivHex), env)
    expect(store.thread(alice.orbitId)[0].text).toBe('old')
    expect(store.thread(alice.orbitId)[0].senderName).toBeUndefined()
  })

  it('send() stamps the name it was given onto the body and the local copy', async () => {
    const { mgr, mail, store } = managerFor(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    const msg = await mgr.send(bob.orbitId, 'hey', undefined, 'Alice')
    expect(decodeBody(mail.sent[0].body)).toMatchObject({ n: 'Alice' })
    expect(store.thread(bob.orbitId)[0].senderName).toBe('Alice')
    expect(msg.senderName).toBe('Alice')
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

  it('thread history persists in localStorage and only trims past the storage backstop', () => {
    // The cap is a localStorage backstop, not a retention policy — DM history
    // is meant to be permanent. It dropped the OLDEST rows, the half anyone
    // would miss, and at 500 it was cutting real history in an active thread
    // long before the browser's ~5MB origin ceiling was anywhere near.
    const store = new DmStore(alice)
    for (let i = 0; i < 2100; i++) store.appendLocal({ id: `m${i}`, peerId: 'p', own: true, text: 'x', ts: i, status: 'sent' })
    const t = store.thread('p')
    expect(t).toHaveLength(2000)
    expect(t[0].id).toBe('m100') // oldest dropped, newest kept
    // survives reload (fresh instance reading the same localStorage):
    expect(new DmStore(alice).thread('p')).toHaveLength(2000)
  })
})

// ─── Message events: reply, edit, delete, reactions, receipts, typing ───────

/** Alice seals a body to bob; returns the envelope + bob's opened copy. */
function fromAlice(body: string) {
  const env = seal1to1(body, 'mail', alice, bob)
  return { env, opened: open1to1(env, bob.encryptionPrivHex) }
}

/** Bob seals a body to alice (acks, read watermarks, his own DMs). */
function fromBob(body: string) {
  const env = seal1to1(body, 'mail', bob, alice)
  return { env, opened: open1to1(env, alice.encryptionPrivHex) }
}

function deliverAlice(mgr: DmManager, body: string) {
  const { opened, env } = fromAlice(body)
  return mgr.handleOpened(opened as never, env as never)
}

function deliverBob(mgr: DmManager, body: string) {
  const { opened, env } = fromBob(body)
  return mgr.handleOpened(opened as never, env as never)
}

describe('DM event codec', () => {
  it('round-trips every kind', () => {
    expect(decodeBody(encodeReadBody('m1', 900))).toEqual({ t: 'dm_read', id: 'm1', upTo: 900 })
    expect(decodeBody(encodeEditBody('m1', 'fixed', 12))).toEqual({ t: 'dm_edit', id: 'm1', text: 'fixed', ts: 12 })
    expect(decodeBody(encodeDeleteBody('m1', 12))).toEqual({ t: 'dm_del', id: 'm1', ts: 12 })
    expect(decodeBody(encodeReactBody('m1', '🔥', 'add', 12))).toEqual({ t: 'dm_react', id: 'm1', emoji: '🔥', op: 'add', ts: 12 })
    expect(decodeBody(encodeTypingBody(12))).toEqual({ t: 'dm_typing', at: 12 })
  })

  it('carries a reply reference and an epoch', () => {
    const msg: DmMessage = { id: 'm2', peerId: 'p', own: true, text: 're', ts: 3, status: 'sent', replyToId: 'm1' }
    expect(decodeBody(encodeDmBody(msg, 'a'.repeat(32)))).toEqual({ t: 'dm', id: 'm2', text: 're', ts: 3, e: 'a'.repeat(32), r: 'm1' })
  })

  it('rejects malformed events instead of half-applying them', () => {
    expect(decodeBody(JSON.stringify({ t: 'dm_read', id: 'm' }))).toBeNull()
    expect(decodeBody(JSON.stringify({ t: 'dm_edit', id: 'm', ts: 1 }))).toBeNull()
    expect(decodeBody(JSON.stringify({ t: 'dm_react', id: 'm', emoji: '🔥', op: 'toggle', ts: 1 }))).toBeNull()
    expect(decodeBody(JSON.stringify({ t: 'dm_react', id: 'm', emoji: 'x'.repeat(40), op: 'add', ts: 1 }))).toBeNull()
    expect(decodeBody(JSON.stringify({ t: 'dm_typing' }))).toBeNull()
    expect(decodeBody(JSON.stringify({ t: 'dm_future_kind', id: 'm' }))).toBeNull()
  })

  it('clamps outbound text to the body budget', () => {
    expect(clampDmText('x'.repeat(MAX_DM_TEXT + 50))).toHaveLength(MAX_DM_TEXT)
    const msg: DmMessage = { id: 'm', peerId: 'p', own: true, text: 'y'.repeat(MAX_DM_TEXT + 5), ts: 1, status: 'sending' }
    expect((decodeBody(encodeDmBody(msg)) as { text: string }).text).toHaveLength(MAX_DM_TEXT)
  })
})

describe('DM reply, edit, delete, reactions, receipts, typing', () => {
  beforeEach(() => localStorage.clear())

  it('stores the reply reference and keeps it across persistence', () => {
    const { mgr, store } = managerFor(bob)
    deliverAlice(mgr, encodeDmBody({
      id: 'in-9', peerId: bob.orbitId, own: true, text: 'reply', ts: 50, status: 'sent', replyToId: 'orig-1',
    }))
    expect(new DmStore(bob).thread(alice.orbitId)[0].replyToId).toBe('orig-1')
    expect(store.thread(alice.orbitId)[0].replyToId).toBe('orig-1')
  })

  it('applies a remote edit and marks the message edited', () => {
    const { mgr, store } = managerFor(bob)
    deliverAlice(mgr, encodeDmBody({ id: 'e1', peerId: bob.orbitId, own: true, text: 'typo', ts: 10, status: 'sent' }))
    deliverAlice(mgr, encodeEditBody('e1', 'fixed', 20))
    const m = store.thread(alice.orbitId).find((x) => x.id === 'e1')
    expect(m?.text).toBe('fixed')
    expect(m?.editedTs).toBe(20)
  })

  it('ignores a stale edit and an edit of our own message', () => {
    const { mgr, store } = managerFor(bob)
    deliverAlice(mgr, encodeDmBody({ id: 'e2', peerId: bob.orbitId, own: true, text: 'v2', ts: 10, status: 'sent' }))
    deliverAlice(mgr, encodeEditBody('e2', 'v3', 30))
    deliverAlice(mgr, encodeEditBody('e2', 'old', 20))
    expect(store.thread(alice.orbitId).find((x) => x.id === 'e2')?.text).toBe('v3')

    // A row WE authored must never mutate from an inbound edit.
    store.appendLocal({ id: 'mine', peerId: alice.orbitId, own: true, text: 'mine', ts: 40, status: 'sent' })
    deliverAlice(mgr, encodeEditBody('mine', 'hijacked', 99))
    expect(store.thread(alice.orbitId).find((x) => x.id === 'mine')?.text).toBe('mine')
  })

  it('removes a deleted message but keeps a tombstone, so a replay cannot resurrect it', () => {
    const { mgr, store } = managerFor(bob)
    const original = encodeDmBody({ id: 'd1', peerId: bob.orbitId, own: true, text: 'secret', ts: 10, status: 'sent' })
    deliverAlice(mgr, original)
    deliverAlice(mgr, encodeDeleteBody('d1', 20))
    const tomb = store.thread(alice.orbitId).find((x) => x.id === 'd1')
    expect(tomb?.deletedTs).toBeTruthy()
    expect(tomb?.text).toBe('')

    // The courier still holds the original until the peer acks it: replaying
    // it must not bring the content back.
    deliverAlice(mgr, original)
    expect(store.thread(alice.orbitId).find((x) => x.id === 'd1')?.text).toBe('')
  })

  it('deletes an id it never saw by writing a stub, blocking the late original', () => {
    const { mgr, store } = managerFor(bob)
    deliverAlice(mgr, encodeDeleteBody('ghost', 5))
    deliverAlice(mgr, encodeDmBody({ id: 'ghost', peerId: bob.orbitId, own: true, text: 'late', ts: 4, status: 'sent' }))
    expect(store.thread(alice.orbitId)).toHaveLength(1)
    expect(store.thread(alice.orbitId)[0].text).toBe('')
  })

  it('refuses an inbound delete for a message we authored', () => {
    const { mgr, store } = managerFor(alice)
    store.appendLocal({ id: 'ours', peerId: bob.orbitId, own: true, text: 'ours', ts: 10, status: 'delivered' })
    deliverBob(mgr, encodeDeleteBody('ours', 20))
    expect(store.thread(bob.orbitId)[0].deletedTs).toBeUndefined()
  })

  it('aggregates reactions as a set per emoji (retries cannot double-count)', () => {
    const { mgr, store } = managerFor(bob)
    deliverAlice(mgr, encodeDmBody({ id: 'r1', peerId: bob.orbitId, own: true, text: 'x', ts: 10, status: 'sent' }))
    deliverAlice(mgr, encodeReactBody('r1', '🔥', 'add', 11))
    deliverAlice(mgr, encodeReactBody('r1', '🔥', 'add', 12))
    expect(store.thread(alice.orbitId).find((x) => x.id === 'r1')?.reactions).toEqual({ '🔥': [alice.orbitId] })
    deliverAlice(mgr, encodeReactBody('r1', '🔥', 'remove', 13))
    expect(store.thread(alice.orbitId).find((x) => x.id === 'r1')?.reactions).toBeUndefined()
  })

  it('local reaction is optimistic and reverts when the peer is unreachable', async () => {
    const { mgr, store } = managerFor(alice)
    // No peer keys cached -> sendBody rejects.
    store.appendLocal({ id: 'out-r', peerId: bob.orbitId, own: true, text: 'x', ts: 1, status: 'sent' })
    expect(await mgr.react(bob.orbitId, 'out-r', '👍', true)).toBe(false)
    expect(store.thread(bob.orbitId)[0].reactions).toBeUndefined()
  })

  it('a read watermark marks our messages seen, idempotently', () => {
    const { mgr, store } = managerFor(alice)
    store.appendLocal({ id: 'o1', peerId: bob.orbitId, own: true, text: 'one', ts: 10, status: 'delivered' })
    store.appendLocal({ id: 'o2', peerId: bob.orbitId, own: true, text: 'two', ts: 20, status: 'delivered' })
    deliverBob(mgr, encodeReadBody('o1', 10))
    expect(store.thread(bob.orbitId)[0].readTs).toBe(10)
    expect(store.thread(bob.orbitId)[1].readTs).toBeUndefined()
    deliverBob(mgr, encodeReadBody('o2', 20))
    deliverBob(mgr, encodeReadBody('o2', 20))
    expect(store.thread(bob.orbitId).map((m) => m.readTs)).toEqual([20, 20])
  })

  it('sends at most one read watermark per advance', () => {
    vi.useFakeTimers()
    try {
      const { mgr, mail, store } = managerFor(alice)
      store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
      // The watermark references THEIR message that we viewed.
      store.appendLocal({ id: 'in-1', peerId: bob.orbitId, own: false, text: 'theirs', ts: 10, status: 'delivered' })
      mgr.markRead(bob.orbitId, 10)
      mgr.markRead(bob.orbitId, 10)
      expect(mail.sent).toHaveLength(1)
      expect(decodeBody(mail.sent[0].body)).toEqual({ t: 'dm_read', id: 'in-1', upTo: 10 })
      mgr.markRead(bob.orbitId, 5) // going backwards is not evidence
      expect(mail.sent).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('typing is throttled, expires, and is never persisted', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const { mgr, mail, store } = managerFor(alice)
      store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
      mgr.type(bob.orbitId)
      expect(mail.sent).toHaveLength(1)
      expect(decodeBody(mail.sent[0].body)?.t).toBe('dm_typing')
      vi.setSystemTime(2_000)
      mgr.type(bob.orbitId) // inside the 3s throttle
      expect(mail.sent).toHaveLength(1)
      vi.setSystemTime(4_100)
      mgr.type(bob.orbitId)
      expect(mail.sent).toHaveLength(2)
      expect(store.thread(bob.orbitId)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers typing to the UI callback without storing a message', () => {
    const onTyping = vi.fn()
    const store = new DmStore(bob)
    const mgr = new DmManager({ mail: fakeMail() as any, store, identity: bob, onThreadChanged: () => {}, onTyping })
    deliverAlice(mgr, encodeTypingBody(777))
    expect(onTyping).toHaveBeenCalledWith(alice.orbitId, 777)
    expect(store.thread(alice.orbitId)).toHaveLength(0)
  })

  it('local edit reverts when the peer cannot be reached', async () => {
    const { mgr, store } = managerFor(alice)
    store.appendLocal({ id: 'e-out', peerId: bob.orbitId, own: true, text: 'before', ts: 1, status: 'sent' })
    expect(await mgr.edit(bob.orbitId, 'e-out', 'after')).toBe(false)
    expect(store.thread(bob.orbitId)[0].text).toBe('before')
    expect(store.thread(bob.orbitId)[0].editedTs).toBeUndefined()
  })

  it('local edit succeeds and persists the new text when the peer is reachable', async () => {
    const { mgr, mail, store } = managerFor(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    store.appendLocal({ id: 'e-ok', peerId: bob.orbitId, own: true, text: 'before', ts: 1, status: 'sent' })
    expect(await mgr.edit(bob.orbitId, 'e-ok', 'after')).toBe(true)
    expect(store.thread(bob.orbitId)[0].text).toBe('after')
    expect(decodeBody(mail.sent[0].body)?.t).toBe('dm_edit')
  })

  it('cannot edit a message we did not author', async () => {
    const { mgr, store } = managerFor(bob)
    store.appendLocal({ id: 'in-x', peerId: alice.orbitId, own: false, text: 'theirs', ts: 1, status: 'delivered' })
    expect(await mgr.edit(alice.orbitId, 'in-x', 'mine now')).toBe(false)
  })

  it('delete-for-me hides locally without notifying the peer', async () => {
    const { mgr, mail, store } = managerFor(alice)
    store.rememberPeer(bob.orbitId, { publicKeyHex: bob.publicKeyHex, encryptionPubHex: bob.encryptionPubHex })
    store.appendLocal({ id: 'l1', peerId: bob.orbitId, own: true, text: 'oops', ts: 5, status: 'delivered' })
    expect(await mgr.remove(bob.orbitId, 'l1', { forEveryone: false })).toBe(true)
    expect(mail.sent).toHaveLength(0)
    expect(store.thread(bob.orbitId)[0].deletedTs).toBeTruthy()
  })
})

