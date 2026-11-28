import { describe, it, expect } from 'vitest'
import {
  isRelayableSwarmFrame,
  parseBareSwarmAnnounce,
  parseSwarmEnvelope,
  parseSwarmFrame,
  SWARM_MAX_CHUNK_BASE64,
} from './swarm-frame'

// The swarm contract is shared by the node (which decides what it carries)
// and the client (which builds and accepts these frames). One definition, so
// the two ends cannot disagree about what a frame is.

describe('isRelayableSwarmFrame (the node allowlist)', () => {
  it('carries the byte-protocol frames', () => {
    expect(isRelayableSwarmFrame({ type: 'SWARM_WANT', id: 'obj-1' })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_HAVE', ids: ['obj-1'] })).toBe(true)
    expect(isRelayableSwarmFrame({
      type: 'SWARM_CHUNK', id: 'obj-1', index: 0, total: 2, mimeType: 'image/jpeg', dataBase64: 'AAAA',
    })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_KEY', id: 'obj-1', transferId: 'ab12', wrapped: 'sealed' })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_CHALLENGE', id: 'obj-1', challenge: 'c' })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_RECEIPT', id: 'obj-1', receipt: { sig: 'x' } })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_OP', operation: { id: 'op-1' } })).toBe(true)
    expect(isRelayableSwarmFrame({ type: 'SWARM_OP_ACK', operationId: 'op-1', actorId: 'u1' })).toBe(true)
    expect(isRelayableSwarmFrame({
      type: 'SWARM_DM',
      envelope: { v: 2, kind: 'mail', to: 'tok', id: 'env-1', sealed: 'AAAA', fromEph: 'eph' },
    })).toBe(true)
  })

  it('carries the announcement envelopes', () => {
    for (const type of ['IMAGE_ANNOUNCE', 'MESSAGE', 'STORY_ANNOUNCE', 'CHAT', 'PRESENCE']) {
      expect(isRelayableSwarmFrame({ type })).toBe(true)
    }
  })

  it('refuses anything that could shadow a server event (audit A2)', () => {
    expect(isRelayableSwarmFrame({ type: 'feed' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'user_banned' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_EVIL' })).toBe(false)
    expect(isRelayableSwarmFrame(null)).toBe(false)
    expect(isRelayableSwarmFrame('SWARM_WANT')).toBe(false)
  })

  it('refuses a frame that does not fit its declared shape', () => {
    // A WANT without an id names nothing.
    expect(isRelayableSwarmFrame({ type: 'SWARM_WANT' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_HAVE', ids: 'obj-1' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_HAVE', ids: [42] })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_KEY', id: 'o', transferId: 't' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_RECEIPT', id: 'o' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_OP' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_OP_ACK', operationId: 'op' })).toBe(false)
    // A DM without a well-formed sealed envelope is refused.
    expect(isRelayableSwarmFrame({ type: 'SWARM_DM' })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_DM', envelope: { v: 2, kind: 'mail' } })).toBe(false)
    expect(isRelayableSwarmFrame({ type: 'SWARM_DM', envelope: { v: 1, kind: 'mail', to: 't', id: 'i', sealed: 's' } })).toBe(false)
  })

  it('refuses a chunk whose index does not belong to its total', () => {
    const chunk = { type: 'SWARM_CHUNK', id: 'o', index: 5, total: 2, mimeType: 'image/jpeg', dataBase64: 'AAAA' }
    expect(isRelayableSwarmFrame(chunk)).toBe(false)
    expect(isRelayableSwarmFrame({ ...chunk, index: 1 })).toBe(true)
  })

  it('refuses an unbounded chunk (the relay is an amplification vector)', () => {
    const chunk = {
      type: 'SWARM_CHUNK', id: 'o', index: 0, total: 1, mimeType: 'image/jpeg',
      dataBase64: 'A'.repeat(SWARM_MAX_CHUNK_BASE64 + 4),
    }
    expect(isRelayableSwarmFrame(chunk)).toBe(false)
    expect(isRelayableSwarmFrame({ ...chunk, dataBase64: 'AAAA' })).toBe(true)
  })
})

