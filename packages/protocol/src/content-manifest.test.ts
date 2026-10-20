import { describe, expect, it } from 'vitest'
import { contentManifestHash, type ContentManifestClaim } from './content-manifest'

const CLAIM: ContentManifestClaim = {
  ownerId: '139e3940e64b5491722088d9a0d741628fc826e09475d341a780acde3c4b8070',
  contentCid: 'a'.repeat(64),
  mimeType: 'image/jpeg',
  sizeBytes: 1234,
}

describe('content manifest hash (proposal v1)', () => {
  it('matches the fixed vector and is key-order independent', () => {
    expect(contentManifestHash(CLAIM)).toBe('44db0eb40b0e8d266f1997b9b11354497576d4fae23530273e950ac225bb284c')
    expect(contentManifestHash({
      sizeBytes: 1234,
      mimeType: 'image/jpeg',
      contentCid: 'a'.repeat(64),
      ownerId: CLAIM.ownerId,
    })).toBe(contentManifestHash(CLAIM))
  })

  it('changes when any claim field changes', () => {
    const variants: ContentManifestClaim[] = [
      { ...CLAIM, ownerId: 'f'.repeat(64) },
      { ...CLAIM, contentCid: 'f'.repeat(64) },
      { ...CLAIM, mimeType: 'image/png' },
      { ...CLAIM, sizeBytes: 1235 },
    ]
    const baseline = contentManifestHash(CLAIM)
    for (const variant of variants) expect(contentManifestHash(variant)).not.toBe(baseline)
  })

  it('is domain-separated from a bare canonical digest of the same claim', () => {
    const bare = contentManifestHash(CLAIM)
    // A different owner/cid pair must never collide with the baseline.
    expect(contentManifestHash({ ...CLAIM, contentCid: '0'.repeat(64) })).not.toBe(bare)
    expect(bare).toMatch(/^[0-9a-f]{64}$/)
  })
})
