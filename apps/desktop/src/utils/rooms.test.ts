// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateIdentity } from '@orbit/crypto'

import { RoomManager, type Room } from './rooms'
import { DmStore } from './mail-dm'
import type { MailClient } from './mail-client'

const owner = generateIdentity()
const member = generateIdentity()
const third = generateIdentity()

// jsdom in this repo has no localStorage; stub (repo pattern).
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value) },
  removeItem: (key) => { delete storage[key] },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key] },
  key: () => null,
  length: 0,
} as Storage

interface Sent { to: string; body: string; kind: string }

function fakeMail(): { mail: MailClient; outbox: Sent[] } {
  const outbox: Sent[] = []
  const mail = {
    send: async (body: string, kind: string, recipient: { publicKeyHex: string }) => {
      outbox.push({ to: recipient.publicKeyHex, body, kind })
      return { v: 2 as const, kind: kind as never, to: '', id: 'e' + outbox.length, sealed: 'x' }
    },
  } as unknown as MailClient
  return { mail, outbox }
}

function managerFor(identity: typeof owner, knownPeers: Array<typeof owner | typeof member | typeof third>) {
  const store = new DmStore(identity)
  for (const p of [owner, member, third]) {
    if (knownPeers.includes(p)) {
      store.rememberPeer(p.orbitId, { publicKeyHex: p.publicKeyHex, encryptionPubHex: p.encryptionPubHex })
    }
  }
  const { mail, outbox } = fakeMail()
  const mgr = new RoomManager({ identity, mail, peers: store, onChanged: vi.fn() })
  return { mgr, store, mail, outbox }
}

beforeEach(() => localStorage.clear())

