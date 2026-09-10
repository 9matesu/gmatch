import { describe, it, expect } from 'vitest'
import { mintTurnCreds, verifyTurnCreds } from './turn-creds'

const SECRET = 'super-secret-shared-with-coturn'
const NOW = 1_788_900_000_000 // fixed clock

describe('ephemeral TURN credentials (coturn use-auth-secret)', () => {
  it('mints a username/credential pair coturn accepts', () => {
    const c = mintTurnCreds(SECRET, ['turn:turn.example.org:3478'], NOW, 3600)
    expect(c.username).toMatch(/^[0-9a-f]{16}:\d+$/)
    expect(verifyTurnCreds(SECRET, c.username, c.credential, NOW)).toBe(true)
  })

  it('rejects the wrong secret', () => {
    const c = mintTurnCreds(SECRET, [], NOW)
    expect(verifyTurnCreds('other-secret', c.username, c.credential, NOW)).toBe(false)
  })

  it('rejects expired credentials', () => {
    const c = mintTurnCreds(SECRET, [], NOW, 60)
    expect(verifyTurnCreds(SECRET, c.username, c.credential, NOW + 61_000)).toBe(false)
    expect(verifyTurnCreds(SECRET, c.username, c.credential, NOW + 59_000)).toBe(true)
  })

  it('rejects malformed usernames / non-base64 creds', () => {
    expect(verifyTurnCreds(SECRET, 'alice:9999999999', 'x', NOW)).toBe(false) // not random-hex
    expect(verifyTurnCreds(SECRET, 'a'.repeat(16) + ':0', 'x', NOW)).toBe(false) // epoch 0 = past
    const c = mintTurnCreds(SECRET, [], NOW)
    expect(verifyTurnCreds(SECRET, c.username, 'not base64 !!!', NOW)).toBe(false)
  })

  it('usernames never embed an identity (blind relay: TURN logs cannot say who)', () => {
    const orbitId = 'deadbeef'.repeat(8)
    const c = mintTurnCreds(SECRET, [], NOW, 3600)
    expect(c.username).not.toContain(orbitId)
    expect(c.username.split(':')[0]).toHaveLength(16)
  })

  it('two mints at the same instant differ (fresh random per request)', () => {
    const a = mintTurnCreds(SECRET, [], NOW)
    const b = mintTurnCreds(SECRET, [], NOW)
    expect(a.username).not.toBe(b.username)
  })

  it('empty secret is a hard error (no silent open relay)', () => {
    expect(() => mintTurnCreds('', [])).toThrow(/TURN_SECRET/)
  })
})