describe('parseSwarmFrame', () => {
  it('refuses anything that is not a frame', () => {
    expect(parseSwarmFrame(null)).toBeNull()
    expect(parseSwarmFrame('SWARM_WANT')).toBeNull()
    expect(parseSwarmFrame({ type: 'feed' })).toBeNull()
    expect(parseSwarmFrame({ type: 'PRESENCE' })).toBeNull()
  })

  it('drops a field whose type is wrong instead of coercing it', () => {
    const frame = parseSwarmFrame({ type: 'SWARM_WANT', id: 'o1', transferId: 7, offerPub: 'ab' })
    expect(frame).not.toBeNull()
    expect(frame!.type).toBe('SWARM_WANT')
    if (frame!.type !== 'SWARM_WANT') throw new Error('expected a want')
    expect(frame!.id).toBe('o1')
    expect(frame!.transferId).toBeUndefined()
    expect(frame!.offerPub).toBe('ab')
  })

  it('refuses a frame whose required field is missing', () => {
    expect(parseSwarmFrame({ type: 'SWARM_WANT' })).toBeNull()
    expect(parseSwarmFrame({ type: 'SWARM_CHUNK', id: 'o', index: 0, total: 1 })).toBeNull()
    expect(parseSwarmFrame({ type: 'SWARM_OP_ACK', operationId: 'op' })).toBeNull()
  })

  it('keeps the sealed-chunk markers', () => {
    const frame = parseSwarmFrame({
      type: 'SWARM_CHUNK', id: 'o', index: 0, total: 1, mimeType: 'image/jpeg',
      dataBase64: 'AAAA', enc: 'swarm-v1', transferId: 'ab12', nonce: 'ff',
    })
    expect(frame).not.toBeNull()
    if (frame!.type !== 'SWARM_CHUNK') throw new Error('expected a chunk')
    expect(frame!.enc).toBe('swarm-v1')
    expect(frame!.transferId).toBe('ab12')
    expect(frame!.nonce).toBe('ff')
  })

  it('refuses a HAVE whose ids are not all strings', () => {
    expect(parseSwarmFrame({ type: 'SWARM_HAVE', ids: ['a', 2] })).toBeNull()
    expect(parseSwarmFrame({ type: 'SWARM_HAVE', ids: ['a'] })).not.toBeNull()
  })

  it('narrows a sealed DM envelope, dropping a malformed one', () => {
    const frame = parseSwarmFrame({
      type: 'SWARM_DM',
      envelope: { v: 2, kind: 'mail', to: 'tok', id: 'env-1', sealed: 'AAAA', fromEph: 'eph', exp: 99 },
    })
    expect(frame).not.toBeNull()
    if (frame?.type !== 'SWARM_DM') throw new Error('expected a dm frame')
    expect(frame.envelope.kind).toBe('mail')
    expect(frame.envelope.to).toBe('tok')
    expect(frame.envelope.fromEph).toBe('eph')
    expect(frame.envelope.exp).toBe(99)
    // Wrong version / missing sealed are refused, never coerced.
    expect(parseSwarmFrame({ type: 'SWARM_DM', envelope: { v: 2, kind: 'mail', to: 't', id: 'i' } })).toBeNull()
    expect(parseSwarmFrame({ type: 'SWARM_DM', envelope: { v: 3, kind: 'mail', to: 't', id: 'i', sealed: 's' } })).toBeNull()
  })
})

