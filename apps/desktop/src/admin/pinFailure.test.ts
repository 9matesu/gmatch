import { describe, expect, it } from 'vitest'
import { describePinFailure } from './pinFailure'

/**
 * The passcode failure is reported as one opaque string, and the three real
 * causes are nothing alike. These tests pin the distinction, because the
 * whole point of the change is that "wrong passcode" and "this node has no
 * passcode to compare against" stop looking the same.
 */

const NODE = 'https://gmatch.pages.dev'

describe('describePinFailure', () => {
  it('names the node on a wrong passcode', () => {
    const msg = describePinFailure(401, 'Invalid secret admin passcode', NODE)
    expect(msg).toContain('gmatch.pages.dev')
    expect(msg).toMatch(/wrong passcode/i)
  })

  it('mentions the identity allowlist, because a correct PIN also gives 401', () => {
    // admin.ts runs the ADMIN_ORBIT_ID gate BEFORE comparing the PIN, so a
    // right passcode from the wrong account is indistinguishable from a wrong
    // passcode at the status level. Saying only "wrong passcode" sends people
    // to retype a PIN that was already right.
    expect(describePinFailure(401, null, NODE)).toMatch(/ADMIN_ORBIT_ID/)
  })

  it('says the node has NO passcode configured on 503', () => {
    // 503 is the fail-closed path: ADMIN_PIN and ADMIN_PIN_HASH both unset.
    // No passcode can ever succeed there, and the raw body reads like a config
    // error only if you already know that.
    const msg = describePinFailure(503, 'Admin console disabled', NODE)
    expect(msg).toMatch(/ADMIN_PIN/)
    expect(msg).not.toMatch(/wrong passcode/i)
  })

  it('says the node does not run the admin service on 404', () => {
    // A courier node (SITE_SERVICES=mail,turn) does not route /api/admin/*.
    const msg = describePinFailure(404, 'Not Found', NODE)
    expect(msg).toMatch(/admin service/i)
    expect(msg).toMatch(/SITE_SERVICES/)
  })

  it('explains a lockout rather than repeating the passcode error', () => {
    expect(describePinFailure(429, null, NODE)).toMatch(/15 minutes/i)
  })

  it('distinguishes 403 (grant expired) from 401 (bad passcode)', () => {
    expect(describePinFailure(403, 'Forbidden', NODE)).toMatch(/expired/i)
  })

  it('never leaks the passcode back in the message', () => {
    // orbitFetch retries any 401 with a fresh signature, so one wrong click
    // costs two lockout strikes. The message must not tempt a retry loop.
    const msg = describePinFailure(401, 'Invalid secret admin passcode', NODE)
    expect(msg).not.toMatch(/try again/i)
  })

  it('falls back to the server string on an unexpected status', () => {
    expect(describePinFailure(500, 'Internal', NODE)).toContain('Internal')
    expect(describePinFailure(500, null, NODE)).toMatch(/500/)
  })

  it('degrades gracefully with no node URL', () => {
    expect(describePinFailure(401, null, undefined)).toMatch(/wrong passcode/i)
  })
})
