import { describe, expect, it } from 'vitest'
import { selectObjectsForSwarm, type StoredObject } from './storage'

function object(id: string, data: ArrayBuffer): StoredObject {
  return {
    id, name: id, mime_type: 'application/octet-stream', size_bytes: data.byteLength,
    owner_id: '', sender_pubkey: '', sender_enc_pubkey: '', created_at: '', data,
  }
}

describe('selectObjectsForSwarm', () => {
  it('selects within the byte budget and skips an oversized entry', () => {
    const rows = [
      object('large', new Uint8Array(8).buffer),
      object('small-a', new Uint8Array(3).buffer),
      object('small-b', new Uint8Array(4).buffer),
    ]
    expect(selectObjectsForSwarm(rows, 7).map((row) => row.id)).toEqual(['small-a', 'small-b'])
    expect(selectObjectsForSwarm(rows, 0)).toEqual([])
  })
})