describe('parseSwarmEnvelope (the relay envelope)', () => {
  it('reads a wrapped byte-protocol frame', () => {
    const envelope = parseSwarmEnvelope({ type: 'SWARM_FRAME', swarm: { type: 'SWARM_WANT', id: 'o1' } })
    expect(envelope).not.toBeNull()
    expect(envelope!.kind).toBe('swarm')
    if (envelope!.kind !== 'swarm') throw new Error('expected a swarm frame')
    expect(envelope!.frame.type).toBe('SWARM_WANT')
  })

  it('keeps the sender the relay proved', () => {
    const envelope = parseSwarmEnvelope({
      type: 'SWARM_FRAME', relayedBy: 'u1', swarm: { type: 'SWARM_WANT', id: 'o1' },
    })
    expect(envelope).not.toBeNull()
    if (envelope!.kind !== 'swarm') throw new Error('expected a swarm frame')
    expect(envelope!.relayedBy).toBe('u1')
  })

  it('reads a wrapped announcement', () => {
    const envelope = parseSwarmEnvelope({
      type: 'SWARM_FRAME', relayedBy: 'u1',
      swarm: { type: 'PRESENCE', user: { id: 'u1', publicKey: 'pk', createdAt: 'now' }, timestamp: 5 },
    })
    expect(envelope).not.toBeNull()
    if (envelope!.kind !== 'announce') throw new Error('expected an announce')
    expect(envelope!.announce.type).toBe('PRESENCE')
    expect(envelope!.announce.user.id).toBe('u1')
    expect(envelope!.announce.relayedBy).toBe('u1')
  })

  it('reads a wrapped sealed DM envelope (the mesh DM relay path)', () => {
    const envelope = parseSwarmEnvelope({
      type: 'SWARM_FRAME', relayedBy: 'u1',
      swarm: { type: 'SWARM_DM', envelope: { v: 2, kind: 'mail', to: 'tok', id: 'e1', sealed: 'AAAA', fromEph: 'eph' } },
    })
    expect(envelope).not.toBeNull()
    if (envelope?.kind !== 'swarm') throw new Error('expected a swarm frame')
    expect(envelope.frame.type).toBe('SWARM_DM')
    expect(envelope.relayedBy).toBe('u1')
  })

  it('refuses a frame that is not the relay envelope', () => {
    expect(parseSwarmEnvelope(null)).toBeNull()
    expect(parseSwarmEnvelope({ type: 'feed' })).toBeNull()
    expect(parseSwarmEnvelope({ type: 'SWARM_FRAME' })).toBeNull()
    expect(parseSwarmEnvelope({ type: 'SWARM_FRAME', swarm: { type: 'feed' } })).toBeNull()
  })
})

describe('parseBareSwarmAnnounce (the mesh / local-tab path)', () => {
  it('reads a bare announcement', () => {
    const announce = parseBareSwarmAnnounce({
      type: 'CHAT',
      user: { id: 'u1', publicKey: 'pk', createdAt: 'now', display_name: 'Bob' },
      chatMessage: { id: 'm1', senderId: 'u1', senderName: 'Bob', text: 'yo', timestamp: 7 },
      timestamp: 7,
    })
    expect(announce).not.toBeNull()
    expect(announce!.type).toBe('CHAT')
    expect(announce!.chatMessage?.text).toBe('yo')
    expect(announce!.user.display_name).toBe('Bob')
  })

  it('refuses an announcement without a user id', () => {
    expect(parseBareSwarmAnnounce({ type: 'PRESENCE' })).toBeNull()
    expect(parseBareSwarmAnnounce({ type: 'PRESENCE', user: { id: '' } })).toBeNull()
  })

  it('refuses a chat line without text', () => {
    const announce = parseBareSwarmAnnounce({
      type: 'CHAT',
      user: { id: 'u1', publicKey: 'pk', createdAt: 'now' },
      chatMessage: { id: 'm1' },
    })
    expect(announce).toBeNull()
  })

  it('refuses an object without an id', () => {
    const announce = parseBareSwarmAnnounce({
      type: 'IMAGE_ANNOUNCE',
      user: { id: 'u1', publicKey: 'pk', createdAt: 'now' },
      payload: { owner_id: 'u2' },
    })
    expect(announce).toBeNull()
  })
})

describe('the announced sender', () => {
  it('refuses an announcement whose user id disagrees with the relay', () => {
    // The relay PROVED who sent the frame; a self-described id that differs
    // is an impersonation attempt.
    const envelope = parseSwarmEnvelope({
      type: 'SWARM_FRAME', relayedBy: 'u1',
      swarm: { type: 'PRESENCE', user: { id: 'u2', publicKey: 'pk', createdAt: 'now' } },
    })
    expect(envelope).toBeNull()
  })

  it('accepts the announcement the relay proved', () => {
    const envelope = parseSwarmEnvelope({
      type: 'SWARM_FRAME', relayedBy: 'u1',
      swarm: { type: 'PRESENCE', user: { id: 'u1', publicKey: 'pk', createdAt: 'now' } },
    })
    expect(envelope).not.toBeNull()
  })
})
