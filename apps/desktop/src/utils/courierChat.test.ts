import { describe, expect, it } from 'vitest'
import type { DmMessage } from './mail-dm'
import { courierThreadToChatMessages } from './courierChat'

const self = 'self-id'
const peer = 'peer-id'

const msg = (over: Partial<DmMessage>): DmMessage => ({
  id: 'm1',
  peerId: peer,
  own: false,
  text: 'hello',
  ts: 1_000,
  status: 'delivered',
  ...over,
})

const run = (thread: DmMessage[]) =>
  courierThreadToChatMessages({
    thread,
    peerId: peer,
    selfId: self,
    resolveName: (payloadName, senderId) => payloadName || (senderId === self ? 'Me' : 'Peer'),
  })

describe('courierThreadToChatMessages', () => {
  it('maps the author from the direction flag', () => {
    const [inbound, outbound] = run([msg({}), msg({ id: 'm2', own: true, text: 'mine' })])
    expect(inbound.senderId).toBe(peer)
    expect(outbound.senderId).toBe(self)
  })

  it('does not call a delivered message "seen"', () => {
    const [row] = run([msg({ own: true, status: 'delivered' })])
    expect(row.courierStatus).toBe('delivered')
    expect(row.readByRecipient).toBe(false)
  })

  it('marks seen only when the read watermark covers the message', () => {
    const [row] = run([msg({ own: true, ts: 500, readTs: 500 })])
    expect(row.readByRecipient).toBe(true)
    const [stale] = run([msg({ own: true, ts: 900, readTs: 500 })])
    expect(stale.readByRecipient).toBe(false)
  })

  it('carries tombstones and reactions through', () => {
    const [row] = run([msg({ text: '', deletedTs: 2_000, reactions: undefined })])
    expect(row.deletedAt).toBe(2_000)
    const [reacted] = run([msg({ reactions: { '🔥': [self] } })])
    expect(reacted.reactions).toEqual({ '🔥': [self] })
  })

  it('carries reply and edit metadata', () => {
    const [row] = run([msg({ replyToId: 'm0', editedTs: 2_000 })])
    expect(row.replyToId).toBe('m0')
    expect(row.editedAt).toBe(new Date(2_000).toISOString())
  })

  it('tolerates a missing thread', () => {
    expect(courierThreadToChatMessages({ thread: undefined, peerId: peer, selfId: self, resolveName: () => 'x' })).toEqual([])
  })
})
