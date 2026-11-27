import { describe, it, expect } from 'vitest'
import { mergeGalleryRows, mergeP2pOnly, sortGalleryRows } from './galleryMerge'
import type { OrbitObject } from '@orbit/shared'
import type { StoredObject } from '../../utils/storage'

/**
 * Gallery merge contract tests.
 *
 * The legacy-row and orphan paths are the ones that used to be untestable
 * inside `loadGallery()`: a descriptor row, an orphan `p2p-obj-` row, a swarm
 * row filling a content_url gap. Each is one input here.
 */

const selfId = 'self'

function db(over: Partial<StoredObject> & { id: string }): StoredObject {
  return {
    name: over.id,
    mime_type: 'image/jpeg',
    size_bytes: 1,
    owner_id: selfId,
    sender_pubkey: 'sp',
    sender_enc_pubkey: 'sep',
    created_at: '2026-01-01T00:00:00.000Z',
    data: new ArrayBuffer(0),
    ...over,
  } as StoredObject
}

function obj(over: Partial<OrbitObject> & { id: string }): OrbitObject {
  return { ...over } as OrbitObject
}

const base = {
  inbox: [] as OrbitObject[],
  dbObjects: [] as StoredObject[],
  p2pItems: [] as OrbitObject[],
  canonicalCardMediaIds: new Set<string>(),
  selfId,
  selfDisplayName: 'Me',
  directory: [{ id: 'peer-1', display_name: 'Peer One' }],
}

describe('mergeGalleryRows', () => {
  it('rebuilds a mirror row from its stored flags, never from a fabricated default', () => {
    // The row the merge produces comes from IndexedDB through buildMirrorRow:
    // the mirror's own caption wins over the inbox copy (the server row is the
    // BASE for display_name/owner, the mirror rebuild carries the stored flags).
    const merged = mergeGalleryRows({
      ...base,
      inbox: [obj({ id: 'x', caption: 'server', owner_id: 'peer-1' })],
      dbObjects: [db({ id: 'x', caption: 'mirror', is_public: 0 })],
    })
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0].caption).toBe('mirror')
    expect((merged.items[0] as unknown as { is_public?: number }).is_public).toBe(0)
  })

  it('leaves a mirror row with no stored flag flag-less (card surfaces exclude it)', () => {
    const merged = mergeGalleryRows({
      ...base,
      dbObjects: [db({ id: 'x' })],
    })
    expect((merged.items[0] as unknown as { is_public?: number }).is_public).toBeUndefined()
  })

  it('reports a p2p-obj- row that no card references as an orphan (never keeps it)', () => {
    const merged = mergeGalleryRows({
      ...base,
      dbObjects: [db({ id: 'p2p-obj-orphan' })],
    })
    expect(merged.items).toHaveLength(0)
    expect(merged.orphanIds).toEqual(['p2p-obj-orphan'])
  })

  it('keeps a p2p-obj- row a card DOES reference', () => {
    const merged = mergeGalleryRows({
      ...base,
      dbObjects: [db({ id: 'p2p-obj-keep' })],
      canonicalCardMediaIds: new Set(['p2p-obj-keep']),
    })
    expect(merged.items).toHaveLength(1)
    expect(merged.orphanIds).toEqual([])
  })

  it('recovers a legacy descriptor row (data is a URL) and reports it, without dropping it', () => {
    const merged = mergeGalleryRows({
      ...base,
      dbObjects: [db({ id: 'legacy', data: new TextEncoder().encode('https://cdn.test/x.jpg').buffer as ArrayBuffer })],
    })
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0].content_url).toBe('https://cdn.test/x.jpg')
    expect(merged.recoveredRows).toHaveLength(1)
  })

  it('resolves an own row as "You" and a peer row from the directory', () => {
    const merged = mergeGalleryRows({
      ...base,
      dbObjects: [db({ id: 'own' }), db({ id: 'peer', owner_id: 'peer-1' })],
    })
    const own = merged.items.find((i) => i.id === 'own')!
    const peer = merged.items.find((i) => i.id === 'peer')!
    expect(own.display_name).toBe('Me')
    expect(peer.display_name).toBe('Peer One')
  })

  it('lets a swarm row fill a missing content_url but never overwrite one', () => {
    const merged = mergeGalleryRows({
      ...base,
      inbox: [obj({ id: 'x', content_url: 'https://cdn.test/keep.jpg' })],
      p2pItems: [obj({ id: 'x', content_url: 'https://cdn.test/other.jpg' })],
    })
    expect(merged.items[0].content_url).toBe('https://cdn.test/keep.jpg')
  })

  it('adds a swarm row the other sources do not have', () => {
    const merged = mergeGalleryRows({
      ...base,
      p2pItems: [obj({ id: 'swarm-only', owner_id: 'peer-1' })],
    })
    expect(merged.items.map((i) => i.id)).toEqual(['swarm-only'])
  })

  it('sorts newest first', () => {
    const merged = mergeGalleryRows({
      ...base,
      inbox: [
        obj({ id: 'old', created_at: '2026-01-01T00:00:00.000Z' }),
        obj({ id: 'new', created_at: '2026-03-01T00:00:00.000Z' }),
      ],
    })
    expect(merged.items.map((i) => i.id)).toEqual(['new', 'old'])
  })
})

describe('mergeP2pOnly', () => {
  it('adds incoming rows and fills a missing content_url, keeping current order when nothing changed', () => {
    const current = [obj({ id: 'a', content_url: 'keep' })]
    const same = mergeP2pOnly(current, [obj({ id: 'a', content_url: 'other' })])
    expect(same).toBe(current)
    const added = mergeP2pOnly(current, [obj({ id: 'b' })])
    expect(added.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })
})

describe('sortGalleryRows', () => {
  it('treats a missing created_at as oldest', () => {
    const rows = sortGalleryRows([
      obj({ id: 'dated', created_at: '2026-01-01T00:00:00.000Z' }),
      obj({ id: 'undated' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['dated', 'undated'])
  })
})