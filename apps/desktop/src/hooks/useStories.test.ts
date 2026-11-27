import { describe, expect, it } from 'vitest'
import type { OrbitObject } from '@orbit/shared'
import { liveStories } from './useStories'

const story = (over: Partial<OrbitObject> = {}): OrbitObject =>
  ({
    id: 's1',
    owner_id: 'u1',
    size_bytes: 0,
    mime_type: 'image/jpeg',
    created_at: new Date().toISOString(),
    ...over,
  }) as OrbitObject

describe('liveStories (24h story TTL)', () => {
  it('keeps a story whose expiry is still ahead', () => {
    const expires = new Date(Date.now() + 23 * 3600 * 1000).toISOString()
    expect(liveStories([story({ expires_at: expires })])).toHaveLength(1)
  })

  it('drops a story whose expiry has passed', () => {
    const expires = new Date(Date.now() - 1000).toISOString()
    expect(liveStories([story({ expires_at: expires })])).toHaveLength(0)
  })

  it('keeps rows with no expiry (non-story objects)', () => {
    expect(liveStories([story()])).toHaveLength(1)
  })
})
