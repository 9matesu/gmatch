import { describe, it, expect } from 'vitest'
import { handleMailSocketMessage, mailWatchers, unwatchMailSocket } from './mail'
import app from '../index'
import { generateIdentity } from '@orbit/crypto'
import { deliveryToken, seal1to1 } from '@orbit/protocol'

function fakeSocket() {
  const sent: string[] = []
  const ws: any = { send: (d: string) => sent.push(d), data: { mail: true } }
  mailWatchers.set(ws, new Set())
  return { ws, sent }
}

describe('anonymous mail push channel', () => {
  it('watch -> PUT notifies the watcher with an opaque notice (no content)', async () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const token = deliveryToken(bob.publicKeyHex)
    const { ws, sent } = fakeSocket()

    handleMailSocketMessage(ws, JSON.stringify({ type: 'watch', tokens: [token] }))
    expect(JSON.parse(sent[0]).type).toBe('watch_ack')

    const env = seal1to1('pushed secret', 'mail', alice, bob)
    const putRes = await app.request(`/api/mail/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    })
    expect(putRes.status).toBe(202)

    const notice = JSON.parse(sent[1])
    expect(notice).toEqual({ type: 'mail', to: token, id: env.id })
    expect(sent[1]).not.toContain('pushed secret')
    unwatchMailSocket(ws)
  })

  it('pull returns full envelopes for a watched token', async () => {
    const alice = generateIdentity()
    const bob = generateIdentity()
    const token = deliveryToken(bob.publicKeyHex)
    const env = seal1to1('pulled', 'mail', alice, bob)
    await app.request(`/api/mail/${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    })
    const { ws, sent } = fakeSocket()
    handleMailSocketMessage(ws, JSON.stringify({ type: 'pull', token }))
    const frame = JSON.parse(sent[0])
    expect(frame.type).toBe('mail_list')
    expect(frame.envelopes.some((e: { id: string }) => e.id === env.id)).toBe(true)
    unwatchMailSocket(ws)
  })

  it('invalid frames are ignored; close unregisters everything', () => {
    const { ws, sent } = fakeSocket()
    handleMailSocketMessage(ws, 'not json')
    handleMailSocketMessage(ws, JSON.stringify({ type: 'watch', tokens: ['nothex'] }))
    expect(sent).toHaveLength(1) // watch_ack with count 0
    unwatchMailSocket(ws)
    handleMailSocketMessage(ws, JSON.stringify({ type: 'pull', token: 'a'.repeat(64) }))
    expect(sent).toHaveLength(1) // dead socket: no further frames
  })
})
