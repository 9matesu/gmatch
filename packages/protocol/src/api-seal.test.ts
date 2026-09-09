// T2: sealed API requests. Protocol-level round-trip for the new helper.
import { describe, it, expect } from 'vitest'
import { generateIdentity } from '@orbit/crypto'
import { sealApiRequest, openApiRequest } from './envelope'

describe('sealed api request envelopes (kind=api_req)', () => {
  it('round-trips a signed headers+body payload through node ECIES', () => {
    const client = generateIdentity()
    const node = generateIdentity()
    const payload = {
      headers: {
        'X-Orbit-Id': client.orbitId,
        'X-Orbit-Timestamp': '1700000000000',
        'X-Orbit-Nonce': 'aabbccddeeff00112233445566778899',
        'X-Orbit-Signature': 'deadbeef',
        'X-Orbit-PubKey': client.publicKeyHex,
      },
      body: '{"caption":"private text"}',
    }
    const header = sealApiRequest(payload, client, node.encryptionPubHex)
    expect(header).not.toContain('private text')
    const opened = openApiRequest(header, node.encryptionPrivHex)
    expect(opened.body).toBe(payload.body)
    expect(opened.headers).toEqual(payload.headers)
  })

  it('rejects garbage headers and non-openable blobs', () => {
    const node = generateIdentity()
    expect(() => openApiRequest('not-a-sealed-header', node.encryptionPrivHex)).toThrow()
    expect(() => openApiRequest('aaaa|bbbb', node.encryptionPrivHex)).toThrow()
  })
})