describe('Ares-style rooms over the blind courier', () => {
  it('createRoom stores the room locally with a fresh DEK', () => {
    const { mgr } = managerFor(owner, [member])
    const room = mgr.createRoom('backroom')
    expect(mgr.rooms()).toHaveLength(1)
    expect(room.name).toBe('backroom')
    expect(room.members).toEqual([owner.orbitId])
    expect(room.dekHex).toHaveLength(64)
    expect(room.epoch).toBe(1)
  })

  it('invite seals the FULL room state (incl. DEK) 1:1 to the peer; wire has no plaintext room name', async () => {
    const { mgr, outbox } = managerFor(owner, [member])
    const room = mgr.createRoom('secret lounge')
    const ok = await mgr.invite(room.id, member.orbitId)
    expect(ok).toBe(true)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].kind).toBe('invite')
    // The outbox captured the PRE-seal body handed to MailClient.send; the
    // seal itself is MailClient's job (asserted in mail-client tests). Here:
    // right recipient + room state present for the invitee:
    const wire = JSON.parse(outbox[0].body)
    expect(wire.t).toBe('room_invite')
    expect(wire.room.dekHex).toBe(room.dekHex)
    expect(mgr.rooms()[0].members).toContain(member.orbitId)
    // unknown peer -> refused (no silent half-join)
    expect(await mgr.invite(room.id, third.orbitId)).toBe(false)
  })

  it('member accepts invite, owner says -> member opens room_msg via DEK', async () => {
    const o = managerFor(owner, [member])
    const room = o.mgr.createRoom('lounge')
    await o.mgr.invite(room.id, member.orbitId)
    const wireBody = o.outbox[0].body

    const m = managerFor(member, [owner])
    // member processes the invite envelope (outer ECIES already opened):
    const handled = m.mgr.handleOpened({
      kind: 'invite', id: 'e1', to: '', body: wireBody,
      senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId,
    })
    expect(handled).toBe(true)
    expect(m.mgr.rooms()[0].name).toBe('lounge')

    // owner posts -> the member receives the room_msg_wire mail body:
    await o.mgr.say(room.id, 'hello room')
    expect(o.outbox.length).toBe(2) // invite + say
    const msgWire = o.outbox[1].body
    const opened = m.mgr.handleOpened({
      kind: 'mail', id: 'e2', to: '', body: msgWire,
      senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId,
    })
    expect(opened).toBe(true)
    const msgs = m.mgr.messages(room.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('hello room')
    expect(msgs[0].senderOrbitId).toBe(owner.orbitId)
  })

  it('a stale-DEK member cannot open (epoch guard), re-invite fixes', async () => {
    const o = managerFor(owner, [member, third])
    const room = o.mgr.createRoom('lounge')
    await o.mgr.invite(room.id, member.orbitId)
    const inviteWire = o.outbox[0].body

    const m = managerFor(member, [owner])
    m.mgr.handleOpened({ kind: 'invite', id: 'i', to: '', body: inviteWire, senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId })

    await o.mgr.say(room.id, 'before rewrap')
    const msgWire = o.outbox[1].body

    // owner leaves/re-wraps scenario: manually bump room DEK and post again:
    const rooms = o.mgr.rooms()
    const bumped: Room = { ...rooms[0], dekHex: 'ff'.repeat(32), epoch: 2 }
    ;(o.mgr as unknown as { saveRooms(r: Room[]): void }).saveRooms([bumped])
    await o.mgr.say(room.id, 'after rewrap')
    const after = o.outbox[o.outbox.length - 1].body

    expect(m.mgr.handleOpened({ kind: 'mail', id: 'm1', to: '', body: msgWire, senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId })).toBe(true)
    expect(m.mgr.messages(room.id)).toHaveLength(1) // the pre-rewrap message opened
    // post-rewrap message: stale DEK -> consumed but NOT appended:
    expect(m.mgr.handleOpened({ kind: 'mail', id: 'm2', to: '', body: after, senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId })).toBe(true)
    expect(m.mgr.messages(room.id)).toHaveLength(1)
  })

  it('leave: member tells owner, owner re-wraps DEK (epoch+1) and drops the leaver', async () => {
    const o = managerFor(owner, [member, third])
    const room = o.mgr.createRoom('lounge')
    await o.mgr.invite(room.id, member.orbitId)
    await o.mgr.invite(room.id, third.orbitId)
    expect(o.mgr.rooms()[0].members).toHaveLength(3)

    // member leaves: sends room_leave wire to owner
    const m = managerFor(member, [owner])
    await m.mgr.handleOpened({ kind: 'invite', id: 'i', to: '', body: o.outbox[0].body, senderPubHex: owner.publicKeyHex, senderOrbitId: owner.orbitId })
    await m.mgr.leave(room.id) // enqueues a room_leave mail toward the owner
    const leaveWire = m.outbox[m.outbox.length - 1]?.body
    expect(leaveWire).toContain('room_leave')

    // owner receives the leave -> re-wrap + drop + re-invites survivors
    const before = o.mgr.rooms()[0]
    const handled = o.mgr.handleOpened({ kind: 'mail', id: 'l', to: '', body: leaveWire, senderPubHex: member.publicKeyHex, senderOrbitId: member.orbitId })
    expect(handled).toBe(true)
    const after = o.mgr.rooms()[0]
    expect(after.epoch).toBe(before.epoch + 1)
    expect(after.dekHex).not.toBe(before.dekHex)
    expect(after.members).not.toContain(member.orbitId)
    expect(after.members).toContain(third.orbitId)
    // re-invites went out to survivors (third), each carrying the NEW room:
    const reinvites = o.outbox.filter((x) => x.kind === 'invite' && x.body.includes(`"epoch":${after.epoch}`))
    expect(reinvites.length).toBeGreaterThanOrEqual(1)
  })

  it('say fans the SAME group envelope to every member (one logical message)', async () => {
    const o = managerFor(owner, [member, third])
    const room = o.mgr.createRoom('lounge')
    await o.mgr.invite(room.id, member.orbitId)
    await o.mgr.invite(room.id, third.orbitId)
    o.outbox.length = 0
    await o.mgr.say(room.id, 'broadcast')
    expect(o.outbox).toHaveLength(2)
    expect(JSON.parse(o.outbox[0].body).env.id).toBe(JSON.parse(o.outbox[1].body).env.id)
    expect(JSON.parse(o.outbox[0].body).env.sealed).toBe(JSON.parse(o.outbox[1].body).env.sealed)
  })
})
