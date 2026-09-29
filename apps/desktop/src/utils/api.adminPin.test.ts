// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { _resetNodeKeyCache } from './api'

/**
 * The 401 retry is normally the right behaviour: a request signed too long ago
 * comes back 401 and a fresh signature succeeds, so retrying silently spares
 * the user a spurious logout. It must not happen on the admin passcode.
 *
 * /api/admin/verify-pin counts every 401 against a 5-strikes/15-minutes
 * lockout. Retrying a wrong passcode is guaranteed to be wrong, so the retry
 * doubled the cost of every typo — three typos locked the user out of the
 * console for a quarter of an hour.
 */

const client = generateIdentity()
const identity = {
  orbitId: client.orbitId,
  publicKeyHex: client.publicKeyHex,
  privateKeyHex: client.privateKeyHex,
  encryptionPubHex: client.encryptionPubHex,
  encryptionPrivHex: client.encryptionPrivHex,
} as never

let calls: string[] = []

beforeEach(() => {
  calls = []
  _resetNodeKeyCache()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid secret admin passcode' }),
      clone: () => ({ ok: false, status: 401 }),
      headers: new Map(),
    } as unknown as Response
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('orbitFetch 401 retry', () => {
  it('does NOT retry the admin passcode endpoint', async () => {
    const { orbitFetch } = await import('./api')
    await orbitFetch('/api/admin/verify-pin', { method: 'POST', body: '{}' }, identity)
    // Count only attempts at the passcode endpoint: a POST may be preceded by
    // an unrelated preflight (the node pubkey lookup for sealing).
    const probes = calls.filter((u) => u.includes('/api/admin/verify-pin'))
    // One strike for one wrong passcode, not two.
    expect(probes).toHaveLength(1)
  })

  it('still retries an ordinary endpoint, where a stale signature is the cause', async () => {
    const { orbitFetch } = await import('./api')
    await orbitFetch('/api/users', { method: 'GET' }, identity)
    expect(calls.filter((u) => u.includes('/api/users'))).toHaveLength(2)
  })

  it('does not retry a passcode check on an absolute URL either', async () => {
    const { orbitFetch } = await import('./api')
    await orbitFetch('https://node.example.com/api/admin/verify-pin', { method: 'POST', body: '{}' }, identity)
    expect(calls.filter((u) => u.includes('/api/admin/verify-pin'))).toHaveLength(1)
  })
})
