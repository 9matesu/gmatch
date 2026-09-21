import { describe, it, expect } from 'vitest'
import { buildMirrorRow, type MirrorStoredRow } from './galleryMirror'
import type { OrbitObject } from '@orbit/shared'

const bare: MirrorStoredRow = {
  id: 'obj-1',
  owner_id: '',
  size_bytes: 10,
  mime_type: 'image/jpeg',
  created_at: '2026-01-01T00:00:00.000Z',
  sender_pubkey: '',
  sender_enc_pubkey: '',
}

describe('buildMirrorRow', () => {
  it('keeps server flags for a known public post instead of phantom-minting it', () => {
    const prev = { id: 'obj-1', owner_id: 'me', is_public: 1, caption: 'hi' } as OrbitObject
    const row = buildMirrorRow(bare, prev, 'blob:local', 'You')
    expect(row.is_public).toBe(1)
    expect(row.content_url).toBe('blob:local')
  })

  it('applies explicit mirror flags (forge-time) over a missing server row', () => {
    const flagged: MirrorStoredRow = { ...bare, owner_id: 'me', is_public: 0, is_story: 0, is_chat: 0, is_avatar: 0 }
    const row = buildMirrorRow(flagged, undefined, 'blob:local', 'You')
    expect(row.is_public).toBe(0)
    expect(row.is_story).toBe(0)
    expect(row.owner_id).toBe('me')
  })

  it('leaves unknown rows flag-less and unattributed so card surfaces exclude them', () => {
    const row = buildMirrorRow(bare, undefined, 'blob:local', '???')
    expect('is_public' in row).toBe(false)
    expect('is_story' in row).toBe(false)
    expect('is_chat' in row).toBe(false)
    expect('is_avatar' in row).toBe(false)
    expect(row.owner_id).toBe('')
  })

  it('marks a mirrored story row so it never renders as a card', () => {
    const story: MirrorStoredRow = { ...bare, owner_id: 'me', is_story: 1, is_public: 0 }
    const row = buildMirrorRow(story, undefined, 'blob:local', 'You')
    expect(row.is_story).toBe(1)
  })
})
