import { describe, expect, it } from 'vitest'
import {
  descriptorUrlFromBytes,
  mediaFlag,
  recoverDescriptorRow,
  resolveClaimedOwner,
} from './objectDescriptor'

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('mediaFlag', () => {
  it('normalises every spelling of yes', () => {
    for (const v of [1, true, '1', 'true']) expect(mediaFlag(v)).toBe(1)
  })

  it('normalises every spelling of no', () => {
    for (const v of [0, false, '0', 'false']) expect(mediaFlag(v)).toBe(0)
  })

  it('reports unknown as null instead of guessing', () => {
    for (const v of [undefined, null, '', 'maybe', 2, {}]) expect(mediaFlag(v)).toBeNull()
  })
})

describe('descriptorUrlFromBytes', () => {
  it('recognises the URL shapes a swarm announcement can carry', () => {
    expect(descriptorUrlFromBytes(bytes('https://cdn.example/a.jpg'))).toBe('https://cdn.example/a.jpg')
    expect(descriptorUrlFromBytes(bytes('/api/objects/abc123'))).toBe('/api/objects/abc123')
    expect(descriptorUrlFromBytes(bytes('gmcache://local/sha256.abc.jpg'))).toBe('gmcache://local/sha256.abc.jpg')
  })

  it('tolerates surrounding whitespace', () => {
    expect(descriptorUrlFromBytes(bytes('  https://cdn.example/a.jpg\n'))).toBe('https://cdn.example/a.jpg')
  })

  it('never mistakes real media bytes for a descriptor', () => {
    // A PNG signature is not valid UTF-8 and is not a URL.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xff, 0xfe])
    expect(descriptorUrlFromBytes(png.buffer)).toBeNull()
  })

  it('rejects empty, oversized and non-URL text', () => {
    expect(descriptorUrlFromBytes(new ArrayBuffer(0))).toBeNull()
    expect(descriptorUrlFromBytes(bytes('not a url'))).toBeNull()
    expect(descriptorUrlFromBytes(bytes('https://a/' + 'x'.repeat(5000)))).toBeNull()
    expect(descriptorUrlFromBytes(undefined)).toBeNull()
    expect(descriptorUrlFromBytes('https://cdn.example/a.jpg')).toBeNull()
  })
})

describe('recoverDescriptorRow', () => {
  it('leaves a real media row untouched', () => {
    // Real media bytes (not UTF-8 text) + the provider url as a separate field.
    const mediaBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xfe]).buffer
    const row = { id: 'a', data: mediaBytes, content_url: 'https://cdn.example/a.jpg' }
    const out = recoverDescriptorRow(row)
    expect(out.descriptorOnly).toBe(false)
    expect(out.changed).toBe(false)
    expect(out.row).toBe(row)
    expect(out.sourceUrl).toBe('https://cdn.example/a.jpg')
  })

  it('recovers a legacy descriptor row once, then is a no-op', () => {
    const legacy = { id: 'a', data: bytes('https://cdn.example/a.jpg') }
    const first = recoverDescriptorRow(legacy)
    expect(first.descriptorOnly).toBe(true)
    expect(first.changed).toBe(true)
    expect(first.sourceUrl).toBe('https://cdn.example/a.jpg')
    // The recovered row keeps its identity and gains the URL it was carrying.
    expect(first.row.id).toBe('a')
    expect((first.row as any).source_url).toBe('https://cdn.example/a.jpg')
    // Second pass: idempotent, no further copy, bytes still present (never deleted).
    const second = recoverDescriptorRow(first.row)
    expect(second.changed).toBe(false)
    expect(second.row).toBe(first.row)
    expect(second.descriptorOnly).toBe(true)
    expect((second.row as any).data).toBe(legacy.data)
  })

  it('does not overwrite a source url the row already has', () => {
    const out = recoverDescriptorRow({
      id: 'a',
      data: bytes('https://old.example/a.jpg'),
      source_url: 'https://new.example/a.jpg',
    })
    expect(out.sourceUrl).toBe('https://new.example/a.jpg')
    expect(out.changed).toBe(false)
  })
})

describe('resolveClaimedOwner', () => {
  it('verifies the sender when it claims its own upload', () => {
    expect(resolveClaimedOwner('alice', 'alice')).toEqual({ owner_id: 'alice', owner_verified: true })
  })

  it('attributes an unattributed object to the sender', () => {
    expect(resolveClaimedOwner(undefined, 'alice')).toEqual({ owner_id: 'alice', owner_verified: true })
  })

  it('keeps a relayer claim but marks it unverified', () => {
    expect(resolveClaimedOwner('bob', 'alice')).toEqual({ owner_id: 'bob', owner_verified: false })
  })

  it('never verifies a claim without a proven sender', () => {
    expect(resolveClaimedOwner('bob', '')).toEqual({ owner_id: 'bob', owner_verified: false })
  })
})
